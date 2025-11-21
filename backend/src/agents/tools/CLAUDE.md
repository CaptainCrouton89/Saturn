## Tool Architecture

All tools use **factory patterns** - they are functions that return tool definitions with bound context.

### Pattern
```typescript
// Factory function
export function myTool(userId: string, contextParam: string) {
  return tool({
    description: '...',
    parameters: schema,
    execute: async (input) => {
      // userId and contextParam are bound in closure
      // LLM only passes schema-defined parameters
    }
  });
}

// Usage in agent
const tools = {
  my_tool: myTool(userId, contextParam),
};
```

### Benefits
- Context (userId, sourceEntityKey, etc.) is bound at tool creation time
- LLM doesn't need to pass context on every call
- Type-safe context binding
- Consistent pattern across all tools

### Existing Tools
- **completeOnboardingTool**(userId, conversationId) - Onboarding completion
- **createArtifactTool**(userId) - Create artifacts
- **updateArtifactTool**(userId) - Update artifacts
- **createEdgeTool**(userId, sourceEntityKey, fromEntityKey, nameToKeyMap) - Create relationships
- **updateEdgeTool**(userId, sourceEntityKey, relationshipType, nameToKeyMap) - Update relationships
- **updateNodeTool**(userId, sourceEntityKey, entityKey, nodeType) - Update nodes
- **addEdgeAndNodeNotesTool**(userId, sourceEntityKey, fromEntityKey, nameToKeyMap) - Update both edge and node

Don't duplicate tools - figure out what exists already.