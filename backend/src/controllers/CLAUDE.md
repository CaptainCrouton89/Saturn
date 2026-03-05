# Controllers - Request Handlers

## Pattern Overview

Controllers are thin wrappers around service calls. They:
1. Extract params/body from Express Request
2. Call service method or agent
3. Return JSON response with appropriate status code

## Critical Conventions

**Minimal Logic**: Controllers should NOT contain business logic. Delegate to services.

**Exception - Input Validation**: Controllers MAY contain validation logic when:
- Validation is part of the response contract (e.g., detailed error details with field-level info)
- Used for admin/ingestion endpoints that require structured error reporting
- See `informationDumpController.ts` for example

**Error Handling**: Let Express error middleware catch thrown errors. Don't wrap in try/catch unless you need to transform the error.

**Response Format**: All responses use snake_case (matches PostgreSQL schema):
```typescript
res.json({
  conversation_id: "...",
  created_at: "...",
  user_id: "..."
})
```

**Authentication**: `req.user` is populated by `authenticateToken` middleware on protected routes. Contains `id` (user ID) and auth type. Use directly, don't re-validate.

**Status Codes**:
- 200: Success with data
- 201: Created
- 204: Success with no content
- 400: Bad request (missing params)
- 401: Unauthorized (missing/invalid token)
- 404: Not found
- 500: Internal server error

Don't use try/catch in controllers unless transforming errors. Services throw, middleware catches.

## Special Patterns

**Streaming Responses** (`chatController.ts`):
- Two distinct implementations:
  - `streamChat()` (Agent SDK path): Uses Claude Agent SDK with MCP servers for explore/traverse
  - `streamMemoryOptimizedChat()` (Vercel AI path): Uses Vercel AI SDK with direct tools, memory-optimized
- Both endpoints validate input (message/userId + conversationId/sessionId) and set telemetry/session IDs
- Use `streamText()` from `ai` package for Vercel SDK streaming
- Use `query()` from Claude Agent SDK for agent-based streaming
- Message history requires format conversion: ConversationTurn → StoredMessage → ModelMessage
- Include tracing spans with `withSpan()` for observability

**MCP Server Factories** (`mcpServer.ts`):
- Create user-scoped MCP server instances (one per userId)
- `createGraphMcpServer(userId)`: Provides explore/traverse tools for knowledge graph access
- `createConversationMcpServer()`: Provides conversation control tools (end, etc.)
- Return MCP servers to pass to agent orchestration
- Do NOT instantiate MCP servers at module level—create them per request/conversation

**Admin/Ingestion Endpoints** (`informationDumpController.ts`):
- May include detailed input validation with field-level error reporting
- Return structured validation errors: `{ error, details: [{ field, message }] }`
- Admin-key auth allows operating on behalf of other users (when user_id provided in body)
