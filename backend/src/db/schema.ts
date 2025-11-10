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
    // Core node constraints
    'CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE',
    'CREATE CONSTRAINT conversation_id IF NOT EXISTS FOR (c:Conversation) REQUIRE c.id IS UNIQUE',
    'CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE',
    'CREATE CONSTRAINT project_id IF NOT EXISTS FOR (pr:Project) REQUIRE pr.id IS UNIQUE',
    'CREATE CONSTRAINT topic_id IF NOT EXISTS FOR (t:Topic) REQUIRE t.id IS UNIQUE',
    'CREATE CONSTRAINT idea_id IF NOT EXISTS FOR (i:Idea) REQUIRE i.id IS UNIQUE',
    'CREATE CONSTRAINT pattern_id IF NOT EXISTS FOR (pt:Pattern) REQUIRE pt.id IS UNIQUE',
    'CREATE CONSTRAINT value_id IF NOT EXISTS FOR (v:Value) REQUIRE v.id IS UNIQUE',
    'CREATE CONSTRAINT artifact_id IF NOT EXISTS FOR (a:Artifact) REQUIRE a.id IS UNIQUE',
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
    'CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name)',
    'CREATE INDEX person_relationship_type IF NOT EXISTS FOR (p:Person) ON (p.relationship_type)',
    'CREATE INDEX person_last_mentioned IF NOT EXISTS FOR (p:Person) ON (p.last_mentioned_at)',

    // Project indexes
    'CREATE INDEX project_name IF NOT EXISTS FOR (pr:Project) ON (pr.name)',
    'CREATE INDEX project_status IF NOT EXISTS FOR (pr:Project) ON (pr.status)',
    'CREATE INDEX project_domain IF NOT EXISTS FOR (pr:Project) ON (pr.domain)',
    'CREATE INDEX project_last_mentioned IF NOT EXISTS FOR (pr:Project) ON (pr.last_mentioned_at)',

    // Topic indexes
    'CREATE INDEX topic_name IF NOT EXISTS FOR (t:Topic) ON (t.name)',
    'CREATE INDEX topic_category IF NOT EXISTS FOR (t:Topic) ON (t.category)',
    'CREATE INDEX topic_last_mentioned IF NOT EXISTS FOR (t:Topic) ON (t.last_mentioned_at)',

    // Idea indexes
    'CREATE INDEX idea_status IF NOT EXISTS FOR (i:Idea) ON (i.status)',
    'CREATE INDEX idea_created IF NOT EXISTS FOR (i:Idea) ON (i.created_at)',

    // Conversation indexes
    'CREATE INDEX conversation_date IF NOT EXISTS FOR (c:Conversation) ON (c.date)',
    'CREATE INDEX conversation_status IF NOT EXISTS FOR (c:Conversation) ON (c.status)',

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
    // Project embedding index (assuming 1536 dimensions for OpenAI embeddings)
    `CREATE VECTOR INDEX project_embedding IF NOT EXISTS
     FOR (p:Project) ON (p.embedding)
     OPTIONS {indexConfig: {
       \`vector.dimensions\`: 1536,
       \`vector.similarity_function\`: 'cosine'
     }}`,

    // Topic embedding index
    `CREATE VECTOR INDEX topic_embedding IF NOT EXISTS
     FOR (t:Topic) ON (t.embedding)
     OPTIONS {indexConfig: {
       \`vector.dimensions\`: 1536,
       \`vector.similarity_function\`: 'cosine'
     }}`,

    // Idea embedding index
    `CREATE VECTOR INDEX idea_embedding IF NOT EXISTS
     FOR (i:Idea) ON (i.embedding)
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
