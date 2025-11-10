#!/usr/bin/env tsx

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { encode } from '@toon-format/toon';
import { neo4jService } from './src/db/neo4j.js';

// Load production environment variables (ESM-compatible)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '.env.production') });

async function main() {
  // Get query from args or stdin
  const args = process.argv.slice(2);
  let query: string;

  if (args.length > 0) {
    // Query from command line args
    query = args.join(' ');
  } else if (!process.stdin.isTTY) {
    // Query from stdin (pipe)
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    query = Buffer.concat(chunks).toString('utf-8').trim();
  } else {
    console.error('Usage: tsx cli.ts "MATCH (n) RETURN n LIMIT 5"');
    console.error('   or: echo "MATCH (n) RETURN n" | tsx cli.ts');
    process.exit(1);
  }

  if (!query) {
    console.error('Error: No query provided');
    process.exit(1);
  }

  try {
    // Connect to Neo4j
    await neo4jService.connect();

    // Execute query
    const results = await neo4jService.executeQuery<Record<string, unknown>>(query);

    // Output as TOON format (compact, LLM-friendly)
    console.log(encode(results));

    // Clean up
    await neo4jService.close();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    await neo4jService.close();
    process.exit(1);
  }
}

main();
