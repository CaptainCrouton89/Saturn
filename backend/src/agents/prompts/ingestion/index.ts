/**
 * Ingestion Agent System Prompts
 *
 * Defines prompts for the ingestion pipeline:
 * - Content Normalization: Transform voice memos to structured notes
 * - Entity Extraction: Identify entities and match to existing graph nodes
 * - Source Creation: Automatically created by source edges node (no prompt needed)
 * - MERGE/CREATE Agents: Specialized agents for updating existing nodes or creating new ones
 *
 * Reference: /Users/silasrhyneer/Code/Cosmo/Saturn/backend/INGESTION_REFACTOR_PLAN.md (Phase 4.2)
 * Reference: /Users/silasrhyneer/Code/Cosmo/Saturn/tech.md (lines 127-131, 228-265)
 */

export { EXTRACTION_SYSTEM_PROMPT } from './phase1-extraction.js';
export { CREATE_RELATIONSHIPS_SYSTEM_PROMPT } from './phase4-create-relationships.js';
export {
  CREATE_CONCEPT_STRUCTURED_PROMPT,
  CREATE_ENTITY_STRUCTURED_PROMPT, CREATE_PERSON_STRUCTURED_PROMPT
} from './phase4-create-structured.js';
export { MERGE_AGENT_SYSTEM_PROMPT } from './phase4-merge.js';
export { RESOLUTION_DECISION_SYSTEM_PROMPT } from './resolution-decision.js';

