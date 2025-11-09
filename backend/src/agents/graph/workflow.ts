/**
 * LangGraph workflow definition for the conversation agent.
 *
 * Workflow flow:
 * START → agent → (if tool calls) tools → agent → (if no tool calls) END
 */

import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { agentNode, toolNode, shouldContinue } from './nodes.js';

/**
 * Complete LangGraph workflow for conversational agent with tool support.
 *
 * The workflow:
 * 1. Starts at the agent node (calls LLM)
 * 2. If LLM makes tool calls, routes to tool node
 * 3. After tools execute, returns to agent node
 * 4. If no tool calls, workflow ends
 */
const workflow = new StateGraph(MessagesAnnotation)
  .addNode('agent', agentNode)
  .addNode('tools', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', shouldContinue, {
    tools: 'tools',
    [END]: END
  })
  .addEdge('tools', 'agent'); // After tools, go back to agent

/**
 * Compiled and executable graph.
 * Export this to run conversations.
 */
export const graph = workflow.compile();
