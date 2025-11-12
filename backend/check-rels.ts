import { neo4jService } from './src/db/neo4j';

async function checkRelationships() {
  await neo4jService.connect();

  try {
    // Check total relationship count
    const countResult = await neo4jService.executeQuery<{ count: number }>(`
      MATCH ()-[r]->()
      WHERE r.user_id = $userId
      RETURN count(r) as count
    `, { userId: '87e4060b-83d5-468e-baf9-ebd6e569ecb7' });

    console.log('Total relationships:', countResult[0]?.count || 0);

    // Get sample relationships
    const sampleResult = await neo4jService.executeQuery<{
      rel_type: string;
      from_type: string;
      to_type: string;
      count: number;
    }>(`
      MATCH (a)-[r]->(b)
      WHERE r.user_id = $userId
      RETURN type(r) as rel_type, labels(a)[0] as from_type, labels(b)[0] as to_type, count(*) as count
    `, { userId: '87e4060b-83d5-468e-baf9-ebd6e569ecb7' });

    console.log('\nRelationship types:');
    sampleResult.forEach(rec => {
      console.log(`  ${rec.from_type} -[${rec.rel_type}]-> ${rec.to_type}: ${rec.count}`);
    });
  } finally {
    await neo4jService.close();
  }
}

checkRelationships().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
