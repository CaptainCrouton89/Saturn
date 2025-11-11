# Entity Updaters

Specialized classes for generating structured entity updates during Phase 3 of memory extraction.

## Pattern

- `PersonUpdater` - Node (personality_traits, current_life_situation) + KNOWS relationship (relationship_type, how_they_met)
- `ProjectUpdater` - Node (domain, vision, key_decisions) + WORKING_ON relationship (status, blockers)
- `TopicUpdater` - Node-only updates (description, category)
- `IdeaUpdater` - Node (original_inspiration, obstacles) + EXPLORING relationship (status, next_steps)

## BaseEntityUpdater Utilities

- `invokeStructured()` - Single LLM call with Zod schema
- `invokeDualStructured()` - Parallel LLM calls for node + relationship schemas
- `filterEmptyValues()` - Removes empty strings, empty arrays, -1 sentinel values

## Adding New Entity Type

Extend `BaseEntityUpdater`, implement `getEntityType()` + `update()`, add to Map in `entityUpdateService.ts`