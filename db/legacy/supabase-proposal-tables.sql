-- Proposal Agent Configuration
-- Stores the system prompt that can be edited from the Hub
CREATE TABLE IF NOT EXISTS proposal_agent_config (
  id text PRIMARY KEY DEFAULT 'default',
  system_prompt text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by text
);

-- Proposal Corrections
-- Stores corrections from CM/partners that get appended to the system prompt
CREATE TABLE IF NOT EXISTS proposal_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction text NOT NULL,
  source text DEFAULT 'CM',
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  proposal_context text  -- which proposal triggered this correction
);

-- Proposal History
-- Logs every generated proposal for reference
CREATE TABLE IF NOT EXISTS proposal_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name text,
  client_name text,
  fee text,
  input_mode text,  -- 'paste' or 'form'
  raw_input text,
  form_data jsonb,
  generated_proposal jsonb,
  created_at timestamptz DEFAULT now(),
  created_by text
);

-- Insert the base system prompt
INSERT INTO proposal_agent_config (id, system_prompt) VALUES ('default', 'BASE_PROMPT')
ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE proposal_agent_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_history ENABLE ROW LEVEL SECURITY;

-- Policies (allow all for service role, read for anon)
CREATE POLICY "Service full access" ON proposal_agent_config FOR ALL USING (true);
CREATE POLICY "Service full access" ON proposal_corrections FOR ALL USING (true);
CREATE POLICY "Service full access" ON proposal_history FOR ALL USING (true);
