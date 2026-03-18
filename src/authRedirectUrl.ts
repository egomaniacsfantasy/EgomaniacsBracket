import { extractInviteCode } from "./lib/inviteCode";

export function buildAuthRedirectUrl(options?: { includePendingJoinCode?: boolean }) {
  if (typeof window === "undefined") return undefined;

  const url = new URL(window.location.origin + window.location.pathname);
  if (options?.includePendingJoinCode) {
    const joinCode = extractInviteCode(window.sessionStorage.getItem("pendingJoinCode"));
    if (joinCode) {
      url.searchParams.set("join", joinCode);
    }
  }

  return url.toString();
}
