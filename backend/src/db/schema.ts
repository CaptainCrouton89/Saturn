import { neo4jService } from './neo4j.js';

/**
 * Initialize Neo4j schema with constraints and indexes
 * This ensures data integrity and query performance
 */
export async function initializeSchema(): Promise<void> {
  console.log('🔧 Initializing Neo4j schema...');

  try {
    await createConstraints();
    await createIndexes();
    await createVectorIndexes(); // Enable vector similarity search for entity resolution
    console.log('✅ Neo4j schema initialized successfully');
  } catch (error) {
    console.error('❌ Schema initialization failed:', error);
    throw error;
  }
}

/**
 * Create uniqueness constraints for node IDs
 * Constraints automatically create indexes
 */
async function createConstraints(): Promise<void> {
  const constraints = [
    // Core node constraints - entity_key uniqueness
    'CREATE CONSTRAINT person_entity_key IF NOT EXISTS FOR (p:Person) REQUIRE p.entity_key IS UNIQUE',
    'CREATE CONSTRAINT concept_entity_key IF NOT EXISTS FOR (c:Concept) REQUIRE c.entity_key IS UNIQUE',
    'CREATE CONSTRAINT entity_entity_key IF NOT EXISTS FOR (e:Entity) REQUIRE e.entity_key IS UNIQUE',
    'CREATE CONSTRAINT source_entity_key IF NOT EXISTS FOR (s:Source) REQUIRE s.entity_key IS UNIQUE',
    'CREATE CONSTRAINT artifact_entity_key IF NOT EXISTS FOR (a:Artifact) REQUIRE a.entity_key IS UNIQUE',
    'CREATE CONSTRAINT pattern_id IF NOT EXISTS FOR (pt:Pattern) REQUIRE pt.id IS UNIQUE',
    'CREATE CONSTRAINT value_id IF NOT EXISTS FOR (v:Value) REQUIRE v.id IS UNIQUE',
    'CREATE CONSTRAINT note_id IF NOT EXISTS FOR (n:Note) REQUIRE n.id IS UNIQUE',
  ];

  for (const constraint of constraints) {
    try {
      await neo4jService.executeQuery(constraint);
    } catch (error) {
      // Constraint might already exist - that's okay
      if (error instanceof Error && !error.message.includes('equivalent constraint already exists')) {
        throw error;
      }
    }
  }

  console.log('  ✓ Constraints created');
}

/**
 * Create indexes for frequently queried properties
 */
async function createIndexes(): Promise<void> {
  const indexes = [
    // Person indexes
    'CREATE INDEX person_user_id IF NOT EXISTS FOR (p:Person) ON (p.user_id)',
    'CREATE INDEX person_canonical_name IF NOT EXISTS FOR (p:Person) ON (p.canonical_name)',

    // Concept indexes
    'CREATE INDEX concept_name IF NOT EXISTS FOR (c:Concept) ON (c.name)',
    'CREATE INDEX concept_user_id IF NOT EXISTS FOR (c:Concept) ON (c.user_id)',

    // Entity indexes
    'CREATE INDEX entity_name IF NOT EXISTS FOR (e:Entity) ON (e.name)',
    'CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.type)',
    'CREATE INDEX entity_user_id IF NOT EXISTS FOR (e:Entity) ON (e.user_id)',

    // Source indexes
    'CREATE INDEX source_user_id IF NOT EXISTS FOR (s:Source) ON (s.user_id)',

    // Pattern indexes
    'CREATE INDEX pattern_type IF NOT EXISTS FOR (pt:Pattern) ON (pt.type)',
    'CREATE INDEX pattern_confidence IF NOT EXISTS FOR (pt:Pattern) ON (pt.confidence_score)',

    // Value indexes
    'CREATE INDEX value_importance IF NOT EXISTS FOR (v:Value) ON (v.importance)',

    // Note indexes
    'CREATE INDEX note_created IF NOT EXISTS FOR (n:Note) ON (n.created_at)',
  ];

  for (const index of indexes) {
    try {
      await neo4jService.executeQuery(index);
    } catch (error) {
      // Index might already exist - that's okay
      if (error instanceof Error && !error.message.includes('equivalent index already exists')) {
        throw error;
      }
    }
  }

  console.log('  ✓ Indexes created');
}

/**
 * Optional: Create vector indexes for embeddings (requires Neo4j 5.11+)
 * Call this function when you're ready to use vector similarity search
 */
export async function createVectorIndexes(): Promise<void> {
  const vectorIndexes = [
    // Concept embedding index (assuming 1536 dimensions for OpenAI embeddings)
    `CREATE VECTOR INDEX concept_embedding IF NOT EXISTS
     FOR (c:Concept) ON (c.embedding)
     OPTIONS {indexConfig: {
       \`vector.dimensions\`: 1536,
       \`vector.similarity_function\`: 'cosine'
     }}`,

    // Entity embedding index
    `CREATE VECTOR INDEX entity_embedding IF NOT EXISTS
     FOR (e:Entity) ON (e.embedding)
     OPTIONS {indexConfig: {
       \`vector.dimensions\`: 1536,
       \`vector.similarity_function\`: 'cosine'
     }}`,

    // Source embedding index
    `CREATE VECTOR INDEX source_embedding IF NOT EXISTS
     FOR (s:Source) ON (s.embedding)
     OPTIONS {indexConfig: {
       \`vector.dimensions\`: 1536,
       \`vector.similarity_function\`: 'cosine'
     }}`,

    // Note embedding index
    `CREATE VECTOR INDEX note_embedding IF NOT EXISTS
     FOR (n:Note) ON (n.embedding)
     OPTIONS {indexConfig: {
       \`vector.dimensions\`: 1536,
       \`vector.similarity_function\`: 'cosine'
     }}`,
  ];

  for (const index of vectorIndexes) {
    try {
      await neo4jService.executeQuery(index);
    } catch (error) {
      if (error instanceof Error && !error.message.includes('equivalent index already exists')) {
        console.warn('Vector index creation failed (requires Neo4j 5.11+):', error.message);
      }
    }
  }

  console.log('  ✓ Vector indexes created (if supported)');
}

/**
 * Verify schema is properly set up
 */
export async function verifySchema(): Promise<boolean> {
  try {
    const constraints = await neo4jService.executeQuery('SHOW CONSTRAINTS');
    const indexes = await neo4jService.executeQuery('SHOW INDEXES');

    console.log(`  ℹ️  Found ${constraints.length} constraints`);
    console.log(`  ℹ️  Found ${indexes.length} indexes`);

    return constraints.length > 0;
  } catch (error) {
    console.error('Schema verification failed:', error);
    return false;
  }
}
