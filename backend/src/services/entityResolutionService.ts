/**
 * Phase 2: Entity Resolution Service
 *
 * Orchestrates entity resolution by delegating to specialized resolvers.
 * Each entity type (Person, Project, Topic, Idea) has its own resolver implementation.
 *
 * Resolution strategy:
 * 1. entity_key match (most reliable)
 * 2. canonical_name match
 * 3. Alias match
 * 4. Vector similarity search (semantic)
 * 5. LLM disambiguation if multiple candidates
 *
 * Creates Alias nodes for new name variants.
 */

import { PersonResolver, ProjectResolver, TopicResolver, IdeaResolver } from './entityResolvers/index.js';
import type { ResolvedEntity } from './entityResolvers/index.js';
import type { EntityCandidate } from './entityIdentificationService.js';

// Re-export ResolvedEntity type
export type { ResolvedEntity };

class EntityResolutionService {
  private resolvers: Map<string, PersonResolver | ProjectResolver | TopicResolver | IdeaResolver>;

  constructor() {
    // Initialize entity-specific resolvers
    this.resolvers = new Map<string, PersonResolver | ProjectResolver | TopicResolver | IdeaResolver>([
      ['Person', new PersonResolver()],
      ['Project', new ProjectResolver()],
      ['Topic', new TopicResolver()],
      ['Idea', new IdeaResolver()],
    ]);
  }

  /**
   * Resolve all entities from identification phase
   */
  async resolve(
    entities: {
      people: EntityCandidate[];
      projects: EntityCandidate[];
      ideas: EntityCandidate[];
      topics: EntityCandidate[];
    },
    userId: string
  ): Promise<ResolvedEntity[]> {
    console.log('🔍 Resolving entities to existing Neo4j nodes...');

    const resolved: ResolvedEntity[] = [];

    // Get resolvers
    const personResolver = this.resolvers.get('Person');
    const projectResolver = this.resolvers.get('Project');
    const ideaResolver = this.resolvers.get('Idea');
    const topicResolver = this.resolvers.get('Topic');

    if (!personResolver || !projectResolver || !ideaResolver || !topicResolver) {
      throw new Error('One or more resolvers not initialized');
    }

    // Resolve each entity type in parallel
    const [resolvedPeople, resolvedProjects, resolvedIdeas, resolvedTopics] = await Promise.all([
      Promise.all(entities.people.map((p) => personResolver.resolve(p, userId))),
      Promise.all(entities.projects.map((p) => projectResolver.resolve(p, userId))),
      Promise.all(entities.ideas.map((i) => ideaResolver.resolve(i, userId))),
      Promise.all(entities.topics.map((t) => topicResolver.resolve(t, userId))),
    ]);

    resolved.push(...resolvedPeople, ...resolvedProjects, ...resolvedIdeas, ...resolvedTopics);

    const newCount = resolved.filter((r) => r.resolvedId === null).length;
    const existingCount = resolved.filter((r) => r.resolvedId !== null).length;

    console.log(`✅ Resolved: ${existingCount} existing entities, ${newCount} new entities`);

    return resolved;
  }
}

export const entityResolutionService = new EntityResolutionService();
