import { neo4jService } from './src/db/neo4j.js';

async function checkRelationships() {
  await neo4jService.connect();

  // Count relationships by type
  const query = `
    MATCH ()-[r]->()
    RETURN type(r) as rel_type, count(*) as count
    ORDER BY count DESC
  `;

  const results = await neo4jService.executeQuery<{ rel_type: string; count: number }>(query);

  console.log('\n📊 Relationships in Neo4j:');
  console.log('='.repeat(50));
  for (const row of results) {
    console.log(`  ${row.rel_type}: ${row.count}`);
  }

  // Check if new relationships have required properties
  const propsQuery = `
    MATCH ()-[r:relates_to]->()
    RETURN r.attitude as attitude,
           r.proximity as proximity,
           r.description as description,
           r.relationship_type as rel_type,
           r.relation_embedding as embedding
    LIMIT 1
  `;

  const propsResults = await neo4jService.executeQuery<{
    attitude: number;
    proximity: number;
    description: string;
    rel_type: string;
    embedding: number[];
  }>(propsQuery);

  if (propsResults.length > 0) {
    console.log('\n✅ Sample relates_to relationship properties:');
    console.log('='.repeat(50));
    const r = propsResults[0];
    console.log(`  attitude: ${r.attitude}`);
    console.log(`  proximity: ${r.proximity}`);
    console.log(`  description: ${r.description}`);
    console.log(`  relationship_type: ${r.rel_type}`);
    console.log(`  relation_embedding: ${r.embedding ? `[${r.embedding.length} dimensions]` : 'null'}`);
  }

  await neo4jService.close();
}

checkRelationships().catch(console.error);
