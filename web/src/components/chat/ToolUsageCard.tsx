import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Ban, FileText, FolderSearch, GitBranch, Globe, Network, Pencil, Search } from "lucide-react";

type SupportedTool =
  | "Read"
  | "Grep"
  | "Glob"
  | "Write"
  | "WebFetch"
  | "WebSearch"
  | "mcp__graph-tools__explore"
  | "mcp__graph-tools__traverse"
  | "mcp__conversation__end";

interface ToolUsageCardProps {
  toolName: SupportedTool;
  input: Record<string, unknown>;
  output?: string;
}

const TOOL_ICONS: Record<SupportedTool, React.ComponentType<{ className?: string }>> = {
  Read: FileText,
  Grep: Search,
  Glob: FolderSearch,
  Write: Pencil,
  WebFetch: Globe,
  WebSearch: Search,
  'mcp__graph-tools__explore': Network,
  'mcp__graph-tools__traverse': GitBranch,
  'mcp__conversation__end': Ban,
};

const TOOL_COLORS: Record<SupportedTool, string> = {
  Read: 'bg-blue-100 text-blue-800',
  Grep: 'bg-green-100 text-green-800',
  Glob: 'bg-purple-100 text-purple-800',
  Write: 'bg-red-100 text-red-800',
  WebFetch: 'bg-yellow-100 text-yellow-800',
  WebSearch: 'bg-blue-100 text-blue-800',
  'mcp__graph-tools__explore': 'bg-indigo-100 text-indigo-800',
  'mcp__graph-tools__traverse': 'bg-pink-100 text-pink-800',
  'mcp__conversation__end': 'bg-red-100 text-red-800',
};

export function ToolUsageCard({ toolName, input, output }: ToolUsageCardProps) {
  // Validate tool name early
  if (!(toolName in TOOL_ICONS)) {
    throw new Error(`Unsupported tool: ${toolName}. Supported tools: ${Object.keys(TOOL_ICONS).join(', ')}`);
  }

  const Icon = TOOL_ICONS[toolName];
  const colorClass = TOOL_COLORS[toolName];

  return (
    <div className="flex justify-start">
      <Card className="max-w-[80%] border-l-4 border-accent bg-beige/50">
        <CardContent className="p-3">
          <div className="mb-2 flex items-center gap-2">
            <Icon className="h-4 w-4 text-accent" />
            <Badge className={colorClass}>
              {toolName}
            </Badge>
          </div>

          <div className="space-y-2">
            {/* Tool Input */}
            <div>
              <div className="text-xs font-semibold text-text-secondary">Input:</div>
              <div className="mt-1 rounded bg-white p-2 text-xs font-mono">
                {Object.entries(input).map(([key, value]) => (
                  <div key={key} className="truncate">
                    <span className="text-primary">{key}:</span>{' '}
                    <span className="text-text-primary">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tool Output (if available) */}
            {output && (
              <div>
                <div className="text-xs font-semibold text-text-secondary">Output:</div>
                <div className="mt-1 max-h-32 overflow-y-auto rounded bg-white p-2 text-xs font-mono">
                  <pre className="whitespace-pre-wrap">{output}</pre>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
