import { neo4jService } from './db/neo4j.js';
import { stopQueue } from './queue/memoryQueue.js';

export async function shutdown(): Promise<void> {
  await Promise.all([neo4jService.close(), stopQueue()]);
}
