import { neo4jService } from './src/db/neo4j.js';

async function findPetr() {
  await neo4jService.connect();

  try {
    const userId = '87e4060b-83d5-468e-baf9-ebd6e569ecb7';

    // Search all node types for 'petr'
    const results = await neo4jService.executeQuery<{
      type: string[];
      key: string;
      name: string;
      canonical: string;
    }>(`
      MATCH (n)
      WHERE n.user_id = $userId
      AND (
        toLower(n.canonical_name) CONTAINS 'petr' OR
        toLower(n.name) CONTAINS 'petr' OR
        toLower(n.description) CONTAINS 'petr'
      )
      RETURN labels(n) as type, n.entity_key as key, n.name as name, n.canonical_name as canonical
    `, { userId });

    console.log('Nodes containing "petr":');
    results.forEach(r => {
      console.log(`  ${r.type[0]}: ${r.name || r.canonical} (key: ${r.key})`);
    });

    if (results.length === 0) {
      console.log('  (none found)');
    }

  } finally {
    await neo4jService.close();
  }
}

findPetr()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
