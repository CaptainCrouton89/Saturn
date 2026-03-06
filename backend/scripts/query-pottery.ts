import { neo4jService } from '../src/db/neo4j';

interface ArtifactResult {
  a_name: string;
  a_description?: string;
  a_details?: string;
  a_id?: string;
  a_created_at?: string;
}

interface EntityResult {
  e_name: string;
  e_description?: string;
  e_type?: string;
  e_entity_type?: string;
  e_id?: string;
}

interface SourceResult {
  s_summary: string;
  s_type?: string;
  s_id?: string;
  s_created_at?: string;
}

interface FamilyArtifactResult {
  a_name: string;
  a_description?: string;
  p_name: string;
  relationship_type: string;
  a_id?: string;
}

interface ExactMatchResult {
  node_type: string[];
  n_id?: string;
  n_name: string;
  n_description?: string;
  n_details?: string;
}

/**
 * Query script to check for pottery details in Neo4j graph
 * Looking for: 'cup with dog face' made by Mel and kids
 */

async function main() {
  try {
    // Connect to Neo4j
    await neo4jService.connect();
    console.log('✓ Connected to Neo4j\n');

    // User ID to search for
    const userId = 'conv-26';

    console.log(`Searching for pottery details for user: ${userId}\n`);
    console.log('='.repeat(80));

    // Query 1: Find all artifacts with pottery-related keywords
    console.log('\n1️⃣  Query 1: Artifacts with pottery/cup keywords');
    console.log('-'.repeat(80));
    const artifactResults = await neo4jService.executeQuery<ArtifactResult>(
      `MATCH (a:Artifact)
       WHERE a.user_id = $userId
       AND (
         a.name =~ '(?i).*(pottery|clay|cup|dog).*'
         OR a.description =~ '(?i).*(pottery|clay|cup|dog).*'
       )
       RETURN a.id, a.name, a.description, a.created_at, a.details`,
      { userId }
    );
    console.log(`Found ${artifactResults.length} artifacts:`);
    artifactResults.forEach((result, idx) => {
      console.log(`  ${idx + 1}. Name: "${result.a_name}"`);
      if (result.a_description) console.log(`     Description: ${result.a_description}`);
      if (result.a_details) console.log(`     Details: ${result.a_details}`);
    });

    // Query 2: Find all entities related to pottery/family activities
    console.log('\n2️⃣  Query 2: Entities (projects/activities) with pottery keywords');
    console.log('-'.repeat(80));
    const entityResults = await neo4jService.executeQuery<EntityResult>(
      `MATCH (e:Entity)
       WHERE e.user_id = $userId
       AND (
         e.name =~ '(?i).*(pottery|clay|cup|dog).*'
         OR e.description =~ '(?i).*(pottery|clay|cup|dog).*'
       )
       RETURN e.id, e.name, e.description, e.type, e.entity_type`,
      { userId }
    );
    console.log(`Found ${entityResults.length} entities:`);
    entityResults.forEach((result, idx) => {
      console.log(`  ${idx + 1}. Name: "${result.e_name}" (type: ${result.e_type || result.e_entity_type})`);
      if (result.e_description) console.log(`     Description: ${result.e_description}`);
    });

    // Query 3: Find sources (conversations) mentioning pottery
    console.log('\n3️⃣  Query 3: Sources (conversations) with pottery keywords');
    console.log('-'.repeat(80));
    const sourceResults = await neo4jService.executeQuery<SourceResult>(
      `MATCH (s:Source)
       WHERE s.user_id = $userId
       AND s.summary =~ '(?i).*(pottery|clay|cup|dog).*'
       RETURN s.id, s.summary, s.created_at, s.type`,
      { userId }
    );
    console.log(`Found ${sourceResults.length} sources:`);
    sourceResults.forEach((result, idx) => {
      console.log(`  ${idx + 1}. ${result.s_type || 'Source'}: "${result.s_summary.substring(0, 100)}..."`);
    });

    // Query 4: Find artifacts related to Mel and kids (family activities)
    console.log('\n4️⃣  Query 4: Artifacts with relationships to family/Mel');
    console.log('-'.repeat(80));
    const familyResults = await neo4jService.executeQuery<FamilyArtifactResult>(
      `MATCH (a:Artifact)-[r]->(p:Person)
       WHERE a.user_id = $userId
       AND p.name =~ '(?i).*(Mel|kids).*'
       AND (
         a.name =~ '(?i).*(pottery|clay|cup|dog).*'
         OR a.description =~ '(?i).*(pottery|clay|cup|dog).*'
       )
       RETURN a.id, a.name, a.description, p.name, type(r) as relationship_type`,
      { userId }
    );
    console.log(`Found ${familyResults.length} family artifacts:`);
    familyResults.forEach((result, idx) => {
      console.log(`  ${idx + 1}. Artifact: "${result.a_name}" → Person: "${result.p_name}"`);
      console.log(`     Relationship: ${result.relationship_type}`);
      if (result.a_description) console.log(`     Description: ${result.a_description}`);
    });

    // Query 5: Specific search for "cup with dog face"
    console.log('\n5️⃣  Query 5: EXACT search for "cup with dog face"');
    console.log('-'.repeat(80));
    const exactResults = await neo4jService.executeQuery<ExactMatchResult>(
      `MATCH (n)
       WHERE n.user_id = $userId
       AND (
         n.name =~ '(?i).*(cup.*dog.*face|dog.*face.*cup).*'
         OR n.description =~ '(?i).*(cup.*dog.*face|dog.*face.*cup).*'
         OR n.details =~ '(?i).*(cup.*dog.*face|dog.*face.*cup).*'
       )
       RETURN labels(n) as node_type, n.id, n.name, n.description, n.details`,
      { userId }
    );
    console.log(`Found ${exactResults.length} exact matches:`);
    if (exactResults.length === 0) {
      console.log('  ❌ No exact matches for "cup with dog face"');
    } else {
      exactResults.forEach((result, idx) => {
        console.log(`  ${idx + 1}. Type: ${result.node_type.join(',')}`);
        console.log(`     Name: "${result.n_name}"`);
        if (result.n_description) console.log(`     Description: ${result.n_description}`);
        if (result.n_details) console.log(`     Details: ${result.n_details}`);
      });
    }

    // Query 6: All artifacts for this user (overview)
    console.log('\n6️⃣  Query 6: All Artifacts for user (overview)');
    console.log('-'.repeat(80));
    const allArtifacts = await neo4jService.executeQuery<ArtifactResult>(
      `MATCH (a:Artifact)
       WHERE a.user_id = $userId
       RETURN a.id, a.name, a.description, a.created_at
       LIMIT 20`,
      { userId }
    );
    console.log(`Found ${allArtifacts.length} total artifacts:`);
    allArtifacts.forEach((result, idx) => {
      console.log(`  ${idx + 1}. "${result.a_name}"`);
    });

    console.log('\n' + '='.repeat(80));
    console.log('Summary:');
    console.log('-'.repeat(80));
    console.log(`Artifacts found: ${artifactResults.length}`);
    console.log(`Entities found: ${entityResults.length}`);
    console.log(`Sources found: ${sourceResults.length}`);
    console.log(`Family artifacts found: ${familyResults.length}`);
    console.log(`Exact "cup with dog face" matches: ${exactResults.length}`);

    if (exactResults.length === 0) {
      console.log('\n❌ The specific "cup with dog face" detail does NOT exist in the graph.');
    } else {
      console.log('\n✅ The "cup with dog face" detail EXISTS in the graph!');
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await neo4jService.close();
  }
}

main();
