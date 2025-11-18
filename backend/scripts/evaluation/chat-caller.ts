/**
 * Chat Controller Caller
 *
 * Programmatically calls the chat controller and captures SSE stream responses
 */

import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import { chatController } from '../../src/controllers/chatController.js';

/**
 * Mock Express Response that captures SSE stream
 */
class MockSSEResponse extends EventEmitter {
  private chunks: string[] = [];
  statusCode = 200;

  setHeader(): this {
    return this;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(): void {
    this.emit('finished');
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(data: unknown): this {
    this.chunks.push(JSON.stringify(data));
    return this;
  }

  /**
   * Extract the full text response from SSE stream
   */
  getFullResponse(): string {
    return this.chunks
      .filter(chunk => chunk.startsWith('data: ') && !chunk.includes('[DONE]'))
      .map(chunk => {
        const json = chunk.replace('data: ', '').trim();
        try {
          const parsed = JSON.parse(json);
          if (parsed.type === 'text-delta') {
            return parsed.delta;
          }
        } catch {
          // Skip parsing errors
        }
        return '';
      })
      .join('');
  }

  /**
   * Get error message if any
   */
  getError(): string | null {
    for (const chunk of this.chunks) {
      if (chunk.startsWith('data: ')) {
        const json = chunk.replace('data: ', '').trim();
        try {
          const parsed = JSON.parse(json);
          if (parsed.type === 'error') {
            return parsed.message;
          }
        } catch {
          // Skip parsing errors
        }
      }
    }
    return null;
  }
}

/**
 * Call the chat controller programmatically and return the response
 *
 * @param message - The question to ask
 * @param userId - The user ID
 * @param conversationId - Optional conversation ID for context (not used for eval)
 * @returns The full text response from the chat controller
 */
export async function callChatController(
  message: string,
  userId: string,
  conversationId?: string
): Promise<string> {
  // Don't pass conversationId for evaluation - just rely on user context
  const mockReq = {
    body: { message, userId },
  } as Request;

  const mockRes = new MockSSEResponse() as unknown as Response;

  // Call controller (it's async but returns void)
  const controllerPromise = chatController.streamMemoryOptimizedChat(mockReq, mockRes);

  // Wait for stream to finish
  await new Promise<void>(resolve => {
    (mockRes as unknown as MockSSEResponse).once('finished', () => resolve());
  });

  // Wait for controller to fully complete
  await controllerPromise;

  // Check for errors
  const error = (mockRes as unknown as MockSSEResponse).getError();
  if (error) {
    throw new Error(`Chat controller error: ${error}`);
  }

  // Check status code
  if ((mockRes as unknown as MockSSEResponse).statusCode !== 200) {
    throw new Error(`Chat controller returned status ${(mockRes as unknown as MockSSEResponse).statusCode}`);
  }

  const response = (mockRes as unknown as MockSSEResponse).getFullResponse();

  if (!response || response.trim() === '') {
    throw new Error('Chat controller returned empty response');
  }

  return response;
}
