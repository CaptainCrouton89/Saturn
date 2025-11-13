import { MockNode, MockRelationship } from './types.js';

/**
 * Mock Neo4j database for testing ingestion pipeline without actual database
 */
export class MockNeo4j {
  nodes: MockNode[] = [];
  relationships: MockRelationship[] = [];

  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  createPerson(args: Record<string, unknown>) {
    const entityKey = `person_${args.canonical_name}_${this.userId}`;
    this.nodes.push({
      entity_key: entityKey,
      type: 'Person',
      properties: { ...args, entity_key: entityKey },
    });
    return { success: true, entity_key: entityKey };
  }

  updatePerson(args: Record<string, unknown>) {
    const node = this.nodes.find((n) => n.entity_key === args.entity_key);
    if (node) {
      node.properties = { ...node.properties, ...args };
    }
    return { success: true };
  }

  createConcept(args: Record<string, unknown>) {
    const entityKey = `concept_${args.name}_${this.userId}`;
    this.nodes.push({
      entity_key: entityKey,
      type: 'Concept',
      properties: { ...args, entity_key: entityKey },
    });
    return { success: true, entity_key: entityKey };
  }

  updateConcept(args: Record<string, unknown>) {
    const node = this.nodes.find((n) => n.entity_key === args.entity_key);
    if (node) {
      node.properties = { ...node.properties, ...args };
    }
    return { success: true };
  }

  createEntity(args: Record<string, unknown>) {
    const entityKey = `entity_${args.name}_${this.userId}`;
    this.nodes.push({
      entity_key: entityKey,
      type: 'Entity',
      properties: { ...args, entity_key: entityKey },
    });
    return { success: true, entity_key: entityKey };
  }

  updateEntity(args: Record<string, unknown>) {
    const node = this.nodes.find((n) => n.entity_key === args.entity_key);
    if (node) {
      node.properties = { ...node.properties, ...args };
    }
    return { success: true };
  }

  createEpisode(args: Record<string, unknown>) {
    const episodeId = args.episode_id as string;
    const entityKey = `episode_${episodeId}_${this.userId}`;
    this.nodes.push({
      entity_key: entityKey,
      type: 'Episode',
      properties: {
        ...args,
        entity_key: entityKey,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    return { success: true, entity_key: entityKey };
  }

  updateEpisode(args: Record<string, unknown>) {
    const node = this.nodes.find((n) => n.entity_key === args.entity_key);
    if (node) {
      node.properties = {
        ...node.properties,
        ...args,
        updated_at: new Date().toISOString(),
      };
    }
    return { success: true };
  }

  createSource(args: Record<string, unknown>) {
    const entityKey = args.entity_key as string;
    this.nodes.push({
      entity_key: entityKey,
      type: 'Source',
      properties: {
        ...args,
        entity_key: entityKey,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    return { success: true, entity_key: entityKey };
  }

  createRelationship(args: Record<string, unknown>) {
    const props = (args.properties as Record<string, unknown>) || {};

    // Auto-set frequency to 1 for new relationships
    if ('frequency' in props || args.relationship_type === 'thinks_about') {
      props.frequency = 1;
    }

    this.relationships.push({
      from_entity_key: args.from_entity_key as string,
      to_entity_key: args.to_entity_key as string,
      type: args.relationship_type as string,
      properties: props,
    });
    return { success: true };
  }

  updateRelationship(args: Record<string, unknown>) {
    const rel = this.relationships.find(
      (r) =>
        r.from_entity_key === args.from_entity_key &&
        r.to_entity_key === args.to_entity_key &&
        r.type === args.relationship_type
    );
    if (rel) {
      const newProps = (args.properties as Record<string, unknown>) || {};

      // Auto-increment frequency if relationship already exists
      if ('frequency' in rel.properties || args.relationship_type === 'thinks_about') {
        const currentFrequency = (rel.properties.frequency as number) || 1;
        newProps.frequency = currentFrequency + 1;
      }

      rel.properties = { ...rel.properties, ...newProps };
    }
    return { success: true };
  }
}
