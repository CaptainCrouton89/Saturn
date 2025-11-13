/**
 * Tool registry for LangChain/LangGraph agents.
 *
 * Centralizes all available tools for easy management and addition of new tools.
 *
 * Note: Retrieval tools (explore, traverse) are not included here as they require
 * userId context and are used by the ingestion agent, not the conversation agent.
 * Import them directly from ./retrieval/ when needed.
 */

import { completeOnboardingTool } from './completeOnboarding.tool.js';
import { writeTool } from './write.tool.js';

// Node creation/update tools for ingestion agent
import { createPersonTool, updatePersonTool } from './nodes/person.tool.js';
import { createConceptTool, updateConceptTool } from './nodes/concept.tool.js';
import { createEntityTool, updateEntityTool } from './nodes/entity.tool.js';
import { createArtifactTool, updateArtifactTool } from './nodes/artifact.tool.js';

// Note tools for adding notes to nodes
import { addNoteToPersonTool } from './notes/add-note-to-person.tool.js';
import { addNoteToConceptTool } from './notes/add-note-to-concept.tool.js';
import { addNoteToEntityTool } from './notes/add-note-to-entity.tool.js';
import { addNoteToRelationshipTool } from './notes/add-note-to-relationship.tool.js';

// Unified relationship tools (per agent-tools.md spec)
import { createRelationshipTool } from './relationships/relationship.tool.js';

/**
 * All available tools for the conversation agent.
 * Add new tools here to make them available to the agent.
 */
export const allTools = [writeTool, completeOnboardingTool];

/**
 * Unified ingestion tools for all entity types and relationships.
 * Used by the ingestion agent (Phase 4) which processes all entity types
 * with a single agent instead of 3 specialized agents.
 *
 * API matches agent-tools.md spec.
 */
export const ingestionTools = [
  // Node tools
  createPersonTool,
  updatePersonTool,
  createConceptTool,
  updateConceptTool,
  createEntityTool,
  updateEntityTool,
  // Note tools
  addNoteToPersonTool,
  addNoteToConceptTool,
  addNoteToEntityTool,
  // Relationship tools (unified API per agent-tools.md)
  createRelationshipTool,
  addNoteToRelationshipTool,
];

/**
 * Artifact creation/update tools (used by all agents when needed)
 */
export const artifactTools = [createArtifactTool, updateArtifactTool];
