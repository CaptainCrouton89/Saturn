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

// Relationship tools for ingestion agent
import {
  createRelationshipTool,
  updateRelationshipTool,
} from './relationships/relationship.tool.js';

/**
 * All available tools for the conversation agent.
 * Add new tools here to make them available to the agent.
 */
export const allTools = [
  writeTool,
  completeOnboardingTool,
];

/**
 * Ingestion-specific tools for creating and updating graph nodes and relationships.
 * These tools are used by the ingestion agent during memory extraction.
 */
export const ingestionTools = [
  // Node tools
  createPersonTool,
  updatePersonTool,
  createConceptTool,
  updateConceptTool,
  createEntityTool,
  updateEntityTool,
  createArtifactTool,
  updateArtifactTool,
  // Relationship tools
  createRelationshipTool,
  updateRelationshipTool,
];
