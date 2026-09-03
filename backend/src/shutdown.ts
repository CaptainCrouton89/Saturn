import { shutdownTracing } from './config/tracing.js';
import { neo4jService } from './db/neo4j.js';
import { stopQueue } from './queue/memoryQueue.js';

export async function shutdown(): Promise<void> {
  await Promise.all([shutdownTracing(), neo4jService.close(), stopQueue()]);
}
