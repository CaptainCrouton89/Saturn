#!/usr/bin/env tsx

import { config } from 'dotenv';
import { isDeepStrictEqual } from 'node:util';
import neo4j, { type ManagedTransaction, type Record as Neo4jRecord } from 'neo4j-driver';
import { CANONICAL_RELATIONSHIP_DIRECTIONS } from '../src/agents/tools/factories/edge.factory.js';
import { neo4jService } from '../src/db/neo4j.js';

config();

const semanticRelationshipTypes = [
  ...Object.keys(CANONICAL_RELATIONSHIP_DIRECTIONS),
  'mentions',
];

type DeduplicationSummary = {
  ownersDemoted: number;
  ownerKeysCleared: number;
  eventMentionsRewired: number;
  eventSemanticEdgesRewired: number;
  eventsRemoved: number;
  relationshipsRemoved: number;
  ownerDuplicateGroups: number;
  eventDuplicateGroups: number;
  relationshipDuplicateGroups: number;
};

type EventEdgeConflict = {
  eventKey: string;
  relationshipType: string;
  otherEndpointKey: string;
  canonicalProperties: Record<string, unknown>;
  duplicateProperties: Record<string, unknown>;
};

function stringValue(record: Neo4jRecord, field: string): string {
  const value = record.get(field);
  if (typeof value !== 'string') {
    throw new Error(`Deduplication conflict query returned a non-string ${field}`);
  }
  return value;
}

