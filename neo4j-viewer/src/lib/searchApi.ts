import type {
  GraphNode,
  GraphLink,
  NodeType,
  PersonDetails,
  ProjectDetails,
  TopicDetails,
  IdeaDetails,
} from '../components/graph/types';
import type {
  VectorSearchResult,
  RAGFilteredEntity,
  GraphRetrievalResult,
  PipelineProgress,
  SearchResult,
} from '../types/search';

// Mock data generators
const mockEntityNames: Record<string, string[]> = {
  Person: ['Sarah Johnson', 'Mike Chen', 'Alex Rivera', 'Emily Watson', 'David Kim'],
  Project: ['AI Research Platform', 'Mobile App Redesign', 'Data Pipeline v2', 'Customer Analytics'],
  Topic: ['Machine Learning', 'Product Design', 'Data Engineering', 'User Research'],
  Idea: ['Automated Onboarding', 'Real-time Collaboration', 'AI-Powered Search', 'Smart Notifications'],
};

function generateMockVectorResults(query: string): VectorSearchResult[] {
  const results: VectorSearchResult[] = [];
  const types = ['Person', 'Project', 'Topic', 'Idea'] as const;

  // Generate 8-12 vector search results
  const count = Math.floor(Math.random() * 5) + 8;

  for (let i = 0; i < count; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    const names = mockEntityNames[type];
    const name = names[Math.floor(Math.random() * names.length)];

    results.push({
      entity_id: `${type.toLowerCase()}_${Math.random().toString(36).substr(2, 9)}`,
      entity_type: type,
      entity_name: name,
      similarity_score: 0.95 - (i * 0.05) - (Math.random() * 0.05),
      excerpt: `...mentioned ${name} in the context of ${query}...`,
    });
  }

  return results.sort((a, b) => b.similarity_score - a.similarity_score);
}

function generateMockRAGFiltering(vectorResults: VectorSearchResult[]): RAGFilteredEntity[] {
  // RAG filters down to top 4-6 most relevant entities
  const count = Math.floor(Math.random() * 3) + 4;
  const filtered = vectorResults.slice(0, count);

  const reasonings = [
    'Directly related to query topic with high semantic similarity',
    'Mentioned in multiple relevant contexts',
    'Key entity with strong connections to other relevant nodes',
    'Recent activity and high importance score',
    'Central to the user\'s knowledge graph for this domain',
  ];

  return filtered.map((result, i) => ({
    entity_id: result.entity_id,
    entity_type: result.entity_type,
    entity_name: result.entity_name,
    relevance_score: 0.9 - (i * 0.1),
    reasoning: reasonings[i % reasonings.length],
  }));
}

function generateMockGraphRetrieval(ragEntities: RAGFilteredEntity[]): GraphRetrievalResult {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const centralNodeIds = ragEntities.map(e => e.entity_id);

  // Create nodes for filtered entities
  ragEntities.forEach((entity) => {
    const node: GraphNode = {
      id: entity.entity_id,
      type: entity.entity_type as NodeType,
      name: entity.entity_name,
      details: generateMockDetails(entity.entity_type as NodeType, entity.entity_name),
    };
    nodes.push(node);
  });

  // Add connected nodes (1-3 per central node)
  ragEntities.forEach((entity, idx) => {
    const connectedCount = Math.floor(Math.random() * 3) + 1;

    for (let i = 0; i < connectedCount; i++) {
      const connectedType = ['Person', 'Project', 'Topic'][Math.floor(Math.random() * 3)] as NodeType;
      const names = mockEntityNames[connectedType];
      const connectedId = `${connectedType.toLowerCase()}_connected_${idx}_${i}`;

      // Add connected node
      nodes.push({
        id: connectedId,
        type: connectedType,
        name: names[Math.floor(Math.random() * names.length)],
        details: generateMockDetails(connectedType, names[0]),
      });

      // Add link
      links.push({
        source: entity.entity_id,
        target: connectedId,
        label: generateRelationType(entity.entity_type as NodeType, connectedType),
        properties: {},
      });
    }
  });

  // Add some links between central nodes
  for (let i = 0; i < ragEntities.length - 1; i++) {
    if (Math.random() > 0.5) {
      links.push({
        source: ragEntities[i].entity_id,
        target: ragEntities[i + 1].entity_id,
        label: 'RELATED_TO',
        properties: {},
      });
    }
  }

  return {
    nodes,
    links,
    central_node_ids: centralNodeIds,
  };
}

