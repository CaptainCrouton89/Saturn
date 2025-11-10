'use client';

import { GraphLink } from './types';
import { Badge } from '@/components/ui/badge';

interface LinkTooltipProps {
  link: GraphLink | null;
  position: { x: number; y: number };
}

export default function LinkTooltip({ link, position }: LinkTooltipProps) {
  if (!link || !link.properties) return null;

  const renderProperties = () => {
    const props = link.properties;
    if (!props) return null;

    // Type guard checks for different property types
    if ('relationship_quality' in props) {
      // KNOWS relationship
      return (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Quality:</span>
            <div className="flex items-center gap-2">
              <div className="w-16 bg-beige/50 rounded-full h-1.5">
                <div
                  className="bg-success h-1.5 rounded-full"
                  style={{ width: `${props.relationship_quality * 100}%` }}
                />
              </div>
              <span className="text-xs font-medium">{Math.round(props.relationship_quality * 100)}%</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Last mentioned:</span>
            <span className="text-xs font-medium">{props.last_mentioned_at}</span>
          </div>
        </>
      );
    }

    if ('priority' in props) {
      // WORKING_ON relationship
      return (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Status:</span>
            <Badge variant="outline" className="text-xs py-0">
              {props.status}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Priority:</span>
            <span className="text-xs font-medium">#{props.priority}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Last discussed:</span>
            <span className="text-xs font-medium">{props.last_discussed_at}</span>
          </div>
        </>
      );
    }

    if ('engagement_level' in props) {
      // INTERESTED_IN relationship
      return (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Engagement:</span>
            <div className="flex items-center gap-2">
              <div className="w-16 bg-beige/50 rounded-full h-1.5">
                <div
                  className="bg-accent h-1.5 rounded-full"
                  style={{ width: `${props.engagement_level * 100}%` }}
                />
              </div>
              <span className="text-xs font-medium">{Math.round(props.engagement_level * 100)}%</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Frequency:</span>
            <span className="text-xs font-medium">{props.frequency} times</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Last discussed:</span>
            <span className="text-xs font-medium">{props.last_discussed_at}</span>
          </div>
        </>
      );
    }

    if ('count' in props && 'sentiment' in props) {
      // MENTIONED relationship
      const sentimentColor =
        props.sentiment > 0.3 ? 'text-success' : props.sentiment < -0.3 ? 'text-error' : 'text-text-secondary';
      const sentimentLabel =
        props.sentiment > 0.3 ? 'Positive' : props.sentiment < -0.3 ? 'Negative' : 'Neutral';

      return (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Mentioned:</span>
            <span className="text-xs font-medium">{props.count} times</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Sentiment:</span>
            <span className={`text-xs font-medium ${sentimentColor}`}>{sentimentLabel}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Importance:</span>
            <div className="flex items-center gap-2">
              <div className="w-16 bg-beige/50 rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full"
                  style={{ width: `${props.importance_score * 100}%` }}
                />
              </div>
              <span className="text-xs font-medium">{Math.round(props.importance_score * 100)}%</span>
            </div>
          </div>
        </>
      );
    }

    if ('depth' in props) {
      // DISCUSSED relationship
      return (
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-secondary">Depth:</span>
          <Badge variant="outline" className="text-xs py-0">
            {props.depth}
          </Badge>
        </div>
      );
    }

    if ('role' in props) {
      // INVOLVED_IN relationship
      return (
        <div>
          <span className="text-xs text-text-secondary">Role:</span>
          <p className="text-xs font-medium mt-1">{props.role}</p>
        </div>
      );
    }

    if ('description' in props && props.description) {
      // RELATED_TO or other relationships with description
      return (
        <div>
          <span className="text-xs text-text-secondary">Description:</span>
          <p className="text-xs font-medium mt-1">{props.description}</p>
        </div>
      );
    }

    if ('emotion' in props) {
      // FEELS relationship
      return (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Emotion:</span>
            <Badge variant="outline" className="text-xs py-0">
              {props.emotion}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Intensity:</span>
            <div className="flex items-center gap-2">
              <div className="w-16 bg-beige/50 rounded-full h-1.5">
                <div
                  className="bg-accent h-1.5 rounded-full"
                  style={{ width: `${props.intensity * 100}%` }}
                />
              </div>
              <span className="text-xs font-medium">{Math.round(props.intensity * 100)}%</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Noted:</span>
            <span className="text-xs font-medium">{props.noted_at}</span>
          </div>
        </>
      );
    }

    return null;
  };

  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{
        left: `${position.x + 10}px`,
        top: `${position.y + 10}px`,
      }}
    >
      <div className="bg-white border border-beige shadow-lg rounded-lg p-3 min-w-[200px] max-w-[280px]">
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-beige/50">
          <Badge variant="secondary" className="text-xs">
            {link.label}
          </Badge>
        </div>
        <div className="space-y-2">{renderProperties()}</div>
      </div>
    </div>
  );
}
