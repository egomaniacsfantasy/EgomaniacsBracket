import { deserializePicks, serializePicks } from "./bracketStorage";
import type { LockedPicks } from "./lib/bracket";

const PENDING_AUTH_DRAFT_KEY = "pendingAuthDraft";
const PENDING_AUTH_DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

type PendingAuthDraft = {
  picks: LockedPicks;
  savedAt: number;
};

export function savePendingAuthDraft(picks: LockedPicks) {
  if (typeof window === "undefined") return;

  const serialized = serializePicks(picks);
  if (Object.keys(serialized).length === 0) {
    window.sessionStorage.removeItem(PENDING_AUTH_DRAFT_KEY);
    return;
  }

  const payload: PendingAuthDraft = {
    picks: serialized,
    savedAt: Date.now(),
  };

  window.sessionStorage.setItem(PENDING_AUTH_DRAFT_KEY, JSON.stringify(payload));
}

export function consumePendingAuthDraft(): LockedPicks | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(PENDING_AUTH_DRAFT_KEY);
    if (!raw) return null;

    window.sessionStorage.removeItem(PENDING_AUTH_DRAFT_KEY);
    const parsed = JSON.parse(raw) as Partial<PendingAuthDraft>;
    if (!parsed || typeof parsed.savedAt !== "number" || !parsed.picks) return null;
    if (Date.now() - parsed.savedAt > PENDING_AUTH_DRAFT_MAX_AGE_MS) return null;

    return deserializePicks(parsed.picks);
  } catch {
    window.sessionStorage.removeItem(PENDING_AUTH_DRAFT_KEY);
    return null;
  }
}
