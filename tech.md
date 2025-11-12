# Final Schema

## Nodes

**Concept:**
- entity_key: string (hash of normalized name + type + user_id)
- user_id: string
- name: string
- description - a 1 sentence overview of most important information
- updated_at
- created_at
- notes: string
- embedding: built from description + notes

**Person:**
- entity_key: string (hash of canonical_name + user_id)
- user_id: string
- name: string
- is_owner: boolean (optional - only set to true for the Person node representing the user themselves)
- canonical_name: string
- appearance - physical description
- situation - current life circumstances, what they're going through
- history - background, how you know them, past context
- personality - traits, communication style, quirks
- expertise - what they're good at, professional domain
- interests - hobbies, passions, topics they care about
- updated_at
- created_at
- notes: string

**Entity:**
- entity_key: string (hash of normalized name + type + user_id)
- user_id: string
- name: string
- type - string (company, place, object, group, institution, product, technology, etc.)
- description - a 1 sentence overview of most important information
- updated_at
- created_at
- notes: string
- embedding: built from description + notes

**Source:**
- entity_key: string (hash of description + user_id + created_at)
- user_id: string
- updated_at
- content: {type: transcript | etc, content: text | json }
- description - 1 setence
- embedding: built from description

**Artifact:**
- entity_key: string (hash of description + user_id + created_at)
- user_id: string
- updated_at
- content: {type: action | md_file | etc, output: text | json}
- description - 1 sentence

## Relationships

**Person [thinks_about] Concept:**
- mood: enum/string - dreads | excited_by | loves | misses | wants | fears | etc.
- frequency: # times/month
- created_at
- updated_at

**Person [has_relationship_with] Person:**
- attitude_towards_person: hostile | unfriendly | neutral | friendly | close | loving
- closeness: 1–5 (1=barely know them, 5=know them very well)
- relationship_type: colleague | employee | partner | sister | mother | spouse | roommate | boss | friend | string
- created_at
- updated_at
- notes: string

**Concept [relates_to] Concept:**
- notes: string
- relevance: number - a score of how closely they're related, 1-10
- created_at
- updated_at

**Concept [involves] Person:**
- notes: string
- relevance: number - a score of how closely they're related, 1-10
- created_at
- updated_at

**Concept [involves] Entity:**
- notes: string
- relevance: number - a score of how closely they're related, 1-10
- created_at
- updated_at

**Concept [produced] Artifact:**
- notes: string
- relevance: number - a score of how closely they're related, 1-10
- created_at
- updated_at

**Person [relates_to] Entity:**
- relationship_type: work | life | other | string
- notes: string
- relevance: number - a score of how closely they're related, 1-10
- created_at
- updated_at

**Entity [relates_to] Entity:**
- relationship_type: string (owns, part_of, near, competes_with, etc.)
- notes: string
- relevance: number - a score of how closely they're related, 1-10
- created_at
- updated_at

**Source [mentions] Person**

**Source [mentions] Entity**

**Source [mentions] Concept**

**Artifact [sourced_from] Source**


---

## Notes:

- The `notes` field on nodes should contain only things that don't fit the rest of the properties and that doesn't belong in a relationship between nodes.
  - On relationships, notes should be where the relationship can be described in rich text.

- **When to create Concepts and Entities:**
  - Concepts and Entities are ONLY for things that have gained importance to the user and contain user-specific information.
  - If something is mentioned casually without user-specific context, it should NOT become an entity.
  - Example: User mentions "Chicago" in passing → NOT an entity (just a known city)
  - Example: User discusses moving to Chicago, or has specific plans/feelings about Chicago → YES, create an Entity (contains user-specific context not inferrable by an LLM) 


## Retrieval
As for retrieval, this is gnarly too. The agent should know about the last few days of conversations. Beyond that, it can use a combination of timestamps and salience and semantic similarity to retrieve information.

In retrieval, here's how this has to be done:

1. User submits message: 

2. GPT-4.1-nano determines if search is necessary. Not necessary for:
   1.  "Explain quantum entanglement simply."
   2.  "Write a Python script to scrape headlines."
   3.  "Help me draft a polite resignation email."
   4.  "Summarize this PDF in bullet points."
   5.  "Debug this TypeScript function."
   6.  "Give me 5 startup ideas in the AI space."
   7.  "Rewrite my dating profile to sound more natural."
   8.  "Design a morning routine for productivity."
   9.  "What's the difference between GPT-4 and GPT-5?"
   10. "Brainstorm fantasy names for a coastal kingdom."
