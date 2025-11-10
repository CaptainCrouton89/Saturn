/**
 * Phase 2: Entity Resolution Service
 *
 * Maps mentioned entities to existing Neo4j nodes or marks them for creation.
 * Uses multi-tier resolution strategy:
 * 1. entity_key match (most reliable)
 * 2. canonical_name match
 * 3. Alias match
 * 4. Fuzzy name match
 * 5. LLM disambiguation if multiple candidates
 *
 * Creates Alias nodes for new name variants.
 */

import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { personRepository } from '../repositories/PersonRepository.js';
import { projectRepository } from '../repositories/ProjectRepository.js';
import { topicRepository } from '../repositories/TopicRepository.js';
import { ideaRepository } from '../repositories/IdeaRepository.js';
import { aliasRepository } from '../repositories/AliasRepository.js';
import type { EntityCandidate } from './entityIdentificationService.js';
import type { Person, Project, Topic, Idea } from '../types/graph.js';

// Resolution result types
export interface ResolvedEntity {
  candidate: EntityCandidate;
  resolvedId: string | null; // null = new entity to create
  existingData: Person | Project | Topic | Idea | null;
  confidence: number; // 0-1
  aliasCreated: boolean; // Whether a new alias was created
}

// Disambiguation schema
const DisambiguationResultSchema = z.object({
  resolvedId: z.string().nullable().describe('The ID of the correct entity, or null if none match'),
  confidence: z.number().min(0).max(1).describe('Confidence in the resolution (0-1)'),
  reasoning: z.string().describe('Brief explanation of why this entity was chosen'),
});

class EntityResolutionService {
  private model: ChatOpenAI;

  constructor() {
    this.model = new ChatOpenAI({
      modelName: 'gpt-4.1-nano', // Lightweight model for disambiguation
    });
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

    // Resolve each entity type in parallel
    const [resolvedPeople, resolvedProjects, resolvedIdeas, resolvedTopics] = await Promise.all([
      Promise.all(entities.people.map((p) => this.resolvePerson(p, userId))),
      Promise.all(entities.projects.map((p) => this.resolveProject(p, userId))),
      Promise.all(entities.ideas.map((i) => this.resolveIdea(i, userId))),
      Promise.all(entities.topics.map((t) => this.resolveTopic(t, userId))),
    ]);

    resolved.push(...resolvedPeople, ...resolvedProjects, ...resolvedIdeas, ...resolvedTopics);

    const newCount = resolved.filter((r) => r.resolvedId === null).length;
    const existingCount = resolved.filter((r) => r.resolvedId !== null).length;

    console.log(`✅ Resolved: ${existingCount} existing entities, ${newCount} new entities`);

    return resolved;
  }

  /**
   * Resolve a Person entity
   */
  private async resolvePerson(candidate: EntityCandidate, _userId: string): Promise<ResolvedEntity> {
    if (!candidate.mentionedName) {
      throw new Error('Person candidate missing mentionedName');
    }

    // Try entity_key first (most reliable)
    let existing = await personRepository.findByEntityKey(candidate.entityKey);

    if (!existing) {
      // Try canonical name
      const canonicalName = candidate.mentionedName.toLowerCase().trim();
      existing = await personRepository.findByCanonicalName(canonicalName);
    }

    if (!existing) {
      // Try alias lookup
      const personId = await aliasRepository.findEntityByAlias(candidate.mentionedName, 'Person');
      if (personId) {
        existing = await personRepository.findById(personId);
      }
    }

    // Check if we need to create alias
    let aliasCreated = false;
    if (existing && existing.name !== candidate.mentionedName) {
      // Entity found but mentioned with different name - create alias
      await aliasRepository.createAlias(candidate.mentionedName, existing.id, 'Person');
      aliasCreated = true;
    }

    // If still not found, try fuzzy search as last resort
    if (!existing) {
      const fuzzyMatches = await personRepository.searchByName(candidate.mentionedName);

      if (fuzzyMatches.length === 1) {
        // Single match, use it (high confidence)
        existing = fuzzyMatches[0];
      } else if (fuzzyMatches.length > 1) {
        // Multiple matches - use LLM disambiguation
        const disambiguated = await this.disambiguate(candidate, fuzzyMatches);
        if (disambiguated) {
          existing = disambiguated as Person;
        }
      }
    }

    return {
      candidate,
      resolvedId: existing?.id || null,
      existingData: existing || null,
      confidence: existing ? 0.95 : 0.8, // High confidence if found, medium if new
      aliasCreated,
    };
  }