function propertyMap(record: Neo4jRecord, field: string): Record<string, unknown> {
  const value = record.get(field);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Deduplication conflict query returned invalid ${field}`);
  }
  return Object.fromEntries(Object.entries(value));
}

function assertionProperties(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => key !== 'created_at' && key !== 'updated_at')
  );
}

function eventEdgeConflict(record: Neo4jRecord): EventEdgeConflict {
  return {
    eventKey: stringValue(record, 'event_key'),
    relationshipType: stringValue(record, 'relationship_type'),
    otherEndpointKey: stringValue(record, 'other_endpoint_key'),
    canonicalProperties: propertyMap(record, 'canonical_properties'),
    duplicateProperties: propertyMap(record, 'duplicate_properties'),
  };
}

async function findConflictingEventEdges(transaction: ManagedTransaction): Promise<EventEdgeConflict[]> {
  const outgoingResult = await transaction.run(`
    MATCH (e:Event)
    WITH e
    ORDER BY e.created_at ASC, e.entity_key ASC
    WITH e.entity_key AS event_key, collect(e) AS events
    WHERE size(events) > 1
    UNWIND events AS first_event
    UNWIND events AS second_event
    WITH event_key, first_event, second_event
    WHERE elementId(first_event) < elementId(second_event)
    MATCH (first_event)-[first_relationship]->(target)
    WHERE type(first_relationship) IN ['relates_to', 'involves', 'connected_to']
    MATCH (second_event)-[second_relationship]->(target)
    WHERE type(second_relationship) = type(first_relationship)
    RETURN event_key, type(first_relationship) AS relationship_type,
      target.entity_key AS other_endpoint_key,
      properties(first_relationship) AS canonical_properties,
      properties(second_relationship) AS duplicate_properties
  `);
  const mentionResult = await transaction.run(`
    MATCH (e:Event)
    WITH e
    ORDER BY e.created_at ASC, e.entity_key ASC
    WITH e.entity_key AS event_key, collect(e) AS events
    WHERE size(events) > 1
    UNWIND events AS first_event
    UNWIND events AS second_event
    WITH event_key, first_event, second_event
    WHERE elementId(first_event) < elementId(second_event)
    MATCH (source:Source)-[first_relationship:mentions]->(first_event)
    MATCH (source)-[second_relationship:mentions]->(second_event)
    RETURN event_key, 'mentions' AS relationship_type,
      source.entity_key AS other_endpoint_key,
      properties(first_relationship) AS canonical_properties,
      properties(second_relationship) AS duplicate_properties
  `);

  return [...outgoingResult.records, ...mentionResult.records]
    .map(eventEdgeConflict)
    .filter(({ canonicalProperties, duplicateProperties }) =>
      !isDeepStrictEqual(
        assertionProperties(canonicalProperties),
        assertionProperties(duplicateProperties)
      )
    );
}

async function countQuery(
  transaction: ManagedTransaction,
  query: string,
  parameters: Record<string, unknown> = {}
): Promise<number> {
  const result = await transaction.run(query, parameters);
  const count = result.records[0]?.get('count');

  if (!neo4j.isInt(count)) {
    throw new Error('Deduplication query returned no integer count');
  }

  return count.toNumber();
}

async function rewireEventRelationships(
  transaction: ManagedTransaction,
  relationshipType: 'relates_to' | 'involves' | 'connected_to'
): Promise<number> {
  return countQuery(transaction, `
    MATCH (e:Event)
    WITH e
    ORDER BY e.created_at ASC, e.entity_key ASC
    WITH e.entity_key AS event_key, collect(e) AS events
    WHERE size(events) > 1
    UNWIND events[1..] AS duplicate
    MATCH (duplicate)-[relationship:${relationshipType}]->(target)
    WITH duplicate, relationship, target, events[0] AS canonical_event
    MERGE (canonical_event)-[canonical_relationship:${relationshipType}]->(target)
    ON CREATE SET canonical_relationship = properties(relationship)
    RETURN count(relationship) AS count
  `);
}

async function deduplicate(transaction: ManagedTransaction): Promise<DeduplicationSummary> {
  const ownersDemoted = await countQuery(transaction, `
    MATCH (p:Person {is_owner: true})
    WITH p
    ORDER BY p.updated_at DESC, p.created_at DESC, p.entity_key ASC
    WITH p.user_id AS user_id, collect(p) AS owners
    WITH user_id, owners[0] AS canonical_owner, owners[1..] AS duplicate_owners
    SET canonical_owner.owner_key = user_id
    FOREACH (duplicate_owner IN duplicate_owners |
      SET duplicate_owner.is_owner = false,
          duplicate_owner.owner_key = null
    )
    RETURN coalesce(sum(size(duplicate_owners)), 0) AS count
  `);

  const ownerKeysCleared = await countQuery(transaction, `
    MATCH (p:Person)
    WHERE coalesce(p.is_owner, false) = false AND p.owner_key IS NOT NULL
    SET p.owner_key = null
    RETURN count(p) AS count
  `);

  const eventEdgeConflicts = await findConflictingEventEdges(transaction);
  if (eventEdgeConflicts.length > 0) {
    throw new Error(
      `Incompatible duplicate Event edge assertions; resolve before rerunning:\n${JSON.stringify(eventEdgeConflicts, null, 2)}`
    );
  }

  const eventMentionsRewired = await countQuery(transaction, `
    MATCH (e:Event)
    WITH e
    ORDER BY e.created_at ASC, e.entity_key ASC
    WITH e.entity_key AS event_key, collect(e) AS events
    WHERE size(events) > 1
    UNWIND events[1..] AS duplicate
    MATCH (source:Source)-[mention:mentions]->(duplicate)
    WITH source, mention, duplicate, events[0] AS canonical_event
    MERGE (source)-[canonical_mention:mentions]->(canonical_event)
    ON CREATE SET canonical_mention = properties(mention)
    RETURN count(mention) AS count
  `);

  const eventSemanticEdgesRewired =
    await rewireEventRelationships(transaction, 'relates_to') +
    await rewireEventRelationships(transaction, 'involves') +
    await rewireEventRelationships(transaction, 'connected_to');

  const eventsRemoved = await countQuery(transaction, `
    MATCH (e:Event)
    WITH e
    ORDER BY e.created_at ASC, e.entity_key ASC
    WITH e.entity_key AS event_key, collect(e) AS events
    WHERE size(events) > 1
    UNWIND events[1..] AS duplicate
    DETACH DELETE duplicate
    RETURN count(duplicate) AS count
  `);

  const relationshipsRemoved = await countQuery(transaction, `
    MATCH (from)-[relationship]->(to)
    WHERE type(relationship) IN $relationship_types
    WITH from, to, type(relationship) AS relationship_type, relationship
    ORDER BY relationship.created_at ASC, relationship.updated_at ASC, elementId(relationship) ASC
    WITH from, to, relationship_type, collect(relationship) AS relationships
    WHERE size(relationships) > 1
    UNWIND relationships[1..] AS duplicate
    DELETE duplicate
    RETURN count(duplicate) AS count
  `, { relationship_types: semanticRelationshipTypes });

  const ownerDuplicateGroups = await countQuery(transaction, `
    MATCH (p:Person {is_owner: true})
    WITH p.user_id AS user_id, count(p) AS owner_count
    WHERE owner_count > 1
    RETURN count(*) AS count
  `);
  const eventDuplicateGroups = await countQuery(transaction, `
    MATCH (e:Event)
    WITH e.entity_key AS entity_key, count(e) AS event_count
    WHERE event_count > 1
    RETURN count(*) AS count
  `);
  const relationshipDuplicateGroups = await countQuery(transaction, `
    MATCH (from)-[relationship]->(to)
    WHERE type(relationship) IN $relationship_types
    WITH from, to, type(relationship) AS relationship_type, count(relationship) AS relationship_count
    WHERE relationship_count > 1
    RETURN count(*) AS count
  `, { relationship_types: semanticRelationshipTypes });

  const summary = {
    ownersDemoted,
    ownerKeysCleared,
    eventMentionsRewired,
    eventSemanticEdgesRewired,
    eventsRemoved,
    relationshipsRemoved,
    ownerDuplicateGroups,
    eventDuplicateGroups,
    relationshipDuplicateGroups,
  };
  const remainingDuplicates =
    summary.ownerDuplicateGroups +
    summary.eventDuplicateGroups +
    summary.relationshipDuplicateGroups;

  if (remainingDuplicates !== 0) {
    throw new Error(`Deduplication incomplete: ${remainingDuplicates} duplicate groups remain`);
  }

  return summary;
}

async function main(): Promise<void> {
  await neo4jService.connect();

  try {
    const session = neo4jService.getDriver().session();
    let summary: DeduplicationSummary;

    try {
      summary = await session.executeWrite(deduplicate);
    } finally {
      await session.close();
    }

    console.log(`Owner nodes demoted: ${summary.ownersDemoted}`);
    console.log(`Non-owner owner_keys cleared: ${summary.ownerKeysCleared}`);
    console.log(`Event mentions rewired: ${summary.eventMentionsRewired}`);
    console.log(`Event semantic edges rewired: ${summary.eventSemanticEdgesRewired}`);
    console.log(`Duplicate Event nodes removed: ${summary.eventsRemoved}`);
    console.log(`Duplicate semantic relationships removed: ${summary.relationshipsRemoved}`);
    console.log(`Remaining owner duplicate groups: ${summary.ownerDuplicateGroups}`);
    console.log(`Remaining Event duplicate groups: ${summary.eventDuplicateGroups}`);
    console.log(`Remaining semantic relationship duplicate groups: ${summary.relationshipDuplicateGroups}`);
    console.log('Remaining duplicates: 0');
  } finally {
    await neo4jService.close();
  }
}

main().catch((error: unknown) => {
  console.error('Graph deduplication failed:', error);
  process.exitCode = 1;
});