3. If it is necessary, makes candidate searches. Begins by immediately acknowledging while beginning search in parallel. See [Search Tools](### Search Tools)
   1. "I'm not sure if I should take the google job offer." -> explore({queries: [{query: "google job offer", threshold: 0.8}], text_matches: ["google"]})
   2. "I think I messed up with andrew—we fought pretty bad last night." -> explore({text_matches: ["andrew"]})
   3. "Okay, what do you think about this idea..." -> explore({queries: [{query: "startup ideas brainstorming", threshold: 0.75}]})
   4. "How am I going to actually make headway on my startup—YC apps are due tomorrow." -> explore({queries: [{query: "YC application startup progress", threshold: 0.8}], text_matches: ["startup", "YC"]})
   5. "I don't know how I feel about this girl—I used to have a crush, but now she has a kid" -> explore({queries: [{query: "romantic feelings crush relationship", threshold: 0.75}]}) then traverse({cypher: "MATCH (u:Person {is_owner: true})-[r:KNOWS]->(p:Person) WHERE p.name CONTAINS 'girl' OR p.situation CONTAINS 'kid' RETURN p, r"})
   6. "If I don't submit my report by end of today, am I screwed?" -> explore({queries: [{query: "report deadline submission", threshold: 0.8}], text_matches: ["report"]})
  

### Search Tools

These tools allow the agent to retrieve arbitrary content from the db. 

Two tools exist: an `explore` tool which allows rapid investigation into the graph, and `traverse` which allows graph operations once promising nodes have been discovered.

#### Explore

Explore can only really target the following nodes/relationships. Each is listed with targetable properties below.

1. Find hits broadly
2. Potentially rerank them
3. Expand them

explore({
    queries?: {query: string, threshold: float}[], // embeddings to find sources, concepts, entities
    text_matches?: string[], // exact string matches to look for with names
    return_explanations?: boolean // if true, expose match features (similarity scores, match types, etc.)
});

##### Gather

Combines all results from search queries (embeddings) and the text matches (fuzzy matching). Will return:

- Persons - via name
- Concepts - via embedding
- Sources - via embedding
- Entities - via embedding and/or name

Embedding search filters by match threshold

**Scoring normalization:**
- Embedding search: cosine similarity already 0-1
- Exact text matches: score as 1.0 (perfect match)
- Fuzzy text matches: normalize to 0-1 using string similarity metric (e.g., Jaro-Winkler, token-based similarity, or Levenshtein-based: `1 - (distance / max_length)`)
- All scores must be in 0-1 range to be comparable when ranking/combining results

##### Rerank and Expand

1. Orders all nodes by their similarity score and salience (float bound by number of connecting nodes and recency of update)
2. Throws away everything but the top 5 concepts, 3 entities, 3 persons, and 5 sources. These are hits
3. Gets all edges between:
   - The collected nodes
   - The nodes and the user
   - The nodes' neighbor nodes and edges
4. Pass this information back to user:
   - The nodes that showed up in hits
     - All of the properties on those nodes
   - All of edges that nodes are part of (top 10, sorted by relevance score or date, preferring relevance, fallback to date)
     - All of the properties on those edges if those edges extend to other hits, or extend to the user
   - Nodes that are neighbors to the hits
     - Only return entity_key, name, description, type for these nodes

#### Traverse

Traversal allows the agent to navigate the graph directly and gather more specific information.

1. Run cypher query
2. Return structured data

traverse({
    cypher: string,  // cypher query
    verbose: boolean
})

With verbose off, it automatically shortens content

## Ingestion

**Step 1: Extraction + Disambiguation**
- Extract all candidates
- Match to existing or mark as new
- Output: list of {node_type, action: create|update, matched_entity_key?, extracted_data}

**Step 2: Auto-create Source edges**
- For each node, create Source [mentions] Node
- Update node's updated_at, salience automatically

**Step 3: Relationship Agent**
Gets:
- Source content
- List of nodes to create/update (with their data)
- Existing relationships for those nodes

Tools available:

**Node tools** (expose limited properties):
- `create_person(canonical_name, appearance?, situation?, history?, personality?, expertise?, interests?)`
- `update_person(entity_key, appearance?, situation?, history?, personality?, expertise?, interests?)` - can update text fields but not canonical_name
- `create_concept(description)`
- `update_concept(entity_key, description)`
- `create_entity(type, description)`
- `update_entity(entity_key, type?, description)`

**Relationship tools:**
- `create_relationship(from_entity_key, to_entity_key, relationship_type, properties: json)` // this would be validated as follows. Extra fields would be ignored.
  - person - [thinks_about] - concept: { mood }
  - person - [has_relationship_with] -> person: { attitude_towards_person, closeness, relationship_type, notes } // we want these only created for user towards other people except in special circumstances
  - concept - [relates_to] - concept: { relevance, notes }
  - concept - [involves] - person: { relevance, notes }
  - concept - [involves] - entity: { relevance, notes }
  - person - [relates_to] -> entity { relationship_type, relevance, notes }
  - entity - [relates_to] -> entity { relationship_type, relevance, notes }
- `update_relationship(from_entity_key, to_entity_key, relationship_type, properties: json)` // also validated

Properties like salience, created_at, updated_at, notes array - all handled automatically, not exposed to agent.