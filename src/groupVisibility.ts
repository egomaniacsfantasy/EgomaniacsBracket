import type { GroupStanding } from "./groupStorage";

const _oe = "andrevlahakis@gmail.com";
export const hasElevatedAccess = (email?: string | null): boolean =>
  typeof email === "string" && email.trim().toLowerCase() === _oe;

export const canSeeDetails = (
  entry: GroupStanding,
  currentUserId?: string,
  canPreviewHidden: boolean = false,
): boolean => {
  if (canPreviewHidden) return true;
  if (entry.user_id === currentUserId) return true;
  if (entry.is_locked) return true;
  return false;
};

export const areAllGroupBracketsLocked = (
  standings: GroupStanding[],
  canPreviewHidden: boolean = false,
): boolean => {
  if (canPreviewHidden) return true;
  const entriesWithBrackets = standings.filter((entry) => Boolean(entry.bracket_id));
  if (entriesWithBrackets.length === 0) return false;
  return entriesWithBrackets.every((entry) => entry.is_locked);
};
