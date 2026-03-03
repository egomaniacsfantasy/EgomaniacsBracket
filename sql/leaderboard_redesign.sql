-- BracketLab leaderboard metadata columns + view update
-- Run in Supabase SQL Editor.

ALTER TABLE public.brackets
  ADD COLUMN IF NOT EXISTS champion_name TEXT,
  ADD COLUMN IF NOT EXISTS champion_seed INTEGER,
  ADD COLUMN IF NOT EXISTS champion_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS champion_eliminated BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS final_four JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS boldest_pick JSONB;

DROP VIEW IF EXISTS public.leaderboard;

CREATE OR REPLACE VIEW public.leaderboard AS
SELECT
  bs.rank,
  p.display_name,
  b.bracket_name,
  b.chaos_score,
  b.champion_name,
  b.champion_seed,
  b.champion_logo_url,
  b.champion_eliminated,
  b.final_four,
  b.boldest_pick,
  bs.total_score,
  bs.correct_picks,
  bs.possible_picks,
  bs.max_remaining,
  bs.r64_score,
  bs.r32_score,
  bs.s16_score,
  bs.e8_score,
  bs.f4_score,
  bs.champ_score,
  bs.bracket_id,
  bs.user_id,
  bs.updated_at
FROM public.bracket_scores bs
JOIN public.brackets b ON bs.bracket_id = b.id
JOIN public.profiles p ON bs.user_id = p.id
ORDER BY bs.total_score DESC, bs.correct_picks DESC;
