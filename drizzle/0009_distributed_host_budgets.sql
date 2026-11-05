CREATE TABLE IF NOT EXISTS source_host_budgets (
  hostname text PRIMARY KEY,
  next_request_at timestamptz NOT NULL DEFAULT now()
);
