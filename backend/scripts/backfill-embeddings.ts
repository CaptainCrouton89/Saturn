/**
 * Backfill Embeddings Script
 *
 * Generates embeddings for all existing Projects, Topics, and Ideas
 * that don't have embeddings yet.
 */

import dotenv from 'dotenv';
import { OpenAIEmbeddings } from '@langchain/openai';
import { neo4jService } from '../src/db/neo4j.js';

// Load environment variables - use production if specified
dotenv.config({ path: process.env.ENV === 'production' ? '.env.production' : '.env' });

interface EntityForEmbedding {
  id: string;
  entity_type: 'Project' | 'Topic' | 'Idea';
  name?: string;
  summary?: string;
  description?: string;
  vision?: string;
  context_notes?: string;
}

const embeddings = new OpenAIEmbeddings({
  modelName: 'text-embedding-3-small',
});

/**
 * Extract text to embed based on entity type
 */
function getEmbeddingText(entity: EntityForEmbedding): string {
  switch (entity.entity_type) {
    case 'Project': {
      if (!entity.name) {
        throw new Error(`Project entity missing name: ${entity.id}`);
      }
      const vision = entity.vision ? ` ${entity.vision}` : '';
      return `${entity.name}${vision}`.trim();
    }
    case 'Topic': {
      if (!entity.name) {
        throw new Error(`Topic entity missing name: ${entity.id}`);
      }
      const description = entity.description ? ` ${entity.description}` : '';
      return `${entity.name}${description}`.trim();
    }
    case 'Idea': {
      const text = entity.summary ?? entity.name;
      if (!text) {
        throw new Error(`Idea entity missing summary and name: ${entity.id}`);
      }
      const contextNotes = entity.context_notes ? ` ${entity.context_notes}` : '';
      return `${text}${contextNotes}`.trim();
    }
    default:
      throw new Error(`Unknown entity type: ${entity.entity_type}`);
  }
}

/**
 * Fetch all entities without embeddings
 */
async function fetchEntitiesWithoutEmbeddings(): Promise<EntityForEmbedding[]> {
  const entities: EntityForEmbedding[] = [];

  // Fetch Projects
  const projectQuery = `
    MATCH (p:Project)
    WHERE p.embedding IS NULL
    RETURN p.id as id, p.name as name, p.vision as vision
  `;
  const projectResults = await neo4jService.executeQuery<{id: string; name: string; vision?: string}>(projectQuery);
  projectResults.forEach(record => {
    entities.push({
      id: record.id,
      entity_type: 'Project',
      name: record.name,
      vision: record.vision,
    });
  });

  // Fetch Topics
  const topicQuery = `
    MATCH (t:Topic)
    WHERE t.embedding IS NULL
    RETURN t.id as id, t.name as name, t.description as description
  `;
  const topicResults = await neo4jService.executeQuery<{id: string; name: string; description?: string}>(topicQuery);
  topicResults.forEach(record => {
    entities.push({
      id: record.id,
      entity_type: 'Topic',
      name: record.name,
      description: record.description,
    });
  });

  // Fetch Ideas
  const ideaQuery = `
    MATCH (i:Idea)
    WHERE i.embedding IS NULL
    RETURN i.id as id, i.summary as summary, i.context_notes as context_notes
  `;
  const ideaResults = await neo4jService.executeQuery<{id: string; summary?: string; context_notes?: string}>(ideaQuery);
  ideaResults.forEach(record => {
    entities.push({
      id: record.id,
      entity_type: 'Idea',
      summary: record.summary,
      context_notes: record.context_notes,
    });
  });

  return entities;
}

/**
 * Generate embeddings in batches
 */
