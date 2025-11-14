import crypto from 'crypto';
import { neo4jService } from '../db/neo4j.js';
import { Source } from '../types/graph.js';

export class SourceRepository {
  /**
   * Generate stable entity_key for a Source
   * Hash of description + user_id + created_at for idempotency
   */
  private generateEntityKey(description: string, userId: string, createdAt: string): string {
    const input = description + userId + createdAt;
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  /**
   * Create a new Source node
   * Each Source is unique (transcript from specific conversation), so use CREATE not MERGE
   */
  async create(
    source: Partial<Source> & {
      user_id: string;
      description: string;
      raw_content: string; // Raw text (original unprocessed content)
      content: { type: string; content: string | Record<string, unknown> }; // Processed structured content
      participants: string[];
    }
  ): Promise<Source> {
    const now = new Date().toISOString();
    const createdAt = source.created_at !== undefined ? source.created_at : now;
    const entityKey = this.generateEntityKey(source.description, source.user_id, createdAt);

    // Validate invariant: user_id must be in participants
    if (!source.participants.includes(source.user_id)) {
      throw new Error('Invariant violation: user_id must be in participants array');
    }

    // Build dynamic property list based on provided fields
    const properties: string[] = [
      'entity_key: $entity_key',
      'user_id: $user_id',
      'description: $description',
      'raw_content: $raw_content',
      'content: $content',
      'started_at: datetime($started_at)',
      'participants: $participants',
      'created_at: datetime($created_at)',
      'updated_at: datetime($updated_at)',
    ];

    const params: Record<string, unknown> = {
      entity_key: entityKey,
      user_id: source.user_id,
      description: source.description,
      raw_content: source.raw_content, // Store as-is (raw text string or object)
      content: JSON.stringify(source.content), // Store as JSON string
      started_at: source.started_at !== undefined ? source.started_at : createdAt,
      participants: source.participants,
      created_at: createdAt,
      updated_at: source.updated_at !== undefined ? source.updated_at : now,
    };

    // Add optional Source properties if provided
    if (source.source_type !== undefined) {
      properties.push('source_type: $source_type');
      params.source_type = source.source_type;
    }

    if (source.team_id !== undefined) {
      properties.push('team_id: $team_id');
      params.team_id = source.team_id;
    }

    if (source.context_type !== undefined) {
      properties.push('context_type: $context_type');
      params.context_type = source.context_type;
    }

    if (source.provenance !== undefined) {
      properties.push('provenance: $provenance');
      params.provenance = JSON.stringify(source.provenance);
    }

    if (source.ended_at !== undefined && source.ended_at !== null) {
      properties.push('ended_at: datetime($ended_at)');
      params.ended_at = source.ended_at;
    }

    if (source.summary !== undefined) {
      properties.push('summary: $summary');
      params.summary = source.summary;
    }

    if (source.keywords !== undefined) {
      properties.push('keywords: $keywords');
      params.keywords = source.keywords;
    }

    if (source.tags !== undefined) {
      properties.push('tags: $tags');
      params.tags = source.tags;
    }

    if (source.embedding !== undefined) {
      properties.push('embedding: $embedding');
      params.embedding = source.embedding;
    }

    if (source.processing_status !== undefined) {
      properties.push('processing_status: $processing_status');
      params.processing_status = source.processing_status;
    }

    if (source.processing_started_at !== undefined) {
      properties.push('processing_started_at: datetime($processing_started_at)');
      params.processing_started_at = source.processing_started_at;
    }

    if (source.processing_completed_at !== undefined) {
      properties.push('processing_completed_at: datetime($processing_completed_at)');
      params.processing_completed_at = source.processing_completed_at;
    }

    if (source.extraction_started_at !== undefined) {
      properties.push('extraction_started_at: datetime($extraction_started_at)');
      params.extraction_started_at = source.extraction_started_at;
    }

    if (source.extraction_completed_at !== undefined) {
      properties.push('extraction_completed_at: datetime($extraction_completed_at)');
      params.extraction_completed_at = source.extraction_completed_at;
    }

    if (source.salience !== undefined) {
      properties.push('salience: $salience');
      params.salience = source.salience;
    }

    if (source.state !== undefined) {
      properties.push('state: $state');
      params.state = source.state;
    }

    if (source.access_count !== undefined) {
      properties.push('access_count: $access_count');
      params.access_count = source.access_count;
    }

    if (source.recall_frequency !== undefined) {
      properties.push('recall_frequency: $recall_frequency');
      params.recall_frequency = source.recall_frequency;
    }

    if (source.last_accessed_at !== undefined) {
      properties.push('last_accessed_at: datetime($last_accessed_at)');
      params.last_accessed_at = source.last_accessed_at;
    }

    if (source.last_recall_interval !== undefined) {
      properties.push('last_recall_interval: $last_recall_interval');
      params.last_recall_interval = source.last_recall_interval;
    }

    if (source.decay_gradient !== undefined) {
      properties.push('decay_gradient: $decay_gradient');
      params.decay_gradient = source.decay_gradient;
    }

    if (source.sensitivity !== undefined) {
      properties.push('sensitivity: $sensitivity');
      params.sensitivity = source.sensitivity;
    }

    if (source.ttl_policy !== undefined) {
      properties.push('ttl_policy: $ttl_policy');
      params.ttl_policy = source.ttl_policy;
    }

    const query = `
      CREATE (s:Source {
        ${properties.join(',\n        ')}
      })
      RETURN s
    `;

    const result = await neo4jService.executeQuery<{ s: Source }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create Source');
    }

    return result[0].s;
  }

