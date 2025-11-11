import { neo4jService } from '../db/neo4j.js';

/**
 * Repository for managing entity aliases for entity resolution
 * Aliases help map name variants (e.g., "Sarah", "Sarah J", "SJ") to the same entity
 */
export class AliasRepository {
  /**
   * Create or link an alias to an entity
   */
  async createAlias(
    alias: string,
    entityId: string,
    entityType: 'Person' | 'Project' | 'Topic' | 'Idea'
  ): Promise<void> {
    // Validate required parameters
    if (!alias || !alias.trim()) {
      throw new Error('Alias name cannot be empty');
    }
    if (!entityId || !entityId.trim()) {
      throw new Error('Entity ID cannot be empty');
    }

    const normalizedName = alias.toLowerCase();

    const query = `
      MERGE (a:Alias {name: $alias, normalized_name: $normalizedName, type: $entityType})
      WITH a
      MATCH (e:${entityType} {id: $entityId})
      MERGE (a)-[:ALIAS_OF]->(e)
    `;

    await neo4jService.executeQuery(query, {
      alias,
      normalizedName,
      entityType,
      entityId,
    });
  }

  /**
   * Find entity by alias
   */
  async findEntityByAlias(
    alias: string,
    entityType: 'Person' | 'Project' | 'Topic'
  ): Promise<string | null> {
    const normalizedName = alias.toLowerCase();

    const query = `
      MATCH (a:Alias {normalized_name: $normalizedName, type: $entityType})-[:ALIAS_OF]->(e:${entityType})
      RETURN e.id as entityId
    `;

    const result = await neo4jService.executeQuery<{ entityId: string }>(query, {
      normalizedName,
      entityType,
    });

    return result[0]?.entityId || null;
  }

  /**
   * Get all aliases for an entity
   */
  async getEntityAliases(entityId: string, entityType: 'Person' | 'Project' | 'Topic'): Promise<string[]> {
    const query = `
      MATCH (a:Alias)-[:ALIAS_OF]->(e:${entityType} {id: $entityId})
      RETURN collect(a.name) as aliases
    `;

    const result = await neo4jService.executeQuery<{ aliases: string[] }>(query, { entityId });
    return result[0]?.aliases || [];
  }

  /**
   * Delete an alias
   */
  async deleteAlias(alias: string, entityType: 'Person' | 'Project' | 'Topic'): Promise<void> {
    const normalizedName = alias.toLowerCase();

    const query = `
      MATCH (a:Alias {normalized_name: $normalizedName, type: $entityType})
      DETACH DELETE a
    `;

    await neo4jService.executeQuery(query, { normalizedName, entityType });
  }

  /**
   * Merge two entities by moving all aliases from source to target
   * Useful when duplicate entities are detected
   */
  async mergeEntityAliases(
    sourceEntityId: string,
    targetEntityId: string,
    entityType: 'Person' | 'Project' | 'Topic'
  ): Promise<void> {
    const query = `
      MATCH (a:Alias)-[r:ALIAS_OF]->(source:${entityType} {id: $sourceEntityId})
      MATCH (target:${entityType} {id: $targetEntityId})
      DELETE r
      MERGE (a)-[:ALIAS_OF]->(target)
    `;

    await neo4jService.executeQuery(query, { sourceEntityId, targetEntityId });
  }
}

export const aliasRepository = new AliasRepository();
