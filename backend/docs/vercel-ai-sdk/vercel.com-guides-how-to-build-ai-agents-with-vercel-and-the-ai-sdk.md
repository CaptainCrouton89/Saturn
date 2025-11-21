---
url: https://vercel.com/guides/how-to-build-ai-agents-with-vercel-and-the-ai-sdk
title: How to build AI Agents with Vercel and the AI SDK
description: Learn how to build, deploy, and scale AI agents on Vercel using the AI SDK. This guide covers calling LLMs, defining tools, creating multi-step agents, and monitoring performance.
access_date: 2025-11-16T22:44:36.000Z
current_date: 2025-11-16T22:44:36.051Z
---

AI agents are systems that observe their environment, make decisions, and take actions to achieve goals. You can think of an agent as a loop that interprets inputs using a large language model (LLM), selects a tool, executes it, and then updates its context before the next decision. Vercel provides the infrastructure, tools, and SDKs to build, deploy, and scale these agents.

This guide will walk you through the process of building an agent using the AI SDK. You will learn how to call an LLM, define tools, and create an agent that can perform tasks based on user input.

## Prerequisites

Before you begin, make sure you have:

* A Vercel account.
* Basic knowledge of TypeScript and Next.js.
* An AI Gateway key created from your dashboard. See step three in the AI Gateway getting started guide.
* The `ai` and `zod` packages installed in your project.
* The Vercel CLI installed (optional for deployment from the command line).

## Calling an LLM

The first step in building an agent is to call an LLM. The AI SDK provides an API for generating text using various models. The following example uses OpenAI, but you can also use Anthropic, Google, Mistral, and other providers..

You can use the `generateText` function to call an LLM and get a response. The function takes a prompt and returns the generated text.

lib/agents.ts

```

import { generateText } from 'ai';


export async function getWeather({location}: string) {

  const { text } = await generateText({

    model: 'openai/gpt-5',

    prompt: `What is the weather like today in ${location}?`,

  });


  console.log(text);

}


```

Because you are using the AI Gateway with the AI SDK, you do not need to install and import the `openai` package; instead, you can define the model using only a string. See the AI Gateway documentation to learn more.

This basic example demonstrates a single LLM call, but it can't yet take actions or use tools.

## Using tools

Tools are functions that the model can call to perform specific tasks. An agent can use tools to extend its capabilities and perform actions based on the context of the conversation. For example, a tool could be a function that queries an external API, performs calculations, or triggers an action.

### How tools work

When you provide tools to the model, it can decide to use them based on the user's input. If the model chooses to use a tool, it will return a structured response indicating which tool to call and the necessary arguments, which are inferred from the context:

```

{

  "tool": "weather",

  "arguments": { "location": "San Francisco" }

}


```

The AI SDK automatically handles:

* Extracting the tool call from the model output
* Validating the arguments against the tool schema
* Executing the function
* Storing both the call and the result in the conversation history

### Defining tools

The AI SDK provides a way to define tools using the `tool` function. This function takes a `description`, `inputSchema` (defined with `zod`), and an `execute` function that performs the action.

lib/agents.ts

```

import { generateText, tool } from 'ai';

import { z } from 'zod';

    prompt: `What is the weather in ${location}?`,

    tools: {

      weather: tool({

        description: 'Get the weather in a location',

        inputSchema: z.object({

          location: z.string().describe('The location to get the weather for'),

        }),

        execute: async ({ location }) => ({

          location,

          temperature: 72 + Math.floor(Math.random() * 21) - 10,

        }),

      }),

      activities: tool({

        description: 'Get the activities in a location',

          location: z

            .string()

            .describe('The location to get the activities for'),

        }),

          activities: ['hiking', 'swimming', 'sightseeing'],

        }),

      }),

    },

  });

  console.log(text);

}


```

In this example, the AI SDK:

* Extracts the tool call from the model output.
* Validates the arguments against the tool schema (defined in the `inputSchema`).
* Executes the function, and stores both the call and its result in `toolCalls` and `toolResults`, which are also added to the message history.

### Why tool descriptions matter

The `description` field is crucial as it tells the model when and how to use the tool. Write clear, specific descriptions that include:

* What the tool does.
* When it should be used.
* What kind of results it returns.

The more specific your descriptions, the better the model will be at choosing the right tool for the task.

## Creating an agent

At the moment, your agent only consists of a single call to the LLM and then stops. Because the AI SDK defaults the number of steps used to 1, the model will make a decision based on the user's input to decide:

* If it should directly return a text response.
* If it should call a tool, and if so, which one.

Either way, once the model has completed its generation, that step is complete. To continue generating results, whether that involves using additional tools or responding to the user with the tool's results, you need to trigger another request.

### Using `stopWhen` and `stepCountIs` for multi-step reasoning