  /**
   * Find Source by entity_key
   */
  async findById(entityKey: string): Promise<Source | null> {
    const query = 'MATCH (s:Source {entity_key: $entity_key}) RETURN s';
    const result = await neo4jService.executeQuery<{ s: Source }>(query, { entity_key: entityKey });
    return result[0]?.s !== undefined ? result[0].s : null;
  }

  /**
   * Get recent Sources for context retrieval
   * Returns Sources from the last N days, ordered by created_at descending
   */
  async getContext(userId: string, daysBack: number): Promise<Source[]> {
    const query = `
      MATCH (s:Source {user_id: $user_id})
      WHERE s.created_at >= datetime() - duration({days: $days_back})
      RETURN s
      ORDER BY s.created_at DESC
    `;

    const result = await neo4jService.executeQuery<{ s: Source }>(query, {
      user_id: userId,
      days_back: daysBack,
    });

    return result.map((r) => r.s);
  }

  /**
   * Semantic search on Source descriptions using vector similarity
   * Returns Sources with embedding similarity above threshold
   */
  async searchByEmbedding(
    embedding: number[],
    threshold: number,
    userId: string
  ): Promise<Array<Source & { similarity: number }>> {
    const query = `
      MATCH (s:Source {user_id: $user_id})
      WHERE s.embedding IS NOT NULL
      WITH s, gds.similarity.cosine($embedding, s.embedding) AS similarity
      WHERE similarity >= $threshold
      RETURN s, similarity
      ORDER BY similarity DESC
      LIMIT 10
    `;

    const result = await neo4jService.executeQuery<{ s: Source; similarity: number }>(query, {
      user_id: userId,
      embedding,
      threshold,
    });

    return result.map((r) => ({ ...r.s, similarity: r.similarity }));
  }

  /**
   * Update Source embedding
   * Called after embedding generation in batch pipeline
   */
  async updateEmbedding(entityKey: string, embedding: number[]): Promise<void> {
    const query = `
      MATCH (s:Source {entity_key: $entity_key})
      SET s.embedding = $embedding, s.updated_at = datetime()
    `;

    await neo4jService.executeQuery(query, { entity_key: entityKey, embedding });
  }

  /**
   * Link Source to mentioned entities
   * Creates (Source)-[:mentions]->(Person|Concept|Entity) relationships
   * Uses Neo4j labels to determine node type instead of type property
   */
  async linkToEntities(
    sourceEntityKey: string,
    entityKeys: string[]
  ): Promise<void> {
    if (entityKeys.length === 0) return;

    const query = `
      MATCH (s:Source {entity_key: $source_key})
      UNWIND $entity_keys AS entity_key
      MATCH (entity)
      WHERE entity.entity_key = entity_key
        AND (entity:Person OR entity:Concept OR entity:Entity)
      MERGE (s)-[:mentions]->(entity)
    `;

    await neo4jService.executeQuery(query, {
      source_key: sourceEntityKey,
      entity_keys: entityKeys,
    });
  }

  /**
   * Get all entities mentioned in a Source
   * Returns People, Concepts, and Entities linked via mentions relationship
   * Uses Neo4j labels to determine node type
   */
  async getMentionedEntities(
    sourceEntityKey: string
  ): Promise<Array<{ entity_key: string; name: string }>> {
    const query = `
      MATCH (s:Source {entity_key: $entity_key})-[:mentions]->(entity)
      WHERE entity:Person OR entity:Concept OR entity:Entity
      RETURN entity.entity_key AS entity_key,
             coalesce(entity.name, entity.canonical_name) AS name
    `;

    const result = await neo4jService.executeQuery<{
      entity_key: string;
      name: string;
    }>(query, { entity_key: sourceEntityKey });

    return result;
  }

  /**
   * Link Source to produced Artifacts
   * Creates (Source)-[:produced]->(Artifact) relationships
   */
  async linkToArtifacts(sourceEntityKey: string, artifactEntityKeys: string[]): Promise<void> {
    if (artifactEntityKeys.length === 0) return;

    const query = `
      MATCH (s:Source {entity_key: $source_key})
      UNWIND $artifact_keys AS artifact_key
      MATCH (a:Artifact {entity_key: artifact_key})
      MERGE (s)-[:produced]->(a)
    `;

    await neo4jService.executeQuery(query, {
      source_key: sourceEntityKey,
      artifact_keys: artifactEntityKeys,
    });
  }

  /**
   * Get all Artifacts produced by a Source
   * Returns Artifacts linked via produced relationship
   */
  async getProducedArtifacts(
    sourceEntityKey: string
  ): Promise<Array<{ entity_key: string; name: string; description: string }>> {
    const query = `
      MATCH (s:Source {entity_key: $entity_key})-[:produced]->(a:Artifact)
      RETURN a.entity_key AS entity_key, a.name AS name, a.description AS description
    `;

    const result = await neo4jService.executeQuery<{
      entity_key: string;
      name: string;
      description: string;
    }>(query, { entity_key: sourceEntityKey });

    return result;
  }

  /**
   * Delete a Source and all its relationships
   * Use with caution - typically only for cleanup/testing
   */
  async delete(entityKey: string): Promise<void> {
    const query = `
      MATCH (s:Source {entity_key: $entity_key})
      DETACH DELETE s
    `;

    await neo4jService.executeQuery(query, { entity_key: entityKey });
  }
}

export const sourceRepository = new SourceRepository();
