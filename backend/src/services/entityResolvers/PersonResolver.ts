/**
 * Person Entity Resolver
 *
 * Resolves Person entities using multi-tier strategy:
 * 1. entity_key match
 * 2. canonical_name match
 * 3. Alias match
 * 4. Vector similarity search
 * 5. Fuzzy name search
 * 6. LLM disambiguation
 */

import { BaseResolver, type ResolvedEntity } from './BaseResolver.js';
import { personRepository } from '../../repositories/PersonRepository.js';
import { aliasRepository } from '../../repositories/AliasRepository.js';
import type { EntityCandidate } from '../entityIdentificationService.js';
import type { Person } from '../../types/graph.js';

export class PersonResolver extends BaseResolver {
  getEntityType(): 'Person' {
    return 'Person';
  }

  async resolve(candidate: EntityCandidate, _userId: string): Promise<ResolvedEntity> {
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
      const searchText = `${candidate.mentionedName} ${candidate.contextClue ? candidate.contextClue : ''}`;
      const similarEntities = await this.vectorSimilaritySearch(searchText, 'Person', 3, 0.85);

      if (similarEntities.length > 0) {
        const topMatch = similarEntities[0];

        if (topMatch.score > 0.92) {
          // High confidence semantic match - use it directly
          existing = topMatch.entity as Person;
          resolvedConfidence = topMatch.score;
          console.log(
            `🔍 Vector match: "${candidate.mentionedName}" → "${existing.name}" (score: ${topMatch.score.toFixed(3)})`
          );
        } else if (topMatch.score > 0.85) {
          // Medium confidence - disambiguate with LLM
          const candidates = similarEntities.map((s) => s.entity as Person);
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
    const aliasCreated = await this.createAliasIfNeeded(existing, candidate.mentionedName, 'Person');

    return {
      candidate,
      resolvedId: existing?.id ? existing.id : null,
      existingData: existing ? existing : null,
      confidence: existing ? resolvedConfidence : 0.8,
      aliasCreated,
    };
  }
}
