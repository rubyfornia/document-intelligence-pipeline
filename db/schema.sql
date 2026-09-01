-- Document Intelligence Pipeline — schema. Idempotent.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY,
  filename text NOT NULL,
  content_hash text UNIQUE NOT NULL,
  byte_size int NOT NULL,
  pdf bytea NOT NULL,
  page_count int,
  title jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  abstract jsonb,
  status text NOT NULL DEFAULT 'queued',
  seed boolean NOT NULL DEFAULT false,
  locked boolean NOT NULL DEFAULT false,  -- shipped demo corpus: protected from deletion
  error text,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pages (
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  n int NOT NULL,
  width real, height real,
  class text, reason text, route text,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  flags text[] NOT NULL DEFAULT '{}',
  model text,
  ms int NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (document_id, n)
);

CREATE TABLE IF NOT EXISTS blocks (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_n int NOT NULL,
  order_index int NOT NULL,
  bbox jsonb,
  text text NOT NULL DEFAULT '',
  font_size real, font_name text, is_bold boolean DEFAULT false,
  role text NOT NULL DEFAULT 'body',
  heading_level int,
  source text NOT NULL DEFAULT 'deterministic',
  bbox_source text NOT NULL DEFAULT 'measured',
  boilerplate boolean NOT NULL DEFAULT false,
  section_id text
);
CREATE INDEX IF NOT EXISTS blocks_doc_page ON blocks(document_id, page_n, order_index);

CREATE TABLE IF NOT EXISTS sections (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  parent_id text,
  level int NOT NULL DEFAULT 1,
  title text NOT NULL,
  page_start int, page_end int,
  order_index int NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'detected',
  summary text,
  confidence real
);
CREATE INDEX IF NOT EXISTS sections_doc ON sections(document_id, order_index);

CREATE TABLE IF NOT EXISTS elements (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_n int NOT NULL,
  type text NOT NULL,               -- figure | table | math
  bbox jsonb,
  caption text, caption_confidence text,
  description text,
  grid jsonb,
  status text NOT NULL DEFAULT 'ok', -- ok | table_extraction_failed
  source text NOT NULL DEFAULT 'vision',
  bbox_source text NOT NULL DEFAULT 'asserted',
  section_id text
);

CREATE TABLE IF NOT EXISTS chunks (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_id text,
  content_type text NOT NULL DEFAULT 'text',  -- text | figure | table
  order_index int NOT NULL DEFAULT 0,
  breadcrumb text[] NOT NULL DEFAULT '{}',
  text text NOT NULL DEFAULT '',
  embedding_text text NOT NULL DEFAULT '',
  tokens int NOT NULL DEFAULT 0,
  page_start int, page_end int,
  block_ids text[] NOT NULL DEFAULT '{}',
  element_id text,
  prev_id text, next_id text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(768)
);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(document_id, order_index);

CREATE TABLE IF NOT EXISTS boilerplate (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  text text NOT NULL,
  pages int[] NOT NULL DEFAULT '{}',
  bbox jsonb
);

CREATE TABLE IF NOT EXISTS warnings (
  id bigserial PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  code text NOT NULL,
  page_n int,
  element_ids text[] NOT NULL DEFAULT '{}',
  message text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'processing',  -- processing | complete | partial | failed
  stage text NOT NULL DEFAULT 'extract',
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  claimed_until timestamptz,                  -- step lease: one driver at a time, pooler-safe
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS claimed_until timestamptz;

-- THE LEDGER: what actually ran — written from the execution path itself.
CREATE TABLE IF NOT EXISTS run_events (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL,
  document_id text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  stage text NOT NULL,
  page_n int,
  model text,
  input_tokens int, output_tokens int,
  ms int, cost_usd numeric,
  note text
);
CREATE INDEX IF NOT EXISTS run_events_doc ON run_events(document_id, id);

CREATE TABLE IF NOT EXISTS relations (
  id text PRIMARY KEY,
  kind text NOT NULL,               -- near_duplicate | related
  a_doc text NOT NULL, b_doc text NOT NULL,
  a_chunk text, b_chunk text,
  score real NOT NULL,
  why text
);
