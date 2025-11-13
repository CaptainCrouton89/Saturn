import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { sourceRepository } from '../../src/repositories/SourceRepository.js';
import { personRepository } from '../../src/repositories/PersonRepository.js';
import { conceptRepository } from '../../src/repositories/ConceptRepository.js';
import { entityRepository } from '../../src/repositories/EntityRepository.js';
import { PipelineState, PipelineConfig, ExtractedEntity } from './types.js';

/**
 * Phase 2: Create Source Node and Link to Mentioned Entities
 *
 * Creates Source node in Neo4j with full schema:
 * - Raw content, processed content, summary, keywords, tags
 * - Processing status set to 'extracted' (Phase 0 and Phase 1 completed)
 * - Creates (Source)-[:mentions]->(Person|Concept|Entity) relationships
 * - Updates hierarchical memory counters on mentioned nodes
 *
 * This phase uses real Neo4j via SourceRepository.
 */
export async function runPhase2(
  state: PipelineState,
  config: PipelineConfig
): Promise<string> {
  console.log(`\n${'='.repeat(80)}`);
  console.log('PHASE 2: Create Source Node and Link to Entities');
  console.log('='.repeat(80));
  console.log('📦 Creating Source node in Neo4j\n');

  // Create Source node with full schema
  const source = await sourceRepository.create({
    user_id: state.userId,
    description: state.summary,
    source_type: state.sourceType,
    summary: state.summary,
    content: {
      type: state.sourceType,
      content: state.transcript,
    },
    keywords: [],
    tags: [],
    processing_status: 'extracted',
  });

  const sourceEntityKey = source.entity_key;
  console.log(`✅ Created Source node: ${sourceEntityKey}`);
  console.log(`   - User ID: ${state.userId}`);
  console.log(`   - Type: ${state.sourceType}`);
  console.log(`   - Summary: ${state.summary.substring(0, 80)}...`);

  // Link Source to mentioned entities via (Source)-[:mentions]->(Node) relationships
  if (state.entities.length > 0) {
    console.log(`\n📎 Creating entity nodes and linking to Source...\n`);

    const entityLinks: { type: 'Person' | 'Concept' | 'Entity'; entity_key: string }[] = [];

    for (const entity of state.entities) {
      const normalizedName = entity.name.toLowerCase().trim();
      const confidence = entity.confidence / 10; // Convert 1-10 scale to 0-1

      let entityKey: string;

      // Create entity node based on type
      if (entity.entity_type === 'Person') {
        // Use PersonRepository.upsert to create/update Person node
        const person = await personRepository.upsert({
          canonical_name: normalizedName,
          name: entity.name,
          user_id: state.userId,
          confidence,
          last_update_source: state.conversationId,
          notes: entity.subpoints.join('\n'),
        });
        entityKey = person.entity_key;
        console.log(`  ✅ Person: ${entity.name} → ${entityKey}`);
      } else if (entity.entity_type === 'Concept') {
        // Use ConceptRepository.create to create Concept node
        const result = await conceptRepository.create(
          {
            name: entity.name,
            user_id: state.userId,
            description: entity.subpoints[0] || entity.name,
            notes: entity.subpoints.slice(1).join('\n'),
          },
          {
            last_update_source: state.conversationId,
            confidence,
          }
        );
        entityKey = result.entity_key;
        console.log(`  ✅ Concept: ${entity.name} → ${entityKey}`);
      } else {
        // Entity type - use EntityRepository.upsert
        const result = await entityRepository.upsert({
          name: entity.name,
          type: 'other', // Generic type for now
          user_id: state.userId,
          description: entity.subpoints[0] || entity.name,
          notes: entity.subpoints.slice(1).join('\n'),
          last_update_source: state.conversationId,
          confidence,
        });
        entityKey = result.entity_key;
        console.log(`  ✅ Entity: ${entity.name} → ${entityKey}`);
      }

      entityLinks.push({
        type: entity.entity_type,
        entity_key: entityKey,
      });
    }

    // Create mentions relationships in batch
    await sourceRepository.linkToEntities(sourceEntityKey, entityLinks);
    console.log(`\n✅ Created ${entityLinks.length} entity nodes and mentions relationships`);
  } else {
    console.log('\n⚠️  No entities extracted - skipping entity creation and mentions relationships');
  }

  // Save output for Phase 3
  const outputData = {
    source: {
      entity_key: sourceEntityKey,
      user_id: state.userId,
      description: state.summary,
      content: { type: state.sourceType, content: state.transcript },
      created_at: new Date().toISOString(),
    },
    mentioned_entities: state.entities.map((e) => ({
      name: e.name,
      entity_type: e.entity_type,
      confidence: e.confidence,
      subpoints: e.subpoints,
    })),
  };

  const outputPath = path.join(config.outputDir, 'pipeline-phase2-source.json');
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`\n💾 Saved to: ${outputPath}\n`);

  return sourceEntityKey;
}
