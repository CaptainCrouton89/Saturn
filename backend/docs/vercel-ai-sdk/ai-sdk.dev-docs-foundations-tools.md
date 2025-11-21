---
url: https://ai-sdk.dev/docs/foundations/tools
title: Foundations: Tools
description: Learn about tools with the AI SDK.
access_date: 2025-11-16T22:44:18.000Z
current_date: 2025-11-16T22:44:18.061Z
---

# Tools

While large language models (LLMs) have incredible generation capabilities, they struggle with discrete tasks (e.g. mathematics) and interacting with the outside world (e.g. getting the weather).

Tools are actions that an LLM can invoke. The results of these actions can be reported back to the LLM to be considered in the next response.

For example, when you ask an LLM for the "weather in London", and there is a weather tool available, it could call a tool with London as the argument. The tool would then fetch the weather data and return it to the LLM. The LLM can then use this information in its response.

## What is a tool?

A tool is an object that can be called by the model to perform a specific task. You can use tools with `generateText`and `streamText` by passing one or more tools to the `tools` parameter.

A tool consists of three properties:

* **`description`**: An optional description of the tool that can influence when the tool is picked.
* **`inputSchema`**: A Zod schema or a JSON schema that defines the input required for the tool to run. The schema is consumed by the LLM, and also used to validate the LLM tool calls.
* **`execute`**: An optional async function that is called with the arguments from the tool call.

`streamUI` uses UI generator tools with a `generate` function that can return React components.

If the LLM decides to use a tool, it will generate a tool call. Tools with an `execute` function are run automatically when these calls are generated. The output of the tool calls are returned using tool result objects.

You can automatically pass tool results back to the LLM using multi-step calls with `streamText` and `generateText`.

## Schemas

Schemas are used to define the parameters for tools and to validate the tool calls.

The AI SDK supports both raw JSON schemas (using the `jsonSchema` function) and Zod schemas (either directly or using the `zodSchema` function).

Zod is a popular TypeScript schema validation library. You can install it with:

pnpm add zod

You can then specify a Zod schema, for example:

```

import z from 'zod';


const recipeSchema = z.object({

  recipe: z.object({

    name: z.string(),

    ingredients: z.array(

      z.object({

        name: z.string(),

        amount: z.string(),

      }),

    ),

    steps: z.array(z.string()),

  }),

});


```

You can also use schemas for structured output generation with`generateObject` and`streamObject`.

## Tool Packages

Given tools are JavaScript objects, they can be packaged and distributed through npm like any other library. This makes it easy to share reusable tools across projects and with the community.

### Using Ready-Made Tool Packages

Install a tool package and import the tools you need:

```

pnpm add some-tool-package


```

Then pass them directly to `generateText`, `streamText`, or your agent definition:

```

import { generateText, stepCountIs } from 'ai';

import { searchTool } from 'some-tool-package';


const { text } = await generateText({

  model: 'anthropic/claude-haiku-4.5',

  prompt: 'When was Vercel Ship AI?',

  tools: {

    webSearch: searchTool,

  },

  stopWhen: stepCountIs(10),

});


```

### Publishing Your Own Tools

You can publish your own tool packages to npm for others to use. Simply export your tool objects from your package:

```

// my-tools/index.ts

export const myTool = {

  description: 'A helpful tool',

  inputSchema: z.object({

    query: z.string(),

  }),

  execute: async ({ query }) => {

    // your tool logic

    return result;

  },

};


```

Anyone can then install and use your tools by importing them.

To get started, you can use the AI SDK Tool Package Template which provides a ready-to-use starting point for publishing your own tools.

## Toolsets

When you work with tools, you typically need a mix of application-specific tools and general-purpose tools. The community has created various toolsets and resources to help you build and use tools.

### Ready-to-Use Tool Packages

These packages provide pre-built tools you can install and use immediately:

* **@exalabs/ai-sdk** \- Web search tool that lets AI search the web and get real-time information.
* **@parallel-web/ai-sdk-tools** \- Web search and extract tools powered by Parallel Web API for real-time information and content extraction.
* **Stripe agent tools** \- Tools for interacting with Stripe.
* **StackOne ToolSet** \- Agentic integrations for hundreds of enterprise SaaS platforms.
* **agentic** \- A collection of 20+ tools that connect to external APIs such as Exa or E2B.
* **Composio** \- 250+ tools like GitHub, Gmail, Salesforce and more.
* **JigsawStack** \- Over 30+ small custom fine-tuned models available for specific uses.
* **AI Tools Registry** \- A Shadcn-compatible tool definitions and components registry for the AI SDK.
* **Toolhouse** \- AI function-calling in 3 lines of code for over 25 different actions.

### MCP Tools

These are pre-built tools available as MCP servers:

* **Smithery** \- An open marketplace of 6,000+ MCPs, including Browserbase and Exa.
* **Pipedream** \- Developer toolkit that lets you easily add 3,000+ integrations to your app or AI agent.
* **Apify** \- Apify provides a marketplace of thousands of tools for web scraping, data extraction, and browser automation.

### Tool Building Tutorials

These tutorials and guides help you build your own tools that integrate with specific services:

* **browserbase** \- Tutorial for building browser tools that run a headless browser.
* **browserless** \- Guide for integrating browser automation (self-hosted or cloud-based).
* **AI Tool Maker** \- A CLI utility to generate AI SDK tools from OpenAPI specs.
* **Interlify** \- Guide for converting APIs into tools.
* **DeepAgent** \- A suite of 50+ AI tools and integrations, seamlessly connecting with APIs like Tavily, E2B, Airtable and more.

Do you have open source tools or tool libraries that are compatible with the AI SDK? Please file a pull request to add them to this list.

## Learn more

The AI SDK Core Tool Calling and Agents documentation has more information about tools and tool calling.