function generateMockDetails(
  type: NodeType,
  name: string
): PersonDetails | ProjectDetails | TopicDetails | IdeaDetails | undefined {
  const now = new Date().toISOString();

  switch (type) {
    case 'Person': {
      const personDetails: PersonDetails = {
        relationship_type: 'colleague',
        last_mentioned_at: now,
        first_mentioned_at: now,
        confidence: 0.85,
        how_they_met: 'Through work collaboration',
        why_they_matter: `${name} is a colleague working on related projects.`,
        relationship_status: 'stable',
      };
      return personDetails;
    }
    case 'Project': {
      const projectDetails: ProjectDetails = {
        status: 'active' as const,
        domain: 'technical',
        vision: `Building ${name} to solve key challenges.`,
        confidence_level: 0.8,
        excitement_level: 0.9,
        first_mentioned_at: now,
        last_mentioned_at: now,
        confidence: 0.85,
      };
      return projectDetails;
    }
    case 'Topic': {
      const topicDetails: TopicDetails = {
        description: `Discussion about ${name} and its applications.`,
        category: 'technical',
        first_mentioned_at: now,
        last_mentioned_at: now,
        confidence: 0.85,
      };
      return topicDetails;
    }
    case 'Idea': {
      const ideaDetails: IdeaDetails = {
        summary: `Exploring ${name} as a potential solution.`,
        status: 'refined' as const,
        confidence_level: 0.75,
        excitement_level: 0.85,
        created_at: now,
        updated_at: now,
        confidence: 0.8,
      };
      return ideaDetails;
    }
    default:
      // Return undefined for other node types (User, Conversation, Note, Artifact)
      return undefined;
  }
}

function generateRelationType(sourceType: NodeType, targetType: NodeType): string {
  const relations: Record<string, string> = {
    'Person-Project': 'INVOLVED_IN',
    'Person-Topic': 'INTERESTED_IN',
    'Project-Topic': 'RELATED_TO',
    'Project-Idea': 'INSPIRED',
    'Idea-Topic': 'RELATED_TO',
  };

  const key = `${sourceType}-${targetType}`;
  const relationType = relations[key];

  // Default to RELATED_TO for any unspecified relationship combinations
  if (!relationType) {
    return 'RELATED_TO';
  }

  return relationType;
}

// Simulated pipeline execution with progress updates
export async function executeSearchPipeline(
  query: string,
  _userId: string,
  onProgress: (progress: PipelineProgress) => void
): Promise<SearchResult> {
  const startTime = Date.now();

  // Stage 1: Vector Search (500-800ms)
  onProgress({
    stage: 'vector_search',
    progress: 0,
    message: 'Performing vector search across knowledge graph...',
  });

  await delay(300);
  onProgress({
    stage: 'vector_search',
    progress: 50,
    message: 'Analyzing semantic similarity...',
  });

  await delay(300);
  const vectorResults = generateMockVectorResults(query);
  onProgress({
    stage: 'vector_search',
    progress: 100,
    message: `Found ${vectorResults.length} potentially relevant entities`,
    data: vectorResults,
  });

  await delay(200);

  // Stage 2: RAG Filtering (400-600ms)
  onProgress({
    stage: 'rag_filtering',
    progress: 0,
    message: 'Applying RAG filtering to narrow results...',
  });

  await delay(250);
  onProgress({
    stage: 'rag_filtering',
    progress: 50,
    message: 'Analyzing relevance and connections...',
  });

  await delay(250);
  const ragFiltered = generateMockRAGFiltering(vectorResults);
  onProgress({
    stage: 'rag_filtering',
    progress: 100,
    message: `Filtered to ${ragFiltered.length} most relevant entities`,
    data: ragFiltered,
  });

  await delay(200);

  // Stage 3: Graph Retrieval (300-500ms)
  onProgress({
    stage: 'graph_retrieval',
    progress: 0,
    message: 'Retrieving nodes and relationships from graph...',
  });

  await delay(200);
  onProgress({
    stage: 'graph_retrieval',
    progress: 50,
    message: 'Expanding connected nodes...',
  });

  await delay(200);
  const graphResult = generateMockGraphRetrieval(ragFiltered);
  onProgress({
    stage: 'graph_retrieval',
    progress: 100,
    message: `Retrieved ${graphResult.nodes.length} nodes and ${graphResult.links.length} relationships`,
    data: graphResult,
  });

  await delay(100);

  // Complete
  onProgress({
    stage: 'complete',
    progress: 100,
    message: 'Search complete!',
    data: graphResult,
  });

  const totalTime = Date.now() - startTime;

  return {
    query,
    pipeline_stages: {
      vector_search: vectorResults,
      rag_filtering: ragFiltered,
      graph_retrieval: graphResult,
    },
    total_execution_time_ms: totalTime,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
