'use client';

import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface GraphControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export default function GraphControls({ onZoomIn, onZoomOut, onReset }: GraphControlsProps) {
  return (
    <div className="absolute top-4 right-4 flex flex-col gap-2">
      <Button
        size="icon"
        variant="secondary"
        onClick={onZoomIn}
        className="bg-white/90 hover:bg-white shadow-md text-gray-700"
        title="Zoom In"
      >
        <ZoomIn className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="secondary"
        onClick={onZoomOut}
        className="bg-white/90 hover:bg-white shadow-md text-gray-700"
        title="Zoom Out"
      >
        <ZoomOut className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="secondary"
        onClick={onReset}
        className="bg-white/90 hover:bg-white shadow-md text-gray-700"
        title="Reset View"
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
