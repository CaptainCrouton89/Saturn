# Services Layer

Business logic for Cosmo's memory extraction pipeline and conversation management.

## Memory Extraction Pipeline (7 Phases)

1. **entityIdentificationService** - Extract entities from transcript using LLM
2. **entityResolutionService** - Match to existing Neo4j nodes (delegates to `entityResolvers/`)
3. **entityUpdateService** - Generate structured updates (delegates to `entityUpdaters/`)
4. **summaryService** - Generate conversation summary
5. **relationshipUpdateService** - Score User→Entity and Conversation→Entity relationships
6. **embeddingGenerationService** - Batch embed entities for semantic search
7. **neo4jTransactionService** - Execute atomic Neo4j transaction

## Strategy Pattern

- `entityUpdaters/` - PersonUpdater, ProjectUpdater, TopicUpdater, IdeaUpdater (extend BaseEntityUpdater)
- `entityResolvers/` - PersonResolver, ProjectResolver, TopicResolver, IdeaResolver (extend BaseResolver)

**Adding New Entity Type**: Create Updater + Resolver extending base classes, add to Map in orchestrators.