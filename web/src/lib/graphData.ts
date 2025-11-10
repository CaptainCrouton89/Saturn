import { GraphData, GraphNode, GraphLink } from '@/components/graph/types';

export function generateMockGraphData(): GraphData {
  const nodes: GraphNode[] = [
    // User (central node)
    {
      id: 'user-1',
      name: 'You',
      type: 'User',
      val: 20, // Larger size for user node
    },

    // People
    {
      id: 'person-1',
      name: 'Sarah',
      type: 'Person',
      val: 12,
      details: {
        relationship_type: 'friend',
        personality_traits: ['thoughtful', 'ambitious', 'creative'],
        current_life_situation: 'Just started new job at tech startup',
        last_mentioned_at: '2025-11-05',
      },
    },
    {
      id: 'person-2',
      name: 'Tom',
      type: 'Person',
      val: 10,
      details: {
        relationship_type: 'colleague',
        personality_traits: ['analytical', 'detail-oriented', 'reserved'],
        current_life_situation: 'Working on promotion timeline',
        last_mentioned_at: '2025-11-08',
      },
    },
    {
      id: 'person-3',
      name: 'Alex',
      type: 'Person',
      val: 9,
      details: {
        relationship_type: 'family',
        personality_traits: ['supportive', 'practical', 'caring'],
        current_life_situation: 'Recently moved to Seattle',
        last_mentioned_at: '2025-11-03',
      },
    },

    // Projects
    {
      id: 'project-1',
      name: 'Side Startup',
      type: 'Project',
      val: 15,
      details: {
        status: 'active',
        vision: 'Build tools for better thinking',
        blockers: ['Finding product-market fit', 'Time management', 'Technical infrastructure'],
        confidence_level: 0.7,
        excitement_level: 0.9,
      },
    },
    {
      id: 'project-2',
      name: 'Career Transition',
      type: 'Project',
      val: 13,
      details: {
        status: 'active',
        vision: 'Move from stable job to meaningful work',
        blockers: ['Financial runway', 'Risk tolerance', 'Market timing'],
        confidence_level: 0.5,
        excitement_level: 0.8,
      },
    },
    {
      id: 'project-3',
      name: 'Writing Project',
      type: 'Project',
      val: 8,
      details: {
        status: 'paused',
        vision: 'Document insights about AI and cognition',
        blockers: ['Finding time', 'Clarifying audience'],
        confidence_level: 0.6,
        excitement_level: 0.65,
      },
    },

    // Topics
    {
      id: 'topic-1',
      name: 'Work-Life Balance',
      type: 'Topic',
      val: 8,
      details: {
        description: 'Discussions about balancing career ambitions with personal life',
        category: 'personal',
        last_mentioned_at: '2025-11-07',
      },
    },
    {
      id: 'topic-2',
      name: 'AI & Technology',
      type: 'Topic',
      val: 9,
      details: {
        description: 'Conversations about AI impact on work and society',
        category: 'technical',
        last_mentioned_at: '2025-11-06',
      },
    },
    {
      id: 'topic-3',
      name: 'Personal Growth',
      type: 'Topic',
      val: 7,
      details: {
        description: 'Self-improvement, learning, and development',
        category: 'personal',
        last_mentioned_at: '2025-11-04',
      },
    },

    // Ideas
    {
      id: 'idea-1',
      name: 'Voice-first AI companion',
      type: 'Idea',
      val: 11,
      details: {
        summary: 'AI that asks questions instead of waiting to be asked',
        status: 'refined',
        confidence_level: 0.8,
        excitement_level: 0.95,
        next_steps: ['Build MVP', 'Test with users', 'Refine conversation flow'],
      },
    },
    {
      id: 'idea-2',
      name: 'Knowledge graph visualization',
      type: 'Idea',
      val: 9,
      details: {
        summary: 'Interactive way to explore personal knowledge and connections',
        status: 'raw',
        confidence_level: 0.6,
        excitement_level: 0.75,
        next_steps: ['Research visualization libraries', 'Design interaction patterns'],
      },
    },

    // Conversations
    {
      id: 'conv-1',
      name: 'Morning Reflection',
      type: 'Conversation',
      val: 6,
      details: {
        summary: 'Discussed career anxieties and relationship with Tom at work',
        date: '2025-11-08',
        duration: 15,
        topic_tags: ['work', 'relationships', 'career'],
      },
    },
    {
      id: 'conv-2',
      name: 'Evening Brainstorm',
      type: 'Conversation',
      val: 6,
      details: {
        summary: 'Explored ideas for the side startup, breakthrough on positioning',
        date: '2025-11-06',
        duration: 22,
        topic_tags: ['startup', 'ideas', 'strategy'],
      },
    },
    {
      id: 'conv-3',
      name: 'Weekend Planning',
      type: 'Conversation',
      val: 5,
      details: {
        summary: 'Talked through personal growth goals and upcoming challenges',
        date: '2025-11-02',
        duration: 18,
        topic_tags: ['growth', 'planning', 'reflection'],
      },
    },
  ];

  const links: GraphLink[] = [
    // User relationships
    { source: 'user-1', target: 'person-1', label: 'KNOWS' },
    { source: 'user-1', target: 'person-2', label: 'KNOWS' },
    { source: 'user-1', target: 'person-3', label: 'KNOWS' },
    { source: 'user-1', target: 'project-1', label: 'WORKING_ON' },
    { source: 'user-1', target: 'project-2', label: 'WORKING_ON' },
    { source: 'user-1', target: 'project-3', label: 'WORKING_ON' },
    { source: 'user-1', target: 'topic-1', label: 'INTERESTED_IN' },
    { source: 'user-1', target: 'topic-2', label: 'INTERESTED_IN' },
    { source: 'user-1', target: 'topic-3', label: 'INTERESTED_IN' },
    { source: 'user-1', target: 'conv-1', label: 'HAD_CONVERSATION' },
    { source: 'user-1', target: 'conv-2', label: 'HAD_CONVERSATION' },
    { source: 'user-1', target: 'conv-3', label: 'HAD_CONVERSATION' },

    // Cross-entity relationships
    { source: 'person-2', target: 'conv-1', label: 'MENTIONED' },
    { source: 'topic-1', target: 'conv-1', label: 'DISCUSSED' },
    { source: 'project-2', target: 'conv-1', label: 'DISCUSSED' },

    { source: 'person-1', target: 'project-1', label: 'INVOLVED_IN' },
    { source: 'idea-1', target: 'project-1', label: 'RELATED_TO' },
    { source: 'idea-1', target: 'conv-2', label: 'EXPLORED' },
    { source: 'topic-2', target: 'conv-2', label: 'DISCUSSED' },
    { source: 'project-1', target: 'topic-2', label: 'RELATED_TO' },

    { source: 'topic-3', target: 'conv-3', label: 'DISCUSSED' },
    { source: 'person-3', target: 'conv-3', label: 'MENTIONED' },

    { source: 'idea-2', target: 'topic-2', label: 'RELATED_TO' },
    { source: 'idea-2', target: 'project-1', label: 'RELATED_TO' },
    { source: 'project-3', target: 'topic-3', label: 'RELATED_TO' },
    { source: 'person-1', target: 'topic-1', label: 'ASSOCIATED_WITH' },
  ];

  return { nodes, links };
}
