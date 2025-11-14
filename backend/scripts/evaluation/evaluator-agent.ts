/**
 * Evaluator Agent - LangGraph agent for querying knowledge graph
 *
 * Uses explore and traverse tools to answer questions about ingested dialogues.
 */

import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { createExploreTool } from '../../src/agents/tools/retrieval/explore.tool.js';
import { createTraverseTool } from '../../src/agents/tools/retrieval/traverse.tool.js';
import type { EvaluationState, ExploreOutput, TraverseOutput } from './types.js';
import { withAgentTracing } from '../../src/utils/tracing.js';

/**
 * State annotation for evaluator agent
 */
const EvaluationStateAnnotation = Annotation.Root({
  user_id: Annotation<string>,
  query: Annotation<string>,
  explore_results: Annotation<ExploreOutput | undefined>,
  traverse_results: Annotation<TraverseOutput | undefined>,
  messages: Annotation<BaseMessage[]>({
    reducer: (state: BaseMessage[], update: BaseMessage[]) => state.concat(update),
  }),
  answer: Annotation<string>,
  iteration: Annotation<number>,
});

/**
 * System prompt for evaluator agent
 */
const EVALUATOR_SYSTEM_PROMPT = `You are an expert knowledge graph query assistant. Your role is to answer questions by exploring and traversing a user's knowledge graph.

**Available Tools:**
1. **explore**: Semantic search across the knowledge graph. Use this first to find relevant entities, concepts, people, and sources.
2. **traverse**: Execute custom Cypher queries for specific navigation. Use after explore for detailed information.

**Your Process:**
1. Analyze the question to understand what information is needed
2. Use explore tool with semantic queries to find relevant nodes
3. If more specific details needed, use traverse tool with targeted Cypher queries
4. Synthesize the retrieved information into a clear, concise answer
5. If information is not found in the graph, clearly state "Information not found"

**Important:**
- Always use explore first for broad discovery
- Use traverse for specific details (e.g., all relationships of a node, temporal queries)
- Keep answers factual and grounded in the retrieved data
- Cite entity_keys when referencing specific nodes
- If uncertain, acknowledge limitations

Answer the user's question based on the knowledge graph.`;

/**
 * Run the evaluator agent for a single query
 *
 * @param userId - User ID for graph scoping
 * @param query - Question to answer
 * @returns Answer string and full message history
 */
async function runEvaluatorAgentImpl(
  userId: string,
  query: string
): Promise<{ answer: string; messages: BaseMessage[] }> {
  // Create tools bound to user_id
  const exploreTool = createExploreTool(userId);
  const traverseTool = createTraverseTool(userId);
  const tools = [exploreTool, traverseTool];

  // Create model with tools
  const model = new ChatOpenAI({
    modelName: 'gpt-4.1-mini',
  }).bindTools(tools);

  // Define graph nodes
  async function callModel(state: typeof EvaluationStateAnnotation.State) {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  }

  // Tool executor node
  async function callTools(state: typeof EvaluationStateAnnotation.State) {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

    if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
      return { messages: [] };
    }

    const toolMessages: BaseMessage[] = [];

    for (const toolCall of lastMessage.tool_calls) {
      const tool = tools.find((t) => t.name === toolCall.name);

      if (!tool) {
        throw new Error(`Tool ${toolCall.name} not found`);
      }

      try {
        const result = await tool.invoke(toolCall.args);

        // Parse result to store in state
        if (toolCall.name === 'explore') {
          const exploreOutput = JSON.parse(result) as ExploreOutput;
          Object.assign(state, { explore_results: exploreOutput });
        } else if (toolCall.name === 'traverse') {
          const traverseOutput = JSON.parse(result) as TraverseOutput;
          Object.assign(state, { traverse_results: traverseOutput });
        }

        toolMessages.push({
          type: 'tool',
          content: result,
          tool_call_id: toolCall.id!,
          name: toolCall.name,
        } as BaseMessage);
      } catch (error) {
        toolMessages.push({
          type: 'tool',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          tool_call_id: toolCall.id!,
          name: toolCall.name,
        } as BaseMessage);
      }
    }

    return { messages: toolMessages };
  }

  // Routing function
  function shouldContinue(state: typeof EvaluationStateAnnotation.State): 'tools' | 'end' {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      return 'tools';
    }

    return 'end';
  }

  // Extract final answer
  async function extractAnswer(state: typeof EvaluationStateAnnotation.State) {
    const lastMessage = state.messages[state.messages.length - 1];

    if (!lastMessage.content) {
      throw new Error('No answer content generated by model');
    }

    const answer = lastMessage.content.toString();
    return { answer };
  }

  // Build graph
  const workflow = new StateGraph(EvaluationStateAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', callTools)
    .addNode('extractAnswer', extractAnswer)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, {
      tools: 'tools',
      end: 'extractAnswer',
    })
    .addEdge('tools', 'agent')
    .addEdge('extractAnswer', END);

  const graph = workflow.compile();

  // Initialize state
  const initialState = {
    user_id: userId,
    query,
    messages: [
      { type: 'system', content: EVALUATOR_SYSTEM_PROMPT } as BaseMessage,
      new HumanMessage(query),
    ],
    answer: '',
    iteration: 0,
  };

  // Run graph
  const result = await graph.invoke(initialState);

  return {
    answer: result.answer,
    messages: result.messages,
  };
}

/**
 * Exported wrapped version with LangSmith tracing
 */
export const runEvaluatorAgent = withAgentTracing(
  runEvaluatorAgentImpl as (...args: unknown[]) => unknown,
  "evaluator",
  { phase: "retrieval" }
) as unknown as typeof runEvaluatorAgentImpl;

/**
 * Batch evaluate multiple queries for a dialogue
 *
 * @param userId - User ID for graph scoping
 * @param queries - Array of questions to answer
 * @returns Array of answers with timing information
 */
export async function batchEvaluate(
  userId: string,
  queries: string[]
): Promise<Array<{ query: string; answer: string; latency_ms: number }>> {
  const results = [];

  for (const query of queries) {
    const startTime = Date.now();

    try {
      const { answer } = await runEvaluatorAgent(userId, query);
      const latency_ms = Date.now() - startTime;

      results.push({ query, answer, latency_ms });
    } catch (error) {
      const latency_ms = Date.now() - startTime;
      results.push({
        query,
        answer: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        latency_ms,
      });
    }
  }

  return results;
}
