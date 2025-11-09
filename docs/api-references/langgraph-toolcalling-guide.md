# LangGraph/LangChain Tool Calling Reference

## Non-obvious Implementation Details

### InjectedState vs Config for State Access
Two ways to access state in tools:

**Python:**
```python
# InjectedState - typed state access
from langgraph.prebuilt import InjectedState

@tool
def my_tool(state: Annotated[CustomState, InjectedState]) -> str:
    return state["user_name"]

# Config - untyped configurable access
from langchain_core.runnables import RunnableConfig

@tool
def my_tool(config: RunnableConfig) -> str:
    return config["configurable"]["user_id"]
```

**TypeScript:**
```typescript
// Config with state injection
const myTool = tool(
  async (_, config: LangGraphRunnableConfig) => {
    const state = config.configurable?.state;
    const userId = config.configurable?.userId;
  }
);
```

### Command Object for State Updates from Tools
Tools can return `Command` to update graph state:
```python
from langgraph.types import Command

@tool
def update_tool(
    state: Annotated[CustomState, InjectedState],
    tool_call_id: Annotated[str, InjectedToolCallId]
) -> Command:
    return Command(
        goto="next_node",  # optional navigation
        update={
            "user_name": "John",
            "messages": [ToolMessage("Updated", tool_call_id=tool_call_id)]
        },
        graph=Command.PARENT  # update parent graph
    )
```

### InjectedToolCallId for Proper Message Attribution
Always use for ToolMessage responses:
```python
from langchain_core.tools import InjectedToolCallId

@tool
def my_tool(
    tool_call_id: Annotated[str, InjectedToolCallId]
) -> Command:
    return Command(update={
        "messages": [ToolMessage("result", tool_call_id=tool_call_id)]
    })
```

### Handoff Tools Use Command for Navigation
```python
@tool
def transfer_to_agent(
    state: Annotated[MessagesState, InjectedState],
    tool_call_id: Annotated[str, InjectedToolCallId]
) -> Command:
    tool_message = {
        "role": "tool",
        "content": f"Transferred to {agent_name}",
        "tool_call_id": tool_call_id,
    }
    return Command(
        goto=agent_name,
        update={"messages": state["messages"] + [tool_message]},
        graph=Command.PARENT  # navigate in parent graph
    )
```

### Parallel Tool Calls Can Be Disabled
```python
agent = create_react_agent(
    model=model.bind_tools(tools, parallel_tool_calls=False),
    tools=tools
)
```

### Force Tool Usage with tool_choice
```python
# Force specific tool
agent = create_react_agent(
    model=model.bind_tools(tools, tool_choice={"type": "tool", "name": "greet"}),
    tools=tools
)

# Force any tool
llm_with_tools = llm.bind_tools([tool], tool_choice="any")
```

### ToolNode Executes Tool Calls from State
```python
from langgraph.prebuilt import ToolNode

tool_node = ToolNode([get_weather])

# Expects state["messages"][-1].tool_calls
builder.add_node("tools", tool_node)
```

### Custom Tool Node Implementation
```python
tools_by_name = {tool.name: tool for tool in tools}

def tool_node(state: AgentState):
    outputs = []
    for tool_call in state["messages"][-1].tool_calls:
        tool_result = tools_by_name[tool_call["name"]].invoke(tool_call["args"])
        outputs.append(
            ToolMessage(
                content=json.dumps(tool_result),
                name=tool_call["name"],
                tool_call_id=tool_call["id"],
            )
        )
    return {"messages": outputs}
```

### Dynamic Tool Selection Pattern
```python
def select_tools(state: State):
    # Analyze state to choose relevant tools
    selected_tool_ids = analyze_state(state)
    return {"selected_tools": selected_tool_ids}

def agent(state: State):
    selected_tools = [tool_registry[id] for id in state["selected_tools"]]
    llm_with_tools = llm.bind_tools(selected_tools)
    return {"messages": [llm_with_tools.invoke(state["messages"])]}
```

### Runtime Context for Tool Configuration
```python
from langgraph.runtime import Runtime

def configure_model(state: AgentState, runtime: Runtime[CustomContext]):
    selected_tools = [
        tool for tool in all_tools
        if tool.name in runtime.context.tools
    ]
    return model.bind_tools(selected_tools)

agent = create_react_agent(
    configure_model,  # dynamic config function
    tools=all_tools
)

# Invoke with context
agent.invoke(
    {"messages": [...]},
    context=CustomContext(tools=["weather"])
)
```

### Supervisor Pattern with Sub-agents as Tools
```python
from langgraph.prebuilt import InjectedState

def agent_1(state: Annotated[dict, InjectedState]):
    response = model.invoke(...)
    return response.content

tools = [agent_1, agent_2]  # agents exposed as tools
supervisor = create_react_agent(model, tools)
```

### tools_condition Helper for Routing
```python
from langgraph.prebuilt import tools_condition

builder.add_conditional_edges(
    "agent",
    tools_condition,  # routes to "tools" or END
    path_map=["tools", "__end__"]
)
```

### Agent Loop Implementation Pattern
```python
@entrypoint()
def agent(messages):
    llm_response = call_model(messages).result()

    while True:
        if not llm_response.tool_calls:
            break

        # Parallel tool execution
        tool_futures = [
            call_tool(tc) for tc in llm_response.tool_calls
        ]
        tool_results = [fut.result() for fut in tool_futures]

        messages = add_messages(messages, [llm_response, *tool_results])
        llm_response = call_model(messages).result()

    return llm_response
```

### State Schema Inheritance
```python
from langgraph.prebuilt.chat_agent_executor import AgentState

class CustomState(AgentState):
    user_name: NotRequired[str]  # optional field
    session_id: str  # required field
```

### Message Addition is Append-only
```python
from langgraph.graph.message import add_messages

# Always appends, never replaces
messages = add_messages(old_messages, new_messages)
```
