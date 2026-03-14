-- BracketLab Pre-Launch Database Indexes
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- These indexes speed up common queries under load.
-- They are safe to run multiple times — IF NOT EXISTS prevents duplicates.

-- Brackets: lookup by user
CREATE INDEX IF NOT EXISTS idx_brackets_user_id
  ON public.brackets (user_id);

-- Bracket scores: lookup by user (scoring, leaderboard)
CREATE INDEX IF NOT EXISTS idx_bracket_scores_user_id
  ON public.bracket_scores (user_id);

-- Group members: lookup by user (my groups)
CREATE INDEX IF NOT EXISTS idx_group_members_user_id
  ON public.group_members (user_id);

-- Group members: lookup by group (group leaderboard)
CREATE INDEX IF NOT EXISTS idx_group_members_group_id
  ON public.group_members (group_id);

-- Groups: lookup by invite code (join flow)
CREATE INDEX IF NOT EXISTS idx_groups_invite_code
  ON public.groups (invite_code);

-- Brackets: submission-related indexes.
-- Only create these after the submitted_at column exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'brackets'
      AND column_name = 'submitted_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_brackets_user_submitted ON public.brackets (user_id, submitted_at)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_brackets_submitted ON public.brackets (submitted_at) WHERE submitted_at IS NOT NULL';
  ELSE
    RAISE NOTICE 'Skipping submitted_at indexes because public.brackets.submitted_at does not exist yet.';
  END IF;
END $$;
