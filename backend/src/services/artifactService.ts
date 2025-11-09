import { supabaseService } from '../db/supabase.js';
import { ArtifactDTO, PaginatedArtifactsDTO } from '../types/dto.js';

export class ArtifactService {
  /**
   * List artifacts for a user with pagination and optional type filtering
   */
  async listArtifacts(
    userId: string,
    limit: number = 10,
    offset: number = 0,
    type?: string
  ): Promise<PaginatedArtifactsDTO> {
    const supabase = supabaseService.getClient();

    let query = supabase
      .from('artifact')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (type) {
      query = query.eq('type', type);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to list artifacts: ${error.message}`);
    }

    const artifacts: ArtifactDTO[] = (data ?? []).map((artifact) => {
      if (!artifact.type) {
        throw new Error(`Invalid artifact data: missing type for artifact ${artifact.id}`);
      }
      if (!artifact.created_at) {
        throw new Error(`Invalid artifact data: missing created_at for artifact ${artifact.id}`);
      }

      return {
        id: artifact.id,
        conversationId: artifact.conversation_id,
        type: artifact.type,
        title: artifact.title,
        content: artifact.content,
        createdAt: artifact.created_at,
        neo4jNodeId: artifact.neo4j_node_id,
        userId: artifact.user_id,
      };
    });

    const total = count ?? 0;
    const hasMore = offset + limit < total;

    return {
      artifacts,
      total,
      hasMore,
    };
  }

  /**
   * Get a specific artifact by ID
   */
  async getArtifact(artifactId: string, userId: string): Promise<ArtifactDTO> {
    const supabase = supabaseService.getClient();

    const { data: artifact, error } = await supabase
      .from('artifact')
      .select('*')
      .eq('id', artifactId)
      .eq('user_id', userId)
      .single();

    if (error || !artifact) {
      throw new Error('Artifact not found');
    }

    if (!artifact.type) {
      throw new Error('Invalid artifact data: missing type');
    }
    if (!artifact.created_at) {
      throw new Error('Invalid artifact data: missing created_at');
    }

    return {
      id: artifact.id,
      conversationId: artifact.conversation_id,
      type: artifact.type,
      title: artifact.title,
      content: artifact.content,
      createdAt: artifact.created_at,
      neo4jNodeId: artifact.neo4j_node_id,
      userId: artifact.user_id,
    };
  }
}

export const artifactService = new ArtifactService();
