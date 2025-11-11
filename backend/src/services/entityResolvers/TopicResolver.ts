/**
 * Topic Entity Resolver
 *
 * Resolves Topic entities using multi-tier strategy:
 * 1. entity_key match
 * 2. canonical_name match
 * 3. Alias match
 * 4. Vector similarity search
 * 5. LLM disambiguation
 */

import { BaseResolver, type ResolvedEntity } from './BaseResolver.js';
import { topicRepository } from '../../repositories/TopicRepository.js';
import { aliasRepository } from '../../repositories/AliasRepository.js';
import type { EntityCandidate } from '../entityIdentificationService.js';
import type { Topic } from '../../types/graph.js';

export class TopicResolver extends BaseResolver {
  getEntityType(): 'Topic' {
    return 'Topic';
  }

  async resolve(candidate: EntityCandidate, _userId: string): Promise<ResolvedEntity> {
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
      const searchText = `${candidate.mentionedName} ${candidate.category ? candidate.category : ''}`;
      const similarEntities = await this.vectorSimilaritySearch(searchText, 'Topic', 3, 0.85);

      if (similarEntities.length > 0) {
        const topMatch = similarEntities[0];

        if (topMatch.score > 0.92) {
          existing = topMatch.entity as Topic;
          resolvedConfidence = topMatch.score;
          console.log(
            `🔍 Vector match: "${candidate.mentionedName}" → "${existing.name}" (score: ${topMatch.score.toFixed(3)})`
          );
        } else if (topMatch.score > 0.85) {
          const candidates = similarEntities.map((s) => s.entity as Topic);
          const disambiguated = await this.disambiguate(candidate, candidates);
          if (disambiguated) {
            existing = disambiguated as Topic;
            resolvedConfidence = 0.88;
          }
        }
      }
    }

    const aliasCreated = await this.createAliasIfNeeded(existing, candidate.mentionedName, 'Topic');

    return {
      candidate,
      resolvedId: existing?.id ? existing.id : null,
      existingData: existing ? existing : null,
      confidence: existing ? resolvedConfidence : 0.8,
      aliasCreated,
    };
  }
}
