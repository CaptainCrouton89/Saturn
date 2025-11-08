# Neo4j Setup Guide

Complete setup guide for the Saturn Backend Neo4j integration.

## 📦 What's Been Set Up

### 1. **Type System** (`src/types/graph.ts`)
Complete TypeScript types for all Neo4j entities:
- Core nodes: User, Conversation, Person, Project, Topic, Idea, Pattern, Value, Artifact, Note
- Relationship properties for all connection types
- Query result types for common operations

### 2. **Database Layer**

**Connection Service** (`src/db/neo4j.ts`):
- Singleton Neo4j driver with connection management
- Graceful shutdown handling
- Convenience query execution method

**Schema Management** (`src/db/schema.ts`):
- Automatic constraint creation for all node IDs
- Performance indexes on frequently queried fields
- Optional vector indexes for embeddings (Neo4j 5.11+)

### 3. **Repository Layer**

**UserRepository** (`src/repositories/UserRepository.ts`):
- Upsert users
- Find by ID
- Get conversation counts

**PersonRepository** (`src/repositories/PersonRepository.ts`):
- Upsert people with rich context
- Search by name
- Get recently mentioned people
- Link people to conversations with metadata

**ConversationRepository** (`src/repositories/ConversationRepository.ts`):
- Create conversations
- Link to users
- Create follow-up chains
- Get conversation context (active topics, recent people, unresolved ideas)
- Get conversation threads

**InsightRepository** (`src/repositories/InsightRepository.ts`):
- Find contradictions between patterns and values
- Get conversation suggestions (Conversation DJ)
- Find what's currently active
- Get patterns manifesting in entities
- Get emotional patterns

### 4. **API Routes** (`src/routes/graph.ts`)

RESTful endpoints for graph operations:
- `POST /api/graph/users` - Create/update user
- `GET /api/graph/users/:id` - Get user
- `POST /api/graph/people` - Create/update person
- `GET /api/graph/people/search?q=name` - Search people
- `GET /api/graph/users/:userId/people/recent` - Recently mentioned people
- `POST /api/graph/conversations` - Create conversation
- `GET /api/graph/users/:userId/context` - Get conversation context
- `GET /api/graph/users/:userId/insights/contradictions` - Find contradictions
- `GET /api/graph/users/:userId/insights/suggestions` - Get conversation suggestions
- `GET /api/graph/users/:userId/insights/active` - What's currently active

## 🚀 Getting Started

### Step 1: Install Neo4j

**Option A: Docker (Recommended)**
```bash
docker run \
  --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/your_secure_password \
  -d neo4j:latest
```

**Option B: Neo4j Desktop**
1. Download from https://neo4j.com/download/
2. Create a new database
3. Set a password
4. Start the database

**Option C: Neo4j AuraDB (Cloud)**
1. Sign up at https://neo4j.com/cloud/aura/
2. Create a free instance
3. Note the connection URI and credentials

### Step 2: Configure Environment Variables

Update `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/.env`:

```bash
# Server Configuration
PORT=3001
NODE_ENV=development

# Neo4j Configuration
NEO4J_URI=neo4j://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_secure_password
```

For Neo4j Aura (cloud), use:
```bash
NEO4J_URI=neo4j+s://xxxxx.databases.neo4j.io
```

### Step 3: Start the Server

```bash
cd /Users/silasrhyneer/Code/Cosmo/Saturn/backend
pnpm run dev
```

You should see:
```
✅ Neo4j connection established
🔧 Initializing Neo4j schema...
  ✓ Constraints created
  ✓ Indexes created
✅ Neo4j schema initialized successfully
🚀 Server running on http://localhost:3001
```

### Step 4: Verify Connection

```bash
# Check Neo4j health
curl http://localhost:3001/api/neo4j/health

# Should return:
# {"status":"connected","message":"Neo4j connection is healthy"}
```

## 📝 Usage Examples

### Create a User

```bash
curl -X POST http://localhost:3001/api/graph/users \
  -H "Content-Type: application/json" \
  -d '{
    "id": "user_123",
    "name": "Silas"
  }'
```

### Create a Person

```bash
curl -X POST http://localhost:3001/api/graph/people \
  -H "Content-Type: application/json" \
  -d '{
    "id": "person_456",
    "name": "Alex",
    "relationship_type": "friend",
    "how_they_met": "College roommates",
    "why_they_matter": "Best friend, always there when needed",
    "personality_traits": ["thoughtful", "creative", "reliable"]
  }'
```

### Create a Conversation

