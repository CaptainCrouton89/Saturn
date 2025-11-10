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
        personality_traits: [
          'thoughtful',
          'ambitious',
          'creative',
          'empathetic',
          'risk-taker',
          'introspective',
          'optimistic',
          'independent',
        ],
        current_life_situation: 'Just started new job at tech startup, navigating leadership expectations',
        first_mentioned_at: '2024-08-12',
        last_mentioned_at: '2025-11-05',
        how_they_met: 'College roommates, reconnected at a tech conference in 2023',
        why_they_matter:
          'One of my closest confidants - helps me think through career decisions and personal growth',
        relationship_status: 'growing',
        communication_cadence: 'weekly video calls, daily text check-ins',
        confidence: 0.95,
        excerpt_span: 'turns 12-18',
      },
    },
    {
      id: 'person-2',
      name: 'Tom',
      type: 'Person',
      val: 10,
      details: {
        relationship_type: 'colleague',
        personality_traits: [
          'analytical',
          'detail-oriented',
          'reserved',
          'strategic',
          'perfectionist',
          'slow-to-trust',
        ],
        current_life_situation:
          'Working on promotion timeline, dealing with team conflicts, questioning career path',
        first_mentioned_at: '2024-11-20',
        last_mentioned_at: '2025-11-08',
        how_they_met: 'Joined same team 14 months ago, paired on critical project',
        why_they_matter:
          'Work ally who challenges my thinking - tension around communication styles but respect his judgment',
        relationship_status: 'complicated',
        communication_cadence: 'daily work messages, occasional lunches',
        confidence: 0.88,
        excerpt_span: '2:15-4:30',
      },
    },
    {
      id: 'person-3',
      name: 'Alex',
      type: 'Person',
      val: 9,
      details: {
        relationship_type: 'family',
        personality_traits: ['supportive', 'practical', 'caring', 'grounded', 'patient', 'perceptive'],
        current_life_situation:
          'Recently moved to Seattle for partner\'s job, adjusting to remote work and new city',
        first_mentioned_at: '2024-06-03',
        last_mentioned_at: '2025-11-03',
        how_they_met: 'Sibling - grew up together',
        why_they_matter:
          'Family anchor who keeps me grounded when I get too caught up in work stress',
        relationship_status: 'stable',
        communication_cadence: 'monthly calls, sporadic texts during life events',
        confidence: 0.98,
        excerpt_span: 'turns 3-7',
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
        domain: 'startup',
        vision: 'Build tools for better thinking - conversational AI that asks questions instead of waiting',
        blockers: [
          'Finding product-market fit',
          'Time management with full-time job',
          'Technical infrastructure decisions',
          'Funding strategy unclear',
          'User testing pipeline',
        ],
        key_decisions: [
          'Voice-first over text interface',
          'Mobile-native instead of web',
          'Graph database for memory',
          'Pre-revenue focus on product quality',
          'Solo founder path for now',
          'Target audience: knowledge workers 25-40',
        ],
        confidence_level: 0.7,
        excitement_level: 0.9,
        time_invested: '~15 hours/week for 6 months',
        money_invested: 3500,
        first_mentioned_at: '2024-05-10',
        last_mentioned_at: '2025-11-06',
        confidence: 0.92,
        excerpt_span: 'turns 8-25',
      },
    },
    {
      id: 'project-2',
      name: 'Career Transition',
      type: 'Project',
      val: 13,
      details: {
        status: 'active',
        domain: 'personal',
        vision:
          'Move from stable corporate job to meaningful work that aligns with personal values and creativity',
        blockers: [
          'Financial runway - need 12 months expenses',
          'Risk tolerance - wrestling with uncertainty',
          'Market timing - tech hiring freeze',
          'Partner expectations and family pressure',
          'Imposter syndrome about founding',
        ],
        key_decisions: [
          'Target transition date: Q2 2026',
          'Build side project to full product first',
          'Save $60k runway before quitting',
          'Therapy to work through risk aversion',
          'Keep transition private until committed',
        ],
        confidence_level: 0.5,
        excitement_level: 0.8,
        time_invested: 'Daily reflection for 8 months',
        money_invested: 0,
        first_mentioned_at: '2024-07-22',
        last_mentioned_at: '2025-11-08',
        confidence: 0.85,
        excerpt_span: '0:12-1:45',
      },
    },
    {
      id: 'project-3',
      name: 'Writing Project',
      type: 'Project',
      val: 8,
      details: {
        status: 'paused',
        domain: 'creative',
        vision: 'Document insights about AI and cognition - essays on tool-for-thought design',
        blockers: [
          'Finding time amid startup work',
          'Clarifying audience - too broad right now',
          'Impostor syndrome writing publicly',
        ],
        key_decisions: [
          'Target audience: product designers in AI',
          'Weekly publishing cadence',
          'Newsletter format over blog',
          'Draw from personal experiments',
        ],
        confidence_level: 0.6,
        excitement_level: 0.65,
        time_invested: '~2 hours/week for 3 months',
        money_invested: 0,
        first_mentioned_at: '2024-09-05',
        last_mentioned_at: '2025-10-28',
        confidence: 0.78,
        excerpt_span: 'turns 15-19',
      },
    },

    // Topics
    {
      id: 'topic-1',
      name: 'Work-Life Balance',
      type: 'Topic',
      val: 8,
      details: {
        description:
          'Discussions about balancing career ambitions with personal life, boundaries, burnout prevention, and sustainable work rhythms',
        category: 'personal',
        first_mentioned_at: '2024-06-15',
        last_mentioned_at: '2025-11-07',
        confidence: 0.91,
        excerpt_span: 'turns 22-28',
      },
    },
    {
      id: 'topic-2',
      name: 'AI & Technology',
      type: 'Topic',
      val: 9,
      details: {
        description:
          'Conversations about AI impact on work and society, tool-for-thought design, emergent capabilities, and human-AI collaboration patterns',
        category: 'technical',
        first_mentioned_at: '2024-05-03',
        last_mentioned_at: '2025-11-06',
        confidence: 0.96,
        excerpt_span: '1:12-2:45',
      },
    },
    {
      id: 'topic-3',
      name: 'Personal Growth',
      type: 'Topic',
      val: 7,
      details: {
        description:
          'Self-improvement, learning methodologies, identity evolution, and intentional behavior change',
        category: 'personal',
        first_mentioned_at: '2024-07-01',
        last_mentioned_at: '2025-11-04',
        confidence: 0.87,
        excerpt_span: 'turns 5-12',
      },
    },

    // Ideas
    {
      id: 'idea-1',
      name: 'Voice-first AI companion',
      type: 'Idea',
      val: 11,
      details: {
        summary:
          'AI that asks questions instead of waiting to be asked - conversational agent that turns passive time into active thinking',
        status: 'refined',
        confidence_level: 0.8,
        excitement_level: 0.95,
        next_steps: [
          'Build iOS MVP with streaming STT',
          'Test with 10 beta users',
          'Refine question generation logic',
          'Add graph-based memory',
          'Launch private beta',
        ],
        original_inspiration:
          'Frustration with ChatGPT waiting passively - realized people enjoy being asked questions',
        evolution_notes:
          'Started as text-based, pivoted to voice-first after noticing best convos happen while walking. Added graph database for contextual memory after realizing conversations felt repetitive.',
        obstacles: [
          'STT latency breaks conversational flow',
          'Users uncomfortable talking to phone in public',
          'Hard to monetize conversation product',
          'Competition from established AI assistants',
        ],
        resources_needed: [
          '$500/month API costs (OpenAI + AssemblyAI)',
          'iOS developer for UI polish',
          'Beta testers willing to talk daily',
          'Marketing budget for launch',
        ],
        experiments_tried: [
          'Text-only prototype - low engagement',
          'Voice with push-to-talk - felt transactional',
          'Continuous listening - privacy concerns',
          'Daily prompt notifications - felt spammy',
        ],
        potential_impact: 'Could change my career - become full-time founder if it gains traction',
        context_notes:
          'This idea has taken over my life. Every conversation validates the core insight. Sarah is my biggest supporter. Tom thinks it\'s too niche. Need to balance excitement with realistic assessment of market size.',
        created_at: '2024-05-10',
        refined_at: '2024-08-22',
        updated_at: '2025-11-06',
        confidence: 0.94,
        excerpt_span: 'turns 18-35',
      },
    },
    {
      id: 'idea-2',
      name: 'Knowledge graph visualization',
      type: 'Idea',
      val: 9,
      details: {
        summary:
          'Interactive way to explore personal knowledge and connections - see how people, projects, ideas relate over time',
        status: 'raw',
        confidence_level: 0.6,
        excitement_level: 0.75,
        next_steps: [
          'Research visualization libraries (D3, Force Graph)',
          'Design interaction patterns for graph navigation',
          'Prototype with mock data',
          'Test readability at different scales',
        ],
        original_inspiration:
          'Saw Roam Research graph view, thought "this should exist for my conversations with AI"',
        evolution_notes: 'Still very early - mostly concept sketches and library research',
        obstacles: [
          'Graph gets messy with lots of nodes',
          'Not clear what insights users would gain',
          'May be feature not product',
        ],
        resources_needed: [
          'Front-end developer with D3 experience',
          'UX research on graph navigation',
          'Neo4j expertise for efficient queries',
        ],
        experiments_tried: [
          'Paper sketches of different layouts',
          'Looked at Obsidian graph plugin',
        ],
        potential_impact: 'Fun side feature for main product - probably not standalone',
        context_notes:
          'This feels like a "nice to have" compared to core conversation functionality. Maybe revisit after MVP launch.',
        created_at: '2024-09-18',
        updated_at: '2025-11-02',
        confidence: 0.72,
        excerpt_span: 'turns 8-15',
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
    {
      source: 'user-1',
      target: 'person-1',
      label: 'KNOWS',
      properties: {
        relationship_quality: 0.92,
        last_mentioned_at: '2025-11-05',
      },
    },
    {
      source: 'user-1',
      target: 'person-2',
      label: 'KNOWS',
      properties: {
        relationship_quality: 0.73,
        last_mentioned_at: '2025-11-08',
      },
    },
    {
      source: 'user-1',
      target: 'person-3',
      label: 'KNOWS',
      properties: {
        relationship_quality: 0.88,
        last_mentioned_at: '2025-11-03',
      },
    },
    {
      source: 'user-1',
      target: 'project-1',
      label: 'WORKING_ON',
      properties: {
        status: 'active',
        priority: 1,
        last_discussed_at: '2025-11-06',
      },
    },
    {
      source: 'user-1',
      target: 'project-2',
      label: 'WORKING_ON',
      properties: {
        status: 'active',
        priority: 2,
        last_discussed_at: '2025-11-08',
      },
    },
    {
      source: 'user-1',
      target: 'project-3',
      label: 'WORKING_ON',
      properties: {
        status: 'paused',
        priority: 3,
        last_discussed_at: '2025-10-28',
      },
    },
    {
      source: 'user-1',
      target: 'topic-1',
      label: 'INTERESTED_IN',
      properties: {
        engagement_level: 0.82,
        last_discussed_at: '2025-11-07',
        frequency: 24,
      },
    },
    {
      source: 'user-1',
      target: 'topic-2',
      label: 'INTERESTED_IN',
      properties: {
        engagement_level: 0.95,
        last_discussed_at: '2025-11-06',
        frequency: 38,
      },
    },
    {
      source: 'user-1',
      target: 'topic-3',
      label: 'INTERESTED_IN',
      properties: {
        engagement_level: 0.75,
        last_discussed_at: '2025-11-04',
        frequency: 18,
      },
    },
    { source: 'user-1', target: 'conv-1', label: 'HAD_CONVERSATION' },
    { source: 'user-1', target: 'conv-2', label: 'HAD_CONVERSATION' },
    { source: 'user-1', target: 'conv-3', label: 'HAD_CONVERSATION' },

    // Cross-entity relationships
    {
      source: 'person-2',
      target: 'conv-1',
      label: 'MENTIONED',
      properties: {
        count: 8,
        sentiment: -0.15,
        importance_score: 0.72,
      },
    },
    {
      source: 'topic-1',
      target: 'conv-1',
      label: 'DISCUSSED',
      properties: {
        depth: 'deep',
      },
    },
    {
      source: 'project-2',
      target: 'conv-1',
      label: 'DISCUSSED',
      properties: {
        depth: 'moderate',
      },
    },

    {
      source: 'person-1',
      target: 'project-1',
      label: 'INVOLVED_IN',
      properties: {
        role: 'advisor and sounding board',
      },
    },
    {
      source: 'idea-1',
      target: 'project-1',
      label: 'RELATED_TO',
      properties: {
        description: 'Core idea that became the project',
      },
    },
    { source: 'idea-1', target: 'conv-2', label: 'EXPLORED' },
    {
      source: 'topic-2',
      target: 'conv-2',
      label: 'DISCUSSED',
      properties: {
        depth: 'deep',
      },
    },
    {
      source: 'project-1',
      target: 'topic-2',
      label: 'RELATED_TO',
      properties: {
        description: 'Project explores AI technology applications',
      },
    },

    {
      source: 'topic-3',
      target: 'conv-3',
      label: 'DISCUSSED',
      properties: {
        depth: 'surface',
      },
    },
    {
      source: 'person-3',
      target: 'conv-3',
      label: 'MENTIONED',
      properties: {
        count: 3,
        sentiment: 0.65,
        importance_score: 0.58,
      },
    },

    {
      source: 'idea-2',
      target: 'topic-2',
      label: 'RELATED_TO',
      properties: {
        description: 'Visualization idea emerged from AI discussions',
      },
    },
    {
      source: 'idea-2',
      target: 'project-1',
      label: 'RELATED_TO',
      properties: {
        description: 'Potential feature for main project',
      },
    },
    {
      source: 'project-3',
      target: 'topic-3',
      label: 'RELATED_TO',
      properties: {
        description: 'Writing project focuses on personal growth themes',
      },
    },
    { source: 'person-1', target: 'topic-1', label: 'ASSOCIATED_WITH' },
  ];

  return { nodes, links };
}
