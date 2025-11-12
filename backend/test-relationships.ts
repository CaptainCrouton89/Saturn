import { neo4jService } from './src/db/neo4j.js';

async function testRelationships() {
  await neo4jService.connect();

  try {
    const userId = '87e4060b-83d5-468e-baf9-ebd6e569ecb7';

    // Check if any relationships exist
    console.log('Checking for existing relationships...');
    const countResult = await neo4jService.executeQuery<{ count: number }>(`
      MATCH (a)-[r]->(b)
      WHERE a.user_id = $userId
      RETURN count(r) as count
    `, { userId });

    console.log(`Total relationships found: ${countResult[0]?.count || 0}`);

    // List all Person nodes
    console.log('\nAll Person nodes:');
    const allPeople = await neo4jService.executeQuery<{
      entity_key: string;
      canonical_name: string;
      name: string;
    }>(`
      MATCH (p:Person {user_id: $userId})
      RETURN p.entity_key as entity_key, p.canonical_name as canonical_name, p.name as name
    `, { userId });

    allPeople.forEach(person => {
      console.log(`  - ${person.name} (canonical: ${person.canonical_name}, key: ${person.entity_key})`);
    });

    if (countResult[0]?.count === 0 && allPeople.length >= 2) {
      console.log('\nNo relationships found. Creating test relationships...');

      // Just use the first two people we find
      const person1 = allPeople[0];
      const person2 = allPeople[1];

      console.log(`\nCreating relationship between:`);
      console.log(`  ${person1.name} -> ${person2.name}`);

      // Create has_relationship_with relationship
      await neo4jService.executeQuery(`
        MATCH (p1:Person {entity_key: $key1})
        MATCH (p2:Person {entity_key: $key2})
        CREATE (p1)-[r:has_relationship_with]->(p2)
        SET
          r.relationship_type = 'friend',
          r.closeness = 'close',
          r.notes = 'Test relationship to verify graph visualization',
          r.user_id = $userId,
          r.created_at = datetime(),
          r.updated_at = datetime()
        RETURN r
      `, {
        key1: person1.entity_key,
        key2: person2.entity_key,
        userId
      });

      console.log(`✅ Created test relationship: ${person1.name} -[has_relationship_with]-> ${person2.name}`);

      // Create another relationship for good measure
      if (allPeople.length >= 3) {
        const person3 = allPeople[2];
        await neo4jService.executeQuery(`
          MATCH (p1:Person {entity_key: $key1})
          MATCH (p3:Person {entity_key: $key3})
          CREATE (p1)-[r:has_relationship_with]->(p3)
          SET
            r.relationship_type = 'acquaintance',
            r.notes = 'Another test relationship',
            r.user_id = $userId,
            r.created_at = datetime(),
            r.updated_at = datetime()
          RETURN r
        `, {
          key1: person1.entity_key,
          key3: person3.entity_key,
          userId
        });
        console.log(`✅ Created test relationship: ${person1.name} -[has_relationship_with]-> ${person3.name}`);
      }
    }

    // Show sample of existing relationships
    console.log('\nSample relationships:');
    const sampleRels = await neo4jService.executeQuery<{
      source_name: string;
      rel_type: string;
      target_name: string;
      has_user_id: boolean;
    }>(`
      MATCH (a)-[r]->(b)
      WHERE a.user_id = $userId
      RETURN
        COALESCE(a.canonical_name, a.name, a.description) as source_name,
        type(r) as rel_type,
        COALESCE(b.canonical_name, b.name, b.description) as target_name,
        r.user_id IS NOT NULL as has_user_id
      LIMIT 10
    `, { userId });

    sampleRels.forEach(rel => {
      const userIdFlag = rel.has_user_id ? '✓' : '✗';
      console.log(`  ${rel.source_name} -[${rel.rel_type}]-> ${rel.target_name} (user_id: ${userIdFlag})`);
    });

  } finally {
    await neo4jService.close();
  }
}

testRelationships()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
