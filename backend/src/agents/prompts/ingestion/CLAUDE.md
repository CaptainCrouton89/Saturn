# Ingestion Prompts

System prompts for the three-phase memory extraction pipeline (ingestionAgent.ts).

## Convention

**One prompt file per phase + type-specific variants**. Each prompt is loaded dynamically by the ingestion agent orchestrator.

## The Phases

**Phase 1 - Extraction** (extract.ts): Identify entities, concepts, and relationships from raw text. Uses `generateObject` with Zod validation → structured node properties.

**Phase 2 - Resolution** (resolution-decision.ts): Decide for each extracted entity: create new node or merge with existing? Uses entity similarity scoring + embedding-based matching.

**Phase 3 - Create/Merge** (create.ts + merge.ts):
- **Create** (create.ts): Type-specific prompts for Person, Concept, Entity, Event nodes. Uses `generateObject` with structured output (no tools). Enforces semantic knowledge capture: temporal grounding, quantitative precision, entity-attribute binding, information density.
- **Merge** (merge.ts): Update target node with new information, uses tool-based agent loop.

**Phase 4 - Relationship Creation** (relationships.ts): Establish relationships between nodes using tool-based agent loop. Validates via `onStepFinish` callbacks to prevent duplicate edges.

## Semantic Knowledge Capture

Critical principles enforced in create.ts type-specific prompts:
- **Temporal grounding**: Specific dates, durations (never "recently", "sometimes")
- **Quantitative precision**: Exact numbers, percentages, counts (never "a lot", "often")
- **Entity-attribute binding**: WHO did/owns/said WHAT (preserve clear attribution)
- **Information density**: One fact per note, maximize density, no redundancy
- **Conversation-sourced only**: Extract ONLY what was discussed, never training data
- **User-specific context**: Focus on how it relates to the user, not generic definitions
- **No meta-observations**: Never reference "discussed on [date]" or conversation metadata

## Key Context

- All prompts operate on **user-scoped graphs** (nodes filtered by `user_id`)
- Prompts receive **neighboring node context** (to inform merge decisions and relationship creation)
- Extraction is **strict**: only create Concepts/Entities when they have user-specific significance (not casual mentions)
- Create phase uses **type-specific prompts** with detailed guidance for each node type (see create.ts)
- Relationship creation uses **dynamic maxSteps** = `2 * neighborCount + 5` to prevent infinite loops

## Integration

Called by `ingestionAgent.ts` → orchestrates phases sequentially with data validation between each phase.
