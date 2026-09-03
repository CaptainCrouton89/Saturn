// Initialize OpenTelemetry tracing FIRST, before any other imports
import { initTracing } from './config/tracing.js';
initTracing();

import cors from 'cors';
import dotenv from 'dotenv';
import express, { Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import morgan from 'morgan';
import { neo4jService } from './db/neo4j.js';
import { initializeSchema } from './db/schema.js';
import { getQueue, stopQueue } from './queue/memoryQueue.js';
import graphRouter from './routes/graph.js';
import authRouter from './routes/auth.js';
import initRouter from './routes/init.js';
import preferencesRouter from './routes/preferences.js';
import conversationsRouter from './routes/conversations.js';
import artifactsRouter from './routes/artifacts.js';
import adminRouter from './routes/admin.js';
import informationDumpRouter from './routes/informationDump.js';
import chatRouter from './routes/chat.js';
import { createMcpRouter } from './mcp.js';

// Load environment variables
dotenv.config({ override: true });

const app: Express = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://d3js.org"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
    },
  },
})); // Security headers
app.use(cors()); // Enable CORS
app.use(morgan('dev')); // Logging
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Health check route
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.get('/api', (_req: Request, res: Response) => {
  res.json({ message: 'Cosmo API' });
});

// Neo4j health check
app.get('/api/neo4j/health', async (_req: Request, res: Response) => {
  try {
    const driver = neo4jService.getDriver();
    await driver.verifyConnectivity();
    res.json({ status: 'connected', message: 'Neo4j connection is healthy' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(503).json({
      status: 'disconnected',
      message: 'Neo4j connection failed',
      error: errorMessage
    });
  }
});

// Auth API routes
app.use('/api/auth', authRouter);

// App initialization route
app.use('/api/init', initRouter);

// Preferences routes
app.use('/api/preferences', preferencesRouter);

// Conversations routes
app.use('/api/conversations', conversationsRouter);

// Artifacts routes
app.use('/api/artifacts', artifactsRouter);

// Graph API routes (public visualization endpoints, other endpoints protected in router)
app.use('/api/graph', graphRouter);

// Admin routes (for queue monitoring)
app.use('/admin', adminRouter);

// Information dump routes
app.use('/api/information-dumps', informationDumpRouter);

// Chat routes (streaming chat endpoints with session tracking)
app.use('/api/chat', chatRouter);

// MCP server (SSE transport for Claude Desktop / Claude Code)
app.use('/mcp', createMcpRouter());

// Static files (graph visualizer at /graph.html)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '..', 'public')));

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Initialize database and start server
async function startServer() {
  let neo4jConnected = false;

  // Neo4j being unavailable is non-fatal, but a connected graph without its schema is unsafe to write.
  try {
    await neo4jService.connect();
    neo4jConnected = true;
  } catch (error) {
    console.error('⚠️ Neo4j unavailable at startup:', error instanceof Error ? error.message : error);
    console.error('Server will start without Neo4j — graph features will fail until reconnected.');
  }

  if (neo4jConnected) {
    try {
      await initializeSchema();
    } catch (error) {
      console.error('Failed to initialize Neo4j schema:', error instanceof Error ? error.message : error);
      await neo4jService.close();
      process.exit(1);
    }
  }

  try {
    // Initialize pg-boss queue for background jobs
    await getQueue();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await neo4jService.close();
  await stopQueue();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await neo4jService.close();
  await stopQueue();
  process.exit(0);
});

startServer();

export default app;
