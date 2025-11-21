# Structured Outputs - generateObject & streamObject

## Overview

Generate type-safe structured data using Zod schemas. Ideal for:

- **Data Extraction** - Extract information from text
- **Classification** - Categorize content
- **Synthetic Data Generation** - Create test data
- **API Responses** - Return typed JSON objects

## generateObject - Type-Safe Objects

Generate a single object that matches your schema.

### Basic Example

```typescript
import { generateObject } from 'ai';
import { z } from 'zod';

const { object } = await generateObject({
  model: 'openai/gpt-5',

  // Define expected structure
  schema: z.object({
    name: z.string(),
    age: z.number(),
    email: z.string().email(),
  }),

  prompt: 'Extract person data from this text...',
});

// Fully typed!
console.log(object.name);    // string
console.log(object.age);     // number
console.log(object.email);   // string
```

### Complex Nested Schemas

```typescript
const recipeSchema = z.object({
  name: z.string(),
  servings: z.number(),
  ingredients: z.array(
    z.object({
      name: z.string(),
      amount: z.string().describe('Amount with unit (e.g., "2 cups")'),
      isOptional: z.boolean().optional(),
    })
  ),
  steps: z.array(
    z.object({
      number: z.number(),
      instruction: z.string(),
      durationMinutes: z.number().optional(),
    })
  ),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  tags: z.array(z.string()).min(1),
});

const { object: recipe } = await generateObject({
  model: 'openai/gpt-5',
  schema: recipeSchema,
  prompt: 'Generate a lasagna recipe',
});

// Fully typed nested access
recipe.ingredients.forEach(ing => {
  console.log(`${ing.amount} of ${ing.name}`);
});
```

### Descriptions for Better Results

Use `.describe()` to guide the model:

```typescript
const userSchema = z.object({
  firstName: z.string().describe('User first name only'),
  lastName: z.string().describe('User last name only'),
  age: z.number().describe('Age in years'),
  preferredLanguage: z
    .enum(['english', 'spanish', 'french', 'german'])
    .describe('Primary language for communications'),
  isActive: z
    .boolean()
    .describe('Whether user account is currently active'),
});

const { object: user } = await generateObject({
  model: 'openai/gpt-5',
  schema: userSchema,
  prompt: extractUserDataPrompt,
});
```

## streamObject - Streaming Structured Data

Stream partial objects as they're generated. Great for:

- **Real-time Updates** - Show partial results immediately
- **Progressive Enhancement** - UI updates as more data arrives
- **Array Elements** - Stream array items one-by-one

### Basic Streaming

```typescript
import { streamObject } from 'ai';
import { z } from 'zod';

const articleSchema = z.object({
  title: z.string(),
  summary: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      content: z.string(),
    })
  ),
});

const { partialObjectStream } = streamObject({
  model: 'openai/gpt-5',
  schema: articleSchema,
  prompt: 'Write an article about TypeScript',
});

// Partial objects update as generation continues
for await (const partialArticle of partialObjectStream) {
  console.log('Current title:', partialArticle.title); // Partial string
  console.log('Sections so far:', partialArticle.sections?.length);
}
```

### Streaming Array Elements

For generating arrays, stream individual elements:

```typescript
const heroSchema = z.object({
  name: z.string(),
  class: z.enum(['warrior', 'mage', 'rogue']),
  description: z.string(),
});

const { elementStream } = streamObject({
  model: 'openai/gpt-5',
  output: 'array', // ← Important!
  schema: heroSchema,
  prompt: 'Generate 5 fantasy heroes',
});

// Each element arrives as a complete object
for await (const hero of elementStream) {
  console.log(`✓ ${hero.name} the ${hero.class}`);
  // Can send to client immediately
}
```

## Output Strategies

### 1. Object (Default)

Returns a single object:

```typescript
const { object } = await generateObject({
  model: 'openai/gpt-5',
  schema: z.object({ name: z.string() }),
  prompt: 'Generate a person',
  // output: 'object' is default
});

// object: { name: 'John' }
```

### 2. Array

Returns array of objects matching schema:

```typescript
const { object: heroes } = await generateObject({
  model: 'openai/gpt-5',
  output: 'array',
  schema: z.object({
    name: z.string(),
    power: z.string(),
  }),
  prompt: 'Generate 3 superheroes',
});

// object: [
//   { name: 'Superman', power: 'Flight' },
//   { name: 'Batman', power: 'Intelligence' },
//   ...
// ]
```

### 3. Enum

Classify into one of several options:

```typescript
const { object: genre } = await generateObject({
  model: 'openai/gpt-5',
  output: 'enum',
  enum: ['action', 'comedy', 'drama', 'horror', 'sci-fi'],
  prompt: 'Classify this movie plot: "Astronauts search for a new planet"',
});

// object: 'sci-fi'
```

### 4. No Schema

For dynamic/unknown structures:

```typescript
const { object } = await generateObject({
  model: 'openai/gpt-5',
  output: 'no-schema',
  prompt: 'Generate JSON data for a user profile with any fields you think are relevant',
});

// Returns whatever the model generates (less type-safe)
```

## Error Handling

### Invalid Schema Validation

```typescript
import { NoObjectGeneratedError } from 'ai';

try {
  const { object } = await generateObject({
    model: 'openai/gpt-5',
    schema: z.object({
      age: z.number().min(0).max(120),
    }),
    prompt: 'Extract age from: "I am 500 years old"',
  });
} catch (error) {
  if (NoObjectGeneratedError.isInstance(error)) {
    console.error('Failed to generate valid object');
    console.error('Raw text:', error.text);
    console.error('Validation error:', error.cause);
  }
}
```

### Repair Invalid JSON

