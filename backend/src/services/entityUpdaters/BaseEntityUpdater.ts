/**
 * Base Entity Updater
 *
 * Abstract base class for entity-specific updaters.
 * Provides shared utilities for LLM invocation, prompt building, and data filtering.
 */

import { ChatOpenAI } from '@langchain/openai';
import type { z } from 'zod';
import type { EntityUpdate } from '../entityUpdateService.js';

export interface EntityCandidate {
  mentionedName?: string;
  summary?: string;
  contextClue?: string;
  category?: string;
  entityKey: string;
}

export interface UpdateContext {
  transcript: string;
  candidate: EntityCandidate;
  resolvedId: string | null;
  existingData: unknown;
  confidence: number;
  conversationId: string;
}

export abstract class BaseEntityUpdater {
  protected model: ChatOpenAI;

  constructor() {
    this.model = new ChatOpenAI({
      modelName: 'gpt-4.1-nano',
    });
  }

  /**
   * Main entry point for updating an entity
   */
  abstract update(context: UpdateContext): Promise<EntityUpdate>;

  /**
   * Get the entity type this updater handles
   */
  abstract getEntityType(): 'Person' | 'Project' | 'Topic' | 'Idea';

  /**
   * Filter out empty values from LLM structured output
   * Remove: empty strings, empty arrays, -1 numbers (sentinel values)
   */
  protected filterEmptyValues(obj: Record<string, unknown>): Record<string, unknown> {
    const filtered: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Skip empty strings
      if (value === '' || value === null || value === undefined) {
        continue;
      }

      // Skip empty arrays
      if (Array.isArray(value) && value.length === 0) {
        continue;
      }

      // Skip -1 sentinel values for numbers
      if (typeof value === 'number' && value === -1) {
        continue;
      }

      filtered[key] = value;
    }

    return filtered;
  }

  /**
   * Invoke LLM with structured output for a single schema
   */
  protected async invokeStructured<T extends z.ZodType>(
    schema: T,
    prompt: string
  ): Promise<Record<string, unknown>> {
    const structuredLlm = this.model.withStructuredOutput(schema);
    return (await structuredLlm.invoke(prompt)) as Record<string, unknown>;
  }

  /**
   * Invoke LLM with structured output for dual schemas (node + relationship)
   * Returns both results in parallel
   */
  protected async invokeDualStructured<TNode extends z.ZodType, TRel extends z.ZodType>(
    nodeSchema: TNode,
    relSchema: TRel,
    nodePrompt: string,
    relPrompt: string
  ): Promise<[Record<string, unknown>, Record<string, unknown>]> {
    const nodeStructuredLlm = this.model.withStructuredOutput(nodeSchema);
    const relStructuredLlm = this.model.withStructuredOutput(relSchema);

    const results = await Promise.all([
      nodeStructuredLlm.invoke(nodePrompt),
      relStructuredLlm.invoke(relPrompt),
    ]);

    return [results[0] as Record<string, unknown>, results[1] as Record<string, unknown>];
  }

  /**
   * Build EntityUpdate result for new entity
   */
  protected buildNewEntityUpdate(
    entityType: 'Person' | 'Project' | 'Topic' | 'Idea',
    entityKey: string,
    newEntityData: { name?: string; canonical_name?: string; summary?: string },
    nodeUpdates: Record<string, unknown>,
    relationshipUpdates: Record<string, unknown>,
    conversationId: string,
    confidence: number
  ): EntityUpdate {
    return {
      entityId: null,
      entityType,
      entityKey,
      isNew: true,
      newEntityData,
      nodeUpdates: this.filterEmptyValues(nodeUpdates),
      relationshipUpdates: this.filterEmptyValues(relationshipUpdates),
      last_update_source: conversationId,
      confidence,
    };
  }

  /**
   * Build EntityUpdate result for existing entity
   */
  protected buildExistingEntityUpdate(
    entityType: 'Person' | 'Project' | 'Topic' | 'Idea',
    entityId: string,
    entityKey: string,
    nodeUpdates: Record<string, unknown>,
    relationshipUpdates: Record<string, unknown>,
    conversationId: string,
    confidence: number
  ): EntityUpdate {
    return {
      entityId,
      entityType,
      entityKey,
      isNew: false,
      nodeUpdates: this.filterEmptyValues(nodeUpdates),
      relationshipUpdates: this.filterEmptyValues(relationshipUpdates),
      last_update_source: conversationId,
      confidence,
    };
  }
}
