/**
 * LoCoMo Dataset Adapter
 *
 * Parses LoCoMo dialogues and chunks them into processable conversation segments.
 */

import { get_encoding } from 'tiktoken';
import { ChatOpenAI } from '@langchain/openai';
import type {
  LoCoMoDialogue,
  ParsedDialogue,
  ConversationChunk,
  ChunkConfig,
} from './types.js';

const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
  max_tokens: 4000,
  overlap_tokens: 200,
  preserve_turn_boundaries: true,
};

/**
 * Parse raw LoCoMo dialogue JSON string into structured format
 */
export function parseDialogue(dialogue: LoCoMoDialogue): ParsedDialogue {
  try {
    const turns = JSON.parse(dialogue.turns);

    if (!turns.speaker_role || !turns.utterance) {
      throw new Error('Missing speaker_role or utterance in turns');
    }

    if (turns.speaker_role.length !== turns.utterance.length) {
      throw new Error('Mismatch between speaker_role and utterance arrays');
    }

    return {
      dialogue_id: dialogue.dialogue_id,
      speaker_roles: turns.speaker_role,
      utterances: turns.utterance,
    };
  } catch (error) {
    throw new Error(`Failed to parse dialogue ${dialogue.dialogue_id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Identify real speaker names from dialogue content using GPT-4.1-nano
 *
 * Analyzes first 4 utterances from each speaker to extract actual names.
 * Throws error if names cannot be identified.
 */
export async function identifySpeakerNames(
  dialogue: ParsedDialogue
): Promise<{ Speaker_1: string; Speaker_2: string }> {
  // Collect first 4 utterances for each speaker
  const speaker1Utterances: string[] = [];
  const speaker2Utterances: string[] = [];

  for (let i = 0; i < dialogue.utterances.length; i++) {
    if (speaker1Utterances.length >= 4 && speaker2Utterances.length >= 4) {
      break;
    }

    if (dialogue.speaker_roles[i] === 'Speaker_1' && speaker1Utterances.length < 4) {
      speaker1Utterances.push(dialogue.utterances[i]);
    } else if (dialogue.speaker_roles[i] === 'Speaker_2' && speaker2Utterances.length < 4) {
      speaker2Utterances.push(dialogue.utterances[i]);
    }
  }

  if (speaker1Utterances.length === 0 || speaker2Utterances.length === 0) {
    throw new Error(`Insufficient utterances for speaker identification in dialogue ${dialogue.dialogue_id}`);
  }

  // Build sample text for analysis
  const sampleText = `Speaker_1 utterances:
${speaker1Utterances.map((u, i) => `${i + 1}. ${u}`).join('\n')}

Speaker_2 utterances:
${speaker2Utterances.map((u, i) => `${i + 1}. ${u}`).join('\n')}`;

  const model = new ChatOpenAI({
    modelName: 'gpt-4.1-mini',
  });

  const prompt = `You are analyzing a dialogue to identify the real names of the speakers.

Below are sample utterances spoken BY each speaker. Your task is to identify who is speaking in each case.

IMPORTANT: When Speaker_1 says "Hey Carol!", that means Speaker_1 is greeting Carol, so Speaker_1's name is NOT Carol.

Look for:
1. Who they are greeting/addressing (the OTHER person's name)
2. Who is being referred to as "you" (the OTHER person)
3. Self-references like "I'm Sarah" or "My name is John"

${sampleText}

Respond ONLY with a JSON object in this exact format (no markdown, no code blocks):
{"Speaker_1": "name_of_person_speaking", "Speaker_2": "name_of_person_speaking"}

Example logic:
- If Speaker_1 says "Hey Carol!", then Speaker_1 is NOT Carol (Carol is who they're talking to)
- If Speaker_2 says "Hi Roy!", then Speaker_2 is NOT Roy (Roy is who they're talking to)
- If Speaker_1 says "Hey Carol!" and Speaker_2 says "Hi Roy!", then Speaker_1=Roy and Speaker_2=Carol

You MUST identify both names. Do not use "Speaker_1" or "Speaker_2" as names.`;

  const response = await model.invoke(prompt);
  const content = response.content.toString().trim();

  // Parse JSON response
  const names = JSON.parse(content) as { Speaker_1: string; Speaker_2: string };

  // Validate response structure
  if (!names.Speaker_1 || !names.Speaker_2) {
    throw new Error(`Invalid response structure from speaker identification for dialogue ${dialogue.dialogue_id}`);
  }

  // Validate that actual names were identified (not fallback labels)
  if (names.Speaker_1 === 'Speaker_1' || names.Speaker_2 === 'Speaker_2') {
    throw new Error(`Failed to identify actual speaker names for dialogue ${dialogue.dialogue_id} - model returned fallback labels`);
  }

  return names;
}

/**
 * Count tokens using tiktoken (cl100k_base encoding used by modern OpenAI models)
 */
export function countTokens(text: string): number {
  const encoder = get_encoding('cl100k_base');
  const tokens = encoder.encode(text);
  const count = tokens.length;
  encoder.free();
  return count;
}

/**
 * Format a single turn with speaker label
 *
 * Uses actual speaker names from the mapping.
 */
function formatTurn(
  speaker: string,
  utterance: string,
  speakerNames: { Speaker_1: string; Speaker_2: string }
): string {
  const displayName = speakerNames[speaker as 'Speaker_1' | 'Speaker_2'];
  if (!displayName) {
    throw new Error(`Unknown speaker role: ${speaker}`);
  }
  return `${displayName}: ${utterance}`;
}

/**
 * Chunk a dialogue into conversation segments
 *
 * Strategy:
 * 1. Process turns sequentially
 * 2. Accumulate turns until max_tokens reached
 * 3. When limit reached, create chunk with overlap from previous chunk
 * 4. Preserve turn boundaries (never split mid-utterance)
 * 5. Use actual speaker names
 */
export function chunkDialogue(
  dialogue: ParsedDialogue,
  config: ChunkConfig = DEFAULT_CHUNK_CONFIG
): ConversationChunk[] {
  if (!dialogue.speaker_names) {
    throw new Error(`Speaker names must be identified before chunking dialogue ${dialogue.dialogue_id}`);
  }

  const chunks: ConversationChunk[] = [];
  const totalTurns = dialogue.utterances.length;
  const speakerNames = dialogue.speaker_names;

  let currentTurnIndex = 0;
  let chunkIndex = 0;

  while (currentTurnIndex < totalTurns) {
    // Build current chunk
    const chunkTurns: string[] = [];
    let chunkTokenCount = 0;
    const chunkStartIndex = currentTurnIndex;

    // Add turns until we hit token limit
    while (currentTurnIndex < totalTurns) {
      const turn = formatTurn(
        dialogue.speaker_roles[currentTurnIndex],
        dialogue.utterances[currentTurnIndex],
        speakerNames
      );
      const turnTokens = countTokens(turn);

      // Check if adding this turn would exceed limit
      if (chunkTurns.length > 0 && chunkTokenCount + turnTokens > config.max_tokens) {
        break;
      }

      chunkTurns.push(turn);
      chunkTokenCount += turnTokens;
      currentTurnIndex++;
    }

    // If no turns were added (single turn exceeds max_tokens), force add it
    if (chunkTurns.length === 0 && currentTurnIndex < totalTurns) {
      const turn = formatTurn(
        dialogue.speaker_roles[currentTurnIndex],
        dialogue.utterances[currentTurnIndex],
        speakerNames
      );
      chunkTurns.push(turn);
      chunkTokenCount = countTokens(turn);
      currentTurnIndex++;
    }

    // Create chunk
    const transcript = chunkTurns.join('\n\n');
    chunks.push({
      dialogue_id: dialogue.dialogue_id,
      chunk_index: chunkIndex,
      total_chunks: 0, // Will be updated after all chunks created
      turn_start: chunkStartIndex,
      turn_end: currentTurnIndex - 1,
      transcript,
      token_count: chunkTokenCount,
      overlap_with_previous: chunkIndex > 0 && config.overlap_tokens > 0,
    });

    chunkIndex++;

    // Calculate overlap for next chunk
    if (currentTurnIndex < totalTurns && config.overlap_tokens > 0) {
      // Backtrack to include overlap turns
      let overlapTokens = 0;
      let overlapTurns = 0;

      for (let i = currentTurnIndex - 1; i >= chunkStartIndex && overlapTokens < config.overlap_tokens; i--) {
        const turn = formatTurn(
          dialogue.speaker_roles[i],
          dialogue.utterances[i],
          speakerNames
        );
        overlapTokens += countTokens(turn);
        overlapTurns++;
      }

      // Move back by overlap turns for next iteration
      currentTurnIndex = Math.max(chunkStartIndex, currentTurnIndex - overlapTurns);
    }
  }

  // Update total_chunks count
  const totalChunks = chunks.length;
  chunks.forEach((chunk) => {
    chunk.total_chunks = totalChunks;
  });

  return chunks;
}

/**
 * Generate a summary for a conversation chunk
 *
 * Simple extractive summary: first 2 sentences + last sentence
 * More sophisticated summarization can be added later
 */
export function generateChunkSummary(transcript: string): string {
  const sentences = transcript.split(/[.!?]+\s+/).filter((s) => s.trim().length > 0);

  if (sentences.length <= 3) {
    return transcript;
  }

  const firstTwo = sentences.slice(0, 2).join('. ') + '.';
  const last = sentences[sentences.length - 1];

  return `${firstTwo} ... ${last}`;
}

/**
 * Load LoCoMo dataset from JSON file
 */
export async function loadLoCoMoDataset(filePath: string): Promise<LoCoMoDialogue[]> {
  const fs = await import('fs/promises');

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const dialogues = JSON.parse(content) as LoCoMoDialogue[];

    if (!Array.isArray(dialogues)) {
      throw new Error('Dataset is not an array');
    }

    return dialogues;
  } catch (error) {
    throw new Error(`Failed to load dataset from ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate user ID for a dialogue
 */
export function generateDialogueUserId(dialogueId: number): string {
  return `locomo-dialogue-${dialogueId}`;
}

/**
 * Generate source ID for a chunk
 */
export function generateChunkSourceId(dialogueId: number, chunkIndex: number): string {
  return `dialogue-${dialogueId}-chunk-${chunkIndex}`;
}
