import neo4j, { Driver } from 'neo4j-driver';

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
      console.log('✅ Neo4j connection established');
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
      console.log('✅ Neo4j connection closed');
      this.driver = null;
    }
  }

  /**
   * Execute a Cypher query (convenience method)
   */
  async executeQuery<T = unknown>(
    cypher: string,
    params: Record<string, unknown> = {}
  ): Promise<T[]> {
    const driver = this.getDriver();
    const session = driver.session();

    try {
      const result = await session.run(cypher, params);
      return result.records.map((record) => record.toObject() as T);
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
