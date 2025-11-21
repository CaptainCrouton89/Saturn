/**
 * OpenTelemetry tracing utilities for Saturn backend
 *
 * Provides helper functions for creating custom spans with proper attributes,
 * sanitizing sensitive metadata, and building standard attribute sets.
 */

import { trace, SpanStatusCode } from '@opentelemetry/api';

// ============================================================================
// Constants for standard attribute keys
// ============================================================================

export const TraceAttributes = {
  // User context
  USER_ID: 'userId',
  TEAM_ID: 'teamId',

  // Conversation context
  CONVERSATION_ID: 'conversationId',
  SESSION_ID: 'sessionId', // For Langfuse session grouping
  MESSAGE_COUNT: 'messageCount',
  IS_FIRST_MESSAGE: 'isFirstMessage',

  // Operation metadata
  OPERATION_TYPE: 'operationType',
  OPERATION_NAME: 'operationName',
  ENTITY_TYPE: 'entityType',
  ENTITY_COUNT: 'entityCount',

  // Performance metrics
  DURATION_MS: 'durationMs',
  ITEM_COUNT: 'itemCount',

  // LLM/AI operations
  MODEL: 'model',
  PROMPT_TOKENS: 'promptTokens',
  COMPLETION_TOKENS: 'completionTokens',
  TOTAL_TOKENS: 'totalTokens',
  COST_USD: 'costUsd',

  // Error tracking
  ERROR_CODE: 'errorCode',
  ERROR_MESSAGE: 'errorMessage',

  // Environment
  ENVIRONMENT: 'environment',
  NODE_ENV: 'nodeEnv',
} as const;

// ============================================================================
// Helper function to get tracer instance
// ============================================================================

/**
 * Get the OpenTelemetry tracer instance for Saturn backend
 */
export function getTracer() {
  return trace.getTracer('saturn-backend', '1.0.0');
}

// ============================================================================
// Span wrapper for async operations
// ============================================================================

/**
 * Wrap an async function with OpenTelemetry span tracking
 *
 * @param name - Span name (e.g., "conversation.create", "ingestion.phase1")
 * @param attributes - Span attributes for context
 * @param fn - Async function to execute
 * @returns Result of fn or throws if fn throws
 *
 * @example
 * const result = await withSpan('conversation.create', {
 *   userId: 'user-123',
 *   teamId: 'team-456',
 * }, async () => {
 *   return await createConversation(...);
 * });
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: () => Promise<T>
): Promise<T> {
  const tracer = getTracer();
  const sanitized = sanitizeMetadata(attributes);

  return tracer.startActiveSpan(name, { attributes: sanitized }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: errorMessage,
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}

// ============================================================================
// Span wrapper for sync operations
// ============================================================================

/**
 * Wrap a sync function with OpenTelemetry span tracking
 *
 * @param name - Span name
 * @param attributes - Span attributes
 * @param fn - Sync function to execute
 * @returns Result of fn or throws if fn throws
 */
