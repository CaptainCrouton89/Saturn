# Routes - Express Route Definitions

## Pattern Overview

Routes connect HTTP endpoints to controller functions. Each entity type typically has its own route file.

## Critical Conventions

**Authentication Middleware**: Apply `authenticateToken` to protected routes:
```typescript
router.post('/conversations', authenticateToken, conversationController.create)
router.get('/conversations/public', conversationController.getPublic) // no auth
```

**Route Organization**:
- RESTful patterns: GET /entities, GET /entities/:id, POST /entities, PATCH /entities/:id, DELETE /entities/:id
- Nested resources: GET /conversations/:id/messages
- Custom actions: POST /conversations/:id/end

**Parameter Naming**: Use singular for :id params, plural for collections:
- `/conversations/:conversationId` (not :id when nested)
- `/concepts/:conceptId/relationships`
- `/entities/:entityId/related`

**Mounting in index.ts**: All routes mounted under `/api` prefix:
```typescript
app.use('/api/conversations', conversationsRouter)
app.use('/api/concepts', conceptsRouter)
app.use('/api/entities', entitiesRouter)
```

**Request Validation**: Controllers validate required params. Don't add validation middleware in routes unless using express-validator schema.

**Special Routes**:
- `/health` - No auth, simple health check
- `/api/auth/*` - Auth-related endpoints (device registration, token refresh)
