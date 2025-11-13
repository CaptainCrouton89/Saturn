import { neo4jService } from './neo4j.js';

/**
 * Initialize Neo4j schema with constraints and indexes
 * This ensures data integrity and query performance
 * Based on documented schema in backend/scripts/ingestion/
 */
export async function initializeSchema(): Promise<void> {
  console.log('🔧 Initializing Neo4j schema...');

  try {
    await createConstraints();
    await createIndexes();
    await createVectorIndexes();
    console.log('✅ Neo4j schema initialized successfully');
  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Schema initialization failed:', error.message);
    } else {
      console.error('❌ Schema initialization failed with unknown error:', error);
    }
    throw error;
  }
}

/**
 * Helper to safely execute constraint creation, ignoring if already exists
 */
async function createConstraintIfNotExists(constraintQuery: string): Promise<void> {
  try {
    await neo4jService.executeQuery(constraintQuery);
  } catch (caughtError) {
    // Validate error type - only Error instances are handled gracefully
    if (!(caughtError instanceof Error)) {
      throw caughtError;
    }

    // Check if this is an expected "already exists" error
    const isAlreadyExists = caughtError.message.includes('equivalent constraint already exists');

    // Only continue silently if constraint already exists; otherwise re-throw
    if (!isAlreadyExists) {
      throw caughtError;
    }
    // Constraint already exists - this is expected, continue silently
  }
}

/**
 * Create uniqueness constraints for all node types
 * Based on schema documentation in backend/scripts/ingestion/nodes/
 */
async function createConstraints(): Promise<void> {
  const constraints = [
    // ===== Person Node Constraints =====
    // entity_key must be globally unique
    'CREATE CONSTRAINT person_entity_key_unique IF NOT EXISTS FOR (p:Person) REQUIRE (p.entity_key) IS UNIQUE',
    // canonical_name must be unique per user
    'CREATE CONSTRAINT person_canonical_name_user IF NOT EXISTS FOR (p:Person) REQUIRE (p.canonical_name, p.user_id) IS UNIQUE',
    // user_id must be unique for owner nodes (is_owner=true)
    'CREATE CONSTRAINT person_owner_unique IF NOT EXISTS FOR (p:Person) REQUIRE (p.user_id, p.is_owner) IS UNIQUE',

    // ===== Concept Node Constraints =====
    // entity_key must be globally unique
    'CREATE CONSTRAINT concept_entity_key_unique IF NOT EXISTS FOR (c:Concept) REQUIRE (c.entity_key) IS UNIQUE',
    // name must be unique per user
    'CREATE CONSTRAINT concept_name_user IF NOT EXISTS FOR (c:Concept) REQUIRE (c.name, c.user_id) IS UNIQUE',

    // ===== Entity Node Constraints =====
    // entity_key must be globally unique
    'CREATE CONSTRAINT entity_entity_key_unique IF NOT EXISTS FOR (e:Entity) REQUIRE (e.entity_key) IS UNIQUE',
    // (name, type, user_id) must be unique per user
    'CREATE CONSTRAINT entity_name_type_user IF NOT EXISTS FOR (e:Entity) REQUIRE (e.name, e.type, e.user_id) IS UNIQUE',

    // ===== Source Node Constraints =====
    // entity_key must be globally unique
    'CREATE CONSTRAINT source_entity_key_unique IF NOT EXISTS FOR (s:Source) REQUIRE (s.entity_key) IS UNIQUE',

    // ===== Artifact Node Constraints =====
    // entity_key must be globally unique
    'CREATE CONSTRAINT artifact_entity_key_unique IF NOT EXISTS FOR (a:Artifact) REQUIRE (a.entity_key) IS UNIQUE',

    // ===== Storyline Node Constraints =====
    // (user_id, anchor_entity_key) must be unique - one storyline per anchor per user
    'CREATE CONSTRAINT storyline_anchor_user IF NOT EXISTS FOR (st:Storyline) REQUIRE (st.user_id, st.anchor_entity_key) IS UNIQUE',

    // ===== Macro Node Constraints =====
    // (user_id, anchor_entity_key) must be unique - one macro per anchor per user
    'CREATE CONSTRAINT macro_anchor_user IF NOT EXISTS FOR (m:Macro) REQUIRE (m.user_id, m.anchor_entity_key) IS UNIQUE',
  ];

  for (const constraint of constraints) {
    await createConstraintIfNotExists(constraint);
  }

  console.log('  ✓ Constraints created');
}

