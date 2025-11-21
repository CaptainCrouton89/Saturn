/**
 * Centralized constants for Neo4j Graph Schema
 * Defines Node Labels and Relationship Types to ensure consistency across the codebase.
 */

export const NodeLabels = {
  Person: 'Person',
  Concept: 'Concept',
  Entity: 'Entity',
  Event: 'Event',
  Source: 'Source',
  Artifact: 'Artifact',
  Storyline: 'Storyline',
  Macro: 'Macro',
} as const;

export type NodeLabel = typeof NodeLabels[keyof typeof NodeLabels];

export const RelationshipTypes = {
  // User relationships
  EngagesWith: 'engages_with',
  HasRelationshipWith: 'has_relationship_with',
  AssociatedWith: 'associated_with',
  Involves: 'involves',
  Produced: 'produced',
  Mentions: 'mentions',
  SourcedFrom: 'sourced_from',
  RelatesTo: 'relates_to',
  ConnectedTo: 'connected_to',
  
  // Detailed relationships (from graph.ts)
  HadConversation: 'HAD_CONVERSATION',
  Knows: 'KNOWS',
  WorkingOn: 'WORKING_ON',
  InterestedIn: 'INTERESTED_IN',
  Exploring: 'EXPLORING',
  Values: 'VALUES',
  HasPattern: 'HAS_PATTERN',
  Mentioned: 'MENTIONED',
  Discussed: 'DISCUSSED',
  Explored: 'EXPLORED',
  Revealed: 'REVEALED',
  FollowedUp: 'FOLLOWED_UP',
  RelatedTo: 'RELATED_TO',
  InvolvedIn: 'INVOLVED_IN',
  SharedExperience: 'SHARED_EXPERIENCE',
  TensionWith: 'TENSION_WITH',
  InspiredBy: 'INSPIRED_BY',
  BlockedBy: 'BLOCKED_BY',
  EvolvedInto: 'EVOLVED_INTO',
  Contradicts: 'CONTRADICTS',
  ManifestsIn: 'MANIFESTS_IN',
  Feels: 'FEELS',
  RelatesToEntity: 'RELATES_TO_ENTITY',
  RelatesToPerson: 'RELATES_TO_PERSON',
  InvolvesEntity: 'INVOLVES_ENTITY',
} as const;

export type RelationshipType = typeof RelationshipTypes[keyof typeof RelationshipTypes];
