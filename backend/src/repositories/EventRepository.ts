import { neo4jService, neo4jInt } from '../db/neo4j.js';
import { Event } from '../types/graph.js';
import { parseNotes, stringifyNotes } from '../utils/notes.js';
import { withSpan, buildEntityAttributes } from '../utils/tracing.js';
import { generateEntityKey } from '../utils/entityNormalization.js';
import { embeddingGenerationService } from '../services/embeddingGenerationService.js';

export class EventRepository {
  /**
   * Validate Event node invariants
   * - Event nodes must have user_id set (user-scoped)
   * - Event nodes must have name set
   */
  private validateEventInvariants(event: Partial<Event> & { name: string; user_id: string }): void {
    // All Event nodes must have user_id set
    if (!event.user_id) {
      throw new Error('Event node must have user_id set (Event nodes are always user-scoped)');
    }

    // Validate name is provided
    if (!event.name) {
      throw new Error('Event node must have name set');
    }
  }

  /**
   * Create a new Event node
   *
   * Uses CREATE (not MERGE) for fail-fast behavior.
   * Will throw Neo4j error if Event with same entity_key already exists.
   *
   * @param event - Event data to create (requires name, user_id, description)
   * @param sourceEntityKey - Optional Source node entity_key to auto-create mention relationship
   */
  async create(
    event: Partial<Event> & { name: string; user_id: string; description: string },
    sourceEntityKey?: string
  ): Promise<{ entity_key: string }> {
    return withSpan(
      'repository.event.create',
      buildEntityAttributes('event', 'create', {
        userId: event.user_id,
      }),
      async () => {
        this.validateEventInvariants(event);

        // Generate deterministic entity_key from normalized name + user_id
        const entityKey = generateEntityKey(event.name, event.user_id);

        // Generate embedding from name + description + notes
        const embeddingText = `${event.name} ${event.description} ${
          event.notes ? event.notes.map(n => n.content).join(' ') : ''
        }`.trim();

        const embedding = embeddingText.length > 0
          ? await embeddingGenerationService.embedSingle(embeddingText)
          : null;

        const query = `
          CREATE (e:Event {
            entity_key: $entity_key,
            user_id: $user_id,
            created_by: $user_id,
            name: $name,
            description: $description,
            notes: $notes,
            embedding: $embedding,
            created_at: datetime(),
            updated_at: datetime(),
            last_update_source: $last_update_source,
            confidence: $confidence,
            salience: 0.5,
            state: 'candidate',
            access_count: 0,
            recall_frequency: 0,
            last_recall_interval: 0,
            decay_gradient: 1.0,
            last_accessed_at: null,
            is_dirty: false
          })
          RETURN e.entity_key as entity_key
        `;

        // Validate required provenance fields
        const last_update_source = event.last_update_source ?? sourceEntityKey;
        if (!last_update_source) {
          throw new Error('last_update_source is required for Event creation - must be provided via event.last_update_source or sourceEntityKey parameter');
        }

        const params = {
          entity_key: entityKey,
          user_id: event.user_id,
          name: event.name,
          description: event.description,
          notes: stringifyNotes(event.notes !== undefined ? event.notes : []),
          embedding: embedding,
          last_update_source,
          confidence: event.confidence !== undefined ? event.confidence : 0.8,
        };

        const result = await neo4jService.executeQuery<{ entity_key: string }>(query, params);

        if (!result[0]) {
          throw new Error('Failed to create Event');
        }

        // Auto-create mention relationship if source_entity_key provided
        if (sourceEntityKey) {
          const mentionQuery = `
            MATCH (s:Source {entity_key: $source_entity_key})
            MATCH (e:Event {entity_key: $entity_key})
            MERGE (s)-[r:mentions]->(e)
            ON CREATE SET r.created_at = s.started_at, r.updated_at = s.started_at
            ON MATCH SET r.updated_at = s.started_at
          `;
          await neo4jService.executeQuery(mentionQuery, {
            source_entity_key: sourceEntityKey,
            entity_key: entityKey,
          });
        }

        return result[0];
      }
    );
  }

