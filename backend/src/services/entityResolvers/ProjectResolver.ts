/**
 * Project Entity Resolver
 *
 * Resolves Project entities using multi-tier strategy:
 * 1. entity_key match
 * 2. canonical_name match
 * 3. Alias match
 * 4. Vector similarity search
 * 5. LLM disambiguation
 */

import { BaseResolver, type ResolvedEntity } from './BaseResolver.js';
import { projectRepository } from '../../repositories/ProjectRepository.js';
import { aliasRepository } from '../../repositories/AliasRepository.js';
import type { EntityCandidate } from '../entityIdentificationService.js';
import type { Project } from '../../types/graph.js';

export class ProjectResolver extends BaseResolver {
  getEntityType(): 'Project' {
    return 'Project';
  }

  async resolve(candidate: EntityCandidate, _userId: string): Promise<ResolvedEntity> {
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
      const searchText = `${candidate.mentionedName} ${candidate.contextClue ? candidate.contextClue : ''}`;
      const similarEntities = await this.vectorSimilaritySearch(searchText, 'Project', 3, 0.85);

      if (similarEntities.length > 0) {
        const topMatch = similarEntities[0];

        if (topMatch.score > 0.92) {
          existing = topMatch.entity as Project;
          resolvedConfidence = topMatch.score;
          console.log(
            `🔍 Vector match: "${candidate.mentionedName}" → "${existing.name}" (score: ${topMatch.score.toFixed(3)})`
          );
        } else if (topMatch.score > 0.85) {
          const candidates = similarEntities.map((s) => s.entity as Project);
          const disambiguated = await this.disambiguate(candidate, candidates);
          if (disambiguated) {
            existing = disambiguated as Project;
            resolvedConfidence = 0.88;
          }
        }
      }
    }

    const aliasCreated = await this.createAliasIfNeeded(existing, candidate.mentionedName, 'Project');

    return {
      candidate,
      resolvedId: existing?.id ? existing.id : null,
      existingData: existing ? existing : null,
      confidence: existing ? resolvedConfidence : 0.8,
      aliasCreated,
    };
  }
}
