CREATE TABLE discovery_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_url text NOT NULL UNIQUE,
  hostname text NOT NULL,
  provider text,
  board_token text,
  state text NOT NULL DEFAULT 'DISCOVERED' CHECK (state IN ('DISCOVERED','IDENTIFIED','REVIEW_REQUIRED','REJECTED')),
  requires_permission_review boolean NOT NULL DEFAULT true CHECK (requires_permission_review = true),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_discovered_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  next_check_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  review_note text
);
--> statement-breakpoint
CREATE INDEX discovery_candidates_state_idx ON discovery_candidates(state, last_observed_at);
--> statement-breakpoint
CREATE INDEX discovery_candidates_hostname_idx ON discovery_candidates(hostname);
--> statement-breakpoint
CREATE TABLE discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  seeds_seen integer NOT NULL DEFAULT 0 CHECK (seeds_seen >= 0),
  candidates_found integer NOT NULL DEFAULT 0 CHECK (candidates_found >= 0),
  candidates_updated integer NOT NULL DEFAULT 0 CHECK (candidates_updated >= 0),
  rejected integer NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
