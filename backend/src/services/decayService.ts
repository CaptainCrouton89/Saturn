import { neo4jService, neo4jInt } from '../db/neo4j.js';

const BATCH_SIZE = 1000;

const NODE_LABELS = [
  'Person',
  'Concept',
  'Entity',
  'Event',
  'Source',
  'Artifact',
  'Storyline',
  'Macro',
] as const;

const RELATIONSHIP_TYPES = [
  'has_relationship_with',
  'engages_with',
  'associated_with',
  'relates_to',
  'involves',
  'connected_to',
] as const;

function buildNodeDecayQuery(label: string): string {
  const ephemeralDays = ['Source', 'Artifact'].includes(label) ? 30 : 90;
  return `
    MATCH (n:${label})
    WHERE n.salience > 0 AND coalesce(n.state, 'candidate') <> 'archived'
    WITH n
    ORDER BY n.entity_key
    SKIP $skip LIMIT $limit

    WITH n,
      CASE
        WHEN n.is_owner = true THEN 'keep_forever'
        WHEN coalesce(n.ttl_policy, 'decay') = 'keep_forever' THEN 'keep_forever'
        WHEN coalesce(n.ttl_policy, 'decay') = 'ephemeral' THEN 'ephemeral'
        ELSE 'decay'
      END AS effective_ttl,
      duration.between(
        datetime(toString(coalesce(n.last_accessed_at, n.created_at))),
        datetime()
      ).days +
      duration.between(
        datetime(toString(coalesce(n.last_accessed_at, n.created_at))),
        datetime()
      ).months * 30 AS days_unused

    WITH n, effective_ttl, toFloat(days_unused) AS days_unused,
      0.02 / (1.0 + coalesce(n.recall_frequency, 0) ^ coalesce(n.decay_gradient, 1.0)) AS base_decay_rate

    WITH n, effective_ttl, days_unused, base_decay_rate,
      CASE
        WHEN coalesce(n.state, 'candidate') = 'candidate' AND coalesce(n.confidence, 0.5) >= 0.8
          THEN 0.0
        WHEN coalesce(n.state, 'candidate') = 'candidate' AND coalesce(n.confidence, 0.5) < 0.8
          THEN base_decay_rate * (1.0 + (1.0 - coalesce(n.confidence, 0.5)) * 2.0)
        ELSE base_decay_rate
      END AS decay_rate

    WITH n, effective_ttl, days_unused, decay_rate,
      CASE
        WHEN effective_ttl = 'keep_forever' THEN 1.0
        ELSE n.salience * exp(-decay_rate * days_unused)
      END AS new_salience,
      CASE WHEN n.last_accessed_at IS NOT NULL THEN
        duration.between(datetime(toString(n.last_accessed_at)), datetime()).days +
        duration.between(datetime(toString(n.last_accessed_at)), datetime()).months * 30
      ELSE null END AS interval_days

    WITH n, effective_ttl, new_salience, interval_days,
      CASE WHEN interval_days IS NOT NULL THEN
        0.05 + 0.95 * CASE
          WHEN (1.0 - exp(-toFloat(interval_days) / 20.0)) / (1.0 - exp(-90.0 / 20.0)) > 1.0 THEN 1.0
          ELSE (1.0 - exp(-toFloat(interval_days) / 20.0)) / (1.0 - exp(-90.0 / 20.0))
        END
      ELSE null END AS spacing_boost

    WITH n, effective_ttl, new_salience, interval_days, spacing_boost,
      CASE
        WHEN spacing_boost IS NOT NULL AND interval_days > coalesce(n.last_recall_interval, 0)
          THEN coalesce(n.decay_gradient, 1.0) + 0.1 * spacing_boost
        WHEN spacing_boost IS NOT NULL AND interval_days <= coalesce(n.last_recall_interval, 0)
          THEN CASE
            WHEN coalesce(n.decay_gradient, 1.0) - 0.05 * (1.0 - spacing_boost) < 0.5 THEN 0.5
            ELSE coalesce(n.decay_gradient, 1.0) - 0.05 * (1.0 - spacing_boost)
          END
        ELSE coalesce(n.decay_gradient, 1.0)
      END AS new_decay_gradient

    WITH n,
      CASE WHEN effective_ttl = 'keep_forever' THEN 1.0 WHEN new_salience < 0.0 THEN 0.0 WHEN new_salience > 1.0 THEN 1.0 ELSE new_salience END AS final_salience,
      CASE WHEN new_decay_gradient < 0.5 THEN 0.5 ELSE new_decay_gradient END AS final_decay_gradient,
      CASE WHEN interval_days IS NOT NULL THEN interval_days ELSE coalesce(n.last_recall_interval, 0) END AS final_last_recall_interval,
      CASE
        WHEN effective_ttl = 'keep_forever' THEN coalesce(n.state, 'candidate')
        WHEN effective_ttl = 'ephemeral' AND toFloat(duration.between(datetime(toString(n.created_at)), datetime()).days) > ${ephemeralDays} THEN 'archived'
        WHEN new_salience < 0.01 THEN 'archived'
        ELSE coalesce(n.state, 'candidate')
      END AS final_state

    SET
      n.salience = final_salience,
      n.decay_gradient = final_decay_gradient,
      n.last_recall_interval = final_last_recall_interval,
      n.state = final_state

    RETURN count(n) AS processed,
      sum(CASE WHEN n.state = 'archived' THEN 1 ELSE 0 END) AS archived
  `;
}

