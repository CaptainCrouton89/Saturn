import { query } from "@anthropic-ai/claude-agent-sdk";
import { Request, Response } from 'express';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { CoreMessage } from 'ai';
import { MAIN_AGENT_SYSTEM_PROMPT } from "../agents/prompts/assistant/main.js";
import { MEMORY_OPTIMIZED_SYSTEM_PROMPT } from "../agents/prompts/assistant/memory-optimized.js";
import { createConversationMcpServer, createGraphMcpServer } from "./mcpServer.js";
import { createExploreTool } from "../agents/tools/retrieval/explore.tool.js";
import { createTraverseTool } from "../agents/tools/retrieval/traverse.tool.js";
import { conversationService } from "../services/conversationService.js";
import { withSpan, setSessionId } from "../utils/tracing.js";
import type { StoredMessage } from "../agents/types/messages.js";
import type { ConversationTurn } from "../types/dto.js";

/**
 * Convert ConversationTurn format to StoredMessage format
 */
function convertConversationTurnsToStoredMessages(turns: ConversationTurn[]): StoredMessage[] {
  return turns.map(turn => ({
    role: turn.speaker === 'user' ? 'human' as const : 'ai' as const,
    content: turn.message,
    timestamp: turn.timestamp
  }));
}

/**
 * Convert StoredMessage format to AI SDK CoreMessage format
 */
function convertToCoreMessages(messages: StoredMessage[]): CoreMessage[] {
  const result: CoreMessage[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'system':
        result.push({ role: 'system', content: msg.content });
        break;

      case 'human':
        result.push({ role: 'user', content: msg.content });
        break;

      case 'ai': {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          result.push({
            role: 'assistant',
            content: [
              { type: 'text', text: msg.content },
              ...msg.tool_calls.map(tc => ({
                type: 'tool-call' as const,
                toolCallId: tc.id,
                toolName: tc.name,
                args: tc.args
              }))
            ]
          });
        } else {
          result.push({ role: 'assistant', content: msg.content });
        }
        break;
      }

      case 'tool': {
        if (!msg.tool_call_id || !msg.name) {
          throw new Error('Tool message missing required tool_call_id or name');
        }
        result.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: msg.tool_call_id,
              toolName: msg.name,
              result: msg.content
            }
          ]
        });
        break;
      }

      default:
        throw new Error(`Unknown message role: ${(msg as StoredMessage).role}`);
    }
  }

  return result;
}

/**
 * Chat Controller
 * Handles streaming chat interactions using Claude Code Agent SDK
 */
export class ChatController {
  /**
   * POST /api/chat/stream
   * Stream chat responses using Server-Sent Events (SSE)
   * Body: { message: string, userId: string, sessionId?: string }
   */
  async streamChat(req: Request, res: Response): Promise<void> {
    try {
      const { message, userId, sessionId } = req.body;

      if (!message || typeof message !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Message is required and must be a string',
        });
        return;
      }