/**
 * Helper to safely execute index creation, ignoring if already exists
 */
async function createIndexIfNotExists(indexQuery: string): Promise<void> {
  try {
    await neo4jService.executeQuery(indexQuery);
  } catch (caughtError) {
    // Validate error type - only Error instances are handled gracefully
    if (!(caughtError instanceof Error)) {
      throw caughtError;
    }

    // Check if this is an expected "already exists" error
    const isAlreadyExists = caughtError.message.includes('equivalent index already exists');

    // Only continue silently if index already exists; otherwise re-throw
    if (!isAlreadyExists) {
      throw caughtError;
    }
    // Index already exists - this is expected, continue silently
  }
}

/**
 * Create indexes for frequently queried properties
 * Optimizes user-scoped queries and entity lookups
 */
async function createIndexes(): Promise<void> {
  const indexes = [
    // ===== Person Indexes =====
    'CREATE INDEX person_user_id IF NOT EXISTS FOR (p:Person) ON (p.user_id)',
    'CREATE INDEX person_is_owner IF NOT EXISTS FOR (p:Person) ON (p.is_owner)',
    'CREATE INDEX person_state IF NOT EXISTS FOR (p:Person) ON (p.state)',
    'CREATE INDEX person_created_by IF NOT EXISTS FOR (p:Person) ON (p.created_by)',

    // ===== Concept Indexes =====
    'CREATE INDEX concept_user_id IF NOT EXISTS FOR (c:Concept) ON (c.user_id)',
    'CREATE INDEX concept_state IF NOT EXISTS FOR (c:Concept) ON (c.state)',
    'CREATE INDEX concept_created_by IF NOT EXISTS FOR (c:Concept) ON (c.created_by)',
    'CREATE INDEX concept_salience IF NOT EXISTS FOR (c:Concept) ON (c.salience)',

    // ===== Entity Indexes =====
    'CREATE INDEX entity_user_id IF NOT EXISTS FOR (e:Entity) ON (e.user_id)',
    'CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.type)',
    'CREATE INDEX entity_state IF NOT EXISTS FOR (e:Entity) ON (e.state)',
    'CREATE INDEX entity_created_by IF NOT EXISTS FOR (e:Entity) ON (e.created_by)',
    'CREATE INDEX entity_salience IF NOT EXISTS FOR (e:Entity) ON (e.salience)',

    // ===== Source Indexes =====
    'CREATE INDEX source_user_id IF NOT EXISTS FOR (s:Source) ON (s.user_id)',
    'CREATE INDEX source_team_id IF NOT EXISTS FOR (s:Source) ON (s.team_id)',
    'CREATE INDEX source_state IF NOT EXISTS FOR (s:Source) ON (s.state)',
    'CREATE INDEX source_processing_status IF NOT EXISTS FOR (s:Source) ON (s.processing_status)',
    'CREATE INDEX source_type IF NOT EXISTS FOR (s:Source) ON (s.source_type)',
    'CREATE INDEX source_context_type IF NOT EXISTS FOR (s:Source) ON (s.context_type)',
    'CREATE INDEX source_created_at IF NOT EXISTS FOR (s:Source) ON (s.created_at)',

    // ===== Artifact Indexes =====
    'CREATE INDEX artifact_user_id IF NOT EXISTS FOR (a:Artifact) ON (a.user_id)',
    'CREATE INDEX artifact_created_at IF NOT EXISTS FOR (a:Artifact) ON (a.created_at)',

    // ===== Storyline Indexes =====
    'CREATE INDEX storyline_user_id IF NOT EXISTS FOR (st:Storyline) ON (st.user_id)',
    'CREATE INDEX storyline_anchor_entity_key IF NOT EXISTS FOR (st:Storyline) ON (st.anchor_entity_key)',
    'CREATE INDEX storyline_state IF NOT EXISTS FOR (st:Storyline) ON (st.state)',

    // ===== Macro Indexes =====
    'CREATE INDEX macro_user_id IF NOT EXISTS FOR (m:Macro) ON (m.user_id)',
    'CREATE INDEX macro_anchor_entity_key IF NOT EXISTS FOR (m:Macro) ON (m.anchor_entity_key)',
    'CREATE INDEX macro_state IF NOT EXISTS FOR (m:Macro) ON (m.state)',
  ];

  for (const index of indexes) {
    await createIndexIfNotExists(index);
  }

  console.log('  ✓ Indexes created');
}

