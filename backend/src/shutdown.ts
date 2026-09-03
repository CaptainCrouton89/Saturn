import { shutdownTracing } from './config/tracing.js';
import { neo4jService } from './db/neo4j.js';
import { stopQueue } from './queue/memoryQueue.js';

let shutdownPromise: Promise<void> | undefined;
let shutdownExitCode = 0;

export function shutdown(requestedExitCode = 0): Promise<void> {
  shutdownExitCode = Math.max(shutdownExitCode, requestedExitCode);
  shutdownPromise ??= shutdownServices();
  return shutdownPromise;
}

export function getShutdownExitCode(): number {
  return shutdownExitCode;
}

async function shutdownServices(): Promise<void> {
  const errors: unknown[] = [];

  // pg-boss waits for active handlers, so their spans must end before tracing flushes.
  for (const close of [stopQueue, () => neo4jService.close(), shutdownTracing]) {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, 'One or more shutdown operations failed');
  }
}
