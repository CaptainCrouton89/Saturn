import { neo4jService } from '../db/neo4j.js';
import { Pattern } from '../types/graph.js';

/**
 * NOTE: Pattern detection not in MVP - schema reserved for future use
 * This repository is available but pattern detection features are not
 * part of the current MVP implementation.
 */
export class PatternRepository {
  /**
   * Create or update a pattern
   */
  async upsert(
    pattern: Partial<Pattern> & {
      id: string;
      entity_key: string;
      description: string;
      last_update_source: string;
    }
  ): Promise<Pattern> {
    const query = `
      MERGE (p:Pattern {entity_key: $entity_key})
      ON CREATE SET
        p.id = $id,
        p.description = $description,
        p.type = $type,
        p.confidence_score = $confidence_score,
        p.first_observed_at = datetime(),
        p.evidence_count = $evidence_count,
        p.last_update_source = $last_update_source
      ON MATCH SET
        p.description = $description,
        p.type = coalesce($type, p.type),
        p.confidence_score = coalesce($confidence_score, p.confidence_score),
        p.evidence_count = coalesce($evidence_count, p.evidence_count),
        p.last_update_source = $last_update_source
      RETURN p
    `;

    const params = {
      id: pattern.id,
      entity_key: pattern.entity_key,
      description: pattern.description,
      last_update_source: pattern.last_update_source,
      type: pattern.type !== undefined ? pattern.type : 'behavioral',
      confidence_score: pattern.confidence_score !== undefined ? pattern.confidence_score : 0.5,
      evidence_count: pattern.evidence_count !== undefined ? pattern.evidence_count : 1,
    };

    const result = await neo4jService.executeQuery<{ p: Pattern }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create/update pattern');
    }

    return result[0].p;
  }

  /**
   * Find pattern by ID
   */
  async findById(id: string): Promise<Pattern | null> {
    const query = 'MATCH (p:Pattern {id: $id}) RETURN p';
    const result = await neo4jService.executeQuery<{ p: Pattern }>(query, { id });
    return result[0]?.p !== undefined ? result[0].p : null;
  }

  /**
   * Find pattern by entity_key (for idempotent updates)
   */
  async findByEntityKey(entityKey: string): Promise<Pattern | null> {
    const query = 'MATCH (p:Pattern {entity_key: $entityKey}) RETURN p';
    const result = await neo4jService.executeQuery<{ p: Pattern }>(query, { entityKey });
    return result[0]?.p !== undefined ? result[0].p : null;
  }

  /**
   * Find patterns by type
   */
  async findByType(type: string): Promise<Pattern[]> {
    const query = `
      MATCH (p:Pattern {type: $type})
      RETURN p
      ORDER BY p.confidence_score DESC, p.evidence_count DESC
    `;

    const result = await neo4jService.executeQuery<{ p: Pattern }>(query, { type });
    return result.map((r) => r.p);
  }

  /**
   * Get all patterns for a user above a confidence threshold
   */
  async getUserPatterns(userId: string, minConfidence: number = 0.6): Promise<Pattern[]> {
    const query = `
      MATCH (u:User {id: $userId})-[:HAS_PATTERN]->(p:Pattern)
      WHERE p.confidence_score >= $minConfidence
      RETURN p
      ORDER BY p.confidence_score DESC
    `;

    const result = await neo4jService.executeQuery<{ p: Pattern }>(query, {
      userId,
      minConfidence,
    });
    return result.map((r) => r.p);
  }

  /**
   * Increment pattern evidence count
   */
  async incrementEvidence(id: string, confidenceBoost: number = 0.05): Promise<void> {
    const query = `
      MATCH (p:Pattern {id: $id})
      SET p.evidence_count = p.evidence_count + 1,
          p.confidence_score = CASE
            WHEN p.confidence_score + $confidenceBoost > 1.0 THEN 1.0
            ELSE p.confidence_score + $confidenceBoost
          END
      RETURN p
    `;

    const result = await neo4jService.executeQuery<{ p: Pattern }>(query, { id, confidenceBoost });

    if (!result[0]) {
      throw new Error(`Pattern with id ${id} not found`);
    }
  }

  /**
   * Link pattern to user
   */
  async linkToUser(userId: string, patternId: string): Promise<void> {
    const query = `
      MATCH (u:User {id: $userId})
      MATCH (p:Pattern {id: $patternId})
      MERGE (u)-[r:HAS_PATTERN]->(p)
      SET r.confirmed_at = datetime()
    `;

    await neo4jService.executeQuery(query, { userId, patternId });
  }

  /**
   * Link pattern to conversation (revealed by)
   */
  async linkToConversation(
    patternId: string,
    conversationId: string,
    confidence: number = 0.7
  ): Promise<void> {
    const query = `
      MATCH (p:Pattern {id: $patternId})
      MATCH (c:Conversation {id: $conversationId})
      MERGE (c)-[r:REVEALED]->(p)
      SET r.confidence = $confidence
    `;

    await neo4jService.executeQuery(query, { patternId, conversationId, confidence });
  }

  /**
   * Create contradiction between pattern and value
   */
  async linkContradiction(
    patternId: string,
    valueId: string,
    description: string,
    severity: number = 0.5
  ): Promise<void> {
    const query = `
      MATCH (p:Pattern {id: $patternId})
      MATCH (v:Value {id: $valueId})
      MERGE (p)-[r:CONTRADICTS]->(v)
      SET r.contradiction_description = $description,
          r.severity = $severity
    `;

    await neo4jService.executeQuery(query, {
      patternId,
      valueId,
      description,
      severity,
    });
  }

  /**
   * Link pattern manifestation (pattern shows up in entity)
   */
  async linkManifestation(
    patternId: string,
    entityId: string,
    entityType: 'Topic' | 'Person' | 'Project'
  ): Promise<void> {
    const query = `
      MATCH (p:Pattern {id: $patternId})
      MATCH (e:${entityType} {id: $entityId})
      MERGE (p)-[:MANIFESTS_IN]->(e)
    `;

    await neo4jService.executeQuery(query, { patternId, entityId });
  }
}

export const patternRepository = new PatternRepository();
