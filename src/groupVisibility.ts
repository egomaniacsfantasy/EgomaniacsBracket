import type { GroupStanding } from "./groupStorage";

const _oe = "andrevlahakis@gmail.com";
export const hasElevatedAccess = (email?: string | null): boolean =>
  email != null && email === _oe;

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
  return standings.length > 0 && standings.every((entry) => entry.is_locked);
};
