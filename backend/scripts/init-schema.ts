#!/usr/bin/env tsx

import { config } from 'dotenv';
import { initializeSchema } from '../src/db/schema.js';
import { neo4jService } from '../src/db/neo4j.js';

// Load environment variables
config();

async function main() {
  try {
    // Connect to Neo4j first
    await neo4jService.connect();

    // Initialize schema (constraints, indexes, vector indexes)
    await initializeSchema();

    // Close connection
    await neo4jService.close();

    process.exit(0);
  } catch (error) {
    console.error('Failed to initialize schema:', error);
    await neo4jService.close();
    process.exit(1);
  }
}

main();