  /**
   * Find event by entity_key
   */
  async findById(entityKey: string): Promise<Event | null> {
    return withSpan(
      'repository.event.findById',
      buildEntityAttributes('event', 'query', { nodeId: entityKey }),
      async () => {
        const query = 'MATCH (e:Event {entity_key: $entity_key}) RETURN e';
        const result = await neo4jService.executeQuery<{ e: Event }>(query, { entity_key: entityKey });
        if (!result[0]?.e) return null;
        const event = result[0].e;
        return {
          ...event,
          notes: parseNotes(event.notes),
        } as Event;
      }
    );
  }

  /**
   * Update an existing Event node (throws error if doesn't exist)
   *
   * Uses MATCH + SET for fail-fast behavior.
   * Will throw error if Event with entity_key doesn't exist.
   *
   * @param entityKey - Event entity_key to update
   * @param properties - Event properties to update
   * @param metadata - Metadata for provenance tracking
   */
  async update(
    entityKey: string,
    properties: Partial<Event>,
    metadata: {
      last_update_source: string;
      confidence?: number;
    }
  ): Promise<Event> {
    return withSpan(
      'repository.event.update',
      buildEntityAttributes('event', 'update', {
        nodeId: entityKey,
      }),
      async () => {
        // Find existing event to validate it exists
        const existingEvent = await this.findById(entityKey);
        if (!existingEvent) {
          throw new Error(`Event with entity_key ${entityKey} not found`);
        }

        // Validate invariants
        if (properties.user_id && properties.user_id !== existingEvent.user_id) {
          throw new Error('Cannot change user_id on Event node');
        }

        // Generate new embedding if name, description, or notes changed
        let embedding: number[] | null = null;
        if (properties.name !== undefined || properties.description !== undefined || properties.notes !== undefined) {
          const embeddingText = `${properties.name ?? existingEvent.name} ${
            properties.description ?? existingEvent.description
          } ${
            properties.notes
              ? properties.notes.map(n => n.content).join(' ')
              : existingEvent.notes?.map(n => n.content).join(' ') ?? ''
          }`.trim();

          if (embeddingText.length > 0) {
            embedding = await embeddingGenerationService.embedSingle(embeddingText);
          }
        }

        const query = `
          MATCH (e:Event {entity_key: $entity_key})
          SET
            e.name = coalesce($name, e.name),
            e.description = coalesce($description, e.description),
            e.notes = CASE WHEN $notes IS NOT NULL THEN $notes ELSE e.notes END,
            e.embedding = coalesce($embedding, e.embedding),
            e.last_update_source = $last_update_source,
            e.confidence = CASE WHEN $confidence IS NOT NULL THEN $confidence ELSE e.confidence END,
            e.updated_at = datetime()
          RETURN e
        `;

        const params = {
          entity_key: entityKey,
          name: properties.name !== undefined ? properties.name : null,
          description: properties.description !== undefined ? properties.description : null,
          notes: properties.notes !== undefined ? stringifyNotes(properties.notes) : null,
          embedding: embedding,
          last_update_source: metadata.last_update_source,
          confidence: metadata.confidence !== undefined ? metadata.confidence : null,
        };

        const result = await neo4jService.executeQuery<{ e: Event }>(query, params);

        if (!result[0]) {
          throw new Error(`Failed to update Event with entity_key ${entityKey}`);
        }

        const eventNode = result[0].e;
        return {
          ...eventNode,
          notes: parseNotes(eventNode.notes),
        } as Event;
      }
    );
  }

