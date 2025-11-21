# Tools, Tool Calling & Agents

## Overview

Tools extend LLM capabilities by allowing models to call functions. This enables:

- **External API Integration** - Weather, search, database queries
- **System Interactions** - File operations, system calls
- **Agentic Behavior** - Multi-step reasoning with tool feedback loops
- **Action Taking** - Models can perform actions, not just generate text

## Defining Tools

### Basic Tool Structure

All tools need three components:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const myTool = tool({
  // 1. Description - tells LLM when/why to use this tool
  description: 'Get current weather for a location',

  // 2. Input Schema - validates tool inputs with Zod
  inputSchema: z.object({
    location: z.string().describe('City name'),
    unit: z.enum(['celsius', 'fahrenheit']).optional(),
  }),

  // 3. Execute function - runs when model calls tool
  execute: async ({ location, unit = 'fahrenheit' }) => {
    const weather = await fetchWeather(location);
    return {
      location,
      temperature: weather.temp,
      unit,
      condition: weather.condition,
    };
  },
});
```

### Tool Helper Function

The `tool()` function provides type inference:

```typescript
// ✅ Good - types inferred from schema
const weatherTool = tool({
  inputSchema: z.object({
    location: z.string(),
  }),
  execute: async ({ location }) => {
    // location is inferred as string
    return { temperature: 72 };
  },
});

// ❌ Avoid - loses type inference
const weatherTool = {
  inputSchema: z.object({
    location: z.string(),
  }),
  execute: async (input: any) => {
    // input is typed as 'any'
  },
};
```

### Modular Tool Organization

```typescript
// tools/weather-tool.ts
import { tool } from 'ai';
import { z } from 'zod';

export const weatherTool = tool({
  description: 'Get weather for a location',
  inputSchema: z.object({
    location: z.string(),
  }),
  execute: async ({ location }) => {
    // Implementation
    return { temperature: 72, condition: 'sunny' };
  },
});

// tools/index.ts
export { weatherTool } from './weather-tool';
export { searchTool } from './search-tool';
export { calculatorTool } from './calculator-tool';

// agent.ts
import { generateText, stepCountIs } from 'ai';
import * as tools from './tools';

const { text } = await generateText({
  model: 'openai/gpt-5',
  tools, // All tools in one place
  prompt: 'What is the weather in NYC?',
  stopWhen: stepCountIs(5),
});
```

## Tool Calling with generateText

### Single Tool Call

```typescript
import { generateText, tool } from 'ai';
import { z } from 'zod';

const { text, toolCalls } = await generateText({
  model: 'openai/gpt-5',
  prompt: 'What is the weather in San Francisco?',

  tools: {
    weather: tool({
      description: 'Get weather for a location',
      inputSchema: z.object({
        location: z.string(),
      }),
      execute: async ({ location }) => ({
        location,
        temperature: 72,
        condition: 'sunny',
      }),
    }),
  },
});

// Model calls tool, returns result
console.log(text); // "The weather in San Francisco is sunny and 72°F"
console.log(toolCalls[0]?.toolName); // "weather"
```

### Multi-Step Tool Calling with stopWhen

For agents that need multiple tool calls before generating a response:

```typescript
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';

const { text, steps, totalUsage } = await generateText({
  model: 'openai/gpt-5',
  prompt: 'Plan my weekend trip to NYC. Get weather and find attractions.',

  stopWhen: stepCountIs(5), // Max 5 steps

  tools: {
    getWeather: tool({
      description: 'Get weather for a city',
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ city, temp: 72, condition: 'sunny' }),
    }),
    getAttractions: tool({
      description: 'Find attractions in a city',
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ city, attractions: ['Museum', 'Park', 'Restaurant'] }),
    }),
  },
});

console.log('Final response:', text);
console.log('Steps taken:', steps.length); // How many steps it took
console.log('Total tokens:', totalUsage.totalTokens);
```

### Accessing Tool Results

```typescript
const { steps } = await generateText({
  // ...
  stopWhen: stepCountIs(5),
});

// Each step contains tool calls and results
for (const step of steps) {
  console.log('Step type:', step.type);

  // Tool calls made in this step
  for (const toolCall of step.toolCalls) {
    console.log('Tool:', toolCall.toolName);
    console.log('Input:', toolCall.input);
  }

  // Results from tool executions
  for (const result of step.toolResults) {
    console.log('Result:', result.result);
  }
}
```

## Per-Step Customization

### prepareStep Callback

Customize model, tools, or messages for each step:

```typescript
const { text } = await generateText({
  model: 'openai/gpt-4',
  prompt: 'Complex research task',

  stopWhen: stepCountIs(10),

  tools: {
    research: researchTool,
    analyze: analyzeTool,
    writeReport: reportTool,
  },

  // Called before each step
  prepareStep: async ({
    stepNumber,
    steps,
    messages,
    model,
    stopWhen
  }) => {
    // Step 1: Use only research tool
    if (stepNumber === 1) {
      return {
        activeTools: ['research'],
        toolChoice: { type: 'tool', toolName: 'research' },
      };
    }

    // Step 2: Analysis
    if (stepNumber === 2) {
      return {
        activeTools: ['analyze'],
        model: openai('gpt-5'), // Switch to stronger model
      };
    }

    // Step 3+: Let model choose
    return {};
  },
});
```

### onStepFinish Callback

Process results after each step:

```typescript
const { text } = await generateText({
  model: 'openai/gpt-5',
  prompt: 'Query database and summarize results',

  stopWhen: stepCountIs(5),

  onStepFinish: ({
    text,
    toolCalls,
    toolResults,
    finishReason,
    usage,
    stepNumber
  }) => {
    console.log(`Step ${stepNumber} finished`);
    console.log('Finish reason:', finishReason);
    console.log('Tokens this step:', usage.totalTokens);

    // Save to database
    saveStep({
      stepNumber,
      toolCalls,
      results: toolResults,
      finalText: text,
    });
  },
});
```

## Tool Execution Options

### Access Tool Call ID

```typescript
const { text } = await generateText({
  tools: {
    myTool: tool({
      inputSchema: z.object({ query: z.string() }),
      execute: async (input, { toolCallId }) => {
        console.log('Tool call ID:', toolCallId);
        // Use for tracking/logging
        return { result: 'success' };
      },
    }),
  },
  prompt: 'Use my tool',
});
```

### Access Message History

```typescript
const myTool = tool({
  inputSchema: z.object({ query: z.string() }),
  execute: async (input, { messages }) => {
    // Messages include all previous exchanges
    // Useful for context-aware tool execution
    const lastUserMessage = messages.findLast(m => m.role === 'user');
    console.log('Context:', lastUserMessage?.content);
    return { result: 'success' };
  },
});
```

### Abort Signals

```typescript
const controller = new AbortController();

