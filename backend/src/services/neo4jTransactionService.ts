/**
 * Phase 7: Neo4j Transaction Service
 *
 * Executes all entity and relationship updates atomically in a single Neo4j transaction.
 * Uses UNWIND for efficient batch updates.
 *
 * If any operation fails, entire transaction rolls back (all-or-nothing).
 */

import { v4 as uuidv4 } from 'uuid';
import { neo4jService } from '../db/neo4j.js';
import { supabaseService } from '../db/supabase.js';
import type { EntityUpdate } from './entityUpdateService.js';
import type { RelationshipUpdates } from './relationshipUpdateService.js';

export interface TransactionInput {
  conversationId: string;
  userId: string;
  entities: EntityUpdate[];
  summary: string | null;
  relationships: RelationshipUpdates;
}

class Neo4jTransactionService {
  /**
   * Execute all updates in a single atomic transaction
   */
  async execute(input: TransactionInput): Promise<void> {
    const { conversationId, userId, entities, summary, relationships } = input;

    console.log(`💾 Executing Neo4j transaction for conversation ${conversationId}...`);

    const session = neo4jService.getDriver().session();
    const tx = session.beginTransaction();

    try {
      // Step 1: Create Conversation node
      await this.createConversationNode(tx, conversationId, summary);

      // Step 2: Create/update entity nodes in batches by type
      const entityIdMap = await this.upsertEntities(tx, entities, conversationId);

      // Step 3: Create User → Conversation relationship
      await this.linkUserToConversation(tx, userId, conversationId);

      // Step 4: Create User → Entity relationships
      await this.createUserRelationships(tx, userId, relationships.userRelationships, entityIdMap);

      // Step 5: Create Conversation → Entity relationships
      await this.createConversationRelationships(tx, conversationId, relationships.conversationRelationships, entityIdMap);

      // Step 6: Commit transaction
      await tx.commit();

      console.log(`✅ Neo4j transaction committed for conversation ${conversationId}`);

      // Step 7: Mark conversation as processed in PostgreSQL
      await this.markConversationProcessed(conversationId);

    } catch (error) {
      await tx.rollback();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Neo4j transaction failed: ${errorMessage}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Create Conversation node in Neo4j
   */
  private async createConversationNode(
    tx: any,
    conversationId: string,
    summary: string | null
  ): Promise<void> {
    const query = `
      CREATE (c:Conversation {
        id: $conversationId,
        summary: $summary,
        date: datetime(),
        duration: 0,
        trigger_method: 'manual',
        status: 'completed',
        topic_tags: []
      })
      RETURN c
    `;

    await tx.run(query, {
      conversationId,
      summary: summary || 'No summary available',
    });
  }

  /**
   * Upsert all entities using UNWIND for efficiency
   *
   * Returns map of temporary IDs → actual Neo4j IDs
   */
  private async upsertEntities(
    tx: any,
    entities: EntityUpdate[],
    conversationId: string
  ): Promise<Map<string, string>> {
    const entityIdMap = new Map<string, string>();

    // Group entities by type
    const people = entities.filter((e) => e.entityType === 'Person');
    const projects = entities.filter((e) => e.entityType === 'Project');
    const topics = entities.filter((e) => e.entityType === 'Topic');
    const ideas = entities.filter((e) => e.entityType === 'Idea');

    // Upsert each type in batch
    if (people.length > 0) {
      const ids = await this.upsertPeople(tx, people, conversationId);
      ids.forEach((id, tempId) => entityIdMap.set(tempId, id));
    }

    if (projects.length > 0) {
      const ids = await this.upsertProjects(tx, projects, conversationId);
      ids.forEach((id, tempId) => entityIdMap.set(tempId, id));
    }

    if (topics.length > 0) {
      const ids = await this.upsertTopics(tx, topics, conversationId);
      ids.forEach((id, tempId) => entityIdMap.set(tempId, id));
    }

    if (ideas.length > 0) {
      const ids = await this.upsertIdeas(tx, ideas, conversationId);
      ids.forEach((id, tempId) => entityIdMap.set(tempId, id));
    }

    return entityIdMap;
  }

  /**
   * Upsert Person entities
   */
  private async upsertPeople(
    tx: any,
    people: EntityUpdate[],
    conversationId: string
  ): Promise<Map<string, string>> {
    const entityIdMap = new Map<string, string>();

    // Prepare data for UNWIND
    const peopleData = people.map((p) => {
      const id = p.entityId || uuidv4();
      const tempId = p.entityId || `temp_${p.entityKey.substring(0, 12)}`;
      entityIdMap.set(tempId, id);

      return {
        id,
        entity_key: p.entityKey,
        name: p.newEntityData?.name || 'Unknown',
        canonical_name: p.newEntityData?.canonical_name || 'unknown',
        last_update_source: conversationId,
        confidence: p.confidence,
        excerpt_span: p.excerpt_span,
        personality_traits: p.nodeUpdates.personality_traits || null,
        current_life_situation: p.nodeUpdates.current_life_situation || null,
      };
    });

    const query = `
      UNWIND $people AS person
      MERGE (p:Person {entity_key: person.entity_key})
      ON CREATE SET
        p.id = person.id,
        p.name = person.name,
        p.canonical_name = person.canonical_name,
        p.updated_at = datetime(),
        p.last_update_source = person.last_update_source,
        p.confidence = person.confidence,
        p.excerpt_span = person.excerpt_span,
        p.personality_traits = person.personality_traits,
        p.current_life_situation = person.current_life_situation
      ON MATCH SET
        p.updated_at = datetime(),
        p.last_update_source = person.last_update_source,
        p.confidence = person.confidence,
        p.excerpt_span = person.excerpt_span,
        p.personality_traits = coalesce(person.personality_traits, p.personality_traits),
        p.current_life_situation = coalesce(person.current_life_situation, p.current_life_situation)
      RETURN p.id as id, person.entity_key as key
    `;

    await tx.run(query, { people: peopleData });

    return entityIdMap;
  }

  /**
   * Upsert Project entities
   */
  private async upsertProjects(
    tx: any,
    projects: EntityUpdate[],
    conversationId: string
  ): Promise<Map<string, string>> {
    const entityIdMap = new Map<string, string>();

    const projectsData = projects.map((p) => {
      const id = p.entityId || uuidv4();
      const tempId = p.entityId || `temp_${p.entityKey.substring(0, 12)}`;
      entityIdMap.set(tempId, id);

      return {
        id,
        entity_key: p.entityKey,
        name: p.newEntityData?.name || 'Unknown',
        canonical_name: p.newEntityData?.canonical_name || 'unknown',
        last_update_source: conversationId,
        confidence: p.confidence,
        excerpt_span: p.excerpt_span,
        domain: p.nodeUpdates.domain || null,
        vision: p.nodeUpdates.vision || null,
        key_decisions: p.nodeUpdates.key_decisions || null,
      };
    });

    const query = `
      UNWIND $projects AS proj
      MERGE (p:Project {entity_key: proj.entity_key})
      ON CREATE SET
        p.id = proj.id,
        p.name = proj.name,
        p.canonical_name = proj.canonical_name,
        p.domain = proj.domain,
        p.last_update_source = proj.last_update_source,
        p.confidence = proj.confidence,
        p.excerpt_span = proj.excerpt_span,
        p.vision = proj.vision,
        p.key_decisions = proj.key_decisions
      ON MATCH SET
        p.last_update_source = proj.last_update_source,
        p.confidence = proj.confidence,
        p.excerpt_span = proj.excerpt_span,
        p.vision = coalesce(proj.vision, p.vision),
        p.key_decisions = coalesce(proj.key_decisions, p.key_decisions)
      RETURN p.id as id
    `;

    await tx.run(query, { projects: projectsData });

    return entityIdMap;
  }

  /**
   * Upsert Topic entities
   */
  private async upsertTopics(
    tx: any,
    topics: EntityUpdate[],
    conversationId: string
  ): Promise<Map<string, string>> {
    const entityIdMap = new Map<string, string>();

    const topicsData = topics.map((t) => {
      const id = t.entityId || uuidv4();
      const tempId = t.entityId || `temp_${t.entityKey.substring(0, 12)}`;
      entityIdMap.set(tempId, id);

      return {
        id,
        entity_key: t.entityKey,
        name: t.newEntityData?.name || 'Unknown',
        canonical_name: t.newEntityData?.canonical_name || 'unknown',
        last_update_source: conversationId,
        confidence: t.confidence,
        excerpt_span: t.excerpt_span,
        description: t.nodeUpdates.description || '',
        category: t.nodeUpdates.category || 'personal',
      };
    });

    const query = `
      UNWIND $topics AS topic
      MERGE (t:Topic {entity_key: topic.entity_key})
      ON CREATE SET
        t.id = topic.id,
        t.name = topic.name,
        t.canonical_name = topic.canonical_name,
        t.description = topic.description,
        t.category = topic.category,
        t.last_update_source = topic.last_update_source,
        t.confidence = topic.confidence,
        t.excerpt_span = topic.excerpt_span
      ON MATCH SET
        t.last_update_source = topic.last_update_source,
        t.confidence = topic.confidence,
        t.excerpt_span = topic.excerpt_span,
        t.description = coalesce(topic.description, t.description),
        t.category = coalesce(topic.category, t.category)
      RETURN t.id as id
    `;

    await tx.run(query, { topics: topicsData });

    return entityIdMap;
  }

  /**
   * Upsert Idea entities
   */
  private async upsertIdeas(
    tx: any,
    ideas: EntityUpdate[],
    conversationId: string
  ): Promise<Map<string, string>> {
    const entityIdMap = new Map<string, string>();

    const ideasData = ideas.map((i) => {
      const id = i.entityId || uuidv4();
      const tempId = i.entityId || `temp_${i.entityKey.substring(0, 12)}`;
      entityIdMap.set(tempId, id);

      return {
        id,
        entity_key: i.entityKey,
        summary: i.newEntityData?.summary || 'Unknown idea',
        last_update_source: conversationId,
        confidence: i.confidence,
        excerpt_span: i.excerpt_span,
        original_inspiration: i.nodeUpdates.original_inspiration || null,
        evolution_notes: i.nodeUpdates.evolution_notes || null,
        obstacles: i.nodeUpdates.obstacles || null,
        resources_needed: i.nodeUpdates.resources_needed || null,
        experiments_tried: i.nodeUpdates.experiments_tried || null,
        context_notes: i.nodeUpdates.context_notes || null,
      };
    });

    const query = `
      UNWIND $ideas AS idea
      MERGE (i:Idea {entity_key: idea.entity_key})
      ON CREATE SET
        i.id = idea.id,
        i.summary = idea.summary,
        i.created_at = datetime(),
        i.updated_at = datetime(),
        i.last_update_source = idea.last_update_source,
        i.confidence = idea.confidence,
        i.excerpt_span = idea.excerpt_span,
        i.original_inspiration = idea.original_inspiration,
        i.evolution_notes = idea.evolution_notes,
        i.obstacles = idea.obstacles,
        i.resources_needed = idea.resources_needed,
        i.experiments_tried = idea.experiments_tried,
        i.context_notes = idea.context_notes
      ON MATCH SET
        i.updated_at = datetime(),
        i.last_update_source = idea.last_update_source,
        i.confidence = idea.confidence,
        i.excerpt_span = idea.excerpt_span,
        i.evolution_notes = coalesce(idea.evolution_notes, i.evolution_notes),
        i.obstacles = coalesce(idea.obstacles, i.obstacles),
        i.resources_needed = coalesce(idea.resources_needed, i.resources_needed),
        i.experiments_tried = coalesce(idea.experiments_tried, i.experiments_tried),
        i.context_notes = coalesce(idea.context_notes, i.context_notes)
      RETURN i.id as id
    `;

    await tx.run(query, { ideas: ideasData });

    return entityIdMap;
  }

  /**
   * Link User to Conversation
   */
  private async linkUserToConversation(tx: any, userId: string, conversationId: string): Promise<void> {
    // First verify User node exists
    const checkQuery = `
      MATCH (u:User {id: $userId})
      RETURN u
    `;

    const checkResult = await tx.run(checkQuery, { userId });

    if (checkResult.records.length === 0) {
      throw new Error(`User node not found in Neo4j: ${userId}. This indicates a critical auth/onboarding bug.`);
    }

    const query = `
      MATCH (u:User {id: $userId})
      MATCH (c:Conversation {id: $conversationId})
      MERGE (u)-[r:HAD_CONVERSATION {timestamp: datetime()}]->(c)
    `;

    await tx.run(query, { userId, conversationId });
  }

  /**
   * Create User → Entity relationships
   */
  private async createUserRelationships(
    tx: any,
    userId: string,
    relationships: any[],
    entityIdMap: Map<string, string>
  ): Promise<void> {
    if (relationships.length === 0) {
      return;
    }

    // First verify User node exists
    const checkQuery = `
      MATCH (u:User {id: $userId})
      RETURN u
    `;

    const checkResult = await tx.run(checkQuery, { userId });

    if (checkResult.records.length === 0) {
      throw new Error(`User node not found in Neo4j: ${userId}. Cannot create relationships without User node.`);
    }

    for (const rel of relationships) {
      // Resolve temp IDs to actual IDs
      const targetId = entityIdMap.get(rel.targetEntityId) || rel.targetEntityId;

      const query = this.buildUserRelationshipQuery(rel.type, rel.targetEntityType);

      // Provide defaults for all possible relationship properties
      const params = {
        userId,
        targetId,
        // KNOWS properties
        relationship_type: rel.properties.relationship_type || null,
        relationship_quality: rel.properties.relationship_quality || null,
        how_they_met: rel.properties.how_they_met || null,
        why_they_matter: rel.properties.why_they_matter || null,
        relationship_status: rel.properties.relationship_status || null,
        communication_cadence: rel.properties.communication_cadence || null,
        // WORKING_ON properties
        status: rel.properties.status || null,
        priority: rel.properties.priority || null,
        confidence_level: rel.properties.confidence_level || null,
        excitement_level: rel.properties.excitement_level || null,
        time_invested: rel.properties.time_invested || null,
        money_invested: rel.properties.money_invested || null,
        blockers: rel.properties.blockers || null,
        // INTERESTED_IN properties
        engagement_level: rel.properties.engagement_level || null,
        // EXPLORING properties
        potential_impact: rel.properties.potential_impact || null,
        next_steps: rel.properties.next_steps || null,
      };

      await tx.run(query, params);
    }
  }

  /**
   * Create Conversation → Entity relationships
   */
  private async createConversationRelationships(
    tx: any,
    conversationId: string,
    relationships: any[],
    entityIdMap: Map<string, string>
  ): Promise<void> {
    for (const rel of relationships) {
      // Resolve temp IDs to actual IDs
      const targetId = entityIdMap.get(rel.targetEntityId) || rel.targetEntityId;

      const query = this.buildConversationRelationshipQuery(rel.type, rel.targetEntityType);

      // Provide defaults for all possible relationship properties
      const params = {
        conversationId,
        targetId,
        // MENTIONED properties
        count: rel.properties.count || null,
        sentiment: rel.properties.sentiment || null,
        importance_score: rel.properties.importance_score || null,
        // DISCUSSED properties (for Topics)
        depth: rel.properties.depth || null,
        // EXPLORED properties (for Ideas)
        outcome: rel.properties.outcome || null,
      };

      await tx.run(query, params);
    }
  }

  /**
   * Build query for User → Entity relationship
   */
  private buildUserRelationshipQuery(relType: string, targetType: string): string {
    if (relType === 'KNOWS') {
      return `
        MATCH (u:User {id: $userId})
        MATCH (p:${targetType} {id: $targetId})
        MERGE (u)-[r:KNOWS]->(p)
        ON CREATE SET
          r.first_mentioned_at = datetime(),
          r.last_mentioned_at = datetime()
        SET r.relationship_type = coalesce($relationship_type, r.relationship_type),
            r.relationship_quality = coalesce($relationship_quality, r.relationship_quality),
            r.how_they_met = coalesce($how_they_met, r.how_they_met),
            r.why_they_matter = coalesce($why_they_matter, r.why_they_matter),
            r.relationship_status = coalesce($relationship_status, r.relationship_status),
            r.communication_cadence = coalesce($communication_cadence, r.communication_cadence),
            r.last_mentioned_at = datetime()
      `;
    }

    if (relType === 'WORKING_ON') {
      return `
        MATCH (u:User {id: $userId})
        MATCH (p:${targetType} {id: $targetId})
        MERGE (u)-[r:WORKING_ON]->(p)
        ON CREATE SET
          r.first_mentioned_at = datetime(),
          r.last_mentioned_at = datetime(),
          r.last_discussed_at = datetime()
        SET r.status = coalesce($status, r.status),
            r.priority = coalesce($priority, r.priority),
            r.confidence_level = coalesce($confidence_level, r.confidence_level),
            r.excitement_level = coalesce($excitement_level, r.excitement_level),
            r.time_invested = coalesce($time_invested, r.time_invested),
            r.money_invested = coalesce($money_invested, r.money_invested),
            r.blockers = coalesce($blockers, r.blockers),
            r.last_mentioned_at = datetime(),
            r.last_discussed_at = datetime()
      `;
    }

    if (relType === 'INTERESTED_IN') {
      return `
        MATCH (u:User {id: $userId})
        MATCH (t:${targetType} {id: $targetId})
        MERGE (u)-[r:INTERESTED_IN]->(t)
        ON CREATE SET
          r.first_mentioned_at = datetime(),
          r.last_mentioned_at = datetime(),
          r.last_discussed_at = datetime(),
          r.frequency = 0
        SET r.engagement_level = coalesce($engagement_level, r.engagement_level),
            r.last_mentioned_at = datetime(),
            r.last_discussed_at = datetime(),
            r.frequency = coalesce(r.frequency, 0) + 1
      `;
    }

    if (relType === 'EXPLORING') {
      return `
        MATCH (u:User {id: $userId})
        MATCH (i:${targetType} {id: $targetId})
        MERGE (u)-[r:EXPLORING]->(i)
        ON CREATE SET
          r.first_mentioned_at = datetime(),
          r.last_mentioned_at = datetime()
        SET r.status = coalesce($status, r.status),
            r.confidence_level = coalesce($confidence_level, r.confidence_level),
            r.excitement_level = coalesce($excitement_level, r.excitement_level),
            r.potential_impact = coalesce($potential_impact, r.potential_impact),
            r.next_steps = coalesce($next_steps, r.next_steps),
            r.last_mentioned_at = datetime()
      `;
    }

    throw new Error(`Unknown user relationship type: ${relType}`);
  }

  /**
   * Build query for Conversation → Entity relationship
   */
  private buildConversationRelationshipQuery(relType: string, targetType: string): string {
    if (relType === 'MENTIONED') {
      return `
        MATCH (c:Conversation {id: $conversationId})
        MATCH (e:${targetType} {id: $targetId})
        MERGE (c)-[r:MENTIONED]->(e)
        SET r.count = $count,
            r.sentiment = $sentiment,
            r.importance_score = $importance_score
      `;
    }

    if (relType === 'DISCUSSED') {
      return `
        MATCH (c:Conversation {id: $conversationId})
        MATCH (t:${targetType} {id: $targetId})
        MERGE (c)-[r:DISCUSSED]->(t)
        SET r.depth = $depth
      `;
    }

    if (relType === 'EXPLORED') {
      return `
        MATCH (c:Conversation {id: $conversationId})
        MATCH (i:${targetType} {id: $targetId})
        MERGE (c)-[r:EXPLORED]->(i)
        SET r.outcome = $outcome
      `;
    }

    throw new Error(`Unknown conversation relationship type: ${relType}`);
  }

  /**
   * Mark conversation as processed in PostgreSQL
   */
  private async markConversationProcessed(conversationId: string): Promise<void> {
    const supabase = supabaseService.getClient();

    const { error } = await supabase
      .from('conversation')
      .update({
        entities_extracted: true,
        neo4j_synced_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    if (error) {
      throw new Error(`Failed to mark conversation as processed: ${error.message}`);
    }
  }
}

export const neo4jTransactionService = new Neo4jTransactionService();