```bash
curl -X POST http://localhost:3001/api/graph/conversations \
  -H "Content-Type: application/json" \
  -d '{
    "id": "conv_789",
    "summary": "Discussed career goals and upcoming projects",
    "duration": 45,
    "trigger_method": "scheduled",
    "status": "completed",
    "topic_tags": ["career", "projects"]
  }'
```

### Get Conversation Context

```bash
curl http://localhost:3001/api/graph/users/user_123/context?days=14
```

Returns active topics, recent people, and unresolved ideas from the last 14 days.

### Find Contradictions

```bash
curl http://localhost:3001/api/graph/users/user_123/insights/contradictions
```

Returns contradictions between stated values and observed patterns.

## 🔍 Direct Neo4j Queries

You can also interact with Neo4j directly using the browser interface:

1. Open http://localhost:7474 (or your Neo4j Desktop/Aura URL)
2. Login with your credentials
3. Run Cypher queries:

```cypher
// See all users
MATCH (u:User) RETURN u

// See all people and their relationships
MATCH (p:Person) RETURN p

// See conversation graph
MATCH (u:User)-[:HAD_CONVERSATION]->(c:Conversation)
RETURN u, c
LIMIT 25

// Find contradictions (once you have patterns and values)
MATCH (u:User)-[:HAS_PATTERN]->(p:Pattern)-[c:CONTRADICTS]->(v:Value)
RETURN p.description as behavior,
       v.description as stated_value,
       c.contradiction_description,
       c.severity
ORDER BY c.severity DESC
```

## 🧪 Testing the Setup

Here's a complete test flow:

```bash
# 1. Create a user
curl -X POST http://localhost:3001/api/graph/users \
  -H "Content-Type: application/json" \
  -d '{"id": "test_user", "name": "Test User"}'

# 2. Create a person
curl -X POST http://localhost:3001/api/graph/people \
  -H "Content-Type: application/json" \
  -d '{"id": "test_person", "name": "Test Person", "relationship_type": "friend"}'

# 3. Create a conversation
curl -X POST http://localhost:3001/api/graph/conversations \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test_conv",
    "summary": "Test conversation",
    "duration": 30,
    "trigger_method": "manual",
    "status": "completed",
    "topic_tags": ["test"]
  }'

# 4. Get user info
curl http://localhost:3001/api/graph/users/test_user

# 5. Search for people
curl "http://localhost:3001/api/graph/people/search?q=Test"
```

## 🎯 Next Steps

### 1. Add More Repositories

Create repositories for other entities:
- `ProjectRepository` - for user projects
- `TopicRepository` - for discussion topics
- `IdeaRepository` - for capturing ideas
- `PatternRepository` - for behavioral patterns
- `ValueRepository` - for stated values

### 2. Implement Entity Extraction

When conversations are saved, automatically extract:
- People mentioned
- Projects discussed
- Ideas explored
- Topics covered

### 3. Enable Vector Search (Optional)

If using Neo4j 5.11+, enable vector indexes:

```typescript
import { createVectorIndexes } from './db/schema';

// After initializeSchema()
await createVectorIndexes();
```

Then add embedding generation to:
- Projects (vision + name)
- Topics (name + description)
- Ideas (summary + context_notes)
- Notes (content)

### 4. Build Pattern Detection

Implement logic to:
- Track user behaviors over time
- Identify patterns (behavioral, thought, emotional, social)
- Link patterns to manifestations (people, projects, topics)
- Detect contradictions with stated values

## 📚 Schema Reference

See `neo4j.md` for complete schema documentation including:
- All node types and properties
- All relationship types and properties
- Powerful query examples
- Key design decisions

## 🐛 Troubleshooting

**Connection failed:**
- Verify Neo4j is running: `docker ps` (if using Docker)
- Check credentials in `.env` match your Neo4j instance
- Ensure ports 7474 and 7687 are accessible

**Schema initialization fails:**
- Check Neo4j version (constraints require 4.0+, vector indexes require 5.11+)
- Verify user has admin privileges

**Queries are slow:**
- Check indexes are created: `SHOW INDEXES` in Neo4j browser
- Consider adding more specific indexes for your use case
- Monitor query performance with `PROFILE` or `EXPLAIN`

## 🔐 Security Notes

- Never commit `.env` file (already in `.gitignore`)
- Use strong passwords for Neo4j
- In production, restrict CORS and use authentication middleware
- Consider encrypting Neo4j connection with `neo4j+s://` URI

## 📖 Additional Resources

- [Neo4j Cypher Manual](https://neo4j.com/docs/cypher-manual/current/)
- [Neo4j Driver Documentation](https://neo4j.com/docs/javascript-manual/current/)
- [Graph Data Modeling](https://neo4j.com/developer/data-modeling/)
