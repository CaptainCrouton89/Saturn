/**
 * Phase 3: Entity Update Service
 *
 * Orchestrates entity update generation by delegating to specialized updaters.
 * Each entity type (Person, Project, Topic, Idea) has its own updater implementation.
 *
 * Update Strategy (MVP): REPLACE
 * - All fields replace existing values
 * - Arrays are bounded (MAX 8-15 items depending on field)
 * - Provenance tracking on all updates
 */

import type { SerializedMessage } from '../agents/types/messages.js';
import type { ResolvedEntity } from './entityResolutionService.js';
import { PersonUpdater, ProjectUpdater, TopicUpdater, IdeaUpdater } from './entityUpdaters/index.js';
import type { UpdateContext } from './entityUpdaters/BaseEntityUpdater.js';

// Export types
export interface EntityUpdate {
  entityId: string | null; // null = new entity to create
  entityType: 'Person' | 'Project' | 'Topic' | 'Idea';
  entityKey: string;
  isNew: boolean;

  // For new entities, provide the full data
  newEntityData?: {
    name?: string;
    canonical_name?: string;
    summary?: string; // For Ideas
  };

  // Update fields (only changed fields)
  // Split into node updates (intrinsic properties) and relationship updates (user-specific)
  nodeUpdates: Record<string, unknown>; // Properties written to the entity node
  relationshipUpdates: Record<string, unknown>; // Properties written to User->Entity relationship

  // Provenance
  last_update_source: string; // conversation_id
  confidence: number;
}

class EntityUpdateService {
  private updaters: Map<string, PersonUpdater | ProjectUpdater | TopicUpdater | IdeaUpdater>;

  constructor() {
    // Initialize entity-specific updaters
    this.updaters = new Map<string, PersonUpdater | ProjectUpdater | TopicUpdater | IdeaUpdater>([
      ['Person', new PersonUpdater()],
      ['Project', new ProjectUpdater()],
      ['Topic', new TopicUpdater()],
      ['Idea', new IdeaUpdater()],
    ]);
  }

  /**
   * Prepare transcript excerpt for entity update
   */
  private prepareTranscript(transcript: SerializedMessage[]): string {
    const dialogue = transcript.filter((msg) => msg.type === 'human' || msg.type === 'ai');

    const formatted = dialogue
      .map((msg, idx) => {
        const speaker = msg.type === 'human' ? 'User' : 'Cosmo';
        const content = msg.content ? msg.content : '';
        return `[Turn ${idx + 1}] ${speaker}: ${content}`;
      })
      .join('\n\n');

    return formatted;
  }

  /**
   * Generate updates for all resolved entities in parallel
   *
   * @param input - Either a conversation transcript (SerializedMessage[]) or plain text (string)
   * @param resolvedEntities - Entities resolved to existing Neo4j nodes or marked as new
   * @param sourceId - conversation_id OR information_dump_id for provenance tracking
   */
  async generateUpdates(
    input: SerializedMessage[] | string,
    resolvedEntities: ResolvedEntity[],
    sourceId: string
  ): Promise<EntityUpdate[]> {
    console.log('📝 Generating entity updates...');

    // Handle both transcript and plain text input
    const readableText =
      typeof input === 'string' ? input : this.prepareTranscript(input);

    // Process all entities in parallel
    const updates = await Promise.all(
      resolvedEntities.map((resolved) =>
        this.generateSingleUpdate(readableText, resolved, sourceId)
      )
    );

    console.log(`✅ Generated ${updates.length} entity updates`);

    return updates;
  }

  /**
   * Generate update for a single entity by delegating to appropriate updater
   */
  private async generateSingleUpdate(
    text: string,
    resolved: ResolvedEntity,
    sourceId: string
  ): Promise<EntityUpdate> {
    const { candidate, resolvedId, existingData, confidence } = resolved;

    // Get the appropriate updater for this entity type
    const updater = this.updaters.get(candidate.type);
    if (!updater) {
      throw new Error(`No updater found for entity type: ${candidate.type}`);
    }

    // Build update context
    const context: UpdateContext = {
      transcript: text, // Now can be either formatted transcript or plain text
      candidate,
      resolvedId,
      existingData,
      confidence,
      conversationId: sourceId, // Now can be conversation_id or information_dump_id
    };

    // Delegate to the entity-specific updater
    return await updater.update(context);
  }
}

export const entityUpdateService = new EntityUpdateService();
