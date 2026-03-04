-- Bracket Lab account/submission hardening
-- Run in Supabase SQL Editor.

ALTER TABLE public.brackets
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

-- Normalize legacy duplicate display names before adding uniqueness constraints.
DO $$
DECLARE
  rec RECORD;
  next_name TEXT;
  n INT;
BEGIN
  FOR rec IN
    SELECT id, display_name
    FROM (
      SELECT id,
             display_name,
             row_number() OVER (
               PARTITION BY lower(trim(display_name))
               ORDER BY created_at NULLS LAST, id
             ) AS rn
      FROM public.profiles
      WHERE display_name IS NOT NULL
    ) t
    WHERE t.rn > 1
  LOOP
    n := 2;
    next_name := trim(rec.display_name) || n::text;
    WHILE EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE lower(trim(p.display_name)) = lower(trim(next_name))
    ) LOOP
      n := n + 1;
      next_name := trim(rec.display_name) || n::text;
    END LOOP;

    UPDATE public.profiles
    SET display_name = next_name
    WHERE id = rec.id;
  END LOOP;
END $$;

-- Case-insensitive + trimmed uniqueness for display names.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_display_name_ci_unique
  ON public.profiles ((lower(trim(display_name))))
  WHERE display_name IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_profile_display_name_unique()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.display_name IS NULL OR trim(NEW.display_name) = '' THEN
    RAISE EXCEPTION 'Display name is required.';
  END IF;

  NEW.display_name := trim(NEW.display_name);

  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND lower(trim(p.display_name)) = lower(trim(NEW.display_name))
  ) THEN
    RAISE EXCEPTION 'Display name already taken. Try adding a number.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_unique_display_name ON public.profiles;
CREATE TRIGGER trg_profiles_unique_display_name
BEFORE INSERT OR UPDATE OF display_name ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_profile_display_name_unique();

CREATE OR REPLACE FUNCTION public.enforce_bracket_submission_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  submit_count INT;
BEGIN
  -- Prevent submit/unsubmit updates once bracket is locked.
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.is_locked, false)
     AND COALESCE(OLD.submitted_at, 'epoch'::timestamptz) IS DISTINCT FROM COALESCE(NEW.submitted_at, 'epoch'::timestamptz) THEN
    RAISE EXCEPTION 'Submissions are locked at tip-off.';
  END IF;

  -- Enforce max 25 submitted brackets per user.
  IF NEW.submitted_at IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR COALESCE(OLD.submitted_at, 'epoch'::timestamptz) = 'epoch'::timestamptz
     ) THEN
    SELECT COUNT(*) INTO submit_count
    FROM public.brackets b
    WHERE b.user_id = NEW.user_id
      AND b.submitted_at IS NOT NULL
      AND b.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

    IF submit_count >= 25 THEN
      RAISE EXCEPTION 'Submission limit reached (25/25).';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_bracket_submission_rules ON public.brackets;
CREATE TRIGGER trg_enforce_bracket_submission_rules
BEFORE INSERT OR UPDATE OF submitted_at, is_locked ON public.brackets
FOR EACH ROW
EXECUTE FUNCTION public.enforce_bracket_submission_rules();

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
WHERE b.submitted_at IS NOT NULL
ORDER BY bs.total_score DESC, bs.correct_picks DESC;
