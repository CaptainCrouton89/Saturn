/**
 * Source Management Service
 *
 * Handles Source node lifecycle management:
 * - Create or find existing Source nodes
 * - Update Source processing status
 * - Manage Source metadata and content
 *
 * Extracted from ingestion orchestrator to separate concerns.
 */

import { sourceRepository } from '../repositories/SourceRepository.js';

/**
 * Source node creation payload
 */
export interface CreateSourcePayload {
  sourceId: string;
  userId: string;
  teamId?: string | null;
  sourceType: string;
  description: string;
  rawContent: string | string[];
  processedContent: string[];
  participants: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Source management service
 */
export class SourceManagementService {
  /**
   * Ensure Source node exists (create if needed, or return existing)
   *
   * Generates stable entity_key from payload, checks if Source exists,
   * and creates new Source if needed.
   *
   * IMPORTANT: Source created BEFORE extraction for sourceEntityKey provenance
   *
   * @param payload - Source creation payload
   * @returns Source entity_key
   */
  async ensureSourceNode(payload: CreateSourcePayload): Promise<string> {
    // First check if Source already exists by sourceId
    const existingSource = await sourceRepository.findBySourceId(payload.sourceId);

    if (existingSource) {
      console.log(`   ✅ Found existing Source: ${existingSource.entity_key}`);
      return existingSource.entity_key;
    }

    // Create new Source node with stable timestamps
    // IMPORTANT: Use payload.createdAt (not new Date()) to ensure deterministic entity_key
    const source = await sourceRepository.create({
      source_id: payload.sourceId, // Store external source ID for idempotent lookups
      user_id: payload.userId,
      team_id: payload.teamId || null,
      source_type: payload.sourceType,
      description: payload.description,
      raw_content: Array.isArray(payload.rawContent)
        ? JSON.stringify(payload.rawContent)
        : payload.rawContent,
      content: {
        type: 'markdown',
        content: this.contentToMarkdown(payload.processedContent),
      },
      participants: payload.participants,
      created_at: payload.createdAt, // Use payload timestamp (deterministic)
      started_at: payload.createdAt, // Conversation start time
      summary: payload.description, // Use AI-generated summary
      processing_status: 'in_progress',
      processing_started_at: payload.createdAt, // Use payload timestamp instead of new Date()
    });

    console.log(`   ✅ Created new Source: ${source.entity_key}`);
    return source.entity_key;
  }

  /**
   * Convert processed content array to markdown string
   *
   * @param processed - Array of processed content strings
   * @returns Markdown formatted string
   */
  private contentToMarkdown(processed: string[]): string {
    return processed.join('\n');
  }
}

// Export singleton instance
export const sourceManagementService = new SourceManagementService();
