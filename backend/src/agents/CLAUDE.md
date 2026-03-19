# Agents Directory

AI SDK agents for conversation orchestration and knowledge graph ingestion. Uses Vercel AI SDK with structured output and tool-based agentic workflows.

## Architecture: Two-Phase Agents

Most agents split work into two distinct phases:
- **Phase 1**: Use `generateObject` for structured output (nodes, notes, properties) → validated via Zod schemas
- **Phase 2**: Use tool-based `generateText` for relationship creation/updates → tracked via `onStepFinish` callbacks for safety

This separation enables strict validation on structured data while allowing flexible tool invocation for graph manipulation.

## SDK Usage Pattern

```typescript
const result = await generateText({
    model: openai("gpt-5.4-mini", {
      reasoningEffort: 'low', // Use low reasoning for faster execution
    }),
    tools,
    maxSteps: dynamicMaxSteps,
    system: systemPrompt,
    prompt: userPrompt,
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'relevant-name',
      metadata: {
        userId,
        sourceEntityKey,
        phase: 'appropriate-phase',
        neighborCount,
        maxSteps: dynamicMaxSteps,
      },
    },
})
```

## Key Patterns

**Tool Factories**: Tools created dynamically to bind context (userId, sourceEntityKey, nameToKeyMap) at runtime.

**Context Formatting**: Use `src/utils/contextFormatting.ts` for XML/markdown node representations.

**Safety in onStepFinish**: Track duplicate tool calls via `createdRelationships` Set; enforce maxSteps = `2 * neighborCount + 5` to prevent loops.

## Agent Types

- **CREATE (createAgent.ts)**: Phase 1 generates node properties; Phase 2 creates relationships to neighbors
- **MERGE (mergeAgent.ts)**: Phase 1 generates notes for target node; Phase 2 updates relationships and neighbors
- **INGESTION (ingestionAgent.ts)**: Orchestrates entity extraction, resolution (create vs merge), and pipeline
