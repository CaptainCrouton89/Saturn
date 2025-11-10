import neo4j, { Driver, Integer } from 'neo4j-driver';

/**
 * Converts Neo4j-specific types to JavaScript primitives
 * Handles: Integer, Date, DateTime, LocalDateTime, Time, LocalTime, Duration, Point
 */
function serializeNeo4jValue(value: unknown): unknown {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return value;
  }

  // Handle Neo4j Integer (the main culprit)
  if (neo4j.isInt(value)) {
    return (value as Integer).toNumber();
  }

  // Handle Neo4j temporal types
  if (neo4j.isDate(value) || neo4j.isDateTime(value) || neo4j.isLocalDateTime(value)) {
    return (value as { toString: () => string }).toString();
  }

  if (neo4j.isTime(value) || neo4j.isLocalTime(value)) {
    return (value as { toString: () => string }).toString();
  }

  if (neo4j.isDuration(value)) {
    return (value as { toString: () => string }).toString();
  }

  // Handle Neo4j Point (spatial)
  if (neo4j.isPoint(value)) {
    const point = value as { x: number; y: number; z?: number; srid: Integer };
    return {
      x: point.x,
      y: point.y,
      z: point.z,
      srid: neo4j.isInt(point.srid) ? point.srid.toNumber() : point.srid,
    };
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(serializeNeo4jValue);
  }

  // Handle plain objects
  if (typeof value === 'object') {
    const serialized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      serialized[key] = serializeNeo4jValue(val);
    }
    return serialized;
  }

  // Return primitive values as-is
  return value;
}

class Neo4jService {
  private driver: Driver | null = null;

  /**
   * Initialize the Neo4j driver connection
   */
  async connect(): Promise<void> {
    const uri = process.env.NEO4J_URI;
    const username = process.env.NEO4J_USERNAME;
    const password = process.env.NEO4J_PASSWORD;

    if (!uri || !username || !password) {
      throw new Error(
        'Missing Neo4j credentials. Please set NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD environment variables.'
      );
    }

    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(username, password));

      // Verify connectivity
      await this.driver.verifyConnectivity();
    } catch (error) {
      console.error('❌ Neo4j connection failed:', error);
      throw error;
    }
  }

  /**
   * Get the Neo4j driver instance
   */
  getDriver(): Driver {
    if (!this.driver) {
      throw new Error('Neo4j driver not initialized. Call connect() first.');
    }
    return this.driver;
  }

  /**
   * Close the Neo4j driver connection
   */
  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
  }

  /**
   * Execute a Cypher query (convenience method)
   * Automatically serializes Neo4j-specific types to JavaScript primitives
   */
  async executeQuery<T = unknown>(
    cypher: string,
    params: Record<string, unknown> = {}
  ): Promise<T[]> {
    const driver = this.getDriver();
    const session = driver.session();

    try {
      const result = await session.run(cypher, params);
      const records = result.records.map((record) => record.toObject());

      // Serialize Neo4j types to JavaScript primitives
      return records.map((record) => serializeNeo4jValue(record) as T);
    } catch (error) {
      console.error('Neo4j query error:', error);
      throw error;
    } finally {
      await session.close();
    }
  }
}

// Export singleton instance
export const neo4jService = new Neo4jService();
