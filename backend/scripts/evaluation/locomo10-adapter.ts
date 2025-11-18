/**
 * LoCoMo10 Dataset Adapter
 *
 * Utilities for loading and parsing the LoCoMo10 dataset
 */

import fs from 'fs/promises';
import type { LoCoMo10Conversation, LoCoMo10Turn, LoCoMo10Session } from './types.js';

/**
 * Load the LoCoMo10 dataset from JSON file
 */
export async function loadLoCoMo10Dataset(
  path: string
): Promise<LoCoMo10Conversation[]> {
  const content = await fs.readFile(path, 'utf-8');
  return JSON.parse(content);
}

/**
 * Extract all sessions from a LoCoMo10 conversation
 * Returns sessions sorted by session number
 */
export function extractSessions(conversation: LoCoMo10Conversation): LoCoMo10Session[] {
  const sessions: LoCoMo10Session[] = [];
  const keys = Object.keys(conversation.conversation);

  // Get session numbers (filter out speaker_a, speaker_b, and date_time fields)
  const sessionNumbers = keys
    .filter(k => k.match(/^session_\d+$/))
    .map(k => parseInt(k.replace('session_', ''), 10))
    .sort((a, b) => a - b);

  for (const num of sessionNumbers) {
    const sessionKey = `session_${num}` as const;
    const dateTimeKey = `session_${num}_date_time` as const;

    const dateTime = conversation.conversation[dateTimeKey];
    if (!dateTime) {
      throw new Error(`Missing dateTime for ${sessionKey} in conversation ${conversation.sample_id}`);
    }

    sessions.push({
      sessionId: sessionKey,
      turns: conversation.conversation[sessionKey],
      dateTime,
    });
  }

  return sessions;
}

/**
 * Parse LoCoMo10 date format to ISO timestamp
 * Input: '1:56 pm on 8 May, 2023'
 * Output: '2023-05-08T13:56:00.000Z'
 *
 * Handles:
 * - 12/24 hour format
 * - AM/PM conversion
 * - Month names -> numbers
 * - Assumes UTC timezone (no timezone in original data)
 */
export function parseLoCoMo10DateTime(dateTimeStr: string): string {
  // Pattern: "HH:MM [am|pm] on DD MMM, YYYY"
  // Example: "1:56 pm on 8 May, 2023"

  const pattern = /^(\d{1,2}):(\d{2})\s*(am|pm)\s*on\s*(\d{1,2})\s*(\w+),\s*(\d{4})$/i;
  const match = dateTimeStr.match(pattern);

  if (!match) {
    throw new Error(`Invalid LoCoMo10 date format: ${dateTimeStr}`);
  }

  const [_, hourStr, minute, ampm, day, monthName, year] = match;

  // Convert 12-hour to 24-hour
  let hour = parseInt(hourStr, 10);
  if (ampm.toLowerCase() === 'pm' && hour !== 12) {
    hour += 12;
  } else if (ampm.toLowerCase() === 'am' && hour === 12) {
    hour = 0;
  }

  // Month names to numbers
  const months: Record<string, number> = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };

  const month = months[monthName.toLowerCase()];
  if (month === undefined) {
    throw new Error(`Invalid month name: ${monthName}`);
  }

  // Create Date object (assumes UTC)
  const date = new Date(Date.UTC(
    parseInt(year, 10),
    month,
    parseInt(day, 10),
    hour,
    parseInt(minute, 10),
    0,
    0
  ));

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateTimeStr}`);
  }

  return date.toISOString();
}

/**
 * Format a session's turns into a transcript string for ingestion
 *
 * @param sessionId - Session identifier (e.g., 'session_1')
 * @param turns - Array of conversation turns
 * @param dateTime - Human-readable date/time string (e.g., '1:56 pm on 8 May, 2023')
 * @returns Formatted transcript with date context
 */
export function formatSessionForIngestion(
  sessionId: string,
  turns: LoCoMo10Turn[],
  dateTime: string
): string {
  // Add date context header for temporal grounding
  const header = `# Conversation on ${dateTime}\n\n`;

  // Convert to simple speaker: message format
  const transcript = turns.map(turn => `${turn.speaker}: ${turn.text}`).join('\n\n');

  return header + transcript;
}

/**
 * Get speaker names from the conversation
 */
export function getSpeakerNames(conversation: LoCoMo10Conversation): {
  speaker_a: string;
  speaker_b: string;
} {
  return {
    speaker_a: conversation.conversation.speaker_a,
    speaker_b: conversation.conversation.speaker_b,
  };
}