/**
 * Helper to safely create vector indexes, warning if Neo4j version doesn't support
 */
async function createVectorIndexIfNotExists(indexQuery: string, indexName: string): Promise<void> {
  try {
    await neo4jService.executeQuery(indexQuery);
  } catch (error) {
    // Validate error type first
    if (!(error instanceof Error)) {
      console.warn(`Vector index ${indexName} creation failed with unknown error type:`, error);
      return;
    }

    // Extract error details
    const errorMessage = error.message;

    // Handle specific known conditions
    if (errorMessage.includes('equivalent index already exists')) {
      // Index already exists - this is expected, no action needed
      return;
    }

    if (errorMessage.includes('VECTOR INDEX is not supported')) {
      // Neo4j version doesn't support vector indexes - this is expected
      // Silently return without error, as this is a graceful degradation
      return;
    }

    // For any other error, log a warning to help with debugging
    // We intentionally don't re-throw here because vector indexes are optional
    // and this represents a graceful degradation for older Neo4j versions
    console.warn(
      `Vector index ${indexName} creation encountered error (Neo4j 5.11+ may be required):`,
      errorMessage
    );
    // Continue execution - vector indexes are a nice-to-have feature, not critical
    return;
  }
}

/**
 * Create vector indexes for embeddings (requires Neo4j 5.11+)
 * Enables semantic similarity search across nodes
 */
async function createVectorIndexes(): Promise<void> {
  const vectorIndexes = [
    // Person embedding index
    {
      name: 'person_embedding',
      query: `CREATE VECTOR INDEX person_embedding IF NOT EXISTS
       FOR (p:Person) ON (p.embedding)
       OPTIONS {indexConfig: {
         \`vector.dimensions\`: 1536,
         \`vector.similarity_function\`: 'cosine'
       }}`,
    },

    // Concept embedding index
    {
      name: 'concept_embedding',
      query: `CREATE VECTOR INDEX concept_embedding IF NOT EXISTS
       FOR (c:Concept) ON (c.embedding)
       OPTIONS {indexConfig: {
         \`vector.dimensions\`: 1536,
         \`vector.similarity_function\`: 'cosine'
       }}`,
    },

    // Entity embedding index
    {
      name: 'entity_embedding',
      query: `CREATE VECTOR INDEX entity_embedding IF NOT EXISTS
       FOR (e:Entity) ON (e.embedding)
       OPTIONS {indexConfig: {
         \`vector.dimensions\`: 1536,
         \`vector.similarity_function\`: 'cosine'
       }}`,
    },

    // Source embedding index
    {
      name: 'source_embedding',
      query: `CREATE VECTOR INDEX source_embedding IF NOT EXISTS
       FOR (s:Source) ON (s.embedding)
       OPTIONS {indexConfig: {
         \`vector.dimensions\`: 1536,
         \`vector.similarity_function\`: 'cosine'
       }}`,
    },

    // Storyline embedding index
    {
      name: 'storyline_embedding',
      query: `CREATE VECTOR INDEX storyline_embedding IF NOT EXISTS
       FOR (st:Storyline) ON (st.embedding)
       OPTIONS {indexConfig: {
         \`vector.dimensions\`: 1536,
         \`vector.similarity_function\`: 'cosine'
       }}`,
    },

    // Macro embedding index
    {
      name: 'macro_embedding',
      query: `CREATE VECTOR INDEX macro_embedding IF NOT EXISTS
       FOR (m:Macro) ON (m.embedding)
       OPTIONS {indexConfig: {
         \`vector.dimensions\`: 1536,
         \`vector.similarity_function\`: 'cosine'
       }}`,
    },
  ];

  for (const vectorIndex of vectorIndexes) {
    await createVectorIndexIfNotExists(vectorIndex.query, vectorIndex.name);
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
    if (error instanceof Error) {
      console.error('Schema verification failed:', error.message);
    } else {
      console.error('Schema verification failed with unknown error:', error);
    }
    return false;
  }
}