const { text } = await generateText({
  model: 'openai/gpt-5',
  prompt: 'Do something',
  abortSignal: controller.signal,

  tools: {
    slowTool: tool({
      inputSchema: z.object({ input: z.string() }),
      execute: async (input, { abortSignal }) => {
        // Respect abort signal
        const response = await fetch('https://api.example.com', {
          signal: abortSignal,
        });
        return response.json();
      },
    }),
  },
});

// Cancel everything
setTimeout(() => controller.abort(), 5000);
```

## Tool Choice Control

```typescript
const { text } = await generateText({
  model: 'openai/gpt-5-mini',
  prompt: 'Your request',

  tools: {
    getTweets: tweetTool,
    getImages: imageTool,
    getText: textTool,
  },

  // Force model to use a tool
  toolChoice: 'required',

  // Or force specific tool
  // toolChoice: { type: 'tool', toolName: 'getTweets' },

  // Or disable tools
  // toolChoice: 'none',
});
```

## Error Handling for Tools

### Invalid Tool Input

```typescript
import { InvalidToolInputError, NoSuchToolError } from 'ai';

try {
  const { text } = await generateText({
    model: 'openai/gpt-5',
    prompt: 'Your prompt',
    tools: { myTool },
    stopWhen: stepCountIs(5),
  });
} catch (error) {
  if (InvalidToolInputError.isInstance(error)) {
    console.error('Model called tool with invalid inputs');
  } else if (NoSuchToolError.isInstance(error)) {
    console.error('Model tried to call non-existent tool');
  }
}
```

### Tool Execution Errors

When tools throw errors, they're added to the response:

```typescript
const { steps } = await generateText({
  model: 'openai/gpt-5',
  prompt: 'Use tools',
  tools: {
    unreliableTool: tool({
      inputSchema: z.object({}),
      execute: async () => {
        throw new Error('This tool failed!');
      },
    }),
  },
  stopWhen: stepCountIs(5),
});

// Check for tool errors in steps
for (const step of steps) {
  for (const part of step.content) {
    if (part.type === 'tool-error') {
      console.error('Tool error:', part.toolName, part.error);
    }
  }
}
```

## Using Ready-Made Tool Libraries

```typescript
// Web search
import { webSearchTool } from '@exalabs/ai-sdk';

// Stripe integration
import { stripeTools } from '@ai-sdk/stripe';

// 20+ integrations
import { tools } from 'agentic';

const { text } = await generateText({
  model: 'openai/gpt-5',
  prompt: 'Search for TypeScript articles',
  tools: {
    webSearch: webSearchTool,
    stripe: stripeTools.createCustomer,
  },
  stopWhen: stepCountIs(5),
});
```

## Agent Class (Optional)

For more structured agent definition:

```typescript
import { Experimental_Agent as Agent, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';

const myAgent = new Agent({
  model: openai('gpt-5'),
  system: 'You are a research assistant.',
  stopWhen: stepCountIs(10),

  tools: {
    search: searchTool,
    analyze: analyzeTool,
  },
});

// Generate response
const { text } = await myAgent.generate({
  prompt: 'Research TypeScript trends',
});

// Or stream response
const result = myAgent.stream({
  prompt: 'Research TypeScript trends',
});

for await (const chunk of result.textStream) {
  console.log(chunk);
}
```

## Best Practices

1. **Write Clear Descriptions** - LLMs use descriptions to decide when to use tools
2. **Validate Schemas** - Use Zod to ensure type safety
3. **Implement Timeouts** - Tool execution can fail; add error handling
4. **Limit Steps** - Prevent infinite loops with `stepCountIs(N)`
5. **Log Tool Usage** - Track which tools are called and why
6. **Test Tools** - Tools should work independently before using in agents
7. **Use prepareStep** - Customize behavior per step for complex workflows
8. **Cache Results** - Avoid repeated tool calls for same inputs

## Next Steps

- **Structured Outputs**: See `04-STRUCTURED-OUTPUTS.md`
- **Reasoning Models**: See `05-REASONING.md`
- **Backend Patterns**: See `06-BACKEND-PATTERNS.md`
