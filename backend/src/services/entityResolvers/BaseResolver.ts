/**
 * Base Entity Resolver
 *
 * Abstract base class for entity resolution.
 * Provides shared utilities for vector search, disambiguation, and alias management.
 */

import { ChatOpenAI } from '@langchain/openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { z } from 'zod';
import { neo4jService } from '../../db/neo4j.js';
import { aliasRepository } from '../../repositories/AliasRepository.js';
import type { EntityCandidate } from '../entityIdentificationService.js';
import type { Person, Project, Topic, Idea } from '../../types/graph.js';

export interface ResolvedEntity {
  candidate: EntityCandidate;
  resolvedId: string | null; // null = new entity to create
  existingData: Person | Project | Topic | Idea | null;
  confidence: number; // 0-1
  aliasCreated: boolean; // Whether a new alias was created
}

interface VectorSearchResult {
  id: string;
  name: string;
  canonical_name: string;
  properties: Record<string, unknown>;
  score: number;
}

const DisambiguationResultSchema = z.object({
  resolvedId: z.string().optional().describe('The ID of the correct entity, or omit if none match'),
  confidence: z.number().min(0).max(1).describe('Confidence in the resolution (0-1)'),
  reasoning: z.string().describe('Brief explanation of why this entity was chosen'),
});

export abstract class BaseResolver {
  protected model: ChatOpenAI;
  protected embeddings: OpenAIEmbeddings;

  constructor() {
    this.model = new ChatOpenAI({
      modelName: 'gpt-4.1-nano', // Lightweight model for disambiguation
    });
    this.embeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small', // Cost-effective embeddings
    });
  }

  /**
   * Main resolution method - implemented by each entity type
   */
  abstract resolve(candidate: EntityCandidate, userId: string): Promise<ResolvedEntity>;

  /**
   * Get the entity type this resolver handles
   */
  abstract getEntityType(): 'Person' | 'Project' | 'Topic' | 'Idea';

  /**
   * Search for semantically similar entities using vector embeddings
   */
  protected async vectorSimilaritySearch(
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
      console.warn(
        `Vector similarity search failed for ${entityType}:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      return [];
    }
  }

  /**
   * Disambiguate between multiple candidate entities using LLM
   * Only uses intrinsic node properties for matching.
   */
  protected async disambiguate(
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
          const traits = person.personality_traits?.slice(0, 3).join(', ');
          const traitsDisplay = traits ? traits : 'no traits';
          const situation = person.current_life_situation ? person.current_life_situation : 'no info';
          return `${idx + 1}. ${person.name} - ${situation} (traits: ${traitsDisplay})`;
        } else if ('domain' in c) {
          // Project - use intrinsic properties only
          const project = c as Project;
          const domain = project.domain ? project.domain : 'no domain';
          const vision = project.vision ? project.vision : 'no info';
          return `${idx + 1}. ${project.name} (${domain}) - ${vision}`;
        } else {
          // Topic
          const topic = c as Topic;
          const category = topic.category ? topic.category : 'no category';
          const description = topic.description ? topic.description : 'no description';
          return `${idx + 1}. ${topic.name} (${category}) - ${description}`;
        }
      })
      .join('\n');

    const mentionedName = candidate.mentionedName ? candidate.mentionedName : candidate.summary;
    const context = candidate.contextClue ? candidate.contextClue : 'none';

    const prompt = `You are resolving an entity mention to an existing entity in the knowledge graph.

Mentioned entity:
- Name: ${mentionedName}
- Context: ${context}
- Type: ${candidate.type}

Existing candidates:
${candidatesList}

Which existing entity (if any) does this mention refer to? If none of them match, return null.

Focus on matching the identity of the entity itself (name, traits, description), not the user's relationship to it.

Return the ID of the matching entity, your confidence (0-1), and brief reasoning.`;

    const result = await structuredLlm.invoke(prompt);

    if (result.resolvedId !== undefined && result.confidence > 0.7) {
      const match = candidates.find((c) => c.id === result.resolvedId);
      const matchName = match?.name ? match.name : 'unknown';
      console.log(
        `🤖 Disambiguated "${candidate.mentionedName}" → "${matchName}" (confidence: ${result.confidence})`
      );
      return match ? match : null;
    }

    return null;
  }

  /**
   * Create alias if entity was resolved with a different name
   */
  protected async createAliasIfNeeded(
    existing: { id: string; name: string } | null,
    mentionedName: string,
    entityType: 'Person' | 'Project' | 'Topic' | 'Idea'
  ): Promise<boolean> {
    if (existing && existing.id && existing.name !== mentionedName) {
      await aliasRepository.createAlias(mentionedName, existing.id, entityType);
      return true;
    }
    return false;
  }
}
