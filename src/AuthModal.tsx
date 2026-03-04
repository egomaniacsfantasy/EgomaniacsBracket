import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { useAuth } from "./AuthContext";

type Mode = "signup" | "signin" | "check-email";

function getFriendlyAuthError(error: { message?: string } | null | undefined): string {
  const raw = error?.message ?? "";
  const msg = raw.toLowerCase();

  if (
    msg.includes("already registered") ||
    msg.includes("already been registered") ||
    msg.includes("duplicate") ||
    msg.includes("already in use")
  ) {
    return "This email already has an account. Try logging in instead.";
  }

  if (msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("email rate limit")) {
    return "Too many attempts. Please wait a minute and try again.";
  }

  if (msg.includes("invalid email") || msg.includes("valid email")) {
    return "Please enter a valid email address.";
  }

  if (msg.includes("password") && (msg.includes("short") || msg.includes("least") || msg.includes("characters"))) {
    return "Password must be at least 6 characters.";
  }

  if (
    msg.includes("invalid login") ||
    msg.includes("invalid credentials") ||
    msg.includes("wrong password") ||
    msg.includes("invalid password")
  ) {
    return "Incorrect email or password.";
  }

  if (msg.includes("user not found") || msg.includes("no user")) {
    return "No account found with this email. Try signing up instead.";
  }

  if (msg.includes("not confirmed") || msg.includes("confirm")) {
    return "Please check your email and click the confirmation link first.";
  }

  if (msg.includes("network") || msg.includes("fetch")) {
    return "Connection error. Please check your internet and try again.";
  }

  return raw || "Something went wrong. Please try again.";
}

export function AuthModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { signUp, signIn, signInWithGoogle, isDisplayNameAvailable } = useAuth();
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedMode, setSubmittedMode] = useState<"signup" | "signin">("signup");
  const [password, setPassword] = useState("");
  const [signinPassword, setSigninPassword] = useState("");
  const [displayNameHint, setDisplayNameHint] = useState("");
  const [displayNameChecking, setDisplayNameChecking] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setMode("signup");
    setEmail("");
    setDisplayName("");
    setError("");
    setSubmitting(false);
    setSubmittedMode("signup");
    setPassword("");
    setSigninPassword("");
    setDisplayNameHint("");
    setDisplayNameChecking(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || mode !== "signup") return;
    const value = displayName.trim();
    if (!value) {
      setDisplayNameHint("");
      setDisplayNameChecking(false);
      return;
    }
    if (value.length < 3) {
      setDisplayNameHint("Use at least 3 characters.");
      setDisplayNameChecking(false);
      return;
    }
    setDisplayNameChecking(true);
    const timer = window.setTimeout(async () => {
      const { available } = await isDisplayNameAvailable(value);
      setDisplayNameHint(available ? "Name available." : "Name taken. Try adding a number.");
      setDisplayNameChecking(false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [displayName, isDisplayNameAvailable, isOpen, mode]);

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
    if (password.length < 6) return setError("Password must be at least 6 characters");

    setSubmitting(true);
    const authResult = await signUp(email.trim(), displayName.trim(), password);
    const authError = authResult.error;
    setSubmitting(false);
    if (authError) return setError(getFriendlyAuthError(authError as { message?: string }));
    setSubmittedMode("signup");
    setMode("check-email");
  };

  const handleSignIn = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!email.trim()) return setError("Email is required");
    if (!signinPassword) return setError("Password is required");

    setSubmitting(true);
    const authResult = await signIn(email.trim(), signinPassword);
    const authError = authResult.error;
    setSubmitting(false);
    if (authError) return setError(getFriendlyAuthError(authError as { message?: string }));
    onClose();
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setSubmitting(true);
    const authResult = await signInWithGoogle();
    setSubmitting(false);
    if (authResult.error) {
      setError("Google sign-in failed. Please try again.");
    }
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
            <p className="auth-modal-hint">Don&apos;t see it? Check your spam folder.</p>
          </div>
        ) : mode === "signup" ? (
          <form onSubmit={handleSignUp} className="auth-modal-form">
            <h3 className="auth-modal-title">Submit your bracket</h3>
            <p className="auth-modal-subtitle">
              Create an account to save up to 25 brackets and compete on the leaderboard. Password required.
            </p>

            <button
              className="auth-modal-google-btn"
              onClick={handleGoogleSignIn}
              type="button"
              disabled={submitting}
            >
              <svg className="auth-modal-google-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            <div className="auth-modal-divider">
              <span className="auth-modal-divider-line" />
              <span className="auth-modal-divider-text">or</span>
              <span className="auth-modal-divider-line" />
            </div>

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
            {displayName.trim() ? (
              <span className={`auth-modal-hint ${displayNameHint.toLowerCase().includes("taken") ? "auth-modal-hint--error" : ""}`}>
                {displayNameChecking ? "Checking name availability..." : displayNameHint}
              </span>
            ) : null}

            <label className="auth-modal-label">Email</label>
            <input
              className="auth-modal-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <label className="auth-modal-label">Password</label>
            <input
              className="auth-modal-input"
              type="password"
              placeholder="At least 6 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={6}
            />

            {error ? (
              <div className="auth-modal-error">
                <span>{error}</span>
                {error.includes("Try logging in") ? (
                  <button
                    className="auth-modal-error-link"
                    type="button"
                    onClick={() => {
                      setMode("signin");
                      setError("");
                      setPassword("");
                    }}
                  >
                    Go to log in →
                  </button>
                ) : null}
                {error.includes("Try signing up") ? (
                  <button
                    className="auth-modal-error-link"
                    type="button"
                    onClick={() => {
                      setMode("signup");
                      setError("");
                    }}
                  >
                    Go to sign up →
                  </button>
                ) : null}
              </div>
            ) : null}

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
                  setPassword("");
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
            <p className="auth-modal-subtitle">Enter your email and password to log in.</p>

            <button
              className="auth-modal-google-btn"
              onClick={handleGoogleSignIn}
              type="button"
              disabled={submitting}
            >
              <svg className="auth-modal-google-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            <div className="auth-modal-divider">
              <span className="auth-modal-divider-line" />
              <span className="auth-modal-divider-text">or</span>
              <span className="auth-modal-divider-line" />
            </div>

            <label className="auth-modal-label">Email</label>
            <input
              className="auth-modal-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoFocus
            />

            <label className="auth-modal-label">Password</label>
            <input
              className="auth-modal-input"
              type="password"
              placeholder="Your password"
              value={signinPassword}
              onChange={(event) => setSigninPassword(event.target.value)}
            />

            {error ? (
              <div className="auth-modal-error">
                <span>{error}</span>
                {error.includes("Try logging in") ? (
                  <button
                    className="auth-modal-error-link"
                    type="button"
                    onClick={() => {
                      setMode("signin");
                      setError("");
                    }}
                  >
                    Go to log in →
                  </button>
                ) : null}
                {error.includes("Try signing up") ? (
                  <button
                    className="auth-modal-error-link"
                    type="button"
                    onClick={() => {
                      setMode("signup");
                      setError("");
                      setSigninPassword("");
                    }}
                  >
                    Go to sign up →
                  </button>
                ) : null}
              </div>
            ) : null}

            <button className="auth-modal-submit" type="submit" disabled={submitting}>
              {submitting ? "Logging in..." : "Log In"}
            </button>

            <p className="auth-modal-toggle">
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError("");
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
