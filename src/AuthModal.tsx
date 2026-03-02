import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useAuth } from "./AuthContext";
import { supabase } from "./supabaseClient";

type Mode = "signup" | "signin" | "check-email";

export function AuthModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { signUp, signIn } = useAuth();
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedMode, setSubmittedMode] = useState<"signup" | "signin">("signup");
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [signinUsePassword, setSigninUsePassword] = useState(false);
  const [signinPassword, setSigninPassword] = useState("");
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setMode("signup");
    setEmail("");
    setDisplayName("");
    setError("");
    setSubmitting(false);
    setSubmittedMode("signup");
    setUsePassword(false);
    setPassword("");
    setSigninUsePassword(false);
    setSigninPassword("");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  const handleSignUp = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!email.trim()) return setError("Email is required");
    if (!displayName.trim()) return setError("Display name is required");
    if (displayName.trim().length > 30) return setError("Display name must be 30 characters or less");
    if (usePassword && password.length < 6) return setError("Password must be at least 6 characters");

    setSubmitting(true);
    const authResult = usePassword
      ? await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: displayName.trim() },
            emailRedirectTo: window.location.origin,
          },
        })
      : await signUp(email.trim(), displayName.trim());
    const authError = authResult.error;
    setSubmitting(false);
    if (authError) return setError((authError as { message?: string })?.message ?? "Unable to sign up");
    setSubmittedMode("signup");
    setMode("check-email");
  };

  const handleSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!email.trim()) return setError("Email is required");
    if (signinUsePassword && !signinPassword) return setError("Password is required");

    setSubmitting(true);
    const authResult = signinUsePassword
      ? await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: signinPassword,
        })
      : await signIn(email.trim());
    const authError = authResult.error;
    setSubmitting(false);
    if (authError) return setError((authError as { message?: string })?.message ?? "Unable to log in");
    if (signinUsePassword) {
      onClose();
      return;
    }
    setSubmittedMode("signin");
    setMode("check-email");
  };

  if (!isOpen) return null;

  return (
    <div className="auth-modal-backdrop" onClick={handleBackdropClick}>
      <div className="auth-modal" ref={modalRef}>
        <button className="auth-modal-close" onClick={onClose}>
          ✕
        </button>

        {mode === "check-email" ? (
          <div className="auth-modal-check-email">
            <span className="auth-modal-icon">✉</span>
            <h3 className="auth-modal-title">Check your email</h3>
            <p className="auth-modal-subtitle">
              We sent a confirmation link to <strong>{email}</strong>. Click the link to{" "}
              {submittedMode === "signup" ? "create your account" : "log in"}.
            </p>
            <p className="auth-modal-same-device-warning">
              ⚠️ Open the link on THIS device. Opening it on a different device won&apos;t log you in here.
            </p>
            <p className="auth-modal-hint">Don&apos;t see it? Check your spam folder.</p>
          </div>
        ) : mode === "signup" ? (
          <form onSubmit={handleSignUp} className="auth-modal-form">
            <h3 className="auth-modal-title">Save your bracket</h3>
            <p className="auth-modal-subtitle">
              Create an account to save up to 3 brackets and compete on the leaderboard.
            </p>

            <label className="auth-modal-label">Display name</label>
            <input
              className="auth-modal-input"
              type="text"
              placeholder="How you'll appear on the leaderboard"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={30}
              autoFocus
            />

            <label className="auth-modal-label">Email</label>
            <input
              className="auth-modal-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            {!usePassword ? (
              <button
                className="auth-modal-password-toggle"
                type="button"
                onClick={() => {
                  setUsePassword(true);
                  setError("");
                }}
              >
                Or set a password instead
              </button>
            ) : (
              <>
                <label className="auth-modal-label">Password</label>
                <input
                  className="auth-modal-input"
                  type="password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={6}
                />
                <button
                  className="auth-modal-password-toggle"
                  type="button"
                  onClick={() => {
                    setUsePassword(false);
                    setPassword("");
                    setError("");
                  }}
                >
                  Use magic link instead (no password needed)
                </button>
              </>
            )}

            {error ? <p className="auth-modal-error">{error}</p> : null}

            <button className="auth-modal-submit" type="submit" disabled={submitting}>
              {submitting ? "Sending..." : "Create Account"}
            </button>

            <p className="auth-modal-toggle">
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError("");
                  setSigninUsePassword(false);
                  setSigninPassword("");
                }}
              >
                Log in
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleSignIn} className="auth-modal-form">
            <h3 className="auth-modal-title">Welcome back</h3>
            <p className="auth-modal-subtitle">Enter your email and we&apos;ll send you a log-in link.</p>

            <label className="auth-modal-label">Email</label>
            <input
              className="auth-modal-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoFocus
            />

            {signinUsePassword ? (
              <>
                <label className="auth-modal-label">Password</label>
                <input
                  className="auth-modal-input"
                  type="password"
                  placeholder="Your password"
                  value={signinPassword}
                  onChange={(event) => setSigninPassword(event.target.value)}
                />
              </>
            ) : null}

            <button
              className="auth-modal-password-toggle"
              type="button"
              onClick={() => {
                setSigninUsePassword((prev) => !prev);
                setSigninPassword("");
                setError("");
              }}
            >
              {signinUsePassword ? "Use magic link instead" : "Log in with password"}
            </button>

            {error ? <p className="auth-modal-error">{error}</p> : null}

            <button className="auth-modal-submit" type="submit" disabled={submitting}>
              {submitting ? "Sending..." : signinUsePassword ? "Log In" : "Send Magic Link"}
            </button>

            <p className="auth-modal-toggle">
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError("");
                  setUsePassword(false);
                  setPassword("");
                }}
              >
                Create one
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
