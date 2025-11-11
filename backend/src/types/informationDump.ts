/**
 * TypeScript types for information dump processing
 *
 * Information dumps allow users to submit unstructured text (notes, journal entries,
 * meeting summaries) that gets processed and integrated into their Neo4j knowledge graph
 * without requiring conversational back-and-forth.
 */

/**
 * InformationDump database record
 *
 * Represents a user-submitted text dump stored in PostgreSQL.
 * Processing happens asynchronously via pg-boss queue.
 */
export interface InformationDump {
  /** UUID primary key */
  id: string;

  /** User who submitted the dump */
  user_id: string;

  /** Short title for the dump (max 200 chars) */
  title: string;

  /** Optional short description/summary (max 200 chars) */
  label: string | null;

  /** Full text content (max 50,000 chars) */
  content: string;

  /** When the dump was created */
  created_at: string;

  /** Current processing status */
  processing_status: 'queued' | 'processing' | 'completed' | 'failed';

  /** Whether entities have been extracted to Neo4j */
  entities_extracted: boolean;

  /** Timestamp when successfully synced to Neo4j */
  neo4j_synced_at: string | null;

  /** Error message if processing failed */
  error_message: string | null;
}

/**
 * Request body for creating a new information dump
 */
export interface CreateInformationDumpRequest {
  /** Short title for the dump (required, 1-200 chars) */
  title: string;

  /** Optional short description/summary (max 200 chars) */
  label?: string;

  /** Full text content (required, 1-50,000 chars) */
  content: string;
}

/**
 * Validation error detail
 */
export interface ValidationErrorDetail {
  /** Field that failed validation */
  field: string;

  /** Human-readable error message */
  message: string;
}