  /**
   * Find events by embedding similarity using cosine similarity
   * Used for entity resolution - embedding-based matching tier
   *
   * @param userId - User ID to scope search
   * @param embedding - Vector embedding to compare against
   * @param similarityThreshold - Minimum cosine similarity score (default: 0.75)
   * @param limit - Maximum number of results (default: 20)
   * @returns Array of Event nodes with similarity_score, ordered by score DESC
   */
  async findByEmbeddingSimilarity(
    userId: string,
    embedding: number[],
    similarityThreshold: number = 0.75,
    limit: number = 20
  ): Promise<Array<Event & { similarity_score: number }>> {
    return withSpan(
      'repository.event.findByEmbeddingSimilarity',
      buildEntityAttributes('event', 'query', { userId }),
      async () => {
        const query = `
          MATCH (e:Event {user_id: $user_id})
          WHERE e.embedding IS NOT NULL
          WITH e, gds.similarity.cosine(e.embedding, $embedding) AS score
          WHERE score > $threshold
          RETURN e, score AS similarity_score
          ORDER BY score DESC
          LIMIT $limit
        `;

        const result = await neo4jService.executeQuery<{ e: Event; similarity_score: number }>(query, {
          user_id: userId,
          embedding: embedding,
          threshold: similarityThreshold,
          limit: neo4jInt(limit),
        });

        return result.map((r) => ({
          ...r.e,
          notes: parseNotes(r.e.notes),
          similarity_score: r.similarity_score,
        })) as Array<Event & { similarity_score: number }>;
      }
    );
  }

  /**
   * Search events by name (fuzzy search on name)
   */
  async searchByName(query: string, userId: string): Promise<Event[]> {
    return withSpan(
      'repository.event.searchByName',
      buildEntityAttributes('event', 'query', { userId }),
      async () => {
        const cypherQuery = `
          MATCH (e:Event {user_id: $user_id})
          WHERE toLower(e.name) CONTAINS toLower($query)
          RETURN e
          ORDER BY e.updated_at DESC
        `;

        const result = await neo4jService.executeQuery<{ e: Event }>(cypherQuery, {
          query: query,
          user_id: userId,
        });
        return result.map((r) => ({
          ...r.e,
          notes: parseNotes(r.e.notes),
        })) as Event[];
      }
    );
  }

  /**
   * Find event by exact name match
   * Used for entity resolution - exact matching tier
   *
   * @param userId - User ID to scope search
   * @param name - Name to match against e.name
   * @returns First matching Event or null
   */
  async findByExactMatch(userId: string, name: string): Promise<Event | null> {
    return withSpan(
      'repository.event.findByExactMatch',
      buildEntityAttributes('event', 'query', { userId }),
      async () => {
        const query = `
          MATCH (e:Event {user_id: $user_id})
          WHERE e.name = $name
          RETURN e
          LIMIT 1
        `;

        const result = await neo4jService.executeQuery<{ e: Event }>(query, {
          user_id: userId,
          name: name,
        });
        if (!result[0]?.e) return null;
        const event = result[0].e;
        return {
          ...event,
          notes: parseNotes(event.notes),
        } as Event;
      }
    );
  }

  /**
   * Find events by fuzzy name matching using Levenshtein distance
   * Used for entity resolution - fuzzy matching tier
   *
   * @param userId - User ID to scope search
   * @param name - Name to match against
   * @param distanceThreshold - Maximum Levenshtein distance (default: 3)
   * @returns Up to 5 matching Event nodes ordered by distance
   */
  async findByFuzzyMatch(
    userId: string,
    name: string,
    distanceThreshold: number = 3
  ): Promise<Event[]> {
    return withSpan(
      'repository.event.findByFuzzyMatch',
      buildEntityAttributes('event', 'query', { userId }),
      async () => {
        const query = `
          MATCH (e:Event {user_id: $user_id})
          WITH e, apoc.text.distance(e.name, $name) AS distance
          WHERE distance <= $threshold
          RETURN e, distance
          ORDER BY distance ASC
          LIMIT 5
        `;

        const result = await neo4jService.executeQuery<{ e: Event; distance: number }>(query, {
          user_id: userId,
          name: name,
          threshold: distanceThreshold,
        });

        return result.map((r) => ({
          ...r.e,
          notes: parseNotes(r.e.notes),
        })) as Event[];
      }
    );
  }

