// Neo4j Indexes for Saturn Backend
// Run these Cypher commands in Neo4j Browser or via neo4j-driver
// These indexes optimize entity resolution, canonical name matching, and alias lookups

// ============================================================================
// Entity Key Indexes (Critical for Idempotency)
// ============================================================================

CREATE INDEX entity_key_person IF NOT EXISTS FOR (p:Person) ON (p.entity_key);
CREATE INDEX entity_key_project IF NOT EXISTS FOR (p:Project) ON (p.entity_key);
CREATE INDEX entity_key_topic IF NOT EXISTS FOR (t:Topic) ON (t.entity_key);
CREATE INDEX entity_key_idea IF NOT EXISTS FOR (i:Idea) ON (i.entity_key);
CREATE INDEX entity_key_pattern IF NOT EXISTS FOR (p:Pattern) ON (p.entity_key);
CREATE INDEX entity_key_value IF NOT EXISTS FOR (v:Value) ON (v.entity_key);

// ============================================================================
// Canonical Name Indexes (For Name Matching)
// ============================================================================

CREATE INDEX person_canonical_name IF NOT EXISTS FOR (p:Person) ON (p.canonical_name);
CREATE INDEX project_canonical_name IF NOT EXISTS FOR (p:Project) ON (p.canonical_name);
CREATE INDEX topic_canonical_name IF NOT EXISTS FOR (t:Topic) ON (t.canonical_name);

// ============================================================================
// Alias Indexes (For Entity Resolution)
// ============================================================================

CREATE INDEX alias_normalized_name IF NOT EXISTS FOR (a:Alias) ON (a.normalized_name);
CREATE INDEX alias_type IF NOT EXISTS FOR (a:Alias) ON (a.type);

// ============================================================================
// Name Indexes (For Fuzzy Search - should already exist)
// ============================================================================

CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name);
CREATE INDEX project_name IF NOT EXISTS FOR (p:Project) ON (p.name);
CREATE INDEX topic_name IF NOT EXISTS FOR (t:Topic) ON (t.name);

// ============================================================================
// ID Indexes (For Direct Lookups - should already exist)
// ============================================================================

CREATE INDEX person_id IF NOT EXISTS FOR (p:Person) ON (p.id);
CREATE INDEX project_id IF NOT EXISTS FOR (p:Project) ON (p.id);
CREATE INDEX topic_id IF NOT EXISTS FOR (t:Topic) ON (t.id);
CREATE INDEX idea_id IF NOT EXISTS FOR (i:Idea) ON (i.id);
CREATE INDEX conversation_id IF NOT EXISTS FOR (c:Conversation) ON (c.id);
CREATE INDEX user_id IF NOT EXISTS FOR (u:User) ON (u.id);
CREATE INDEX note_id IF NOT EXISTS FOR (n:Note) ON (n.id);
CREATE INDEX artifact_id IF NOT EXISTS FOR (a:Artifact) ON (a.id);

// ============================================================================
// Status and Category Indexes (For Filtering)
// ============================================================================

CREATE INDEX project_status IF NOT EXISTS FOR (p:Project) ON (p.status);
CREATE INDEX idea_status IF NOT EXISTS FOR (i:Idea) ON (i.status);
CREATE INDEX topic_category IF NOT EXISTS FOR (t:Topic) ON (t.category);

// ============================================================================
// Verification Query
// ============================================================================

// Run this to verify all indexes were created successfully:
SHOW INDEXES;
