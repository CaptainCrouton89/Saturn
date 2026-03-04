# Routes - Express Route Definitions

## Pattern Overview

Routes connect HTTP endpoints to controller functions. Each entity type typically has its own route file.

## Critical Conventions

**Authentication Middleware**: Apply `authenticateToken` to protected routes:
```typescript
router.post('/conversations', authenticateToken, (req, res) => conversationController.create(req, res))
router.get('/users', (req, res) => graphController.getAllUsers(req, res)) // no auth
```

**Route Organization**:
- RESTful patterns: GET /entities, GET /entities/:id, POST /entities, PATCH /entities/:id, DELETE /entities/:id
- Nested resources: GET /conversations/:id/messages, GET /users/:userId/full-graph
- Custom actions: POST /conversations/:id/end, POST /users/:userId/explore
- Query params: GET /people/search?q=name

**Parameter Naming**: Use singular for :id params, plural for collections:
- `/conversations/:conversationId` (not :id when nested)
- `/concepts/:conceptId/relationships`
- `/users/:userId/full-graph` (nested under user resource)

**Handler Pattern**: Use inline arrow functions for clarity:
```typescript
router.get('/users/:id', (req, res) => graphController.getUser(req, res))
router.post('/users', authenticateToken, (req, res) => graphController.createUser(req, res))
```

**Endpoint Organization**: Group public endpoints separately from protected ones with clear comments

**Mounting in index.ts**: All routes mounted under `/api` prefix:
```typescript
app.use('/api/conversations', conversationsRouter)
app.use('/api/graph', graphRouter)
```

**Request Validation**: Controllers validate required params. Don't add validation middleware in routes unless using express-validator schema.

**Special Routes**:
- `/health` - No auth, simple health check
- `/api/auth/*` - Auth-related endpoints (device registration, token refresh)
