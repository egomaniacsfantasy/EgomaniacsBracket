-- Elevated leaderboard bracket deletion for the site owner.
-- Run in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.admin_delete_bracket(target_bracket_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requester_email TEXT := lower(COALESCE(auth.jwt() ->> 'email', ''));
BEGIN
  IF requester_email <> 'andrevlahakis@gmail.com' THEN
    RAISE EXCEPTION 'Not authorized to delete this bracket.';
  END IF;

  UPDATE public.group_members
  SET bracket_id = NULL
  WHERE bracket_id = target_bracket_id;

  DELETE FROM public.bracket_scores
  WHERE bracket_id = target_bracket_id;

  DELETE FROM public.brackets
  WHERE id = target_bracket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bracket not found.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_bracket(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_bracket(uuid) TO authenticated;
