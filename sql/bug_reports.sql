CREATE TABLE IF NOT EXISTS public.bug_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name TEXT,
  description TEXT NOT NULL,
  url TEXT,
  route TEXT,
  user_agent TEXT,
  screen_width INTEGER,
  screen_height INTEGER,
  viewport_width INTEGER,
  viewport_height INTEGER,
  active_region TEXT,
  active_round TEXT,
  active_tab TEXT,
  pick_count INTEGER,
  chaos_score REAL,
  display_mode TEXT,
  is_mobile BOOLEAN,
  futures_open BOOLEAN,
  sim_running BOOLEAN,
  bracket_hash TEXT,
  email_sent BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS bug_reports_created_at_idx ON public.bug_reports (created_at DESC);

ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;

GRANT INSERT ON TABLE public.bug_reports TO anon, authenticated;
GRANT SELECT ON TABLE public.bug_reports TO service_role;

DROP POLICY IF EXISTS "Anyone can insert bug reports" ON public.bug_reports;
CREATE POLICY "Anyone can insert bug reports"
  ON public.bug_reports FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Only service role can select bug reports" ON public.bug_reports;
CREATE POLICY "Only service role can select bug reports"
  ON public.bug_reports FOR SELECT
  TO service_role
  USING (true);
