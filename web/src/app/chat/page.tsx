"use client";

import { useState, useEffect, useRef } from "react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ToolUsageCard } from "@/components/chat/ToolUsageCard";
import { ChatInput } from "@/components/chat/ChatInput";
import { streamChat, ChatStreamEvent } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface ToolUse {
  id: string;
  toolName: 'Read' | 'Grep' | 'Glob';
  input: Record<string, unknown>;
  output?: string;
  timestamp: Date;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolUses, setToolUses] = useState<ToolUse[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState("");
  const [userId, setUserId] = useState("locomo-eval-user"); // Default test user
  const [sessionId, setSessionId] = useState<string | undefined>(undefined); // Track session ID for conversation continuity
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, toolUses, currentAssistantMessage]);

  const handleSendMessage = async (userMessage: string) => {
    if (isStreaming) {
      throw new Error("Cannot send message while streaming");
    }

    // Add user message to chat
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsg]);

    setIsStreaming(true);
    setCurrentAssistantMessage("");

    try {
      // Stream response from backend with session ID for conversation continuity
      for await (const event of streamChat(userMessage, userId, sessionId)) {
        handleStreamEvent(event);
      }

      // Add final assistant message if there's content
      if (currentAssistantMessage.trim()) {
        const assistantMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: currentAssistantMessage,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, assistantMsg]);
      }

    } catch (streamError) {
      const errorMessage = streamError instanceof Error ? streamError.message : String(streamError);
      throw new Error(`Failed to stream chat: ${errorMessage}`);
    } finally {
      setIsStreaming(false);
      setCurrentAssistantMessage("");
    }
  };

  const handleStreamEvent = (event: ChatStreamEvent) => {
    const { type, data } = event;

    if (type === 'connected') {
      // Connection established
      return;
    }

    if (type === 'parse_error') {
      console.error('Parse error in stream:', data);
      return;
    }

    if (type === 'error') {
      console.error('Full error event:', event);
      console.error('Error data:', data);
      const errorDetails = data ? JSON.stringify(data) : 'Unknown error';
      throw new Error(`Stream error: ${errorDetails}`);
    }

    // Handle SDK message types
    const sdkMessage = data as Record<string, unknown>;

    // Extract and store session_id from any SDK message
    if (sdkMessage.session_id && typeof sdkMessage.session_id === 'string') {
      setSessionId(sdkMessage.session_id);
    }

    if (sdkMessage.type === 'assistant') {
      // Extract text content from assistant message
      const message = sdkMessage.message as { content?: Array<{ type: string; text?: string }> };
      if (message.content) {
        const textBlocks = message.content.filter(block => block.type === 'text');
        const text = textBlocks.map(block => block.text).join('');
        setCurrentAssistantMessage(prev => prev + text);
      }
    }

    if (sdkMessage.type === 'assistant' && sdkMessage.message) {
      const message = sdkMessage.message as {
        content?: Array<{
          type: string;
          name?: string;
          input?: Record<string, unknown>;
        }>;
      };

      if (message.content) {
        // Check for tool use in message
        message.content.forEach(block => {
          if (block.type === 'tool_use' && block.name && block.input) {
            const toolName = block.name as 'Read' | 'Grep' | 'Glob';
            const toolUse: ToolUse = {
              id: `tool-${Date.now()}-${Math.random()}`,
              toolName,
              input: block.input,
              timestamp: new Date()
            };
            setToolUses(prev => [...prev, toolUse]);
          }
        });
      }
    }

    if (sdkMessage.type === 'result') {
      // Final result - streaming complete
      const result = sdkMessage as { result?: string };
      if (result.result) {
        const finalMsg: ChatMessage = {
          id: `assistant-final-${Date.now()}`,
          role: 'assistant',
          content: result.result,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, finalMsg]);
      }
      setCurrentAssistantMessage("");
    }
  };

  return (
    <div className="flex h-screen flex-col bg-cream">
      {/* Header */}
      <div className="border-b border-beige bg-white p-4">
        <div className="mx-auto max-w-4xl space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-heading text-2xl font-bold text-primary">
                Claude Code Chat
              </h1>
              <p className="text-sm text-text-secondary">
                Ask questions about the codebase using Read, Grep, and Glob tools
              </p>
            </div>
            <Link href="/">
              <Button variant="outline" size="sm">
                <Home className="mr-2 h-4 w-4" />
                Home
              </Button>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="userId" className="text-sm font-medium text-text-secondary whitespace-nowrap">
              User ID:
            </label>
            <Input
              id="userId"
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              disabled={isStreaming}
              className="max-w-xs"
              placeholder="Enter user ID"
            />
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-4xl space-y-4">
          {messages.length === 0 && (
            <Card className="border-2 border-dashed border-beige bg-white p-8 text-center">
              <p className="text-text-secondary">
                Start a conversation by asking about the codebase!
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Badge variant="outline">Read files</Badge>
                <Badge variant="outline">Search patterns</Badge>
                <Badge variant="outline">Find files</Badge>
              </div>
            </Card>
          )}

          {messages
            .filter(msg => msg.role !== 'system') // Don't render system messages
            .map(msg => (
              <MessageBubble
                key={msg.id}
                role={msg.role as 'user' | 'assistant'}
                content={msg.content}
                timestamp={msg.timestamp}
              />
            ))}

          {toolUses.map(tool => (
            <ToolUsageCard
              key={tool.id}
              toolName={tool.toolName}
              input={tool.input}
              output={tool.output}
            />
          ))}

          {currentAssistantMessage && (
            <MessageBubble
              role="assistant"
              content={currentAssistantMessage}
            />
          )}

          {isStreaming && (
            <div className="flex items-center gap-2 text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Thinking...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <ChatInput
        onSend={handleSendMessage}
        disabled={isStreaming}
        placeholder="Ask me about the codebase..."
      />
    </div>
  );
}
