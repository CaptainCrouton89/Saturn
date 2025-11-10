'use client';

import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getNodeColor } from '@/lib/graphUtils';
import type {
  ConversationDetails,
  GraphNode,
  IdeaDetails,
  PersonDetails,
  ProjectDetails,
  TopicDetails,
} from './types';

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
              {personDetails.relationship_status && (
                <Badge variant="outline" className="ml-2">
                  {personDetails.relationship_status}
                </Badge>
              )}
            </div>
            {personDetails.why_they_matter && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Why They Matter</h4>
                <p className="text-text-secondary text-sm italic">{personDetails.why_they_matter}</p>
              </div>
            )}
            {personDetails.how_they_met && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">How We Met</h4>
                <p className="text-text-secondary text-sm">{personDetails.how_they_met}</p>
              </div>
            )}
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
                <p className="text-text-secondary text-sm">{personDetails.current_life_situation}</p>
              </div>
            )}
            {personDetails.communication_cadence && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Communication</h4>
                <p className="text-text-secondary text-sm">{personDetails.communication_cadence}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">First Mentioned</h4>
                <p className="text-text-secondary">{personDetails.first_mentioned_at}</p>
              </div>
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">Last Mentioned</h4>
                <p className="text-text-secondary">{personDetails.last_mentioned_at}</p>
              </div>
            </div>
            <div className="pt-2 border-t border-beige/30">
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <span>Confidence: {Math.round(personDetails.confidence * 100)}%</span>
                {personDetails.excerpt_span && <span>• {personDetails.excerpt_span}</span>}
              </div>
            </div>
          </div>
        );

      case 'Project':
        const projectDetails = node.details as ProjectDetails;
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Status</h4>
                <Badge>{projectDetails.status}</Badge>
              </div>
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Domain</h4>
                <Badge variant="outline">{projectDetails.domain}</Badge>
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Vision</h4>
              <p className="text-text-secondary text-sm">{projectDetails.vision}</p>
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
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Key Decisions</h4>
              <ul className="list-disc list-inside space-y-1">
                {projectDetails.key_decisions.map((decision, i) => (
                  <li key={i} className="text-text-secondary text-sm">
                    {decision}
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
            {(projectDetails.time_invested || projectDetails.money_invested !== undefined) && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                {projectDetails.time_invested && (
                  <div>
                    <h4 className="font-semibold mb-1 text-text-primary">Time Invested</h4>
                    <p className="text-text-secondary text-xs">{projectDetails.time_invested}</p>
                  </div>
                )}
                {projectDetails.money_invested !== undefined && (
                  <div>
                    <h4 className="font-semibold mb-1 text-text-primary">Money Invested</h4>
                    <p className="text-text-secondary text-xs">${projectDetails.money_invested}</p>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">First Mentioned</h4>
                <p className="text-text-secondary">{projectDetails.first_mentioned_at}</p>
              </div>
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">Last Mentioned</h4>
                <p className="text-text-secondary">{projectDetails.last_mentioned_at}</p>
              </div>
            </div>
            <div className="pt-2 border-t border-beige/30">
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <span>Confidence: {Math.round(projectDetails.confidence * 100)}%</span>
                {projectDetails.excerpt_span && <span>• {projectDetails.excerpt_span}</span>}
              </div>
            </div>
          </div>
        );

      case 'Topic':
        const topicDetails = node.details as TopicDetails;
        return (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Category</h4>
              <Badge>{topicDetails.category}</Badge>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Description</h4>
              <p className="text-text-secondary text-sm">{topicDetails.description}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">First Discussed</h4>
                <p className="text-text-secondary">{topicDetails.first_mentioned_at}</p>
              </div>
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">Last Discussed</h4>
                <p className="text-text-secondary">{topicDetails.last_mentioned_at}</p>
              </div>
            </div>
            <div className="pt-2 border-t border-beige/30">
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <span>Confidence: {Math.round(topicDetails.confidence * 100)}%</span>
                {topicDetails.excerpt_span && <span>• {topicDetails.excerpt_span}</span>}
              </div>
            </div>
          </div>
        );

      case 'Idea':
        const ideaDetails = node.details as IdeaDetails;
        return (
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Status</h4>
              <Badge>{ideaDetails.status}</Badge>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Summary</h4>
              <p className="text-text-secondary text-sm">{ideaDetails.summary}</p>
            </div>
            {ideaDetails.original_inspiration && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Original Inspiration</h4>
                <p className="text-text-secondary text-sm italic">{ideaDetails.original_inspiration}</p>
              </div>
            )}
            {ideaDetails.evolution_notes && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Evolution</h4>
                <p className="text-text-secondary text-sm">{ideaDetails.evolution_notes}</p>
              </div>
            )}
            {ideaDetails.potential_impact && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Potential Impact</h4>
                <p className="text-text-secondary text-sm italic">{ideaDetails.potential_impact}</p>
              </div>
            )}
            {ideaDetails.context_notes && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Context Notes</h4>
                <p className="text-text-secondary text-sm">{ideaDetails.context_notes}</p>
              </div>
            )}
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
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Obstacles</h4>
              <ul className="list-disc list-inside space-y-1">
                {ideaDetails.obstacles.map((obstacle, i) => (
                  <li key={i} className="text-text-secondary text-sm">
                    {obstacle}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Resources Needed</h4>
              <ul className="list-disc list-inside space-y-1">
                {ideaDetails.resources_needed.map((resource, i) => (
                  <li key={i} className="text-text-secondary text-sm">
                    {resource}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2 text-text-primary">Experiments Tried</h4>
              <ul className="list-disc list-inside space-y-1">
                {ideaDetails.experiments_tried.map((experiment, i) => (
                  <li key={i} className="text-text-secondary text-sm">
                    {experiment}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">Created</h4>
                <p className="text-text-secondary">{ideaDetails.created_at}</p>
              </div>
              {ideaDetails.refined_at && (
                <div>
                  <h4 className="font-semibold mb-1 text-text-primary">Refined</h4>
                  <p className="text-text-secondary">{ideaDetails.refined_at}</p>
                </div>
              )}
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">Updated</h4>
                <p className="text-text-secondary">{ideaDetails.updated_at}</p>
              </div>
            </div>
            <div className="pt-2 border-t border-beige/30">
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <span>Confidence: {Math.round(ideaDetails.confidence * 100)}%</span>
                {ideaDetails.excerpt_span && <span>• {ideaDetails.excerpt_span}</span>}
              </div>
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
    <Sheet open={!!node} onOpenChange={(open: boolean) => !open && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] flex flex-col">
        <SheetHeader className="flex-shrink-0">
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
        <Separator className="my-4 flex-shrink-0" />
        <div className="px-6 overflow-y-auto flex-1 pb-8">{renderDetails()}</div>
      </SheetContent>
    </Sheet>
  );
}
