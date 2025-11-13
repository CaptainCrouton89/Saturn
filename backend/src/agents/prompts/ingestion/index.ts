/**
 * Ingestion Agent System Prompts
 *
 * Defines prompts for the 4-phase ingestion pipeline:
 * 0. Convert to Notes (conditional): Transform voice memos to structured notes
 * 1. Extraction + Disambiguation: Identify entities and match to existing graph nodes
 * 2. Source Edges: Automatically created by source edges node (no prompt needed)
 * 3. Relationship Agent: LLM with tools to create/update nodes and relationships
 *
 * Reference: /Users/silasrhyneer/Code/Cosmo/Saturn/backend/INGESTION_REFACTOR_PLAN.md (Phase 4.2)
 * Reference: /Users/silasrhyneer/Code/Cosmo/Saturn/tech.md (lines 127-131, 228-265)
 */

export { NOTES_EXTRACTION_SYSTEM_PROMPT } from './phase0-notes.js';
export { EXTRACTION_SYSTEM_PROMPT } from './phase1-extraction.js';
export { UPDATE_COLLECTION_SYSTEM_PROMPT } from './phase3-update-collection.js';
export { PERSON_PROCESSING_SYSTEM_PROMPT } from './phase4-person.js';
export { CONCEPT_PROCESSING_SYSTEM_PROMPT } from './phase4-concept.js';
export { ENTITY_PROCESSING_SYSTEM_PROMPT } from './phase4-entity.js';
