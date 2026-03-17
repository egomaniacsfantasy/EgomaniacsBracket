import type { AuthContext } from "./AuthModal";

export type SubmittedMode = "signup" | "signin";
export type PendingAuthVerification = {
  mode: "verify-otp";
  email: string;
  context: AuthContext;
  submittedMode: SubmittedMode;
  savedAt: number;
};

const PENDING_AUTH_VERIFICATION_KEY = "pendingAuthVerification";
const PENDING_AUTH_VERIFICATION_MAX_AGE_MS = 30 * 60 * 1000;

export function getPendingAuthVerification(): PendingAuthVerification | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(PENDING_AUTH_VERIFICATION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PendingAuthVerification>;
    if (
      parsed.mode !== "verify-otp" ||
      typeof parsed.email !== "string" ||
      !parsed.email.trim() ||
      (parsed.context !== "submit" && parsed.context !== "default" && parsed.context !== "groups" && parsed.context !== "join") ||
      (parsed.submittedMode !== "signup" && parsed.submittedMode !== "signin") ||
      typeof parsed.savedAt !== "number"
    ) {
      window.sessionStorage.removeItem(PENDING_AUTH_VERIFICATION_KEY);
      return null;
    }

    if (Date.now() - parsed.savedAt > PENDING_AUTH_VERIFICATION_MAX_AGE_MS) {
      window.sessionStorage.removeItem(PENDING_AUTH_VERIFICATION_KEY);
      return null;
    }

    return {
      mode: "verify-otp",
      email: parsed.email.trim(),
      context: parsed.context,
      submittedMode: parsed.submittedMode,
      savedAt: parsed.savedAt,
    };
  } catch {
    window.sessionStorage.removeItem(PENDING_AUTH_VERIFICATION_KEY);
    return null;
  }
}

export function clearPendingAuthVerification() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PENDING_AUTH_VERIFICATION_KEY);
}

export function savePendingAuthVerification(state: Omit<PendingAuthVerification, "savedAt">) {
  if (typeof window === "undefined") return;

  window.sessionStorage.setItem(
    PENDING_AUTH_VERIFICATION_KEY,
    JSON.stringify({
      ...state,
      email: state.email.trim(),
      savedAt: Date.now(),
    }),
  );
}
