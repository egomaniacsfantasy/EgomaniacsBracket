-- Minimal Supabase hotfix for bracket submissions.
-- This avoids the broader account hardening script and only adds
-- the schema pieces required for submitted brackets to work.
--
-- Safe scope:
-- - adds public.brackets.submitted_at if missing
-- - recreates the bracket submission trigger/function
--
-- It does NOT:
-- - touch display names
-- - modify profiles
-- - recreate the leaderboard view

ALTER TABLE public.brackets
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.enforce_bracket_submission_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  submit_count INT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.is_locked, false)
     AND COALESCE(OLD.submitted_at, 'epoch'::timestamptz) IS DISTINCT FROM COALESCE(NEW.submitted_at, 'epoch'::timestamptz) THEN
    RAISE EXCEPTION 'Submissions are locked at tip-off.';
  END IF;

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

    IF submit_count >= 10 THEN
      RAISE EXCEPTION 'Submission limit reached (10/10).';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_enforce_bracket_submission_rules'
      AND tgrelid = 'public.brackets'::regclass
  ) THEN
    CREATE TRIGGER trg_enforce_bracket_submission_rules
    BEFORE INSERT OR UPDATE OF submitted_at, is_locked ON public.brackets
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_bracket_submission_rules();
  END IF;
END $$;
