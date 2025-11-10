import { OpenAIEmbeddings } from '@langchain/openai';
import { neo4jService } from './src/db/neo4j.js';
import { config } from 'dotenv';

config({ path: '.env.production' });

async function test() {
  try {
    // Connect to Neo4j
    await neo4jService.connect();
    console.log('✅ Connected to Neo4j');

    // Generate embedding
    const embeddings = new OpenAIEmbeddings({ modelName: 'text-embedding-3-small' });
    const queryEmbedding = await embeddings.embedQuery('projects');
    console.log('✅ Generated embedding, length:', queryEmbedding.length);

    // Test simple vector similarity query
    const testQuery = `
      MATCH (p:Project)
      WHERE p.embedding IS NOT NULL
      WITH p, vector.similarity.cosine(p.embedding, $queryEmbedding) AS score
      WHERE score > 0.5
      RETURN p.name, score
      ORDER BY score DESC
      LIMIT 5
    `;

    console.log('Running vector search query...');
    const results = await neo4jService.executeQuery(testQuery, { queryEmbedding });

    console.log('✅ Results:', results);

  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    if (error.code) console.error('Error code:', error.code);
  } finally {
    await neo4jService.close();
  }
}

test();
