# Agents Directory

AI SDK agents for conversation orchestration and knowledge graph ingestion. Uses Vercel AI SDK with structured output and tool-based agentic workflows.

## Agent Types

**Conversation Agent** (orchestrator.ts):
- Uses `streamText` for real-time user conversations
- Tools for onboarding, artifact management (separate from ingestion agents)
- Message format conversion between StoredMessage (DB) and ModelMessage (AI SDK)
- Multi-step execution with MAX_STEPS = 10

**Ingestion Agents** (createAgent.ts, mergeAgent.ts, ingestionAgent.ts):
- Two-phase pattern: structured output (Phase 1) + tool-based graph mutations (Phase 2)
- Exports both full orchestrators and phase-only functions for flexibility
- CREATE: Phase 1 builds node, Phase 2 creates relationships
- MERGE: Phase 1 generates notes, Phase 2 updates neighbors
- INGESTION: Orchestrates extraction, resolution (create vs merge), and pipeline

## Architecture: Two-Phase Pattern

Ingestion agents split work for validation and safety:
- **Phase 1**: `generateObject` for structured output (nodes, notes) → validated via Zod schemas
- **Phase 2**: `generateText` with tools for graph mutations → tracked via `onStepFinish` for safety

Phase-only exports: `runCreateAgentPhase1Only()`, `runCreateAgentPhase2Only()`, etc. enable independent execution and reuse.

## Key Patterns

**Prompt Caching**: All agents use `providerOptions: { openai: { promptCacheKey } }` for performance optimization.

**Dynamic Max Steps**: `calculateDynamicMaxSteps(neighborCount)` prevents loops (typically `2 * neighborCount + 5`).

**Tool Factories**: Tools bound at runtime with context (userId, sourceEntityKey, nameToKeyMap).

**Context Formatting**: Use `src/utils/contextFormatting.ts` for XML/markdown node representations.

**Safety Tracking**: `onStepFinish` callbacks track duplicate tool calls via Set; throw on safety limit exceeded.

**Telemetry**: All agents emit `experimental_telemetry` with functionId and metadata for observability.

## Development Notes

- Ingestion agents: Reference `scripts/ingestion/schema.md` for node schemas
- Conversation agent: Add tools to the `tools` object; update system prompts in `prompts/index.js`
- Error handling: Ingestion agents return `{success, error}` objects; throw early in conversation agent
