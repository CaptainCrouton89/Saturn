-- User profiles (linked to auth.users)
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY,
  device_id text NOT NULL,
  onboarding_completed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Source table (conversations + information dumps)
CREATE TABLE IF NOT EXISTS source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_type text NOT NULL,
  content_raw jsonb NOT NULL,
  content_processed jsonb,
  summary text,
  entities_extracted boolean DEFAULT false,
  neo4j_synced_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Artifacts
CREATE TABLE IF NOT EXISTS artifact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id),
  conversation_id uuid,
  neo4j_node_id text,
  title text,
  type text,
  content text,
  created_at timestamptz DEFAULT now()
);

-- Audio files
CREATE TABLE IF NOT EXISTS audio_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid,
  storage_path text NOT NULL,
  format text,
  duration_seconds numeric,
  file_size_bytes bigint,
  sample_rate integer,
  created_at timestamptz DEFAULT now()
);

-- User preferences
CREATE TABLE IF NOT EXISTS user_preference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id),
  type text,
  instruction text,
  strength numeric,
  confidence numeric,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Waitlist
CREATE TABLE IF NOT EXISTS waitlist (
  id serial PRIMARY KEY,
  email text NOT NULL,
  created_at timestamptz DEFAULT now()
);
