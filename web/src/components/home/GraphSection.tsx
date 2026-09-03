"use client";

import { GraphData } from "@/components/graph/types";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo } from "react";

// Dynamically import KnowledgeGraph to avoid SSR issues
const KnowledgeGraph = dynamic(() => import("@/components/graph/KnowledgeGraph"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[500px] items-center justify-center rounded-xl bg-gradient-to-br from-white/50 to-beige/50 backdrop-blur-sm">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  ),
});

const LEGEND = [
  { label: "People", className: "bg-node-people" },
  { label: "Projects", className: "bg-node-projects" },
  { label: "Ideas", className: "bg-node-ideas" },
  { label: "Topics", className: "bg-node-topics" },
  { label: "You", color: "#5F6F65" },
  { label: "Conversations", color: "#C9C5BC" },
];

export function GraphSection() {
  const { ref, isVisible } = useScrollAnimation();

  // Demo graph data showing the node types. force-graph rewrites a link's
  // source/target in place, so build it per mount rather than sharing one object.
  const graphData = useMemo((): GraphData => ({
    nodes: [
      { id: '1', name: 'Sarah', type: 'person', val: 15 },
      { id: '2', name: 'Career Growth', type: 'concept', val: 12 },
      { id: '3', name: 'Morning Conversation', type: 'source', val: 8 },
      { id: '4', name: 'Tech Startup', type: 'entity', val: 10 },
      { id: '5', name: 'Action Plan', type: 'artifact', val: 9 },
    ],
    links: [
      { source: '1', target: '2', label: 'thinks_about' },
      { source: '3', target: '1', label: 'mentions' },
      { source: '3', target: '2', label: 'mentions' },
      { source: '2', target: '4', label: 'involves' },
      { source: '5', target: '3', label: 'sourced_from' },
    ]
  }), []);

  return (
    <section
      ref={ref}
      className={`bg-gradient-to-br from-beige to-cream px-4 py-16 transition-all duration-700 md:px-8 md:py-24 ${
        isVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
      }`}
    >
      <div className="mx-auto max-w-5xl">
        <h2 className="mb-4 text-center font-heading text-3xl font-bold text-primary md:text-4xl">
          It builds a living map of your life
        </h2>
        <p className="mx-auto mb-12 max-w-3xl text-center text-lg leading-relaxed text-text-secondary">
          Cosmo remembers the people in your life, your ongoing projects, recurring themes, and how they all connect.
          Every conversation makes it smarter about you.
        </p>

        <div className="relative">
          <KnowledgeGraph data={graphData} width={1200} height={800} />
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-6">
          {LEGEND.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <div
                className={cn("h-4 w-4 rounded-full", item.className)}
                style={item.color ? { backgroundColor: item.color } : undefined}
              />
              <span className="text-sm text-text-secondary">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
