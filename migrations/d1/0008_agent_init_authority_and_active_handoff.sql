-- Bind resumable init state to the OAuth client that created it and keep a
-- single server-authoritative credential handoff per run.
ALTER TABLE agent_init_runs ADD COLUMN oauth_client_id TEXT;
ALTER TABLE agent_init_runs ADD COLUMN active_handoff_id TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_init_runs_oauth_client
  ON agent_init_runs(operator_id, oauth_client_id, status, expires_at);
