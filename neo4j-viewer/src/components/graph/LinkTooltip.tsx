'use client';

import type { GraphLink } from './types';
import { PropertyRenderer } from './PropertyRenderer';

interface LinkTooltipProps {
  link: GraphLink | null;
  position: { x: number; y: number };
}

export default function LinkTooltip({ link, position }: LinkTooltipProps) {
  if (!link || !link.properties) return null;

  return (
    <div
      className="pointer-events-none fixed z-50"
      style={{
        left: `${position.x + 10}px`,
        top: `${position.y - 10}px`,
      }}
    >
      <div className="bg-white border-2 border-primary/20 shadow-xl rounded-lg p-3 min-w-[220px] max-w-[300px]">
        <div className="flex items-center gap-2 mb-2 pb-2 border-b-2 border-beige">
          <span className="text-xs font-semibold text-text-primary uppercase tracking-wider">
            {link.label}
          </span>
        </div>
        <div className="space-y-2">
          <PropertyRenderer properties={link.properties as Record<string, unknown>} mode="tooltip" />
        </div>
      </div>
    </div>
  );
}
