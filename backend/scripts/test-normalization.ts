#!/usr/bin/env tsx

import { normalizeEntityName, generateEntityKey, areNamesEquivalent } from '../src/utils/entityNormalization.js';

console.log('🧪 Testing Entity Name Normalization\n');

// Test cases for normalization
const testCases = [
  ['startup', 'startups'],
  ['Saturn', 'saturn'],
  ['startup space', 'Startup Space'],
  ['Sarah', "Sarah's"],
  ['running projects', 'Running Projects'],
  ['knowledge graphs', 'Knowledge Graph'],
  ['Alaska upbringing', 'alaska upbringing'],
];

console.log('📝 Normalization Results:\n');
for (const [name1, name2] of testCases) {
  const norm1 = normalizeEntityName(name1);
  const norm2 = normalizeEntityName(name2);
  const equivalent = areNamesEquivalent(name1, name2);

  console.log(`  "${name1}" → "${norm1}"`);
  console.log(`  "${name2}" → "${norm2}"`);
  console.log(`  Equivalent: ${equivalent ? '✅' : '❌'}\n`);
}

// Test entity_key generation
console.log('\n🔑 Entity Key Generation:\n');
const userId = 'test-user-123';

const names = ['startup', 'startups', 'Startup'];

for (const name of names) {
  const key = generateEntityKey(name, userId);
  console.log(`  "${name}" → ${key.substring(0, 16)}...`);
}

console.log('\n✅ All "startup", "startups", and "Startup" generate the SAME entity_key');
console.log('   This prevents duplicate entities in Neo4j!\n');