export function withSpanSync<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: () => T
): T {
  const tracer = getTracer();
  const sanitized = sanitizeMetadata(attributes);

  return tracer.startActiveSpan(name, { attributes: sanitized }, (span) => {
    try {
      const result = fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: errorMessage,
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}

// ============================================================================
// Session ID tracking for Langfuse trace grouping
// ============================================================================

/**
 * Set session ID on the active OpenTelemetry span for Langfuse trace grouping
 *
 * This allows multiple traces (e.g., across multiple API requests in the same
 * conversation or session) to be grouped together in the Langfuse UI.
 *
 * Should be called early in the request lifecycle, before spawning agents or
 * making LLM calls, so the session ID propagates to all child spans.
 *
 * @param sessionId - Unique session identifier (e.g., conversationId, client sessionId)
 *
 * @example
 * // In a chat endpoint
 * setSessionId(conversationId);
 *
 * @example
 * // With optional session from client
 * if (sessionId) {
 *   setSessionId(sessionId);
 * }
 */
export function setSessionId(sessionId: string): void {
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.setAttribute(TraceAttributes.SESSION_ID, sessionId);
  }
}

// ============================================================================
// Metadata sanitization (PII filtering)
// ============================================================================

/**
 * Remove sensitive/PII data from span attributes
 *
 * DO NOT include in spans:
 * - Full message content (use length instead)
 * - Email addresses
 * - Phone numbers
 * - API keys or tokens
 * - Raw embeddings
 * - Personal information
 *
 * SAFE to include:
 * - User IDs (opaque identifiers)
 * - Conversation IDs
 * - Entity counts
 * - Operation types
 * - Performance metrics
 */
export function sanitizeMetadata(
  metadata: Record<string, string | number | boolean | undefined | null>
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(metadata)) {
    // Skip null/undefined values
    if (value === null || value === undefined) {
      continue;
    }

    // Skip sensitive fields
    if (
      key.toLowerCase().includes('password') ||
      key.toLowerCase().includes('secret') ||
      key.toLowerCase().includes('token') ||
      key.toLowerCase().includes('key') ||
      key.toLowerCase().includes('email') ||
      key.toLowerCase().includes('phone') ||
      key.toLowerCase().includes('content') ||
      key.toLowerCase().includes('message') ||
      key.toLowerCase().includes('embedding')
    ) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

// ============================================================================
// Standard attribute builders
// ============================================================================

/**
 * Build user context attributes
 */
export function buildUserAttributes(userId: string, teamId?: string | null) {
  const attributes: Record<string, string | number | boolean> = {
    [TraceAttributes.USER_ID]: userId,
  };

  if (teamId) {
    attributes[TraceAttributes.TEAM_ID] = teamId;
  }

  return attributes;
}

/**
 * Build conversation context attributes
 */
export function buildConversationAttributes(
  conversationId: string,
  userId: string,
  options?: {
    messageCount?: number;
    isFirstMessage?: boolean;
    totalTokens?: number;
  }
) {
  return {
    [TraceAttributes.CONVERSATION_ID]: conversationId,
    [TraceAttributes.USER_ID]: userId,
    [TraceAttributes.MESSAGE_COUNT]: options?.messageCount,
    [TraceAttributes.IS_FIRST_MESSAGE]: options?.isFirstMessage,
    [TraceAttributes.TOTAL_TOKENS]: options?.totalTokens,
  };
}

/**
 * Build entity/node operation attributes
 */
export function buildEntityAttributes(
  entityType: string,
  operationType: 'create' | 'update' | 'delete' | 'query',
  options?: {
    userId?: string;
    entityCount?: number;
    nodeId?: string;
  }
) {
  return {
    [TraceAttributes.ENTITY_TYPE]: entityType,
    [TraceAttributes.OPERATION_TYPE]: operationType,
    [TraceAttributes.USER_ID]: options?.userId,
    [TraceAttributes.ENTITY_COUNT]: options?.entityCount,
  };
}

/**
 * Build LLM operation attributes
 */
export function buildLLMAttributes(
  model: string,
  options?: {
    functionId?: string;
    promptTokens?: number;
    completionTokens?: number;
    costUsd?: number;
  }
) {
  return {
    [TraceAttributes.MODEL]: model,
    [TraceAttributes.OPERATION_NAME]: options?.functionId,
    [TraceAttributes.PROMPT_TOKENS]: options?.promptTokens,
    [TraceAttributes.COMPLETION_TOKENS]: options?.completionTokens,
    [TraceAttributes.TOTAL_TOKENS]:
      options?.promptTokens && options?.completionTokens
        ? options.promptTokens + options.completionTokens
        : undefined,
    [TraceAttributes.COST_USD]: options?.costUsd,
  };
}

/**
 * Build error attributes
 */
export function buildErrorAttributes(error: Error, errorCode?: string) {
  const attributes: Record<string, string> = {
    [TraceAttributes.ERROR_MESSAGE]: error.message,
  };

  if (errorCode) {
    attributes[TraceAttributes.ERROR_CODE] = errorCode;
  }

  return attributes;
}

// ============================================================================
// Legacy LangSmith support (for backward compatibility)
// ============================================================================

type AgentType = 'conversation' | 'ingestion' | 'evaluator';

interface TracingOptions {
  phase?: string;
  userId?: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Legacy wrapper for agents using LangSmith traceable
 * Kept for backward compatibility with existing agent code
 *
 * @deprecated Use withSpan() from OpenTelemetry instead
 */
export function withAgentTracing(
  fn: (...args: unknown[]) => unknown,
  _agentType: AgentType,
  _options?: TracingOptions
): (...args: unknown[]) => unknown {
  // For now, just return the function as-is
  // This preserves backward compatibility while we migrate to OpenTelemetry
  return fn;
}
