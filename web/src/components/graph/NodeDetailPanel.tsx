'use client';

import {
  GraphNode,
  PersonDetails,
  ProjectDetails,
  TopicDetails,
  IdeaDetails,
  ConversationDetails,
} from './types';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { getNodeColor } from '@/lib/graphUtils';

interface NodeDetailPanelProps {
  node: GraphNode | null;
  onClose: () => void;
}

export default function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
  if (!node) return null;

  const renderDetails = () => {
    if (!node.details) return <p className="text-text-secondary">No additional details available.</p>;

    switch (node.type) {
      case 'Person':
        const personDetails = node.details as PersonDetails;
        return (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Relationship</h4>
              <Badge variant="secondary">{personDetails.relationship_type}</Badge>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Personality Traits</h4>
              <div className="flex flex-wrap gap-2">
                {personDetails.personality_traits.map((trait, i) => (
                  <Badge key={i} variant="outline">
                    {trait}
                  </Badge>
                ))}
              </div>
            </div>
            {personDetails.current_life_situation && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Current Situation</h4>
                <p className="text-text-secondary">{personDetails.current_life_situation}</p>
              </div>
            )}
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Last Mentioned</h4>
              <p className="text-sm text-text-secondary">{personDetails.last_mentioned_at}</p>
            </div>
          </div>
        );

      case 'Project':
        const projectDetails = node.details as ProjectDetails;
        return (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Status</h4>
              <Badge>{projectDetails.status}</Badge>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Vision</h4>
              <p className="text-text-secondary">{projectDetails.vision}</p>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Blockers</h4>
              <ul className="list-disc list-inside space-y-1">
                {projectDetails.blockers.map((blocker, i) => (
                  <li key={i} className="text-text-secondary text-sm">
                    {blocker}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Confidence</h4>
                <div className="w-full bg-beige rounded-full h-2">
                  <div
                    className="bg-success h-2 rounded-full"
                    style={{ width: `${projectDetails.confidence_level * 100}%` }}
                  />
                </div>
                <p className="text-xs text-text-secondary mt-1">
                  {Math.round(projectDetails.confidence_level * 100)}%
                </p>
              </div>
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Excitement</h4>
                <div className="w-full bg-beige rounded-full h-2">
                  <div
                    className="bg-accent h-2 rounded-full"
                    style={{ width: `${projectDetails.excitement_level * 100}%` }}
                  />
                </div>
                <p className="text-xs text-text-secondary mt-1">
                  {Math.round(projectDetails.excitement_level * 100)}%
                </p>
              </div>
            </div>
          </div>
        );

      case 'Topic':
        const topicDetails = node.details as TopicDetails;
        return (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Description</h4>
              <p className="text-text-secondary">{topicDetails.description}</p>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Category</h4>
              <Badge>{topicDetails.category}</Badge>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Last Discussed</h4>
              <p className="text-sm text-text-secondary">{topicDetails.last_mentioned_at}</p>
            </div>
          </div>
        );

      case 'Idea':
        const ideaDetails = node.details as IdeaDetails;
        return (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Summary</h4>
              <p className="text-text-secondary">{ideaDetails.summary}</p>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Status</h4>
              <Badge>{ideaDetails.status}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Confidence</h4>
                <div className="w-full bg-beige rounded-full h-2">
                  <div
                    className="bg-success h-2 rounded-full"
                    style={{ width: `${ideaDetails.confidence_level * 100}%` }}
                  />
                </div>
                <p className="text-xs text-text-secondary mt-1">
                  {Math.round(ideaDetails.confidence_level * 100)}%
                </p>
              </div>
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Excitement</h4>
                <div className="w-full bg-beige rounded-full h-2">
                  <div
                    className="bg-accent h-2 rounded-full"
                    style={{ width: `${ideaDetails.excitement_level * 100}%` }}
                  />
                </div>
                <p className="text-xs text-text-secondary mt-1">
                  {Math.round(ideaDetails.excitement_level * 100)}%
                </p>
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Next Steps</h4>
              <ul className="list-disc list-inside space-y-1">
                {ideaDetails.next_steps.map((step, i) => (
                  <li key={i} className="text-text-secondary text-sm">
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );

      case 'Conversation':
        const convDetails = node.details as ConversationDetails;
        return (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Summary</h4>
              <p className="text-text-secondary">{convDetails.summary}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Date</h4>
                <p className="text-sm text-text-secondary">{convDetails.date}</p>
              </div>
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Duration</h4>
                <p className="text-sm text-text-secondary">{convDetails.duration} min</p>
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Topics</h4>
              <div className="flex flex-wrap gap-2">
                {convDetails.topic_tags.map((tag, i) => (
                  <Badge key={i} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        );

      default:
        return <p className="text-text-secondary">No details available for this node type.</p>;
    }
  };

  return (
    <Sheet open={!!node} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: getNodeColor(node.type) }}
            />
            <SheetTitle className="text-2xl">{node.name}</SheetTitle>
          </div>
          <SheetDescription>
            <Badge variant="secondary">{node.type}</Badge>
          </SheetDescription>
        </SheetHeader>
        <Separator className="my-6" />
        <div className="mt-6">{renderDetails()}</div>
      </SheetContent>
    </Sheet>
  );
}
