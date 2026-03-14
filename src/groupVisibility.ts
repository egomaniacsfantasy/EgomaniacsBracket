import type { GroupStanding } from "./groupStorage";

export const canSeeDetails = (entry: GroupStanding, currentUserId?: string): boolean => {
  if (entry.user_id === currentUserId) return true;
  if (entry.is_locked) return true;
  return false;
};

export const areAllGroupBracketsLocked = (standings: GroupStanding[]): boolean =>
  standings.length > 0 && standings.every((entry) => entry.is_locked);
