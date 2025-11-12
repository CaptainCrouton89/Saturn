import crypto from 'crypto';
import { neo4jService, neo4jInt } from '../db/neo4j.js';
import { Artifact } from '../types/graph.js';

/**
 * Repository for Artifact entities in Neo4j
 * Handles CRUD operations for artifacts (generated outputs, actions, files, etc.)
 * Follows pattern from ConceptRepository and EntityRepository
 */
export class ArtifactRepository {
  /**
   * Generate stable entity_key for an artifact
   * Hash of description + user_id + created_at for uniqueness
   */
  private generateEntityKey(description: string, userId: string, createdAt: Date): string {
    const normalized = description.toLowerCase();
    const timestamp = createdAt.toISOString();
    return crypto.createHash('sha256').update(normalized + userId + timestamp).digest('hex');
  }

  /**
   * Create a new artifact
   * Generates entity_key from description + user_id + created_at
   * Note: Provenance tracking (last_update_source, confidence) not yet implemented for Artifacts
   */
  async create(
    artifact: {
      description: string;
      content: { type: string; output: string | Record<string, unknown> };
      notes?: string;
      user_id: string;
    },
    _provenance?: { last_update_source?: string; confidence?: number }
  ): Promise<{ entity_key: string }> {
    const createdAt = new Date();
    const entity_key = this.generateEntityKey(artifact.description, artifact.user_id, createdAt);

    const query = `
      CREATE (a:Artifact {
        entity_key: $entity_key,
        user_id: $user_id,
        description: $description,
        content: $content,
        notes: $notes,
        created_at: datetime($created_at),
        updated_at: datetime($updated_at)
      })
      RETURN a.entity_key as entity_key
    `;

    const params = {
      entity_key,
      user_id: artifact.user_id,
      description: artifact.description,
      content: artifact.content,
      notes: artifact.notes !== undefined ? artifact.notes : '',
      created_at: createdAt.toISOString(),
      updated_at: createdAt.toISOString(),
    };

    const result = await neo4jService.executeQuery<{ entity_key: string }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create artifact');
    }

    return { entity_key: result[0].entity_key };
  }

  /**
   * Update an existing artifact
   * Updates only provided fields (partial update)
   * Note: Provenance tracking (last_update_source, confidence) not yet implemented for Artifacts
   */
  async update(
    entity_key: string,
    updates: {
      description?: string;
      content?: { type: string; output: string | Record<string, unknown> };
      notes?: string;
    },
    _provenance?: { last_update_source?: string; confidence?: number }
  ): Promise<{ entity_key: string }> {
    // Build dynamic SET clause based on provided fields
    const setFields: string[] = ['a.updated_at = datetime()'];
    const params: Record<string, unknown> = { entity_key };

    if (updates.description !== undefined) {
      setFields.push('a.description = $description');
      params.description = updates.description;
    }
    if (updates.content !== undefined) {
      setFields.push('a.content = $content');
      params.content = updates.content;
    }
    if (updates.notes !== undefined) {
      setFields.push('a.notes = $notes');
      params.notes = updates.notes;
    }

    const query = `
      MATCH (a:Artifact {entity_key: $entity_key})
      SET ${setFields.join(', ')}
      RETURN a.entity_key as entity_key
    `;

    const result = await neo4jService.executeQuery<{ entity_key: string }>(query, params);

    if (!result[0]) {
      throw new Error(`Artifact with entity_key ${entity_key} not found`);
    }

    return { entity_key: result[0].entity_key };
  }

  /**
   * Find artifact by entity_key
   */
  async findById(entityKey: string): Promise<Artifact | null> {
    const query = 'MATCH (a:Artifact {entity_key: $entityKey}) RETURN a';
    const result = await neo4jService.executeQuery<{ a: Artifact }>(query, { entityKey });
    return result[0]?.a !== undefined ? result[0].a : null;
  }

  /**
   * Find artifacts by content type
   */
  async findByContentType(contentType: string, userId: string, limit: number = 10): Promise<Artifact[]> {
    const query = `
      MATCH (a:Artifact {user_id: $userId})
      WHERE a.content.type = $contentType
      RETURN a
      ORDER BY a.created_at DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{ a: Artifact }>(query, { contentType, userId, limit: neo4jInt(limit) });
    return result.map((r) => r.a);
  }

  /**
   * Get all artifacts for a user
   */
  async findByUserId(userId: string, limit: number = 100): Promise<Artifact[]> {
    const query = `
      MATCH (a:Artifact {user_id: $userId})
      RETURN a
      ORDER BY a.created_at DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{ a: Artifact }>(query, { userId, limit: neo4jInt(limit) });
    return result.map((r) => r.a);
  }

  /**
   * Get sources that produced this artifact (via sourced_from relationship)
   */
  async getSourcesForArtifact(entityKey: string, limit: number = 10): Promise<
    Array<{
      source_entity_key: string;
      description: string;
    }>
  > {
    const query = `
      MATCH (a:Artifact {entity_key: $entityKey})-[:sourced_from]->(s:Source)
      RETURN s.entity_key as source_entity_key, s.description as description
      ORDER BY s.updated_at DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{
      source_entity_key: string;
      description: string;
    }>(query, { entityKey, limit: neo4jInt(limit) });

    return result;
  }

  /**
   * Get concepts that produced this artifact (via produced relationship)
   */
  async getConceptsForArtifact(entityKey: string, limit: number = 10): Promise<
    Array<{
      concept_entity_key: string;
      name: string;
      notes: string;
      relevance: number;
    }>
  > {
    const query = `
      MATCH (c:Concept)-[r:produced]->(a:Artifact {entity_key: $entityKey})
      RETURN c.entity_key as concept_entity_key, c.name as name, r.notes as notes, r.relevance as relevance
      ORDER BY r.relevance DESC, r.updated_at DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{
      concept_entity_key: string;
      name: string;
      notes: string;
      relevance: number;
    }>(query, { entityKey, limit: neo4jInt(limit) });

    return result;
  }

  /**
   * Delete an artifact by entity_key
   * Also removes all relationships
   */
  async delete(entityKey: string): Promise<void> {
    const query = `
      MATCH (a:Artifact {entity_key: $entityKey})
      DETACH DELETE a
    `;

    await neo4jService.executeQuery(query, { entityKey });
  }
}

export const artifactRepository = new ArtifactRepository();