      if (!userId || typeof userId !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'userId is required and must be a string',
        });
        return;
      }

      // Validate sessionId if provided
      if (sessionId !== undefined && typeof sessionId !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'sessionId must be a string',
        });
        return;
      }

      // Set session ID for Langfuse trace grouping
      if (sessionId) {
        setSessionId(sessionId);
      }

      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      // Send initial connection confirmation
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

      // Create MCP servers
      const userGraphMcpServer = createGraphMcpServer(userId);
      const conversationMcpServer = createConversationMcpServer();

      // Configure SDK options with session management
      const sdkQuery = query({
        prompt: message,
        options: {
          cwd: '/tmp/',
          allowedTools: ['Read', 'Grep', 'Glob', 'Write', 'WebFetch', 'WebSearch'],
          mcpServers: {
            'graph-tools': userGraphMcpServer,
            'conversation': conversationMcpServer
          },
          permissionMode: 'bypassPermissions',
          includePartialMessages: true,
          systemPrompt: MAIN_AGENT_SYSTEM_PROMPT,
          model: 'haiku',
          // Use session management to maintain conversation context
          resume: sessionId,
          continue: !!sessionId, // Continue previous session if sessionId provided
        },
      });

      // Stream messages from SDK to client
      for await (const event of sdkQuery) {
        // Send each SDK message as SSE event
        const eventData = {
          type: event.type,
          data: event,
        };

        res.write(`data: ${JSON.stringify(eventData)}\n\n`);

        // Handle result message (final message)
        if (event.type === 'result') {
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }

      // If loop completes without result, end the stream
      res.write('data: [DONE]\n\n');
      res.end();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Stream chat error:', errorMessage);

      // Send error as SSE event
      const errorEvent = {
        type: 'error',
        message: 'Failed to process chat message',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      };

      res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
      res.end();
    }
  }

  /**
   * POST /api/chat/stream-memory
   * Memory-optimized streaming endpoint using Vercel AI SDK
   * Body: { message: string, userId: string, conversationId?: string }
   */
  async streamMemoryOptimizedChat(req: Request, res: Response): Promise<void> {
    try {
      const { message, userId, conversationId } = req.body;

      if (!message || typeof message !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Message is required and must be a string',
        });
        return;
      }

      if (!userId || typeof userId !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'userId is required and must be a string',
        });
        return;
      }

      // Validate conversationId if provided
      if (conversationId !== undefined && typeof conversationId !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'conversationId must be a string',
        });
        return;
      }

      // Set session ID for Langfuse trace grouping (use conversationId as session)
      if (conversationId) {
        setSessionId(conversationId);
      }

      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      // Send initial connection confirmation
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

      // Load conversation history if conversationId provided
      let existingTranscript: StoredMessage[] = [];
      if (conversationId) {
        try {
          const conversation = await conversationService.getConversation(conversationId, userId);
          existingTranscript = convertConversationTurnsToStoredMessages(conversation.transcript ?? []);
        } catch (loadError) {
          console.warn(`Failed to load conversation ${conversationId}:`, loadError);
          // Continue with empty transcript rather than failing
        }
      }

      // Create AI SDK tools (not MCP servers)
      const tools = {
        explore: createExploreTool(userId),
        traverse: createTraverseTool(userId)
      };

      // Build message array
      let messages: CoreMessage[];
      if (existingTranscript.length === 0) {
        // First message - add system prompt
        messages = [
          { role: 'system', content: MEMORY_OPTIMIZED_SYSTEM_PROMPT },
          { role: 'user', content: message }
        ];
      } else {
        // Convert existing messages and add new user message
        const existingCoreMessages = convertToCoreMessages(existingTranscript);
        messages = [
          ...existingCoreMessages,
          { role: 'user', content: message }
        ];
      }

      // Stream with AI SDK - wrapped with custom span
      const isFirstMessage = !conversationId;
      const conversationIdForTelemetry = conversationId !== undefined ? conversationId : 'new-conversation';

      const result = await withSpan('chat.stream', {
        userId,
        conversationId: conversationIdForTelemetry,
        isFirstMessage,
        endpoint: '/api/chat/stream-memory',
      }, async () => {
        return streamText({
          model: openai('gpt-4.1-mini'),
          messages,
          tools,
          maxSteps: 10,
          experimental_telemetry: {
            isEnabled: true,
            functionId: 'chat-stream',
            metadata: {
              userId,
              conversationId: conversationIdForTelemetry,
              isFirstMessage,
              endpoint: '/api/chat/stream-memory',
            },
          },
          onStepFinish: ({ toolCalls }) => {
            // Log tool usage for monitoring
            if (toolCalls && toolCalls.length > 0) {
              console.log('[Memory Chat] Tool calls:', toolCalls.map(tc => tc.toolName));
            }
          }
        });
      });

      // Use fullStream to handle both tool calls and text
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          res.write(`data: ${JSON.stringify({ type: 'text-delta', delta: part.textDelta })}\n\n`);
        } else if (part.type === 'error') {
          console.error('[Memory Chat] ERROR in stream:', part.error);
        }
      }

      // Send completion signal
      res.write('data: [DONE]\n\n');
      res.end();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Stream memory chat error:', errorMessage);
      throw error;
    }
  }
}

export const chatController = new ChatController();
