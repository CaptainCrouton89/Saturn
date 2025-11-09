# LangGraph Conversation Orchestration Reference

## Non-obvious Implementation Details for Cosmo MVP

### State Management with Reducers

**Reducers prevent overwrites during concurrent operations:**
```typescript
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

// BAD: Will error on concurrent updates
const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>
});

// GOOD: Reducer handles concurrent appends
const ConversationState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, update) => existing.concat(update),
    default: () => []
  }),
  userId: Annotation<string>,
  conversationId: Annotation<string>,
  preferences: Annotation<UserPreference[]>({
    reducer: (_, update) => update, // replace
    default: () => []
  }),
  activeEntities: Annotation<ActiveEntities>({
    reducer: (_, update) => update, // replace
    default: () => ({ people: [], projects: [], topics: [] })
  })
});
```

**Python equivalent:**
```python
from typing import Annotated
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages

class ConversationState(TypedDict):
    messages: Annotated[list, add_messages]  # reducer built-in
    user_id: str
    conversation_id: str
    preferences: list[UserPreference]
    active_entities: ActiveEntities
```

### Checkpointing: Thread-Based Conversation Persistence

**Critical**: Checkpointer only on parent graph, propagates to subgraphs automatically.

```typescript
import { MemorySaver } from "@langchain/langgraph";
import { StateGraph, START, END } from "@langchain/langgraph";

const checkpointer = new MemorySaver(); // In-memory for dev

const graph = new StateGraph(ConversationState)
  .addNode("loadContext", loadContextNode)
  .addNode("processMessage", processMessageNode)
  .addNode("generateResponse", generateResponseNode)
  .addEdge(START, "loadContext")
  .addEdge("loadContext", "processMessage")
  .addEdge("processMessage", "generateResponse")
  .addEdge("generateResponse", END)
  .compile({ checkpointer });

// Each conversation = unique thread
const config = {
  configurable: {
    thread_id: conversationId, // maps to conversation.id from DB
  }
};

// Turn 1
await graph.invoke({ messages: [userMessage1] }, config);

// Turn 2 - automatically loads state from turn 1
await graph.invoke({ messages: [userMessage2] }, config);
```

**Python with PostgreSQL (production):**
```python
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

DB_URI = "postgresql://user:pass@localhost/dbname"
async with AsyncPostgresSaver.from_conn_string(DB_URI) as checkpointer:
    # await checkpointer.setup()  # run once to create tables

    graph = builder.compile(checkpointer=checkpointer)

    config = {"configurable": {"thread_id": conversation_id}}

    async for chunk in graph.astream(
        {"messages": [user_message]},
        config,
        stream_mode="values"
    ):
        # Stream response
        pass
```

### Context Loading Pattern (First Turn Only)

**Load once, cache in state:**
```typescript
const loadContextNode = async (
  state: typeof ConversationState.State,
  config: LangGraphRunnableConfig
) => {
  // Check if context already loaded
  if (state.preferences && state.preferences.length > 0) {
    return {}; // Skip - already loaded
  }

  const userId = config.configurable?.userId;

  // Load all context in parallel
  const [preferences, activeEntities, recentSummaries] = await Promise.all([
    db.userPreference.findMany({ where: { userId } }),
    neo4j.getActiveEntities(userId), // entities mentioned in last 14 days
    db.conversation.findMany({
      where: { userId, status: "completed" },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { summary: true }
    })
  ]);

  return {
    preferences,
    activeEntities,
    context: {
      recentSummaries: recentSummaries.map(c => c.summary)
    }
  };
};
```

### Sliding Window Message Management

**Keep last 10-15 turns verbatim, summarize older:**
```typescript
const processMessageNode = async (
  state: typeof ConversationState.State
) => {
  const WINDOW_SIZE = 15;
  let messages = state.messages;

  // If exceeds window, summarize old messages
  if (messages.length > WINDOW_SIZE) {
    const toSummarize = messages.slice(0, messages.length - WINDOW_SIZE);
    const toKeep = messages.slice(messages.length - WINDOW_SIZE);

    // Summarize old messages via LLM
    const summary = await llm.invoke([
      new SystemMessage("Summarize this conversation history in 2-3 sentences"),
      ...toSummarize
    ]);

    // Replace with summary + keep recent
    messages = [
      new SystemMessage(`Previous conversation summary: ${summary.content}`),
      ...toKeep
    ];
  }

  return { messages };
};
```

### Command for State Updates + Navigation

**Return Command from nodes to both update state AND route:**
```typescript
import { Command } from "@langchain/langgraph";

const agentNode = async (state: typeof ConversationState.State) => {
  const response = await model.invoke(state.messages);

  // Check if tools were called
  if (response.tool_calls?.length) {
    return new Command({
      update: { messages: [response] },
      goto: "executeTools" // navigate to tool execution
    });
  }

  // No tools - done
  return new Command({
    update: { messages: [response] },
    goto: END
  });
};
```

