We generally use the vercel ai sdk with tracing:

```typescript
const result = await generateText({
    model: openai("gpt-5-nano", {
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

Tools usually use tool factories so we can dynamically set variables at runtime.

Context for tools/prompts is usually formatted with the src/utils/contextFormatting.ts