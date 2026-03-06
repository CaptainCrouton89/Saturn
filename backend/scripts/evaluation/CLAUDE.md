# scripts/evaluation - CLAUDE.md

LoCoMo dialogue dataset evaluation pipeline. Ingests conversations through full Phase 0-4 pipeline, creates semantic knowledge graphs, evaluates with LLM agents.

## Quick Commands

```bash
# Setup canonical evaluation user
pnpm tsx scripts/evaluation/setup-canonical-user.ts

# Run ingestion (exports LOCOMO_USER_ID from setup output first)
pnpm tsx scripts/evaluation/run-locomo-ingestion.ts

# Generate answer evaluations (parallel)
pnpm tsx scripts/evaluation/run-locomo10-eval.ts <conv-index>

# Score answers against ground truth (parallel)
pnpm tsx scripts/evaluation/score-locomo10-eval.ts <answers-file>

# Cleanup (safe deletion with dependency ordering)
pnpm tsx scripts/evaluation/cleanup-locomo-data.ts --user-id <user-id>
```

## Key Patterns

**Canonical User Model**: All dialogues use single `user_id` for semantic consolidation across conversations. Without this, each dialogue creates orphaned `user_id`, fragmented Person/Concept/Entity nodes, and Phase 4 owner node creation failures. Enabled by: Supabase auth user + Neo4j owner Person node with `is_owner=true`.

**Provenance Tagging**: Sources tagged with `{origin: "locomo-eval", dialogue_id, chunk_index}` for evaluation filtering and safe deletion.

**Parallel Processing**: `run-locomo10-eval.ts` and `score-locomo10-eval.ts` use concurrency control for generation/scoring phases.

**Safe Deletion**: `cleanup-locomo-data.ts` deletes in dependency order (hierarchical → episodic → semantic relationships → nodes) to prevent orphaned relationships.

**Idempotent Setup**: `setup-canonical-user.ts` can be re-run without errors; verifies/creates owner Person node if missing.

## Data Flow

1. **Setup**: Create canonical user in Supabase + Neo4j (owner Person node)
2. **Ingestion**: Chunk LoCoMo dialogues (~4k tokens), run Phase 0-4 pipeline per chunk, tag sources with provenance
3. **Evaluation**: Generate answers via LLM agents, score against ground truth
4. **Cleanup**: Recursively delete by user_id or provenance origin

## Important Notes

- Chunking: ~4000 token limit with 200 token overlap, preserves utterance boundaries
- Ingestion: Uses official `ingestionAgent` (Phase 0: cleanup, Phase 1: extract entities, Phase 1.5: resolve against graph, Phase 2: create sources, Phase 3: build relationships)
- Evaluator Agent: LangGraph workflow with semantic search + Cypher query tools for LoCoMo10 QA evaluation
- User scoping: All nodes share same `user_id` for consolidation; required by auth/graph design
- LoCoMo10 workflow: `run-locomo10-eval.ts` → answers.jsonl, then `score-locomo10-eval.ts` → evaluation metrics
- Test mode: Use `--limit N --chunk-limit M` flags for small runs during development
- Full docs: See **README.md** for detailed step-by-step instructions, examples, troubleshooting

## Files Structure

- **types.ts** - LoCoMo data structures + pipeline interfaces
- **locomo-adapter.ts** - Parse/chunk dataset, token counting
- **locomo10-adapter.ts** - LoCoMo10 benchmark format adapter
- **setup-canonical-user.ts** - Create eval user (Supabase + Neo4j)
- **run-locomo-ingestion.ts** - LoCoMo dataset ingestion (canonical user + provenance tagging)
- **run-locomo10-eval.ts** - Answer generation phase (parallel)
- **score-locomo10-eval.ts** - Answer scoring phase (parallel)
- **evaluator-agent.ts** - LangGraph query agent
- **chat-caller.ts** - Direct API conversation endpoint caller
- **README.md** - Comprehensive documentation
