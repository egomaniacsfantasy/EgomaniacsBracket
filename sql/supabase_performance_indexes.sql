-- Performance indexes for Bracket Lab group + leaderboard reads.
-- Run in the Supabase SQL Editor.

CREATE INDEX IF NOT EXISTS group_members_user_id_idx
  ON public.group_members (user_id);

CREATE INDEX IF NOT EXISTS group_members_group_id_idx
  ON public.group_members (group_id);

CREATE INDEX IF NOT EXISTS group_members_group_id_user_id_idx
  ON public.group_members (group_id, user_id);

CREATE INDEX IF NOT EXISTS group_members_bracket_id_idx
  ON public.group_members (bracket_id)
  WHERE bracket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bracket_scores_bracket_id_idx
  ON public.bracket_scores (bracket_id);

CREATE INDEX IF NOT EXISTS bracket_scores_user_id_idx
  ON public.bracket_scores (user_id);

CREATE INDEX IF NOT EXISTS bracket_scores_score_order_idx
  ON public.bracket_scores (total_score DESC, correct_picks DESC, bracket_id);

CREATE INDEX IF NOT EXISTS bracket_scores_rank_idx
  ON public.bracket_scores (rank);

CREATE INDEX IF NOT EXISTS brackets_submitted_at_idx
  ON public.brackets (submitted_at)
  WHERE submitted_at IS NOT NULL;

ANALYZE public.group_members;
ANALYZE public.bracket_scores;
ANALYZE public.brackets;
