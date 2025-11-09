# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Saturn Backend is a simple Express TypeScript API for the Cosmo AI Companion. It's a greenfield backend with a minimal setup focused on core infrastructure and extensibility.

**Current State**: Bootstrap phase with basic health and API endpoints. Ready for feature expansion.

## Development Commands

### Core Development
- `npm install` - Install dependencies
- `npm run dev` - Start dev server with hot reload (ts-node-dev)
- `npm run build` - Compile TypeScript to dist/
- `npm start` - Run production build
- `npm run type-check` - Type-check without emitting (useful for CI/validation)

### Environment Setup
- Copy `.env.example` to `.env` and update values
- Required variables: `PORT` (default: 3000), `NODE_ENV`
- `.env` is in `.gitignore` — never commit secrets

## Architecture & Code Organization

### Current Structure
```
src/
└── index.ts          # Single entry point with Express app setup
```

### Project Design Pattern

The project uses a **monolithic single-file approach** for now:
- All middleware, routes, and error handling in `index.ts`
- Appropriate for bootstrap phase; plan to refactor into modular structure as features grow

### Key Architectural Decisions

**Middleware Stack** (express → cors → helmet → morgan):
- **Helmet**: Security headers (CSP, X-Frame-Options, etc.)
- **CORS**: Enabled globally for all origins (may need restriction for production)
- **Morgan**: HTTP request logging in 'dev' format
- **express.json()**: JSON body parsing

**Error Handling**:
- Global error handler catches unhandled errors from routes
- Returns detailed error messages in development, generic in production (NODE_ENV check)
- 404 handler returns JSON for consistency

**Response Format**:
- All responses are JSON (including errors)
- Standard structure: `{ message, data }` for success, `{ error, message }` for failures

## Future Refactoring Opportunities

When the API grows beyond bootstrap phase, plan to:

1. **Route Organization**: Extract routes into separate modules (`routes/`, `controllers/`)
2. **Middleware Separation**: Create custom middleware files for logging, auth, validation
3. **Service Layer**: Extract business logic into `services/` for data processing, external integrations
4. **Environment Config**: Move middleware configuration (CORS, helmet) to a config file
5. **Testing**: Add unit tests for routes and services as they become more complex

## Type Safety & Linting

- **TypeScript**: Strict mode enabled, no implicit `any`, unused locals/parameters flagged
- Source maps and declaration files generated for debugging
- No eslint/prettier configured yet (can be added as team standards evolve)

## Dependencies & Tech Stack

- **Express 4.21**: Web framework
- **TypeScript 5.7**: Type safety
- **Helmet 8.0**: Security headers
- **CORS 2.8**: Cross-origin requests
- **Morgan 1.10**: HTTP logging
- **dotenv 16.4**: Environment variable management
- **ts-node-dev 2.0**: Development hot-reload
- **Node.js 20+**: Runtime requirement

## API Endpoints (Current)

- `GET /health` - Health check, returns `{ status: 'ok', timestamp }`
- `GET /api` - API info, returns `{ message: 'Cosmo API' }`
- `GET *` (404) - Returns error response

## Environment Variables

```
PORT=3000                # Server port
NODE_ENV=development     # development | production
```

Add more as features require (database URLs, API keys, etc.).

## Notes for Future Contributors

- Keep the codebase organized as features are added — split into routes, controllers, services early
- All routes should return JSON responses for consistency
- Consider adding request validation middleware as endpoints grow
- Add integration tests for new endpoints before merging to main
- Update this CLAUDE.md when making architectural changes
