/**
 * Mentions Linking Service
 *
 * Handles creation of mentions relationships between Source nodes and entities.
 * Dedupes entity keys and provides idempotent linking.
 *
 * Extracted from ingestion orchestrator to separate concerns.
 */

import { sourceRepository } from '../repositories/SourceRepository.js';
import type { EntityType } from '../types/graph.js';

/**
 * Entity reference for mentions linking
 */
export interface EntityReference {
  entity_key: string;
  entity_type: EntityType;
}

/**
 * Mentions linking result
 */
export interface MentionsLinkingResult {
  created: number;
  skipped: number;
  total: number;
}

/**
 * Mentions Linking Service
 */
export class MentionsLinkingService {
  /**
   * Link Source to mentioned entities via mentions edges
   *
   * Dedupes entity keys before linking.
   * Converts entity types to proper Neo4j labels (person -> Person).
   *
   * @param sourceEntityKey - Source entity_key
   * @param entities - Entity references to link
   * @returns Linking result with created/skipped counts
   * @throws Error if any relationship creation fails unexpectedly
   */
  async linkMentionsToSource(
    sourceEntityKey: string,
    entities: EntityReference[]
  ): Promise<MentionsLinkingResult> {
    if (entities.length === 0) {
      console.log('   ⚠️  No entities to link (empty entity list)');
      return { created: 0, skipped: 0, total: 0 };
    }

    // Dedupe entity keys (convert to Set and back to ensure uniqueness)
    const uniqueEntities = Array.from(
      new Map(entities.map((e) => [e.entity_key, e])).values()
    );

    if (uniqueEntities.length === 0) {
      console.log('   ⚠️  No entities to link (all filtered out)');
      return { created: 0, skipped: 0, total: 0 };
    }

    // Link mentions using sourceRepository (idempotent)
    const linkResult = await sourceRepository.linkToEntities(
      sourceEntityKey,
      uniqueEntities.map((e) => ({
        entity_key: e.entity_key,
        type: e.entity_type,
      }))
    );

    if (linkResult.skipped > 0) {
      console.log(
        `   ✅ Linked ${linkResult.created} new mentions (${linkResult.skipped} already existed)`
      );
    } else {
      console.log(`   ✅ Linked ${linkResult.created} mentions edges`);
    }

    return {
      created: linkResult.created,
      skipped: linkResult.skipped,
      total: uniqueEntities.length,
    };
  }

  /**
   * Extract entity references from resolved entities
   *
   * Filters entities with valid entity_keys and converts to EntityReference format.
   *
   * @param entities - Resolved entities (must have entity_key and entity_type)
   * @returns Array of entity references ready for linking
   */
  extractEntityReferences<
    T extends { entity_key?: string; entity_type: EntityType }
  >(entities: T[]): EntityReference[] {
    return entities
      .filter((e) => e.entity_key !== undefined)
      .map((e) => ({
        entity_key: e.entity_key!,
        entity_type: e.entity_type,
      }));
  }
}

// Export singleton instance
export const mentionsLinkingService = new MentionsLinkingService();
