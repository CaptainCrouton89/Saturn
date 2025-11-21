#!/usr/bin/env tsx

import { config } from "dotenv";
import { LangfuseClient } from "@langfuse/client";

// Load environment variables from .env file
config();

const langfuse = new LangfuseClient();

interface CliCommand {
  name: string;
  description: string;
  args?: string;
  handler: (args: string[]) => Promise<void>;
}

interface TraceFilters {
  page?: number;
  limit?: number;
  userId?: string;
  name?: string;
}

interface ObservationFilters {
  page?: number;
  limit?: number;
  traceId?: string;
  type?: string;
}

interface PaginationParams {
  page?: number;
  limit?: number;
}

const commands: CliCommand[] = [
  {
    name: "list-traces",
    description: "List all traces (supports pagination)",
    args: "[--page <number>] [--limit <number>] [--user-id <id>] [--name <name>]",
    handler: async (args) => {
      const page = getArgValue(args, "--page") ? parseInt(getArgValue(args, "--page")!) : 1;
      const limit = getArgValue(args, "--limit") ? parseInt(getArgValue(args, "--limit")!) : 50;
      const userId = getArgValue(args, "--user-id");
      const name = getArgValue(args, "--name");

      const filters: TraceFilters = {
        page,
        limit,
      };
      if (userId) filters.userId = userId;
      if (name) filters.name = name;

      const traces = await langfuse.api.trace.list(filters);

      console.log(JSON.stringify(traces, null, 2));
    },
  },
  {
    name: "get-trace",
    description: "Get a single trace by ID",
    args: "<trace-id>",
    handler: async (args) => {
      const traceId = args[0];
      if (!traceId) {
        throw new Error("Trace ID is required");
      }

      const trace = await langfuse.api.trace.get(traceId);
      console.log(JSON.stringify(trace, null, 2));
    },
  },
  {
    name: "list-observations",
    description: "List all observations (supports pagination)",
    args: "[--page <number>] [--limit <number>] [--trace-id <id>] [--type <type>]",
    handler: async (args) => {
      const page = getArgValue(args, "--page") ? parseInt(getArgValue(args, "--page")!) : 1;
      const limit = getArgValue(args, "--limit") ? parseInt(getArgValue(args, "--limit")!) : 50;
      const traceId = getArgValue(args, "--trace-id");
      const type = getArgValue(args, "--type");

      const filters: ObservationFilters = {
        page,
        limit,
      };
      if (traceId) filters.traceId = traceId;
      if (type) filters.type = type;

      const observations = await langfuse.api.observations.getMany(filters);

      console.log(JSON.stringify(observations, null, 2));
    },
  },
  {
    name: "get-observation",
    description: "Get a single observation by ID",
    args: "<observation-id>",
    handler: async (args) => {
      const observationId = args[0];
      if (!observationId) {
        throw new Error("Observation ID is required");
      }

      const observation = await langfuse.api.observations.get(observationId);
      console.log(JSON.stringify(observation, null, 2));
    },
  },
  {
    name: "list-sessions",
    description: "List all sessions (supports pagination)",
    args: "[--page <number>] [--limit <number>]",
    handler: async (args) => {
      const page = getArgValue(args, "--page") ? parseInt(getArgValue(args, "--page")!) : 1;
      const limit = getArgValue(args, "--limit") ? parseInt(getArgValue(args, "--limit")!) : 50;

      const params: PaginationParams = {
        page,
        limit,
      };

      const sessions = await langfuse.api.sessions.list(params);

      console.log(JSON.stringify(sessions, null, 2));
    },
  },
  {
    name: "get-session",
    description: "Get a single session by ID",
    args: "<session-id>",
    handler: async (args) => {
      const sessionId = args[0];
      if (!sessionId) {
        throw new Error("Session ID is required");
      }

      const session = await langfuse.api.sessions.get(sessionId);
      console.log(JSON.stringify(session, null, 2));
    },
  },
  {
    name: "list-scores",
    description: "List all scores (supports pagination)",
    args: "[--page <number>] [--limit <number>]",
    handler: async (args) => {
      const page = getArgValue(args, "--page") ? parseInt(getArgValue(args, "--page")!) : 1;
      const limit = getArgValue(args, "--limit") ? parseInt(getArgValue(args, "--limit")!) : 50;

      const params: PaginationParams = {
        page,
        limit,
      };

      const scores = await langfuse.api.scoreV2.get(params);

      console.log(JSON.stringify(scores, null, 2));
    },
  },
  {
    name: "get-score",
    description: "Get a single score by ID",
    args: "<score-id>",
    handler: async (args) => {
      const scoreId = args[0];
      if (!scoreId) {
        throw new Error("Score ID is required");
      }

      const score = await langfuse.api.scoreV2.getById(scoreId);
      console.log(JSON.stringify(score, null, 2));
    },
  },
  {
    name: "help",
    description: "Show this help message",
    handler: async () => {
      showHelp();
    },
  },
];

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return undefined;
}

function showHelp() {
  console.log("Langfuse CLI - Query traces, observations, sessions, and scores\n");
  console.log("Usage: tsx scripts/langfuse-cli.ts <command> [options]\n");
  console.log("Commands:");

  for (const cmd of commands) {
    const cmdLine = `  ${cmd.name}${cmd.args ? ` ${cmd.args}` : ""}`;
    console.log(cmdLine);
    console.log(`    ${cmd.description}\n`);
  }

  console.log("Examples:");
  console.log("  tsx scripts/langfuse-cli.ts list-traces --limit 10");
  console.log("  tsx scripts/langfuse-cli.ts get-trace <trace-id>");
  console.log("  tsx scripts/langfuse-cli.ts list-observations --trace-id <id> --limit 20");
  console.log("  tsx scripts/langfuse-cli.ts list-sessions --page 2");
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showHelp();
    process.exit(0);
  }

  const commandName = args[0];
  const command = commands.find((cmd) => cmd.name === commandName);

  if (!command) {
    console.error(`Unknown command: ${commandName}\n`);
    showHelp();
    process.exit(1);
  }

  try {
    await command.handler(args.slice(1));
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await langfuse.shutdown();
  }
}

main();
