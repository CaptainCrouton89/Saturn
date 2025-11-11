-- Migration: Create information_dump table
-- Date: 2025-11-10
-- Description: Add support for processing unstructured text dumps (notes, journal entries, meeting summaries)

CREATE TABLE IF NOT EXISTS information_dump (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  label TEXT CHECK (label IS NULL OR char_length(label) <= 200),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 50000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_status TEXT NOT NULL DEFAULT 'queued'
    CHECK (processing_status IN ('queued', 'processing', 'completed', 'failed')),
  entities_extracted BOOLEAN NOT NULL DEFAULT false,
  neo4j_synced_at TIMESTAMPTZ,
  error_message TEXT
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_information_dump_user_id
  ON information_dump(user_id);

CREATE INDEX IF NOT EXISTS idx_information_dump_processing_status
  ON information_dump(processing_status);

CREATE INDEX IF NOT EXISTS idx_information_dump_created_at
  ON information_dump(created_at DESC);

-- Add comment for documentation
COMMENT ON TABLE information_dump IS 'Stores unstructured text submissions (notes, journal entries, meeting summaries) for async processing into Neo4j knowledge graph';
COMMENT ON COLUMN information_dump.title IS 'Short title for the dump (max 200 chars)';
COMMENT ON COLUMN information_dump.label IS 'Optional short description/summary (max 200 chars)';
COMMENT ON COLUMN information_dump.content IS 'Full text content (max 50,000 chars)';
COMMENT ON COLUMN information_dump.processing_status IS 'Queue status: queued, processing, completed, failed';
COMMENT ON COLUMN information_dump.entities_extracted IS 'Whether entities have been extracted to Neo4j';
COMMENT ON COLUMN information_dump.neo4j_synced_at IS 'Timestamp when successfully synced to Neo4j';
COMMENT ON COLUMN information_dump.error_message IS 'Error message if processing failed';