This can be done by configuring a loop using the `stopWhen` and `stepCountIs` parameters to specify the maximum number of steps the agent can take before stopping. The AI SDK automatically handles orchestration by appending each response to the conversation history, executing tool calls, and triggering additional generations until either the maximum number of steps is reached or a text response is received.

### The agent loop

A typical agent flow looks like this:

1. You (the developer) send a prompt to the LLM.
2. The LLM decides to either generate text or call a tool (returning the tool name and arguments).
3. If a tool is called, the AI SDK executes the tool and receives the result.
4. The AI SDK appends the tool call and result to the conversation history.
5. The AI SDK automatically triggers a new generation based on the updated conversation history.
6. Steps 2-5 repeat until either reaching the maximum number of steps (defined by `stopWhen`) or receiving a text response without a tool call.
7. The final text response is returned.

lib/agents.ts

```

import { generateText, tool, stepCountIs } from 'ai';

    stopWhen: stepCountIs(5), // Allow up to 5 steps

    tools: {

        parameters: z.object({

        }),

        }),

      }),

        }),

        }),

      }),

    },

  });

}


```

## Deploying AI agents on Vercel

To deploy your agent on Vercel, create an API route with the following code. The agent will loop through the steps until it reaches a stopping condition, which is when it receives a text response. Once deployed, your API route will be using Fluid compute, which is ideal for AI agents because it:

* Minimizes cold starts for faster response times.
* Allows tasks to run in the background after responding to users.
* Enables considerably longer function durations, perfect for agents that run for extended periods.
* Supports concurrent workloads without the typical timeouts of traditional serverless environments.
* Automatically scales with increased usage.

Depending on your plan, the default maximum duration will be between 60 and 800 seconds. You can also set a custom maximum duration for your agent by using the \`maxDuration\` variable in your API route. This will allow you to specify how long the agent can run before timing out.

lib/agents.ts

```


// Set the maximum duration for this function

export const maxDuration = 60; // 60 seconds


export async function POST(request: Request) {

  const { prompt }: { prompt?: string } = await request.json();


  if (!prompt) {

    return new Response('Prompt is required', { status: 400 });

  }


  const result = await generateText({

    prompt,

    stopWhen: stepCountIs(5),

    tools: {

        }),

        }),

      }),

        }),

        }),

      }),

    },

  });


  return Response.json({

    steps: result.steps,

    finalAnswer: result.text,

  });

}


```

### Understanding maxDuration

Depending on your plan, the default maximum duration will be between 300 and 800 seconds. You can set a custom maximum duration for your agent by using the `maxDuration` variable in your API route. This allows you to specify how long the agent can run before timing out.

Choose a duration based on your agent's complexity:

* **Simple agents (1-3 tool calls)**: 30-60 seconds
* **Moderate agents (multiple sequential operations)**: 60-180 seconds
* **Complex agents (extensive reasoning chains)**: 180-900 seconds

With Fluid compute, you have significantly more time for your agent to complete complex multi-step workflows.

### Deploy to Vercel

Deply your agent using the Vercel CLI:

```

vercel deploy


```

## Testing your agent

Once deployed, you can test your agent using `curl`:

```

curl -X POST https://your-project.vercel.app/api/agent \

  -H "Content-Type: application/json" \

  -d '{"prompt":"What is the weather in Tokyo?"}'


```

The response will include both the steps of the agent and the final answer:

Response

```

{

  "steps": [

    {

      "stepType": "initial",

      "toolCalls": [

        {

          "type": "tool-call",

          "toolCallId": "call_7QGq6MRbq0L3lLwpN23OMDKm",

          "toolName": "weather",

          "args": { "location": "Tokyo" }

        }

      ],

      "toolResults": [

        {

          "type": "tool-result",

          "result": {

            "location": "Tokyo",

            "temperature": 77,

            "condition": "cloudy"

          }

        }

      ]

    },

    {

      "stepType": "tool-result",

      "text": "The weather in Tokyo is currently cloudy with a temperature of 77°F."

    }

  ],

  "finalAnswer": "The weather in Tokyo is currently cloudy with a temperature of 77°F."

}


```

## Observing your agent

Once deployed, you can observe your agent's behavior using the **Observability** and **Logs** tabs in the Vercel dashboard. 

### Observability tab

The **Observability** tab provides insights into:

* The number of requests over time.
* Response times and latency metrics.
* Error rates and patterns
* Performance trends

### Logs tab

If you've added logging to your agent (using `console.log`, `console.error`, etc.), you can view the logs in the **Logs** tab. This is helpful for:

* Debugging tool execution
* Understanding the agent's decision making process
* Tracking token usage
* Identifying errors and edge cases

## More resources

To learn more about building AI agents, see the following resources:

* AI SDK documentation
* AI SDK examples
* AI SDK cookbook
* Fluid compute documentation