**Python equivalent:**
```python
from langgraph.types import Command

def agent_node(state: ConversationState) -> Command:
    response = model.invoke(state["messages"])

    if response.tool_calls:
        return Command(
            update={"messages": [response]},
            goto="execute_tools"
        )

    return Command(
        update={"messages": [response]},
        goto=END
    )
```

### Conditional Edges Without Command

**Traditional approach (still valid):**
```typescript
const shouldContinue = (state: typeof ConversationState.State) => {
  const lastMessage = state.messages.at(-1);

  if (lastMessage && isAIMessage(lastMessage) && lastMessage.tool_calls?.length) {
    return "executeTools";
  }
  return END;
};

const graph = new StateGraph(ConversationState)
  .addNode("agent", agentNode)
  .addNode("executeTools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue, {
    "executeTools": "executeTools",
    [END]: END
  })
  .addEdge("executeTools", "agent") // loop back
  .compile({ checkpointer });
```

### Streaming Modes

**3 modes, choose based on UI needs:**

1. **"values"** - Full state after each node (most common)
```typescript
for await (const chunk of await graph.stream(input, {
  ...config,
  streamMode: "values"
})) {
  console.log(chunk.messages.at(-1)?.content); // latest message
}
```

2. **"updates"** - Only what each node returned
```typescript
for await (const chunk of await graph.stream(input, {
  ...config,
  streamMode: "updates"
})) {
  // chunk = { nodeName: { messages: [...] } }
  console.log(chunk);
}
```

3. **"messages"** - Stream individual message tokens (for TTS)
```typescript
for await (const chunk of await graph.stream(input, {
  ...config,
  streamMode: "messages"
})) {
  console.log(chunk[0].content); // token-by-token
}
```

### State Snapshot & History (Time Travel)

**Get current state:**
```typescript
const snapshot = await graph.getState(config);
console.log(snapshot.values); // current state
console.log(snapshot.next); // next scheduled nodes
console.log(snapshot.config.configurable.checkpoint_id); // checkpoint ID
```

**List checkpoint history:**
```python
checkpoints = []
for checkpoint in graph.get_state_history(config):
    checkpoints.append({
        "checkpoint_id": checkpoint.config["configurable"]["checkpoint_id"],
        "step": len(checkpoint.values.get("messages", [])),
        "values": checkpoint.values
    })

# Resume from past checkpoint
past_config = {
    "configurable": {
        "thread_id": "conv-123",
        "checkpoint_id": checkpoints[2]["checkpoint_id"]
    }
}
result = graph.invoke(input, config=past_config)
```

### Subgraph Pattern (Optional for Complex Workflows)

**Use Command.PARENT to navigate to parent graph:**
```typescript
// Subgraph
const toolSubgraph = new StateGraph(ToolState)
  .addNode("search", searchNode)
  .addNode("synthesis", synthesisNode)
  .addEdge(START, "search")
  .addEdge("search", "synthesis")
  .compile();

// Tool node returns Command to parent
const synthesisNode = (state) => {
  const result = synthesize(state);

  return new Command({
    update: { result },
    goto: "agent", // node in PARENT graph
    graph: Command.PARENT
  });
};

// Parent graph
const graph = new StateGraph(ConversationState)
  .addNode("agent", agentNode)
  .addNode("tools", toolSubgraph) // subgraph as node
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldUseTool, ["tools", END])
  .compile({ checkpointer });
```

### Parallel Node Execution (Fan-out/Fan-in)

**Multiple tools execute concurrently:**
```typescript
const State = Annotation.Root({
  results: Annotation<string[]>({
    reducer: (existing, update) => existing.concat(update), // append
    default: () => []
  })
});

const graph = new StateGraph(State)
  .addNode("search", searchNode)
  .addNode("synthesize", synthesizeNode)
  .addNode("aggregate", aggregateNode)
  .addEdge(START, "search")
  .addEdge(START, "synthesize") // both run in parallel
  .addEdge("search", "aggregate")
  .addEdge("synthesize", "aggregate")
  .addEdge("aggregate", END)
  .compile();

// search and synthesize execute concurrently
// aggregate waits for both to complete
```

### Background Processing Trigger Pattern

**End conversation, trigger async processing:**
```typescript
const endConversationNode = async (state: typeof ConversationState.State) => {
  // Mark conversation as completed
  await db.conversation.update({
    where: { id: state.conversationId },
    data: { status: "completed", endedAt: new Date() }
  });

  // Trigger background job (don't await)
  backgroundQueue.add("process-conversation", {
    conversationId: state.conversationId,
    transcript: state.messages
  });

  return { status: "completed" };
};
```

