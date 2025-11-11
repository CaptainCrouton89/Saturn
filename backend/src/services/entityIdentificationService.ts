/**
 * Phase 1: Entity Identification Service
 *
 * Extracts mentioned entities from conversation transcripts using LLM.
 * Generates stable entity_key for idempotent processing.
 *
 * Uses GPT-4o-mini for cost-effective extraction (~$0.002 per conversation).
 */

import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import type { SerializedMessage } from '../agents/types/messages.js';
import { generateEntityKey } from '../utils/entityNormalization.js';

// Zod schemas for structured extraction
const PersonMentionSchema = z.object({
  mentionedName: z.string().describe('The name as mentioned in conversation'),
  contextClue: z.string().describe('Brief context about this person (e.g., "my manager", "friend from college")'),
});

const ProjectMentionSchema = z.object({
  mentionedName: z.string().describe('The project name as mentioned'),
  contextClue: z.string().describe('Brief context (e.g., "startup idea", "side project")'),
});

const IdeaMentionSchema = z.object({
  summary: z.string().describe('Brief summary of the idea'),
});

const TopicMentionSchema = z.object({
  name: z.string().describe('The topic name'),
  category: z.enum(['technical', 'personal', 'philosophical', 'professional']).describe('Topic category'),
});

const ExtractedEntitiesSchema = z.object({
  people: z.array(PersonMentionSchema).describe('People mentioned in the conversation'),
  projects: z.array(ProjectMentionSchema).describe('Projects mentioned'),
  ideas: z.array(IdeaMentionSchema).describe('Ideas discussed'),
  topics: z.array(TopicMentionSchema).describe('Topics discussed'),
});

// Export types
export type PersonMention = z.infer<typeof PersonMentionSchema>;
export type ProjectMention = z.infer<typeof ProjectMentionSchema>;
export type IdeaMention = z.infer<typeof IdeaMentionSchema>;
export type TopicMention = z.infer<typeof TopicMentionSchema>;

export interface EntityCandidate {
  type: 'Person' | 'Project' | 'Idea' | 'Topic';
  mentionedName?: string; // For Person, Project, Topic
  summary?: string; // For Idea
  contextClue?: string;
  category?: string; // For Topic
  entityKey: string; // Stable hash for idempotency
}

export interface IdentifiedEntities {
  people: EntityCandidate[];
  projects: EntityCandidate[];
  ideas: EntityCandidate[];
  topics: EntityCandidate[];
}

class EntityIdentificationService {
  private model: ChatOpenAI;

  constructor() {
    this.model = new ChatOpenAI({
      modelName: 'gpt-4.1-mini',
    });
  }


  /**
   * Prepare transcript for entity extraction
   *
   * Filters out system messages and tool calls, keeping only user/assistant dialogue
   */
  private prepareTranscript(transcript: SerializedMessage[]): string {
    const dialogue = transcript.filter((msg) => msg.type === 'human' || msg.type === 'ai');

    const formatted = dialogue
      .map((msg, idx) => {
        const speaker = msg.type === 'human' ? 'User' : 'Cosmo';
        const content = msg.content || '';
        return `[Turn ${idx + 1}] ${speaker}: ${content}`;
      })
      .join('\n\n');

    return formatted;
  }