  /**
   * Resolve a Project entity
   */
  private async resolveProject(candidate: EntityCandidate, _userId: string): Promise<ResolvedEntity> {
    if (!candidate.mentionedName) {
      throw new Error('Project candidate missing mentionedName');
    }

    let existing: Project | null = await projectRepository.findByEntityKey(candidate.entityKey);

    if (!existing) {
      const canonicalName = candidate.mentionedName.toLowerCase().trim();
      existing = await projectRepository.findByCanonicalName(canonicalName);
    }

    if (!existing) {
      const projectId = await aliasRepository.findEntityByAlias(candidate.mentionedName, 'Project');
      if (projectId) {
        existing = await projectRepository.findById(projectId);
      }
    }

    let aliasCreated = false;
    if (existing && existing.name !== candidate.mentionedName) {
      await aliasRepository.createAlias(candidate.mentionedName, existing.id, 'Project');
      aliasCreated = true;
    }

    return {
      candidate,
      resolvedId: existing?.id || null,
      existingData: existing || null,
      confidence: existing ? 0.95 : 0.8,
      aliasCreated,
    };
  }

  /**
   * Resolve a Topic entity
   */
  private async resolveTopic(candidate: EntityCandidate, _userId: string): Promise<ResolvedEntity> {
    if (!candidate.mentionedName) {
      throw new Error('Topic candidate missing mentionedName');
    }

    let existing: Topic | null = await topicRepository.findByEntityKey(candidate.entityKey);

    if (!existing) {
      const canonicalName = candidate.mentionedName.toLowerCase().trim();
      existing = await topicRepository.findByCanonicalName(canonicalName);
    }

    if (!existing) {
      const topicId = await aliasRepository.findEntityByAlias(candidate.mentionedName, 'Topic');
      if (topicId) {
        existing = await topicRepository.findById(topicId);
      }
    }

    let aliasCreated = false;
    if (existing && existing.name !== candidate.mentionedName) {
      await aliasRepository.createAlias(candidate.mentionedName, existing.id, 'Topic');
      aliasCreated = true;
    }

    return {
      candidate,
      resolvedId: existing?.id || null,
      existingData: existing || null,
      confidence: existing ? 0.95 : 0.8,
      aliasCreated,
    };
  }

  /**
   * Resolve an Idea entity
   *
   * Ideas are matched by entity_key (hash of summary), as they don't have names
   */
  private async resolveIdea(candidate: EntityCandidate, _userId: string): Promise<ResolvedEntity> {
    const existing = await ideaRepository.findByEntityKey(candidate.entityKey);

    return {
      candidate,
      resolvedId: existing?.id || null,
      existingData: existing || null,
      confidence: existing ? 0.85 : 0.8, // Slightly lower confidence for ideas
      aliasCreated: false, // Ideas don't have aliases
    };
  }

  /**
   * Disambiguate between multiple candidate entities using LLM
   *
   * Only uses intrinsic node properties for matching.
   */
  private async disambiguate(
    candidate: EntityCandidate,
    candidates: (Person | Project | Topic)[]
  ): Promise<Person | Project | Topic | null> {
    if (candidates.length === 0) {
      return null;
    }

    const structuredLlm = this.model.withStructuredOutput(DisambiguationResultSchema);

    const candidatesList = candidates
      .map((c, idx) => {
        if ('personality_traits' in c) {
          // Person - use intrinsic properties only
          const person = c as Person;
          const traits = person.personality_traits?.slice(0, 3).join(', ') || 'no traits';
          return `${idx + 1}. ${person.name} - ${person.current_life_situation || 'no info'} (traits: ${traits})`;
        } else if ('domain' in c) {
          // Project - use intrinsic properties only
          const project = c as Project;
          return `${idx + 1}. ${project.name} (${project.domain || 'no domain'}) - ${project.vision || 'no info'}`;
        } else {
          // Topic
          const topic = c as Topic;
          return `${idx + 1}. ${topic.name} (${topic.category || 'no category'}) - ${topic.description || 'no description'}`;
        }
      })
      .join('\n');

    const prompt = `You are resolving an entity mention to an existing entity in the knowledge graph.

Mentioned entity:
- Name: ${candidate.mentionedName || candidate.summary}
- Context: ${candidate.contextClue || 'none'}
- Type: ${candidate.type}

Existing candidates:
${candidatesList}

Which existing entity (if any) does this mention refer to? If none of them match, return null.

Focus on matching the identity of the entity itself (name, traits, description), not the user's relationship to it.

Return the ID of the matching entity, your confidence (0-1), and brief reasoning.`;

    try {
      const result = await structuredLlm.invoke(prompt);

      if (result.resolvedId && result.confidence > 0.7) {
        const match = candidates.find((c) => c.id === result.resolvedId);
        console.log(`🤖 Disambiguated "${candidate.mentionedName}" → "${match?.name}" (confidence: ${result.confidence})`);
        return match || null;
      }

      return null;
    } catch (error) {
      console.warn('⚠️ Disambiguation failed, treating as new entity:', error);
      return null;
    }
  }
}

export const entityResolutionService = new EntityResolutionService();
