#!/usr/bin/env tsx

import { config } from 'dotenv';
import { neo4jService } from '../src/db/neo4j.js';

config();

const semanticRelationshipTypes = [
  'has_relationship_with',
  'engages_with',
  'associated_with',
  'relates_to',
  'involves',
  'mentions',
];

type CountResult = { count: number };

async function mutationCount(query: string, parameters: Record<string, unknown> = {}): Promise<number> {
  const result = await neo4jService.executeQuery<CountResult>(query, parameters);
  if (!result[0]) {
    throw new Error('Deduplication query returned no count');
  }
  return result[0].count;
}

async function duplicateGroupCount(query: string, parameters: Record<string, unknown> = {}): Promise<number> {
  const result = await neo4jService.executeQuery<CountResult>(query, parameters);
  if (!result[0]) {
    throw new Error('Duplicate audit query returned no count');
  }
  return result[0].count;
}

async function main(): Promise<void> {
  await neo4jService.connect();

  try {
    const ownersDemoted = await mutationCount(`
      MATCH (p:Person {is_owner: true})
      WITH p
      ORDER BY p.updated_at DESC, p.created_at DESC, p.entity_key ASC
      WITH p.user_id AS user_id, collect(p) AS owners
      WITH user_id, owners[0] AS canonical_owner, owners[1..] AS duplicate_owners
      SET canonical_owner.owner_key = user_id
      FOREACH (duplicate_owner IN duplicate_owners |
        SET duplicate_owner.is_owner = false,
            duplicate_owner.owner_key = null
      )
      RETURN sum(size(duplicate_owners)) AS count
    `);

    const ownerKeysCleared = await mutationCount(`
      MATCH (p:Person)
      WHERE coalesce(p.is_owner, false) = false AND p.owner_key IS NOT NULL
      SET p.owner_key = null
      RETURN count(p) AS count
    `);

    const eventMentionsRewired = await mutationCount(`
      MATCH (e:Event)
      WITH e
      ORDER BY e.created_at ASC, e.entity_key ASC
      WITH e.entity_key AS event_key, collect(e) AS events
      WHERE size(events) > 1
      UNWIND events[1..] AS duplicate
      MATCH (source:Source)-[mention:mentions]->(duplicate)
      WITH source, mention, events[0] AS canonical_event
      MERGE (source)-[canonical_mention:mentions]->(canonical_event)
      ON CREATE SET
        canonical_mention.created_at = mention.created_at,
        canonical_mention.updated_at = mention.updated_at
      ON MATCH SET canonical_mention.updated_at = coalesce(canonical_mention.updated_at, mention.updated_at)
      RETURN count(DISTINCT duplicate) AS count
    `);

    const eventsRemoved = await mutationCount(`
      MATCH (e:Event)
      WITH e
      ORDER BY e.created_at ASC, e.entity_key ASC
      WITH e.entity_key AS event_key, collect(e) AS events
      WHERE size(events) > 1
      UNWIND events[1..] AS duplicate
      DETACH DELETE duplicate
      RETURN count(duplicate) AS count
    `);

    const relationshipsRemoved = await mutationCount(`
      MATCH (from)-[relationship]->(to)
      WHERE type(relationship) IN $relationship_types
      WITH from, to, type(relationship) AS relationship_type, relationship
      ORDER BY relationship.created_at ASC, relationship.updated_at ASC, elementId(relationship) ASC
      WITH from, to, relationship_type, collect(relationship) AS relationships
      WHERE size(relationships) > 1
      UNWIND relationships[1..] AS duplicate
      DELETE duplicate
      RETURN count(duplicate) AS count
    `, { relationship_types: semanticRelationshipTypes });

    const ownerDuplicateGroups = await duplicateGroupCount(`
      MATCH (p:Person {is_owner: true})
      WITH p.user_id AS user_id, count(p) AS owner_count
      WHERE owner_count > 1
      RETURN count(*) AS count
    `);
    const eventDuplicateGroups = await duplicateGroupCount(`
      MATCH (e:Event)
      WITH e.entity_key AS entity_key, count(e) AS event_count
      WHERE event_count > 1
      RETURN count(*) AS count
    `);
    const relationshipDuplicateGroups = await duplicateGroupCount(`
      MATCH (from)-[relationship]->(to)
      WHERE type(relationship) IN $relationship_types
      WITH from, to, type(relationship) AS relationship_type, count(relationship) AS relationship_count
      WHERE relationship_count > 1
      RETURN count(*) AS count
    `, { relationship_types: semanticRelationshipTypes });

    const remainingDuplicates = ownerDuplicateGroups + eventDuplicateGroups + relationshipDuplicateGroups;
    console.log(`Owner nodes demoted: ${ownersDemoted}`);
    console.log(`Non-owner owner_keys cleared: ${ownerKeysCleared}`);
    console.log(`Event mentions rewired: ${eventMentionsRewired}`);
    console.log(`Duplicate Event nodes removed: ${eventsRemoved}`);
    console.log(`Duplicate semantic relationships removed: ${relationshipsRemoved}`);
    console.log(`Remaining owner duplicate groups: ${ownerDuplicateGroups}`);
    console.log(`Remaining Event duplicate groups: ${eventDuplicateGroups}`);
    console.log(`Remaining semantic relationship duplicate groups: ${relationshipDuplicateGroups}`);
    console.log(`Remaining duplicates: ${remainingDuplicates}`);

    if (remainingDuplicates !== 0) {
      throw new Error(`Deduplication incomplete: ${remainingDuplicates} duplicate groups remain`);
    }
  } finally {
    await neo4jService.close();
  }
}

main().catch((error: unknown) => {
  console.error('Graph deduplication failed:', error);
  process.exitCode = 1;
});