  /**
   * Extract entities from conversation transcript
   *
   * @param transcript - Serialized conversation messages
   * @param userId - User ID for generating stable entity keys
   * @returns Identified entities with stable entity_key values
   */
  async identify(transcript: SerializedMessage[], userId: string): Promise<IdentifiedEntities> {
    if (!transcript || transcript.length === 0) {
      throw new Error('Cannot identify entities: transcript is empty');
    }

    const readableTranscript = this.prepareTranscript(transcript);

    if (!readableTranscript) {
      throw new Error('Cannot identify entities: no dialogue found in transcript');
    }

    // Extract entities using structured output
    const structuredLlm = this.model.withStructuredOutput(ExtractedEntitiesSchema);

    const prompt = `You are an expert at extracting entities from conversations. Analyze this conversation and identify:

1. **People**: Anyone mentioned by name or reference (e.g., "Sarah", "my manager", "her friend")
2. **Projects**: Any projects, work, startups, creative endeavors the user is working on or mentioned
3. **Ideas**: Specific ideas discussed, explored, or brainstormed during the conversation
4. **Topics**: Subjects or themes discussed (technical topics, personal interests, philosophical questions)

Guidelines:
- Extract ALL entities, even if mentioned briefly
- For people: Include their name and relationship/context
- For projects: Include project name and type (startup, side project, work, creative)
- For ideas: Brief summary (1-2 sentences)
- For topics: Categorize as technical, personal, philosophical, or professional
- Track where each entity was mentioned (turn numbers or "beginning/middle/end")

Conversation:
${readableTranscript}`;

    try {
      const extracted = await structuredLlm.invoke(prompt);

      // Convert to EntityCandidate format with stable keys (using normalized names for deduplication)
      const people: EntityCandidate[] = extracted.people.map((p) => ({
        type: 'Person' as const,
        mentionedName: p.mentionedName,
        contextClue: p.contextClue,
        entityKey: generateEntityKey(p.mentionedName, 'Person', userId),
      }));

      const projects: EntityCandidate[] = extracted.projects.map((p) => ({
        type: 'Project' as const,
        mentionedName: p.mentionedName,
        contextClue: p.contextClue,
        entityKey: generateEntityKey(p.mentionedName, 'Project', userId),
      }));

      const ideas: EntityCandidate[] = extracted.ideas.map((i) => ({
        type: 'Idea' as const,
        summary: i.summary,
        entityKey: generateEntityKey(i.summary, 'Idea', userId),
      }));

      const topics: EntityCandidate[] = extracted.topics.map((t) => ({
        type: 'Topic' as const,
        mentionedName: t.name,
        category: t.category,
        entityKey: generateEntityKey(t.name, 'Topic', userId),
      }));

      console.log(`✅ Identified entities: ${people.length} people, ${projects.length} projects, ${ideas.length} ideas, ${topics.length} topics`);

      return { people, projects, ideas, topics };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to identify entities: ${errorMessage}`);
    }
  }

  /**
   * Extract entities from unstructured text (information dumps)
   *
   * @param text - Plain text content (notes, journal entries, meeting summaries)
   * @param userId - User ID for generating stable entity keys
   * @returns Identified entities with stable entity_key values
   */
  async identifyFromText(text: string, userId: string): Promise<IdentifiedEntities> {
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot identify entities: text is empty');
    }

    // Extract entities using structured output
    const structuredLlm = this.model.withStructuredOutput(ExtractedEntitiesSchema);

    const prompt = `You are an expert at extracting entities from unstructured text. Analyze this text and identify:

1. **People**: Anyone mentioned by name or reference (e.g., "Sarah", "my manager", "her friend")
2. **Projects**: Any projects, work, startups, creative endeavors mentioned
3. **Ideas**: Specific ideas discussed or mentioned
4. **Topics**: Subjects or themes discussed (technical topics, personal interests, philosophical questions)

Guidelines:
- Extract ALL entities, even if mentioned briefly
- For people: Include their name and relationship/context
- For projects: Include project name and type (startup, side project, work, creative)
- For ideas: Brief summary (1-2 sentences)
- For topics: Categorize as technical, personal, philosophical, or professional

Text:
${text}`;

    try {
      const extracted = await structuredLlm.invoke(prompt);

      // Convert to EntityCandidate format with stable keys
      const people: EntityCandidate[] = extracted.people.map((p) => ({
        type: 'Person' as const,
        mentionedName: p.mentionedName,
        contextClue: p.contextClue,
        entityKey: generateEntityKey(p.mentionedName, 'Person', userId),
      }));

      const projects: EntityCandidate[] = extracted.projects.map((p) => ({
        type: 'Project' as const,
        mentionedName: p.mentionedName,
        contextClue: p.contextClue,
        entityKey: generateEntityKey(p.mentionedName, 'Project', userId),
      }));

      const ideas: EntityCandidate[] = extracted.ideas.map((i) => ({
        type: 'Idea' as const,
        summary: i.summary,
        entityKey: generateEntityKey(i.summary, 'Idea', userId),
      }));

      const topics: EntityCandidate[] = extracted.topics.map((t) => ({
        type: 'Topic' as const,
        mentionedName: t.name,
        category: t.category,
        entityKey: generateEntityKey(t.name, 'Topic', userId),
      }));

      console.log(
        `✅ Identified entities from text: ${people.length} people, ${projects.length} projects, ${ideas.length} ideas, ${topics.length} topics`
      );

      return { people, projects, ideas, topics };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to identify entities from text: ${errorMessage}`);
    }
  }
}

export const entityIdentificationService = new EntityIdentificationService();
