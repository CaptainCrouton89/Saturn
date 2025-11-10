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
import { OpenAIEmbeddings } from '@langchain/openai';
import { z } from 'zod';
import { personRepository } from '../repositories/PersonRepository.js';
import { projectRepository } from '../repositories/ProjectRepository.js';
import { topicRepository } from '../repositories/TopicRepository.js';
import { ideaRepository } from '../repositories/IdeaRepository.js';
import { aliasRepository } from '../repositories/AliasRepository.js';
import { neo4jService } from '../db/neo4j.js';
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

// Vector search result from Neo4j
interface VectorSearchResult {
  id: string;
  name: string;
  canonical_name: string;
  properties: Record<string, unknown>;
  score: number;
}

// Disambiguation schema
const DisambiguationResultSchema = z.object({
  resolvedId: z.string().optional().describe('The ID of the correct entity, or omit if none match'),
  confidence: z.number().min(0).max(1).describe('Confidence in the resolution (0-1)'),
  reasoning: z.string().describe('Brief explanation of why this entity was chosen'),
});

class EntityResolutionService {
  private model: ChatOpenAI;
  private embeddings: OpenAIEmbeddings;

  constructor() {
    this.model = new ChatOpenAI({
      modelName: 'gpt-4.1-nano', // Lightweight model for disambiguation
    });
    this.embeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small', // Cost-effective embeddings
    });
  }

  /**
   * Search for semantically similar entities using vector embeddings
   *
   * @param entityText - Text to embed and search (name + context)
   * @param entityType - Entity type (Person, Project, Topic, Idea)
   * @param topK - Number of similar results to return
   * @param threshold - Minimum cosine similarity score (0-1)
   * @returns Array of entities with similarity scores
   */
  private async vectorSimilaritySearch(
    entityText: string,
    entityType: string,
    topK: number = 3,
    threshold: number = 0.85
  ): Promise<Array<{ entity: Person | Project | Topic | Idea; score: number }>> {
    try {
      // Generate embedding for the search text
      const embedding = await this.embeddings.embedQuery(entityText);

      // Query Neo4j vector index
      const query = `
        CALL db.index.vector.queryNodes(
          $indexName,
          $topK,
          $embedding
        ) YIELD node, score
        WHERE labels(node)[0] = $entityType
          AND score >= $threshold
          AND EXISTS(node.embedding)
        RETURN
          node.id AS id,
          node.name AS name,
          node.canonical_name AS canonical_name,
          node as properties,
          score
        ORDER BY score DESC
      `;

      // Determine the appropriate vector index name
      const indexName = `${entityType.toLowerCase()}_embedding`;

      const result = await neo4jService.executeQuery<VectorSearchResult>(query, {
        indexName,
        topK,
        embedding,
        entityType,
        threshold,
      });

      if (!result || result.length === 0) {
        return [];
      }

      // Map results to entities with scores
      return result.map((record) => ({
        entity: {
          id: record.id,
          name: record.name,
          canonical_name: record.canonical_name,
          ...record.properties,
        } as Person | Project | Topic | Idea,
        score: record.score,
      }));
    } catch (error) {
      // Vector search might fail if index doesn't exist or Neo4j version doesn't support it
      console.warn(`Vector similarity search failed for ${entityType}:`, error instanceof Error ? error.message : 'Unknown error');
      return [];
    }
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

    // If still not found, try vector similarity search (semantic matching)
    let resolvedConfidence = 0.95;
    if (!existing) {
      const searchText = `${candidate.mentionedName} ${candidate.contextClue || ''}`;
      const similarEntities = await this.vectorSimilaritySearch(searchText, 'Person', 3, 0.85);

      if (similarEntities.length > 0) {
        const topMatch = similarEntities[0];

        if (topMatch.score > 0.92) {
          // High confidence semantic match - use it directly
          existing = topMatch.entity as Person;
          resolvedConfidence = topMatch.score;
          console.log(`🔍 Vector match: "${candidate.mentionedName}" → "${existing.name}" (score: ${topMatch.score.toFixed(3)})`);
        } else if (topMatch.score > 0.85) {
          // Medium confidence - disambiguate with LLM
          const candidates = similarEntities.map(s => s.entity as Person);
          const disambiguated = await this.disambiguate(candidate, candidates);
          if (disambiguated) {
            existing = disambiguated as Person;
            resolvedConfidence = 0.88;
          }
        }
      }
    }

    // Fallback: try fuzzy search as last resort
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

    // Check if we need to create alias
    let aliasCreated = false;
    if (existing && existing.id && existing.name !== candidate.mentionedName) {
      // Entity found but mentioned with different name - create alias
      await aliasRepository.createAlias(candidate.mentionedName, existing.id, 'Person');
      aliasCreated = true;
    }

    return {
      candidate,
      resolvedId: existing?.id || null,
      existingData: existing || null,
      confidence: existing ? resolvedConfidence : 0.8,
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

    // Try vector similarity search for semantic matching
    let resolvedConfidence = 0.95;
    if (!existing) {
      const searchText = `${candidate.mentionedName} ${candidate.contextClue || ''}`;
      const similarEntities = await this.vectorSimilaritySearch(searchText, 'Project', 3, 0.85);

      if (similarEntities.length > 0) {
        const topMatch = similarEntities[0];

        if (topMatch.score > 0.92) {
          existing = topMatch.entity as Project;
          resolvedConfidence = topMatch.score;
          console.log(`🔍 Vector match: "${candidate.mentionedName}" → "${existing.name}" (score: ${topMatch.score.toFixed(3)})`);
        } else if (topMatch.score > 0.85) {
          const candidates = similarEntities.map(s => s.entity as Project);
          const disambiguated = await this.disambiguate(candidate, candidates);
          if (disambiguated) {
            existing = disambiguated as Project;
            resolvedConfidence = 0.88;
          }
        }
      }
    }

    let aliasCreated = false;
    if (existing && existing.id && existing.name !== candidate.mentionedName) {
      await aliasRepository.createAlias(candidate.mentionedName, existing.id, 'Project');
      aliasCreated = true;
    }

    return {
      candidate,
      resolvedId: existing?.id || null,
      existingData: existing || null,
      confidence: existing ? resolvedConfidence : 0.8,
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

    // Try vector similarity search for semantic matching
    let resolvedConfidence = 0.95;
    if (!existing) {
      const searchText = `${candidate.mentionedName} ${candidate.category || ''}`;
      const similarEntities = await this.vectorSimilaritySearch(searchText, 'Topic', 3, 0.85);

      if (similarEntities.length > 0) {
        const topMatch = similarEntities[0];

        if (topMatch.score > 0.92) {
          existing = topMatch.entity as Topic;
          resolvedConfidence = topMatch.score;
          console.log(`🔍 Vector match: "${candidate.mentionedName}" → "${existing.name}" (score: ${topMatch.score.toFixed(3)})`);
        } else if (topMatch.score > 0.85) {
          const candidates = similarEntities.map(s => s.entity as Topic);
          const disambiguated = await this.disambiguate(candidate, candidates);
          if (disambiguated) {
            existing = disambiguated as Topic;
            resolvedConfidence = 0.88;
          }
        }
      }
    }

    let aliasCreated = false;
    if (existing && existing.id && existing.name !== candidate.mentionedName) {
      await aliasRepository.createAlias(candidate.mentionedName, existing.id, 'Topic');
      aliasCreated = true;
    }

    return {
      candidate,
      resolvedId: existing?.id || null,
      existingData: existing || null,
      confidence: existing ? resolvedConfidence : 0.8,
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

    const result = await structuredLlm.invoke(prompt);

    if (result.resolvedId !== undefined && result.confidence > 0.7) {
      const match = candidates.find((c) => c.id === result.resolvedId);
      console.log(`🤖 Disambiguated "${candidate.mentionedName}" → "${match?.name}" (confidence: ${result.confidence})`);
      return match || null;
    }

    return null;
  }
}

export const entityResolutionService = new EntityResolutionService();
