import dotenv from 'dotenv';
import { initTracing } from './config/tracing.js';
import { neo4jService } from './db/neo4j.js';
import { initializeSchema } from './db/schema.js';
import { getQueue } from './queue/memoryQueue.js';

export interface BootstrapOptions {
  allowNeo4jUnavailable?: boolean;
}

export interface BootstrapResult {
  neo4jConnected: boolean;
  queue: Awaited<ReturnType<typeof getQueue>>;
}

export async function bootstrap({ allowNeo4jUnavailable = false }: BootstrapOptions = {}): Promise<BootstrapResult> {
  dotenv.config({ override: true });
  await initTracing();

  let neo4jConnected = false;
  try {
    await neo4jService.connect();
    neo4jConnected = true;
  } catch (error) {
    if (!allowNeo4jUnavailable) {
      throw error;
    }

    console.error('⚠️ Neo4j unavailable at startup:', error instanceof Error ? error.message : error);
    console.error('Server will start without Neo4j — graph features will fail until reconnected.');
  }

  if (neo4jConnected) {
    try {
      await initializeSchema();
    } catch (error) {
      console.error('Failed to initialize Neo4j schema:', error instanceof Error ? error.message : error);
      await neo4jService.close();
      throw error;
    }
  }

  const queue = await getQueue();

  return { neo4jConnected, queue };
}
