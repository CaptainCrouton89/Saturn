import { Card, CardContent } from "@/components/ui/card";
import { User, Bot } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

export function MessageBubble({ role, content, timestamp }: MessageBubbleProps) {
  const isUser = role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-white">
          <Bot className="h-4 w-4" />
        </div>
      )}

      <div className={`flex max-w-[80%] flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <Card className={`${isUser ? 'bg-primary text-white' : 'bg-white'}`}>
          <CardContent className="p-3">
            <div className={`prose prose-sm max-w-none ${isUser ? 'prose-invert' : ''}`}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Style code blocks
                  code: ({ className, children, ...props }) => {
                    const isInline = !className;
                    if (isInline) {
                      return (
                        <code className="rounded bg-gray-100 px-1 py-0.5 text-sm font-mono" {...props}>
                          {children}
                        </code>
                      );
                    }
                    return (
                      <code className={`${className} block rounded bg-gray-900 p-3 text-sm text-gray-100 overflow-x-auto`} {...props}>
                        {children}
                      </code>
                    );
                  },
                  // Ensure proper paragraph spacing
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  // Style lists
                  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc">{children}</ul>,
                  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal">{children}</ol>,
                  // Style links
                  a: ({ children, href }) => (
                    <a href={href} className="text-accent underline hover:no-underline" target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          </CardContent>
        </Card>

        {timestamp && (
          <span className="text-xs text-text-secondary">
            {timestamp.toLocaleTimeString()}
          </span>
        )}
      </div>

      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
