ALTER TABLE source
  ADD COLUMN processing_status text,
  ADD COLUMN error_message text,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE source
  ADD CONSTRAINT source_processing_status_check
    CHECK (processing_status IN ('queued', 'processing', 'completed', 'failed')),
  ADD CONSTRAINT source_attempt_count_check
    CHECK (attempt_count >= 0);

CREATE INDEX source_processing_status_idx ON source(processing_status);
