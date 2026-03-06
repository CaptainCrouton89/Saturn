import { getNeo4jDriver } from '../src/db/neo4jClient.js';

async function checkUserIds() {
  const driver = getNeo4jDriver();
  const session = driver.session();

  try {
    const result = await session.run(`
      MATCH (n)
      WHERE n.user_id IS NOT NULL
      RETURN DISTINCT n.user_id as user_id, labels(n) as labels, count(*) as count
      ORDER BY user_id, labels
      LIMIT 20
    `);

    console.log('User IDs found in database:');
    console.log('');
    result.records.forEach(r => {
      console.log(`  ${r.get('user_id')}: ${r.get('labels').join(', ')} (${r.get('count')} nodes)`);
    });

    // Also check source IDs
    console.log('');
    console.log('Source IDs (checking for conv-26 pattern):');
    const sourcesResult = await session.run(`
      MATCH (s:Source)
      WHERE s.source_id CONTAINS 'conv-26'
      RETURN s.source_id as source_id, s.user_id as user_id
      ORDER BY s.source_id
      LIMIT 10
    `);

    sourcesResult.records.forEach(r => {
      console.log(`  ${r.get('source_id')} -> user_id: ${r.get('user_id')}`);
    });
  } finally {
    await session.close();
    await driver.close();
  }
}

checkUserIds();