  /**
   * Find events by fuzzy name matching with similarity score (for RRF ranking)
   * Uses normalized similarity score (1 - normalized_distance) where higher is better
   *
   * @param userId - User ID to scope search
   * @param name - Name to match against
   * @param limit - Maximum number of results (default: 10)
   * @returns Array of Event nodes with fuzzy_score, ordered by score DESC
   */
  async findByFuzzyMatchWithScore(
    userId: string,
    name: string,
    limit: number = 10
  ): Promise<Array<Event & { fuzzy_score: number }>> {
    return withSpan(
      'repository.event.findByFuzzyMatchWithScore',
      buildEntityAttributes('event', 'query', { userId }),
      async () => {
        const query = `
          MATCH (e:Event {user_id: $user_id})
          WITH e, apoc.text.distance(e.name, $name) AS distance,
               size($name) AS name_length
          WHERE distance <= name_length * 0.5
          WITH e, 1.0 - (toFloat(distance) / toFloat(name_length)) AS fuzzy_score
          WHERE fuzzy_score > 0.5
          RETURN e, fuzzy_score
          ORDER BY fuzzy_score DESC
          LIMIT $limit
        `;

        const result = await neo4jService.executeQuery<{ e: Event; fuzzy_score: number }>(query, {
          user_id: userId,
          name: name,
          limit: neo4jInt(limit),
        });

        return result.map((r) => ({
          ...r.e,
          notes: parseNotes(r.e.notes),
          fuzzy_score: r.fuzzy_score,
        })) as Array<Event & { fuzzy_score: number }>;
      }
    );
  }

  /**
   * Find events by exact name match with score (for RRF ranking)
   * Returns score of 1.0 for exact matches
   *
   * @param userId - User ID to scope search
   * @param name - Name to match exactly (case-insensitive)
   * @param limit - Maximum number of results (default: 10)
   * @returns Array of Event nodes with exact_score, ordered by name
   */
  async findByExactMatchWithScore(
    userId: string,
    name: string,
    limit: number = 10
  ): Promise<Array<Event & { exact_score: number }>> {
    return withSpan(
      'repository.event.findByExactMatchWithScore',
      buildEntityAttributes('event', 'query', { userId }),
      async () => {
        const query = `
          MATCH (e:Event {user_id: $user_id})
          WHERE toLower(e.name) = toLower($name)
          RETURN e, 1.0 AS exact_score
          ORDER BY e.name
          LIMIT $limit
        `;

        const result = await neo4jService.executeQuery<{ e: Event; exact_score: number }>(query, {
          user_id: userId,
          name: name,
          limit: neo4jInt(limit),
        });

        return result.map((r) => ({
          ...r.e,
          notes: parseNotes(r.e.notes),
          exact_score: r.exact_score,
        })) as Array<Event & { exact_score: number }>;
      }
    );
  }

  /**
   * Deduplicate and aggregate candidates from multiple search tiers
   * Helper method for entity resolution
   *
   * @param exact - Results from exact match search
   * @param fuzzy - Results from fuzzy match search
   * @param similar - Results from embedding similarity search (with similarity_score)
   * @param maxCandidates - Maximum number of unique candidates to return (default: 20)
   * @returns Deduplicated array of Event nodes (up to maxCandidates)
   */
  deduplicateCandidates(
    exact: Event[],
    fuzzy: Event[],
    similar: Array<Event & { similarity_score: number }>,
    maxCandidates: number = 20
  ): Event[] {
    const candidateMap = new Map<string, Event>();

    // Add exact matches first (highest priority)
    for (const event of exact) {
      if (!candidateMap.has(event.entity_key)) {
        candidateMap.set(event.entity_key, event);
      }
    }

    // Add fuzzy matches (medium priority)
    for (const event of fuzzy) {
      if (!candidateMap.has(event.entity_key)) {
        candidateMap.set(event.entity_key, event);
      }
    }

    // Add embedding similarity matches (lower priority, but may have better semantic matches)
    // Sort by similarity_score DESC to prioritize higher scores
    const sortedSimilar = [...similar].sort((a, b) => b.similarity_score - a.similarity_score);
    for (const event of sortedSimilar) {
      if (!candidateMap.has(event.entity_key)) {
        candidateMap.set(event.entity_key, event);
      }
    }

    // Return up to maxCandidates
    return Array.from(candidateMap.values()).slice(0, maxCandidates);
  }

