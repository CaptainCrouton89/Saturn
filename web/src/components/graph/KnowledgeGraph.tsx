'use client';

import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { GraphData, GraphNode, GraphLink } from './types';
import { getNodeColor, getNodeLabel } from '@/lib/graphUtils';
import NodeDetailPanel from './NodeDetailPanel';
import GraphControls from './GraphControls';
import LinkTooltip from './LinkTooltip';
import * as d3 from 'd3-force';

// Types for force-graph internals
interface ForceGraphMethods {
  centerAt: (x?: number, y?: number, duration?: number) => void;
  zoom: (scale?: number, duration?: number) => number;
  zoomToFit: (duration?: number, padding?: number) => void;
  d3Force: (forceName: string, force?: unknown) => unknown;
}

interface NodeCanvasObject extends GraphNode {
  x: number;
  y: number;
}

interface LinkCanvasObject {
  source: NodeCanvasObject;
  target: NodeCanvasObject;
  label?: string;
  value?: number;
  properties?: GraphLink['properties'];
}

interface KnowledgeGraphProps {
  data: GraphData;
  width?: number;
  height?: number;
  highlightedNodeIds?: string[];
}

export default function KnowledgeGraph({
  data,
  width = 1000,
  height = 500,
  highlightedNodeIds = []
}: KnowledgeGraphProps) {
  // Using type assertion for the ref since react-force-graph-2d doesn't export proper types
  const graphRef = useRef<ForceGraphMethods>(null as unknown as ForceGraphMethods);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [hoveredLink, setHoveredLink] = useState<GraphLink | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // Memoize graph data to prevent unnecessary re-renders
  const graphData = useMemo(() => data, [data]);

  // Track mouse position for tooltip
  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    setMousePosition({ x: event.clientX, y: event.clientY });
  }, []);

  // Node click handler
  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    // Center camera on node
    if (graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 1000);
      graphRef.current.zoom(2, 1000);
    }
  }, []);

  // Custom node label for hover tooltip
  const getNodeHoverLabel = useCallback((node: GraphNode) => {
    return `${node.name} - ${node.type}`;
  }, []);

  // Custom node rendering
  const paintNode = useCallback(
    (node: NodeCanvasObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const label = getNodeLabel(node.name);
      const fontSize = 12 / globalScale;
      const nodeRadius = node.val || 5;
      const isHighlighted = highlightedNodeIds.includes(node.id);

      // Draw node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, nodeRadius, 0, 2 * Math.PI);
      ctx.fillStyle = getNodeColor(node.type);
      ctx.fill();

      // Draw border for selected/hovered/highlighted node
      if (selectedNode?.id === node.id || hoveredNode?.id === node.id) {
        ctx.strokeStyle = '#2C2A27';
        ctx.lineWidth = 3 / globalScale;
        ctx.stroke();
      } else if (isHighlighted) {
        // Highlight border for search results
        ctx.strokeStyle = '#8B7355'; // primary color
        ctx.lineWidth = 3 / globalScale;
        ctx.stroke();

        // Optional: add a glow effect for highlighted nodes
        ctx.shadowBlur = 10 / globalScale;
        ctx.shadowColor = '#8B7355';
      } else {
        // Subtle border for all nodes
        ctx.strokeStyle = '#FDFCFA';
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Reset shadow
      ctx.shadowBlur = 0;

      // Draw label - make it bolder for highlighted nodes
      ctx.font = `${isHighlighted ? 'bold ' : ''}${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2C2A27';
      ctx.fillText(label, node.x, node.y + nodeRadius + fontSize);
    },
    [selectedNode, hoveredNode, highlightedNodeIds]
  );

  // Link hover handler
  const handleLinkHover = useCallback((link: GraphLink | null) => {
    setHoveredLink(link);
  }, []);

  // Custom link rendering with hover state
  const paintLink = useCallback(
    (link: LinkCanvasObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const start = link.source;
      const end = link.target;

      // Get source and target IDs (handles both string and object forms)
      const sourceId = typeof start === 'object' ? start.id : start;
      const targetId = typeof end === 'object' ? end.id : end;

      // Get hovered link source/target IDs
      let hoveredSourceId: string | undefined;
      let hoveredTargetId: string | undefined;

      if (hoveredLink) {
        hoveredSourceId = typeof hoveredLink.source === 'object'
          ? (hoveredLink.source as { id: string }).id
          : hoveredLink.source;
        hoveredTargetId = typeof hoveredLink.target === 'object'
          ? (hoveredLink.target as { id: string }).id
          : hoveredLink.target;
      }

      // Check if this link is hovered - compare IDs
      const isHovered = hoveredLink && (
        (hoveredSourceId === sourceId && hoveredTargetId === targetId) ||
        (hoveredSourceId === targetId && hoveredTargetId === sourceId)
      );

      // Subtle highlight for hovered links
      if (isHovered) {
        ctx.strokeStyle = 'rgba(139, 115, 85, 0.5)'; // primary with moderate opacity
        ctx.lineWidth = 2 / globalScale;
      } else {
        ctx.strokeStyle = 'rgba(139, 115, 85, 0.25)'; // primary with opacity
        ctx.lineWidth = 1.5 / globalScale;
      }

      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    },
    [hoveredLink]
  );

  // Zoom controls
  const handleZoomIn = () => {
    if (graphRef.current) {
      graphRef.current.zoom(graphRef.current.zoom() * 1.3, 300);
    }
  };

  const handleZoomOut = () => {
    if (graphRef.current) {
      graphRef.current.zoom(graphRef.current.zoom() / 1.3, 300);
    }
  };

  const handleResetView = () => {
    if (graphRef.current) {
      graphRef.current.zoomToFit(400, 50);
    }
  };

  // Configure force simulation for better node spacing
  useEffect(() => {
    if (graphRef.current) {
      // Increase repulsion between nodes
      graphRef.current.d3Force('charge', d3.forceManyBody().strength(-300));
      // Set minimum distance between linked nodes
      graphRef.current.d3Force('link', d3.forceLink().distance(100));
      // Add collision detection to prevent overlap
      graphRef.current.d3Force('collide', d3.forceCollide().radius(30));
    }
  }, []);

  return (
    <div className="relative" onMouseMove={handleMouseMove}>
      {/* Graph Canvas */}
      <div className="rounded-xl overflow-hidden bg-gradient-to-br from-white/50 to-beige/50 backdrop-blur-sm">
        {/* react-force-graph-2d has complex generic types - type casting needed */}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <ForceGraph2D
          ref={graphRef as any}
          graphData={graphData as any}
          width={width}
          height={height}
          nodeVal="val"
          nodeLabel={getNodeHoverLabel}
          linkLabel={() => ''} // Disable default link label - we use custom tooltip
          nodeCanvasObject={paintNode as any}
          linkCanvasObject={paintLink as any}
          onNodeClick={handleNodeClick}
          onNodeHover={setHoveredNode}
          onLinkHover={handleLinkHover as any}
          cooldownTicks={100}
          onEngineStop={() => graphRef.current?.zoomToFit(400, 50)}
          enableNodeDrag={true}
          enableZoomInteraction={true}
          enablePanInteraction={true}
          backgroundColor="transparent"
          linkDirectionalParticles={2}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleSpeed={0.003}
        />
      </div>

      {/* Graph Controls */}
      <GraphControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={handleResetView}
      />

      {/* Link Tooltip */}
      <LinkTooltip link={hoveredLink} position={mousePosition} />

      {/* Node Detail Panel */}
      <NodeDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
    </div>
  );
}