**Background job (separate process):**
```typescript
// Bull/BullMQ job processor
processor.process("process-conversation", async (job) => {
  const { conversationId, transcript } = job.data;

  // 1. Extract entities
  const entities = await extractEntities(transcript);

  // 2. Update Neo4j
  await neo4j.updateGraph(entities);

  // 3. Generate embeddings
  await generateEmbeddings(conversationId, transcript);

  // 4. Mark complete
  await db.conversation.update({
    where: { id: conversationId },
    data: { entitiesExtracted: true, neo4jSyncedAt: new Date() }
  });
});
```

### Configuration Propagation

**Pass runtime config through graph:**
```typescript
const config = {
  configurable: {
    thread_id: conversationId,
    user_id: userId, // available in all nodes
    model_name: "claude-4-sonnet" // custom config
  }
};

// Access in any node
const myNode = async (state, config: LangGraphRunnableConfig) => {
  const userId = config.configurable?.user_id;
  const modelName = config.configurable?.model_name;
  // ...
};
```

### Error Handling Pattern

**Catch errors, update state, continue:**
```typescript
const agentNode = async (state: typeof ConversationState.State) => {
  try {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  } catch (error) {
    console.error("Agent error:", error);

    // Return error message to user
    return {
      messages: [
        new AIMessage("I encountered an error. Let me try again.")
      ],
      error: error.message
    };
  }
};
```

### Cosmo-Specific Full Pattern

```typescript
import { Annotation, StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { BaseMessage, AIMessage, HumanMessage } from "@langchain/core/messages";

// State definition
const ConversationState = Annotation.Root({
  conversationId: Annotation<string>,
  userId: Annotation<string>,
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, update) => existing.concat(update),
    default: () => []
  }),
  preferences: Annotation<UserPreference[]>({
    reducer: (_, update) => update,
    default: () => []
  }),
  activeEntities: Annotation<ActiveEntities>({
    reducer: (_, update) => update,
    default: () => ({ people: [], projects: [], topics: [] })
  }),
  turnNumber: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 0
  })
});

// Nodes
const loadContextNode = async (state, config) => {
  if (state.preferences.length > 0) return {}; // already loaded

  const userId = config.configurable?.userId;

  const [preferences, activeEntities] = await Promise.all([
    db.userPreference.findMany({ where: { userId } }),
    neo4j.getActiveEntities(userId)
  ]);

  return { preferences, activeEntities };
};

const processMessageNode = async (state) => {
  // Sliding window management
  const WINDOW_SIZE = 15;
  let messages = state.messages;

  if (messages.length > WINDOW_SIZE) {
    const old = messages.slice(0, -WINDOW_SIZE);
    const recent = messages.slice(-WINDOW_SIZE);

    const summary = await llm.invoke([
      new SystemMessage("Summarize briefly"),
      ...old
    ]);

    messages = [
      new SystemMessage(`Context: ${summary.content}`),
      ...recent
    ];
  }

  return { messages };
};

const agentNode = async (state) => {
  // Build context-aware prompt
  const systemPrompt = buildSystemPrompt(state.preferences, state.activeEntities);

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    ...state.messages
  ]);

  return {
    messages: [response],
    turnNumber: state.turnNumber + 1
  };
};

// Build graph
const checkpointer = new MemorySaver();

const graph = new StateGraph(ConversationState)
  .addNode("loadContext", loadContextNode)
  .addNode("processMessage", processMessageNode)
  .addNode("agent", agentNode)
  .addEdge(START, "loadContext")
  .addEdge("loadContext", "processMessage")
  .addEdge("processMessage", "agent")
  .addEdge("agent", END)
  .compile({ checkpointer });

// API endpoint usage
async function handleExchange(conversationId: string, userId: string, userMessage: string) {
  const config = {
    configurable: {
      thread_id: conversationId,
      userId
    }
  };

  const result = await graph.invoke(
    { messages: [new HumanMessage(userMessage)] },
    config
  );

  const assistantMessage = result.messages.at(-1);

  // Update DB
  await db.conversation.update({
    where: { id: conversationId },
    data: {
      transcript: result.messages, // full history
      updatedAt: new Date()
    }
  });

  return {
    text: assistantMessage.content,
    turnNumber: result.turnNumber
  };
}
```

### Key Gotchas

1. **Checkpointer only on parent graph** - automatically propagates to subgraphs
2. **Reducers required for concurrent updates** - especially for messages array
3. **thread_id is the conversation ID** - maps directly to your DB conversation.id
4. **Context loads once per thread** - check if already loaded before fetching
5. **Streaming modes are different** - "values" for full state, "updates" for deltas
6. **Command replaces conditional edges** - use for cleaner state + navigation
7. **Background jobs separate** - don't block graph execution with async processing
8. **State snapshot for debugging** - use getState() to inspect current checkpoint