  /**
   * Get all events for a specific user
   * Ordered by most recently updated
   */
  async findByUserId(userId: string, limit: number = 100): Promise<Event[]> {
    return withSpan(
      'repository.event.findByUserId',
      buildEntityAttributes('event', 'query', { userId }),
      async () => {
        const query = `
          MATCH (e:Event {user_id: $user_id})
          RETURN e
          ORDER BY e.updated_at DESC
          LIMIT $limit
        `;
        const result = await neo4jService.executeQuery<{ e: Event }>(query, { user_id: userId, limit: neo4jInt(limit) });
        return result.map((r) => ({
          ...r.e,
          notes: parseNotes(r.e.notes),
        })) as Event[];
      }
    );
  }

  /**
   * Get recently mentioned events (ordered by updated_at)
   */
  async getRecentlyMentioned(userId: string, daysBack: number): Promise<Event[]> {
    return withSpan(
      'repository.event.getRecentlyMentioned',
      buildEntityAttributes('event', 'query', { userId }),
      async () => {
        const query = `
          MATCH (e:Event {user_id: $user_id})
          WHERE e.updated_at >= datetime() - duration({days: $days_back})
          RETURN e
          ORDER BY e.updated_at DESC
        `;

        const result = await neo4jService.executeQuery<{ e: Event }>(query, {
          user_id: userId,
          days_back: daysBack,
        });
        return result.map((r) => ({
          ...r.e,
          notes: parseNotes(r.e.notes),
        })) as Event[];
      }
    );
  }

  /**
   * Increment access tracking for an event when it's retrieved
   *
   * Updates (per decay.md):
   * - access_count += 1
   * - recall_frequency += 1
   * - last_accessed_at = now
   * - salience = min(1.0, salience + α) where α ∈ [0.05, 0.1]
   * - state: candidate → active (first access), active → core (10+ accesses)
   */
  async incrementAccess(entityKey: string): Promise<void> {
    return withSpan(
      'repository.event.incrementAccess',
      buildEntityAttributes('event', 'update', { nodeId: entityKey }),
      async () => {
        const salienceBoost = 0.075; // Mid-point of [0.05, 0.1] range

        const query = `
          MATCH (e:Event {entity_key: $entityKey})
          SET
            e.access_count = coalesce(e.access_count, 0) + 1,
            e.recall_frequency = coalesce(e.recall_frequency, 0) + 1,
            e.last_accessed_at = datetime(),
            e.salience = CASE
              WHEN coalesce(e.salience, 0.5) + $salienceBoost > 1.0 THEN 1.0
              ELSE coalesce(e.salience, 0.5) + $salienceBoost
            END,
            e.state = CASE
              WHEN coalesce(e.access_count, 0) + 1 >= 10 THEN 'core'
              WHEN coalesce(e.access_count, 0) + 1 >= 1 THEN 'active'
              ELSE coalesce(e.state, 'candidate')
            END
        `;

        await neo4jService.executeQuery(query, { entityKey, salienceBoost });
      }
    );
  }

  /**
   * Batch increment access for multiple events
   * More efficient than calling incrementAccess multiple times
   */
  async batchIncrementAccess(entityKeys: string[]): Promise<void> {
    return withSpan(
      'repository.event.batchIncrementAccess',
      buildEntityAttributes('event', 'update', { entityCount: entityKeys.length }),
      async () => {
        if (entityKeys.length === 0) return;

        const salienceBoost = 0.075;

        const query = `
          UNWIND $entityKeys AS entityKey
          MATCH (e:Event {entity_key: entityKey})
          SET
            e.access_count = coalesce(e.access_count, 0) + 1,
            e.recall_frequency = coalesce(e.recall_frequency, 0) + 1,
            e.last_accessed_at = datetime(),
            e.salience = CASE
              WHEN coalesce(e.salience, 0.5) + $salienceBoost > 1.0 THEN 1.0
              ELSE coalesce(e.salience, 0.5) + $salienceBoost
            END,
            e.state = CASE
              WHEN coalesce(e.access_count, 0) + 1 >= 10 THEN 'core'
              WHEN coalesce(e.access_count, 0) + 1 >= 1 THEN 'active'
              ELSE coalesce(e.state, 'candidate')
            END
        `;

        await neo4jService.executeQuery(query, { entityKeys, salienceBoost });
      }
    );
  }
}

export const eventRepository = new EventRepository();