async function generateEmbeddings(entities: EntityForEmbedding[]): Promise<Map<string, number[]>> {
  console.log(`\n📊 Generating embeddings for ${entities.length} entities...`);

  const texts = entities.map(getEmbeddingText);
  console.log(`  Generated ${texts.length} texts to embed`);
  console.log(`  Sample texts:`, texts.slice(0, 3));

  const embeddingVectors = await embeddings.embedDocuments(texts);
  console.log(`  Received ${embeddingVectors.length} embedding vectors`);

  const embeddingMap = new Map<string, number[]>();
  entities.forEach((entity, idx) => {
    console.log(`  Mapping entity ${idx}: ${entity.entity_type} - ${entity.id} - ${entity.name ?? entity.summary}`);
    if (!embeddingVectors[idx]) {
      console.warn(`  ⚠️  No embedding for entity ${entity.id} at index ${idx}`);
      return;
    }
    embeddingMap.set(entity.id, embeddingVectors[idx]);
  });

  console.log(`  Final embedding map size: ${embeddingMap.size}`);
  return embeddingMap;
}

/**
 * Update entities with embeddings in Neo4j
 */
async function updateEmbeddings(
  entityType: 'Project' | 'Topic' | 'Idea',
  embeddings: Array<{ id: string; embedding: number[] }>
): Promise<void> {
  if (embeddings.length === 0) return;

  const query = `
    UNWIND $embeddings AS emb
    MATCH (n:${entityType} {id: emb.id})
    SET n.embedding = emb.embedding
    RETURN n.id
  `;

  const results = await neo4jService.executeQuery<{id: string}>(query, { embeddings });
  console.log(`  ✅ Updated ${results.length} ${entityType} embeddings`);
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log('🚀 Starting embedding backfill...\n');

    // Connect to Neo4j
    await neo4jService.connect();
    console.log('✅ Connected to Neo4j');

    // Fetch entities without embeddings
    const entities = await fetchEntitiesWithoutEmbeddings();

    if (entities.length === 0) {
      console.log('\n✨ All entities already have embeddings!');
      await neo4jService.close();
      return;
    }

    console.log(`\n📋 Found ${entities.length} entities without embeddings:`);
    const projectCount = entities.filter(e => e.entity_type === 'Project').length;
    const topicCount = entities.filter(e => e.entity_type === 'Topic').length;
    const ideaCount = entities.filter(e => e.entity_type === 'Idea').length;
    console.log(`   - ${projectCount} Projects`);
    console.log(`   - ${topicCount} Topics`);
    console.log(`   - ${ideaCount} Ideas`);

    // Generate embeddings
    const embeddingMap = await generateEmbeddings(entities);
    console.log(`\n✅ Generated ${embeddingMap.size} embeddings`);

    // Group by entity type
    const projectEmbeddings = entities
      .filter(e => e.entity_type === 'Project')
      .map(e => ({ id: e.id, embedding: embeddingMap.get(e.id)! }));

    const topicEmbeddings = entities
      .filter(e => e.entity_type === 'Topic')
      .map(e => ({ id: e.id, embedding: embeddingMap.get(e.id)! }));

    const ideaEmbeddings = entities
      .filter(e => e.entity_type === 'Idea')
      .map(e => ({ id: e.id, embedding: embeddingMap.get(e.id)! }));

    // Update Neo4j
    console.log('\n📝 Updating Neo4j...');
    await updateEmbeddings('Project', projectEmbeddings);
    await updateEmbeddings('Topic', topicEmbeddings);
    await updateEmbeddings('Idea', ideaEmbeddings);

    console.log('\n✨ Embedding backfill complete!\n');

    // Verify
    const verifyQuery = `
      MATCH (p:Project) WHERE p.embedding IS NOT NULL
      WITH count(p) as project_count
      MATCH (t:Topic) WHERE t.embedding IS NOT NULL
      WITH project_count, count(t) as topic_count
      MATCH (i:Idea) WHERE i.embedding IS NOT NULL
      RETURN project_count, topic_count, count(i) as idea_count
    `;

    const verification = await neo4jService.executeQuery<{project_count: number; topic_count: number; idea_count: number}>(verifyQuery);
    if (verification.length > 0) {
      const record = verification[0];
      console.log('📊 Verification:');
      console.log(`   - Projects with embeddings: ${record.project_count}`);
      console.log(`   - Topics with embeddings: ${record.topic_count}`);
      console.log(`   - Ideas with embeddings: ${record.idea_count}`);
    }

    await neo4jService.close();
  } catch (error) {
    console.error('❌ Error during backfill:', error);
    await neo4jService.close();
    process.exit(1);
  }
}

main();
