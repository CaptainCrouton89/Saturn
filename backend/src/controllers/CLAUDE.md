# Controllers - Request Handlers

## Pattern Overview

Controllers are thin wrappers around service calls. They:
1. Extract params/body from Express Request
2. Call service method
3. Return JSON response with appropriate status code

## Critical Conventions

**Minimal Logic**: Controllers should NOT contain business logic. Delegate to services.

**Error Handling**: Let Express error middleware catch thrown errors. Don't wrap in try/catch unless you need to transform the error.

**Response Format**: All responses use snake_case (matches PostgreSQL schema):
```typescript
res.json({
  conversation_id: "...",
  created_at: "...",
  user_id: "..."
})
```

**Authentication**: `req.userId` is populated by `authenticateToken` middleware on protected routes. Use it directly, don't re-validate.

**Status Codes**:
- 200: Success with data
- 201: Created
- 204: Success with no content
- 400: Bad request (missing params)
- 401: Unauthorized (missing/invalid token)
- 404: Not found
- 500: Internal server error

Don't use try/catch in controllers unless transforming errors. Services throw, middleware catches.
