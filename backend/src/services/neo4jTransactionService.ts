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
      await this.createConversationNode(tx, conversationId, summary, userId);

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
    summary: string | null,
    userId: string
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
        // Updates
        relationship_type: p.updates.relationship_type || null,
        how_they_met: p.updates.how_they_met || null,
        why_they_matter: p.updates.why_they_matter || null,
        personality_traits: p.updates.personality_traits || null,
        relationship_status: p.updates.relationship_status || null,
        communication_cadence: p.updates.communication_cadence || null,
        current_life_situation: p.updates.current_life_situation || null,
      };
    });

    const query = `
      UNWIND $people AS person
      MERGE (p:Person {entity_key: person.entity_key})
      ON CREATE SET
        p.id = person.id,
        p.name = person.name,
        p.canonical_name = person.canonical_name,
        p.first_mentioned_at = datetime(),
        p.last_mentioned_at = datetime(),
        p.updated_at = datetime(),
        p.last_update_source = person.last_update_source,
        p.confidence = person.confidence,
        p.excerpt_span = person.excerpt_span,
        p.relationship_type = person.relationship_type,
        p.how_they_met = person.how_they_met,
        p.why_they_matter = person.why_they_matter,
        p.personality_traits = person.personality_traits,
        p.relationship_status = person.relationship_status,
        p.communication_cadence = person.communication_cadence,
        p.current_life_situation = person.current_life_situation
      ON MATCH SET
        p.last_mentioned_at = datetime(),
        p.updated_at = datetime(),
        p.last_update_source = person.last_update_source,
        p.confidence = person.confidence,
        p.excerpt_span = person.excerpt_span,
        p.relationship_type = coalesce(person.relationship_type, p.relationship_type),
        p.how_they_met = coalesce(person.how_they_met, p.how_they_met),
        p.why_they_matter = coalesce(person.why_they_matter, p.why_they_matter),
        p.personality_traits = coalesce(person.personality_traits, p.personality_traits),
        p.relationship_status = coalesce(person.relationship_status, p.relationship_status),
        p.communication_cadence = coalesce(person.communication_cadence, p.communication_cadence),
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
        status: p.updates.status || 'active',
        domain: p.updates.domain || 'personal',
        vision: p.updates.vision || null,
        blockers: p.updates.blockers || null,
        key_decisions: p.updates.key_decisions || null,
        confidence_level: p.updates.confidence_level || null,
        excitement_level: p.updates.excitement_level || null,
        time_invested: p.updates.time_invested || null,
        money_invested: p.updates.money_invested || null,
      };
    });

    const query = `
      UNWIND $projects AS proj
      MERGE (p:Project {entity_key: proj.entity_key})
      ON CREATE SET
        p.id = proj.id,
        p.name = proj.name,
        p.canonical_name = proj.canonical_name,
        p.status = proj.status,
        p.domain = proj.domain,
        p.first_mentioned_at = datetime(),
        p.last_mentioned_at = datetime(),
        p.last_update_source = proj.last_update_source,
        p.confidence = proj.confidence,
        p.excerpt_span = proj.excerpt_span,
        p.vision = proj.vision,
        p.blockers = proj.blockers,
        p.key_decisions = proj.key_decisions,
        p.confidence_level = proj.confidence_level,
        p.excitement_level = proj.excitement_level,
        p.time_invested = proj.time_invested,
        p.money_invested = proj.money_invested
      ON MATCH SET
        p.last_mentioned_at = datetime(),
        p.last_update_source = proj.last_update_source,
        p.confidence = proj.confidence,
        p.excerpt_span = proj.excerpt_span,
        p.status = coalesce(proj.status, p.status),
        p.vision = coalesce(proj.vision, p.vision),
        p.blockers = coalesce(proj.blockers, p.blockers),
        p.key_decisions = coalesce(proj.key_decisions, p.key_decisions),
        p.confidence_level = coalesce(proj.confidence_level, p.confidence_level),
        p.excitement_level = coalesce(proj.excitement_level, p.excitement_level),
        p.time_invested = coalesce(proj.time_invested, p.time_invested),
        p.money_invested = coalesce(proj.money_invested, p.money_invested)
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
        description: t.updates.description || '',
        category: t.updates.category || 'personal',
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
        t.first_mentioned_at = datetime(),
        t.last_mentioned_at = datetime(),
        t.last_update_source = topic.last_update_source,
        t.confidence = topic.confidence,
        t.excerpt_span = topic.excerpt_span
      ON MATCH SET
        t.last_mentioned_at = datetime(),
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
        status: i.updates.status || 'raw',
        original_inspiration: i.updates.original_inspiration || null,
        evolution_notes: i.updates.evolution_notes || null,
        obstacles: i.updates.obstacles || null,
        resources_needed: i.updates.resources_needed || null,
        experiments_tried: i.updates.experiments_tried || null,
        confidence_level: i.updates.confidence_level || null,
        excitement_level: i.updates.excitement_level || null,
        potential_impact: i.updates.potential_impact || null,
        next_steps: i.updates.next_steps || null,
        context_notes: i.updates.context_notes || null,
      };
    });

    const query = `
      UNWIND $ideas AS idea
      MERGE (i:Idea {entity_key: idea.entity_key})
      ON CREATE SET
        i.id = idea.id,
        i.summary = idea.summary,
        i.status = idea.status,
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
        i.confidence_level = idea.confidence_level,
        i.excitement_level = idea.excitement_level,
        i.potential_impact = idea.potential_impact,
        i.next_steps = idea.next_steps,
        i.context_notes = idea.context_notes
      ON MATCH SET
        i.updated_at = datetime(),
        i.last_update_source = idea.last_update_source,
        i.confidence = idea.confidence,
        i.excerpt_span = idea.excerpt_span,
        i.status = coalesce(idea.status, i.status),
        i.evolution_notes = coalesce(idea.evolution_notes, i.evolution_notes),
        i.obstacles = coalesce(idea.obstacles, i.obstacles),
        i.resources_needed = coalesce(idea.resources_needed, i.resources_needed),
        i.experiments_tried = coalesce(idea.experiments_tried, i.experiments_tried),
        i.confidence_level = coalesce(idea.confidence_level, i.confidence_level),
        i.excitement_level = coalesce(idea.excitement_level, i.excitement_level),
        i.potential_impact = coalesce(idea.potential_impact, i.potential_impact),
        i.next_steps = coalesce(idea.next_steps, i.next_steps),
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
    for (const rel of relationships) {
      // Resolve temp IDs to actual IDs
      const targetId = entityIdMap.get(rel.targetEntityId) || rel.targetEntityId;

      const query = this.buildUserRelationshipQuery(rel.type, rel.targetEntityType);
      await tx.run(query, {
        userId,
        targetId,
        ...rel.properties,
      });
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
      await tx.run(query, {
        conversationId,
        targetId,
        ...rel.properties,
      });
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
        SET r.relationship_quality = $relationship_quality,
            r.last_mentioned_at = datetime($last_mentioned_at)
      `;
    }

    if (relType === 'WORKING_ON') {
      return `
        MATCH (u:User {id: $userId})
        MATCH (p:${targetType} {id: $targetId})
        MERGE (u)-[r:WORKING_ON]->(p)
        SET r.status = $status,
            r.priority = $priority,
            r.last_discussed_at = datetime($last_discussed_at)
      `;
    }

    if (relType === 'INTERESTED_IN') {
      return `
        MATCH (u:User {id: $userId})
        MATCH (t:${targetType} {id: $targetId})
        MERGE (u)-[r:INTERESTED_IN]->(t)
        SET r.engagement_level = $engagement_level,
            r.last_discussed_at = datetime($last_discussed_at),
            r.frequency = coalesce(r.frequency, 0) + $frequency
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