Automatically attempt to repair malformed JSON:

```typescript
const { object } = await generateObject({
  model: 'openai/gpt-5',
  schema: personSchema,
  prompt: 'Extract person data',

  experimental_repairText: async ({ text, error }) => {
    // Attempt to fix common JSON errors
    let repaired = text;

    // Add missing closing brace
    if (!text.includes('}')) {
      repaired += '}';
    }

    // Remove trailing commas
    repaired = repaired.replace(/,\s*}/g, '}');
    repaired = repaired.replace(/,\s*]/g, ']');

    return repaired;
  },
});
```

## Schema Metadata

```typescript
const { object } = await generateObject({
  model: 'openai/gpt-5',

  // Give schema a name and description
  schemaName: 'BlogPost',
  schemaDescription: 'A complete blog post with title, content, and metadata',

  schema: z.object({
    title: z.string().describe('Post title (max 100 chars)'),
    slug: z.string().describe('URL-friendly version of title'),
    content: z.string().describe('Full post content in markdown'),
    publishedAt: z.date().describe('Publication date'),
    tags: z.array(z.string()).describe('Topic tags'),
  }),

  prompt: 'Create a blog post about TypeScript',
});
```

## Combining with Tools & Reasoning

Use structured outputs with `generateText` for tools + structured output:

```typescript
import { generateText, tool, Output } from 'ai';
import { z } from 'zod';

const { text, experimental_output } = await generateText({
  model: 'openai/gpt-5',

  // Can use tools AND get structured output
  tools: {
    search: searchTool,
    getLinks: linksToolL,
  },

  // Define expected structured output
  experimental_output: Output.object({
    schema: z.object({
      summary: z.string(),
      mainPoints: z.array(z.string()),
      sources: z.array(z.string().url()),
    }),
  }),

  prompt: 'Research and summarize...',
  stopWhen: stepCountIs(5),
});

// Both text AND structured output available
console.log(experimental_output?.summary);
```

## Accessing Reasoning

For reasoning models, get the model's thought process:

```typescript
import { generateObject } from 'ai';
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';

const { object, reasoning } = await generateObject({
  model: 'openai/gpt-5',

  schema: z.object({
    diagnosis: z.string(),
    recommendedTreatment: z.array(z.string()),
    riskFactors: z.array(z.string()),
  }),

  prompt: 'Analyze patient symptoms...',

  // Get detailed reasoning
  providerOptions: {
    openai: {
      reasoningSummary: 'detailed',
    } satisfies OpenAIResponsesProviderOptions,
  },
});

// See how model arrived at answer
console.log('Model reasoning:', reasoning);
console.log('Diagnosis:', object.diagnosis);
```

## Type Inference Patterns

### Create Reusable Schemas

```typescript
// types/schemas.ts
import { z } from 'zod';

export const userSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['admin', 'user', 'guest']),
});

// Extract TypeScript type
export type User = z.infer<typeof userSchema>;

// Use everywhere
const { object: user } = await generateObject({
  model: 'openai/gpt-5',
  schema: userSchema,
  prompt: 'Extract user data',
});

// user is fully typed as User
const userId: string = user.id; // ✅ Works
user.id.toUpperCase(); // ✅ Type-safe
```

### Discriminated Unions

```typescript
const resultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    data: z.string(),
  }),
  z.object({
    status: z.literal('error'),
    message: z.string(),
  }),
]);

const { object: result } = await generateObject({
  model: 'openai/gpt-5',
  schema: resultSchema,
  prompt: 'Process request',
});

// Type-safe discrimination
if (result.status === 'success') {
  console.log('Data:', result.data); // ✅ data is accessible
} else {
  console.log('Error:', result.message); // ✅ message is accessible
}
```

## Real-World Examples

### Data Extraction from Text

```typescript
const { object: contact } = await generateObject({
  model: 'openai/gpt-5',
  schema: z.object({
    name: z.string(),
    email: z.string().email(),
    phone: z.string().optional(),
    company: z.string(),
    jobTitle: z.string(),
  }),
  prompt: `Extract contact info from:
"John Smith (john.smith@acme.com) from Acme Corp works as VP of Engineering"`,
});

// { name: 'John Smith', email: 'john.smith@acme.com', ... }
```

### Sentiment Analysis with Classification

```typescript
const { object: analysis } = await generateObject({
  model: 'openai/gpt-5',
  schema: z.object({
    sentiment: z.enum(['positive', 'negative', 'neutral']),
    confidence: z.number().min(0).max(1),
    keyPhrases: z.array(z.string()),
  }),
  prompt: `Analyze sentiment of: "I love TypeScript! It's amazing for large projects"`,
});

// { sentiment: 'positive', confidence: 0.95, keyPhrases: ['love', 'amazing'] }
```

### API Response Typing

```typescript
const listingSchema = z.object({
  id: z.string(),
  title: z.string(),
  price: z.number(),
  location: z.string(),
  images: z.array(z.string().url()),
  features: z.array(z.string()),
});

const { object: listing } = await generateObject({
  model: 'openai/gpt-5',
  schema: listingSchema,
  prompt: 'Generate a realistic property listing',
});

// Return to client with full type safety
return Response.json(listing);
```

## Performance Tips

1. **Use Descriptions** - Models generate more accurate schemas
2. **Validate Early** - Catch errors before processing
3. **Stream Arrays** - Show first results immediately
4. **Limit Complexity** - Simpler schemas = faster generation
5. **Use Enums** - More reliable than free text
6. **Cache Schemas** - Avoid recreating z.object() repeatedly

## Next Steps

- **Reasoning Models**: See `05-REASONING.md`
- **Backend Patterns**: See `06-BACKEND-PATTERNS.md`