function buildRelationshipDecayQuery(relType: string): string {
  return `
    MATCH ()-[r:${relType}]-()
    WHERE r.salience > 0 AND coalesce(r.state, 'candidate') <> 'archived'
    WITH r
    ORDER BY elementId(r)
    SKIP $skip LIMIT $limit

    WITH r,
      CASE
        WHEN coalesce(r.ttl_policy, 'decay') = 'keep_forever' THEN 'keep_forever'
        WHEN coalesce(r.ttl_policy, 'decay') = 'ephemeral' THEN 'ephemeral'
        ELSE 'decay'
      END AS effective_ttl,
      duration.between(
        datetime(toString(coalesce(r.last_accessed_at, r.created_at))),
        datetime()
      ).days +
      duration.between(
        datetime(toString(coalesce(r.last_accessed_at, r.created_at))),
        datetime()
      ).months * 30 AS days_unused

    WITH r, effective_ttl, toFloat(days_unused) AS days_unused,
      0.02 / (1.0 + coalesce(r.recall_frequency, 0) ^ coalesce(r.decay_gradient, 1.0)) AS base_decay_rate

    WITH r, effective_ttl, days_unused, base_decay_rate,
      CASE
        WHEN coalesce(r.state, 'candidate') = 'candidate' AND coalesce(r.confidence, 0.5) >= 0.8
          THEN 0.0
        WHEN coalesce(r.state, 'candidate') = 'candidate' AND coalesce(r.confidence, 0.5) < 0.8
          THEN base_decay_rate * (1.0 + (1.0 - coalesce(r.confidence, 0.5)) * 2.0)
        ELSE base_decay_rate
      END AS decay_rate

    WITH r, effective_ttl, days_unused, decay_rate,
      CASE
        WHEN effective_ttl = 'keep_forever' THEN 1.0
        ELSE r.salience * exp(-decay_rate * days_unused)
      END AS new_salience,
      CASE WHEN r.last_accessed_at IS NOT NULL THEN
        duration.between(datetime(toString(r.last_accessed_at)), datetime()).days +
        duration.between(datetime(toString(r.last_accessed_at)), datetime()).months * 30
      ELSE null END AS interval_days

    WITH r, effective_ttl, new_salience, interval_days,
      CASE WHEN interval_days IS NOT NULL THEN
        0.05 + 0.95 * CASE
          WHEN (1.0 - exp(-toFloat(interval_days) / 20.0)) / (1.0 - exp(-90.0 / 20.0)) > 1.0 THEN 1.0
          ELSE (1.0 - exp(-toFloat(interval_days) / 20.0)) / (1.0 - exp(-90.0 / 20.0))
        END
      ELSE null END AS spacing_boost

    WITH r, effective_ttl, new_salience, interval_days, spacing_boost,
      CASE
        WHEN spacing_boost IS NOT NULL AND interval_days > coalesce(r.last_recall_interval, 0)
          THEN coalesce(r.decay_gradient, 1.0) + 0.1 * spacing_boost
        WHEN spacing_boost IS NOT NULL AND interval_days <= coalesce(r.last_recall_interval, 0)
          THEN CASE
            WHEN coalesce(r.decay_gradient, 1.0) - 0.05 * (1.0 - spacing_boost) < 0.5 THEN 0.5
            ELSE coalesce(r.decay_gradient, 1.0) - 0.05 * (1.0 - spacing_boost)
          END
        ELSE coalesce(r.decay_gradient, 1.0)
      END AS new_decay_gradient

    WITH r,
      CASE WHEN effective_ttl = 'keep_forever' THEN 1.0 WHEN new_salience < 0.0 THEN 0.0 WHEN new_salience > 1.0 THEN 1.0 ELSE new_salience END AS final_salience,
      CASE WHEN new_decay_gradient < 0.5 THEN 0.5 ELSE new_decay_gradient END AS final_decay_gradient,
      CASE WHEN interval_days IS NOT NULL THEN interval_days ELSE coalesce(r.last_recall_interval, 0) END AS final_last_recall_interval,
      CASE
        WHEN effective_ttl = 'keep_forever' THEN coalesce(r.state, 'candidate')
        WHEN effective_ttl = 'ephemeral' AND toFloat(duration.between(datetime(toString(r.created_at)), datetime()).days) > 90 THEN 'archived'
        WHEN new_salience < 0.01 THEN 'archived'
        ELSE coalesce(r.state, 'candidate')
      END AS final_state

    SET
      r.salience = final_salience,
      r.decay_gradient = final_decay_gradient,
      r.last_recall_interval = final_last_recall_interval,
      r.state = final_state

    RETURN count(r) AS processed,
      sum(CASE WHEN r.state = 'archived' THEN 1 ELSE 0 END) AS archived
  `;
}

