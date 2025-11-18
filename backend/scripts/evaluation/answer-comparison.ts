/**
 * Answer Comparison using LLM-as-Judge
 *
 * Evaluates whether model answers match expected answers semantically
 */

import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

const JUDGE_PROMPT = `You are an expert evaluator comparing two answers to the same question.

Question: {QUESTION}

Expected Answer: {EXPECTED}

Model Answer: {MODEL}

Your task:
1. Determine if the model answer contains the same core information as the expected answer
2. Be lenient with phrasing differences - focus on semantic equivalence
3. For temporal questions, check if dates/times match (allow flexible formats like "May 7, 2023" vs "7 May 2023")
4. For factual questions, check if key entities/facts are present
5. For reasoning questions, check if the logic/conclusion aligns
6. Partial answers that contain correct information should get partial credit

Score guidelines:
- 1.0: Perfect match, all key information present
- 0.8-0.9: Minor differences but core information correct
- 0.5-0.7: Partially correct, some key information present
- 0.2-0.4: Minimal overlap, mostly incorrect
- 0.0-0.1: Completely wrong or irrelevant

Respond with JSON only (no markdown, no code blocks):
{
  "score": 0.0,
  "reasoning": "brief explanation"
}`;

interface ComparisonResult {
  score: number;
  reasoning: string;
}

/**
 * Compare model answer to expected answer using LLM-as-judge
 *
 * @param question - The question that was asked
 * @param expectedAnswer - The expected/ground truth answer
 * @param modelAnswer - The answer from our model
 * @returns Score (0-1) and reasoning
 */
export async function compareAnswers(
  question: string,
  expectedAnswer: string | number,
  modelAnswer: string
): Promise<ComparisonResult> {
  // Convert expected answer to string
  const expectedStr = String(expectedAnswer);

  const prompt = JUDGE_PROMPT.replace('{QUESTION}', question)
    .replace('{EXPECTED}', expectedStr)
    .replace('{MODEL}', modelAnswer);

  try {
    const result = await generateText({
      model: openai('gpt-4o-mini'),
      messages: [{ role: 'user', content: prompt }],
    });

    // Parse the JSON response
    let parsed: { score: number; reasoning: string };
    try {
      // Try to extract JSON from potential markdown code blocks
      const text = result.text.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(text);
      }
    } catch (parseError) {
      throw new Error(`Failed to parse judge response: ${result.text}`);
    }

    // Validate score is in valid range
    if (typeof parsed.score !== 'number' || parsed.score < 0 || parsed.score > 1) {
      throw new Error(`Invalid score from judge: ${parsed.score}`);
    }

    return {
      score: parsed.score,
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    console.error('Error in LLM-as-judge comparison:', error);
    throw new Error(`Answer comparison failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
