/**
 * Idea Entity Resolver
 *
 * Ideas are matched by entity_key (hash of summary), as they don't have names.
 * No alias matching or vector search needed.
 */

import { BaseResolver, type ResolvedEntity } from './BaseResolver.js';
import { ideaRepository } from '../../repositories/IdeaRepository.js';
import type { EntityCandidate } from '../entityIdentificationService.js';

export class IdeaResolver extends BaseResolver {
  getEntityType(): 'Idea' {
    return 'Idea';
  }

  async resolve(candidate: EntityCandidate, _userId: string): Promise<ResolvedEntity> {
    const existing = await ideaRepository.findByEntityKey(candidate.entityKey);

    return {
      candidate,
      resolvedId: existing?.id ? existing.id : null,
      existingData: existing ? existing : null,
      confidence: existing ? 0.85 : 0.8, // Slightly lower confidence for ideas
      aliasCreated: false, // Ideas don't have aliases
    };
  }
}
