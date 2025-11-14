/**
 * Consolidation Prompts Index
 *
 * System prompts for Phase 5 nightly consolidation agents.
 * Each prompt instructs an agent to review accumulated notes and
 * decide if node/relationship properties should be updated.
 */

// Node consolidation prompts
export { PERSON_CONSOLIDATION_SYSTEM_PROMPT } from './person-consolidation.js';
export { CONCEPT_CONSOLIDATION_SYSTEM_PROMPT } from './concept-consolidation.js';
export { ENTITY_CONSOLIDATION_SYSTEM_PROMPT } from './entity-consolidation.js';

// Relationship consolidation prompts
export { HAS_RELATIONSHIP_WITH_CONSOLIDATION_SYSTEM_PROMPT } from './has-relationship-with-consolidation.js';
export { ENGAGES_WITH_CONSOLIDATION_SYSTEM_PROMPT } from './engages-with-consolidation.js';
export { ASSOCIATED_WITH_CONSOLIDATION_SYSTEM_PROMPT } from './associated-with-consolidation.js';
export { RELATES_TO_CONSOLIDATION_SYSTEM_PROMPT } from './relates-to-consolidation.js';
export { INVOLVES_CONSOLIDATION_SYSTEM_PROMPT } from './involves-consolidation.js';
export { CONNECTED_TO_CONSOLIDATION_SYSTEM_PROMPT } from './connected-to-consolidation.js';
