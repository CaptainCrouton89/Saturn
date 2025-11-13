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

// Specialized Person relationship tools
import {
  createPersonThinksAboutConceptTool,
  createPersonRelationshipTool,
  createPersonRelatesToEntityTool,
} from './relationships/person-relationships.tool.js';

// Specialized Concept relationship tools
import {
  createConceptRelatesToConceptTool,
  createConceptInvolvesPersonTool,
  createConceptInvolvesEntityTool,
} from './relationships/concept-relationships.tool.js';

// Specialized Entity relationship tools
import { createEntityRelatesToEntityTool } from './relationships/entity-relationships.tool.js';

/**
 * All available tools for the conversation agent.
 * Add new tools here to make them available to the agent.
 */
export const allTools = [writeTool, completeOnboardingTool];

/**
 * Person-specific ingestion tools (node + relationships)
 */
export const personIngestionTools = [
  createPersonTool,
  updatePersonTool,
  createPersonThinksAboutConceptTool,
  createPersonRelationshipTool,
  createPersonRelatesToEntityTool,
];

/**
 * Concept-specific ingestion tools (node + relationships)
 */
export const conceptIngestionTools = [
  createConceptTool,
  updateConceptTool,
  createConceptRelatesToConceptTool,
  createConceptInvolvesPersonTool,
  createConceptInvolvesEntityTool,
];

/**
 * Entity-specific ingestion tools (node + relationships)
 */
export const entityIngestionTools = [
  createEntityTool,
  updateEntityTool,
  createEntityRelatesToEntityTool,
];

/**
 * Artifact creation/update tools (used by all agents when needed)
 */
export const artifactTools = [createArtifactTool, updateArtifactTool];