async function processBatches(
  query: string,
  entityLabel: string,
): Promise<{ processed: number; archived: number }> {
  let skip = 0;
  let totalProcessed = 0;
  let totalArchived = 0;

  while (true) {
    const result = await neo4jService.executeQuery<{ processed: number; archived: number }>(
      query,
      { skip: neo4jInt(skip), limit: neo4jInt(BATCH_SIZE) },
    );

    const batch = result[0];
    if (!batch || batch.processed === 0) break;

    totalProcessed += batch.processed;
    totalArchived += batch.archived;
    skip += BATCH_SIZE;

    console.log(
      `[DecayService] ${entityLabel} batch ${skip / BATCH_SIZE}: processed=${batch.processed}, archived=${batch.archived}`,
    );
  }

  return { processed: totalProcessed, archived: totalArchived };
}

export async function runNightlyDecay(): Promise<void> {
  const startTime = Date.now();
  console.log('[DecayService] Starting nightly decay...');

  let totalNodes = 0;
  let totalNodesArchived = 0;
  let totalRels = 0;
  let totalRelsArchived = 0;

  // Process nodes
  for (const label of NODE_LABELS) {
    const query = buildNodeDecayQuery(label);
    const { processed, archived } = await processBatches(query, `Nodes:${label}`);
    totalNodes += processed;
    totalNodesArchived += archived;
    console.log(`[DecayService] Nodes - ${label}: processed=${processed}, archived=${archived}`);
  }

  // Process relationships
  for (const relType of RELATIONSHIP_TYPES) {
    const query = buildRelationshipDecayQuery(relType);
    const { processed, archived } = await processBatches(query, `Rels:${relType}`);
    totalRels += processed;
    totalRelsArchived += archived;
    console.log(`[DecayService] Relationships - ${relType}: processed=${processed}, archived=${archived}`);
  }

  const durationMs = Date.now() - startTime;
  console.log(
    `[DecayService] Complete. Duration: ${durationMs}ms, total nodes: ${totalNodes}, total rels: ${totalRels}, archived: ${totalNodesArchived + totalRelsArchived}`,
  );
}
