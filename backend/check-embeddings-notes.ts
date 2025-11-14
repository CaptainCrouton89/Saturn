import { neo4jService } from './src/db/neo4j.js';

async function checkEmbeddingsAndNotes() {
  await neo4jService.connect();

  console.log('\n🔍 Checking Embeddings and Notes\n');
  console.log('='.repeat(80));

  // Check relationship embeddings and notes
  console.log('\n📊 RELATIONSHIPS:');
  console.log('='.repeat(80));

  const relQuery = `
    MATCH ()-[r:relates_to]->()
    RETURN
      r.relation_embedding as relation_embedding,
      r.notes_embedding as notes_embedding,
      r.notes as notes,
      r.attitude as attitude,
      r.proximity as proximity,
      r.description as description,
      r.relationship_type as rel_type
    LIMIT 2
  `;

  const relResults = await neo4jService.executeQuery<{
    relation_embedding: number[] | null;
    notes_embedding: number[] | null;
    notes: unknown[] | null;
    attitude: number;
    proximity: number;
    description: string;
    rel_type: string;
  }>(relQuery);

  for (let i = 0; i < relResults.length; i++) {
    const r = relResults[i];
    console.log(`\nRelationship ${i + 1}:`);
    console.log(`  Type: ${r.rel_type}`);
    console.log(`  Description: ${r.description?.substring(0, 80)}...`);
    console.log(`  Attitude: ${r.attitude}, Proximity: ${r.proximity}`);
    console.log(`  relation_embedding: ${r.relation_embedding ? `✅ [${r.relation_embedding.length} dims]` : '❌ null'}`);
    console.log(`  notes_embedding: ${r.notes_embedding ? `✅ [${r.notes_embedding.length} dims]` : '❌ null or empty'}`);
    console.log(`  notes array: ${r.notes ? `✅ [${r.notes.length} notes]` : '❌ empty array or null'}`);
  }

  // Check Person → Concept relationships (engages_with)
  console.log('\n\n📊 PERSON → CONCEPT RELATIONSHIPS (engages_with):');
  console.log('='.repeat(80));

  const personConceptQuery = `
    MATCH (p:Person)-[r:engages_with]->(c:Concept)
    RETURN
      r.relation_embedding as relation_embedding,
      r.notes_embedding as notes_embedding,
      r.notes as notes,
      r.attitude as attitude,
      r.proximity as proximity,
      r.description as description,
      p.name as person_name,
      c.name as concept_name
    LIMIT 1
  `;

  const pcResults = await neo4jService.executeQuery<{
    relation_embedding: number[] | null;
    notes_embedding: number[] | null;
    notes: unknown[] | null;
    attitude: number;
    proximity: number;
    description: string;
    person_name: string;
    concept_name: string;
  }>(personConceptQuery);

  if (pcResults.length > 0) {
    const r = pcResults[0];
    console.log(`\nPerson → Concept relationship:`);
    console.log(`  ${r.person_name} → ${r.concept_name}`);
    console.log(`  Description: ${r.description?.substring(0, 80)}...`);
    console.log(`  Attitude: ${r.attitude}, Proximity: ${r.proximity}`);
    console.log(`  relation_embedding: ${r.relation_embedding ? `✅ [${r.relation_embedding.length} dims]` : '❌ null'}`);
    console.log(`  notes_embedding: ${r.notes_embedding ? `✅ [${r.notes_embedding.length} dims]` : '❌ null or empty'}`);
    console.log(`  notes array: ${r.notes ? `✅ [${r.notes.length} notes]` : '❌ empty array or null'}`);
  }

  // Check node embeddings and notes
  console.log('\n\n📦 NODES (Concepts):');
  console.log('='.repeat(80));

  const nodeQuery = `
    MATCH (c:Concept)
    RETURN
      c.name as name,
      c.description as description,
      c.notes as notes,
      c.embedding as embedding
    LIMIT 3
  `;

  const nodeResults = await neo4jService.executeQuery<{
    name: string;
    description: string | null;
    notes: unknown[] | null;
    embedding: number[] | null;
  }>(nodeQuery);

  for (let i = 0; i < nodeResults.length; i++) {
    const n = nodeResults[i];
    console.log(`\nConcept ${i + 1}: ${n.name}`);
    console.log(`  Description: ${n.description ? `"${n.description.substring(0, 80)}..."` : '❌ null'}`);
    console.log(`  embedding: ${n.embedding ? `✅ [${n.embedding.length} dims]` : '❌ null'}`);
    console.log(`  notes array: ${n.notes ? `✅ [${n.notes.length} notes]` : '❌ empty or null'}`);
  }

  // Check Person nodes
  console.log('\n\n📦 NODES (Person):');
  console.log('='.repeat(80));

  const personQuery = `
    MATCH (p:Person)
    RETURN
      p.name as name,
      p.canonical_name as canonical_name,
      p.situation as situation,
      p.history as history,
      p.notes as notes
    LIMIT 2
  `;

  const personResults = await neo4jService.executeQuery<{
    name: string;
    canonical_name: string;
    situation: string | null;
    history: string | null;
    notes: unknown[] | null;
  }>(personQuery);

  for (let i = 0; i < personResults.length; i++) {
    const p = personResults[i];
    console.log(`\nPerson ${i + 1}: ${p.name} (${p.canonical_name})`);
    console.log(`  situation: ${p.situation ? `"${p.situation.substring(0, 60)}..."` : '❌ null'}`);
    console.log(`  history: ${p.history ? `"${p.history.substring(0, 60)}..."` : '❌ null'}`);
    console.log(`  notes array: ${p.notes ? `✅ [${p.notes.length} notes]` : '❌ empty or null'}`);
  }

  await neo4jService.close();
}

checkEmbeddingsAndNotes().catch(console.error);
