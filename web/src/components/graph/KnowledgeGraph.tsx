'use client';

import { useRef, useState, useCallback, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { GraphData, GraphNode } from './types';
import { getNodeColor, getNodeLabel } from '@/lib/graphUtils';
import NodeDetailPanel from './NodeDetailPanel';
import GraphControls from './GraphControls';

// Types for force-graph internals
interface ForceGraphMethods {
  centerAt: (x?: number, y?: number, duration?: number) => void;
  zoom: (scale?: number, duration?: number) => number;
  zoomToFit: (duration?: number, padding?: number) => void;
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
}

interface KnowledgeGraphProps {
  data: GraphData;
  width?: number;
  height?: number;
}

export default function KnowledgeGraph({
  data,
  width = 1000,
  height = 500
}: KnowledgeGraphProps) {
  // Using a type assertion for the ref since react-force-graph-2d doesn't export proper types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);

  // Memoize graph data to prevent unnecessary re-renders
  const graphData = useMemo(() => data, [data]);

  // Node click handler
  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    // Center camera on node
    if (graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 1000);
      graphRef.current.zoom(2, 1000);
    }
  }, []);

  // Custom node rendering
  const paintNode = useCallback(
    (node: NodeCanvasObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const label = getNodeLabel(node.name);
      const fontSize = 12 / globalScale;
      const nodeRadius = node.val || 5;

      // Draw node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, nodeRadius, 0, 2 * Math.PI);
      ctx.fillStyle = getNodeColor(node.type);
      ctx.fill();

      // Draw border for selected/hovered node
      if (selectedNode?.id === node.id || hoveredNode?.id === node.id) {
        ctx.strokeStyle = '#2C2A27';
        ctx.lineWidth = 3 / globalScale;
        ctx.stroke();
      } else {
        // Subtle border for all nodes
        ctx.strokeStyle = '#FDFCFA';
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Draw label
      ctx.font = `${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2C2A27';
      ctx.fillText(label, node.x, node.y + nodeRadius + fontSize);
    },
    [selectedNode, hoveredNode]
  );

  // Custom link rendering
  const paintLink = useCallback(
    (link: LinkCanvasObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const start = link.source;
      const end = link.target;

      ctx.strokeStyle = 'rgba(139, 115, 85, 0.25)'; // primary with opacity
      ctx.lineWidth = 1.5 / globalScale;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    },
    []
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

  return (
    <div className="relative">
      {/* Graph Canvas */}
      <div className="rounded-xl overflow-hidden bg-gradient-to-br from-white/50 to-beige/50 backdrop-blur-sm">
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData as any}
          width={width}
          height={height}
          nodeVal="val"
          nodeLabel="name"
          nodeCanvasObject={paintNode}
          linkCanvasObject={paintLink}
          onNodeClick={handleNodeClick}
          onNodeHover={setHoveredNode}
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

      {/* Node Detail Panel */}
      <NodeDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
    </div>
  );
}
