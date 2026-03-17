import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { supabase } from "./supabaseClient";
import { useAuth } from "./AuthContext";
import { trackEvent } from "./lib/analytics";

export interface BugReportModalProps {
  activeRegion?: string;
  activeRound?: string;
  activeTab?: string;
  pickCount?: number;
  chaosScore?: number | null;
  displayMode?: string;
  isFuturesOpen?: boolean;
  isSimRunning?: boolean;
  bracketHash?: string | null;
  isMobile?: boolean;
}

const MAX_DESCRIPTION_LENGTH = 500;
const MIN_DESCRIPTION_LENGTH = 5;
const COOLDOWN_MS = 30_000;
const COOLDOWN_KEY = "og_bug_report_last_ts";

export default function BugReportModal({
  activeRegion,
  activeRound,
  activeTab,
  pickCount,
  chaosScore,
  displayMode,
  isFuturesOpen,
  isSimRunning,
  bracketHash,
  isMobile,
}: BugReportModalProps) {
  const { user, profile } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (!isOpen) return;

    focusTimerRef.current = window.setTimeout(() => {
      try {
        textareaRef.current?.focus({ preventScroll: true });
      } catch {
        textareaRef.current?.focus();
      }
      focusTimerRef.current = null;
    }, 80);

    return () => {
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    };
  }, [isOpen]);

  const handleClose = useCallback(() => {
    if (status === "sending") return;
    clearTimers();
    setIsOpen(false);
    setDescription("");
    setStatus("idle");
    setErrorMsg("");
  }, [clearTimers, status]);

  useEffect(() => {
    if (!isOpen) return;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      handleClose();
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [handleClose, isOpen]);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    document.body.classList.add("br-modal-open");
    return () => document.body.classList.remove("br-modal-open");
  }, [isOpen]);

  const isOnCooldown = useCallback(() => {
    try {
      const lastSubmittedAt = Number(window.localStorage.getItem(COOLDOWN_KEY) || "0");
      return Date.now() - lastSubmittedAt < COOLDOWN_MS;
    } catch {
      return false;
    }
  }, []);

  const setCooldown = useCallback(() => {
    try {
      window.localStorage.setItem(COOLDOWN_KEY, String(Date.now()));
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const handleOpen = useCallback(() => {
    if (isOnCooldown()) return;
    clearTimers();
    setIsOpen(true);
    setStatus("idle");
    setDescription("");
    setErrorMsg("");
    trackEvent("bug_report_opened");
  }, [clearTimers, isOnCooldown]);

  const handleOverlayClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target === overlayRef.current) handleClose();
    },
    [handleClose]
  );

  const handleSubmit = useCallback(async () => {
    const trimmed = description.trim();
    if (!trimmed) {
      setErrorMsg("Please describe what went wrong.");
      return;
    }
    if (trimmed.length < MIN_DESCRIPTION_LENGTH) {
      setErrorMsg("Please add a bit more detail.");
      return;
    }

    setStatus("sending");
    setErrorMsg("");

    try {
      const { error } = await supabase.from("bug_reports").insert({
        user_id: user?.id ?? null,
        display_name: profile?.display_name || user?.email || null,
        description: trimmed,
        url: window.location.href,
        route: window.location.pathname,
        user_agent: window.navigator.userAgent,
        screen_width: window.screen?.width ?? null,
        screen_height: window.screen?.height ?? null,
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        active_region: activeRegion ?? null,
        active_round: activeRound ?? null,
        active_tab: activeTab ?? null,
        pick_count: pickCount ?? null,
        chaos_score: chaosScore ?? null,
        display_mode: displayMode ?? null,
        is_mobile: isMobile ?? window.innerWidth < 768,
        futures_open: isFuturesOpen ?? null,
        sim_running: isSimRunning ?? null,
        bracket_hash: bracketHash ?? null,
      });

      if (error) throw error;

      trackEvent("bug_report_submitted", {
        has_description: true,
        description_length: trimmed.length,
        is_authenticated: Boolean(user),
        pick_count: pickCount ?? 0,
      });

      setCooldown();
      setStatus("success");
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setIsOpen(false);
        setDescription("");
        setStatus("idle");
        setErrorMsg("");
      }, 2200);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[BugReport] submit failed:", error);
      setStatus("error");
      setErrorMsg("Something went wrong. Try again in a moment.");
      trackEvent("bug_report_error", { error: errorMessage });
    }
  }, [
    activeRegion,
    activeRound,
    activeTab,
    bracketHash,
    chaosScore,
    description,
    displayMode,
    isFuturesOpen,
    isMobile,
    isSimRunning,
    pickCount,
    profile?.display_name,
    setCooldown,
    user,
  ]);

  const handleDescriptionKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit]
  );

  const modal = isOpen ? (
        <div
          className="br-overlay"
          ref={overlayRef}
          onClick={handleOverlayClick}
          role="dialog"
          aria-modal="true"
          aria-label="Report a bug"
        >
          <div className="br-modal" onClick={(event) => event.stopPropagation()}>
            <div className="br-header">
              <div className="br-heading-group">
                <h2 className="br-title">Report a Bug</h2>
                <p className="br-subtitle">Tell us what broke. We will attach the current bracket context automatically.</p>
              </div>
              <button className="br-close" onClick={handleClose} aria-label="Close" type="button">
                <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path
                    d="M4 4L12 12M12 4L4 12"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            {status === "success" ? (
              <div className="br-success">
                <span className="br-success-icon" aria-hidden="true">
                  <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M3.5 8.25L6.5 11.25L12.5 4.75"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <p className="br-success-text">Bug report sent.</p>
              </div>
            ) : (
              <>
                <label className="br-label" htmlFor="br-description">
                  What went wrong?
                </label>
                <textarea
                  id="br-description"
                  ref={textareaRef}
                  className="br-textarea"
                  placeholder="Describe what happened or what looks off..."
                  value={description}
                  onChange={(event) => {
                    if (event.target.value.length <= MAX_DESCRIPTION_LENGTH) {
                      setDescription(event.target.value);
                      if (errorMsg) setErrorMsg("");
                    }
                  }}
                  onKeyDown={handleDescriptionKeyDown}
                  rows={4}
                  maxLength={MAX_DESCRIPTION_LENGTH}
                  disabled={status === "sending"}
                />

                <div className="br-meta-row">
                  {errorMsg ? (
                    <span className="br-error">{errorMsg}</span>
                  ) : (
                    <span className="br-char-count">
                      {description.length}/{MAX_DESCRIPTION_LENGTH}
                    </span>
                  )}
                </div>

                <div className="br-context-note">
                  <span className="br-context-chip">Context included</span>
                  <p>Browser, viewport, current tab, region, round, and bracket state will be attached automatically.</p>
                </div>

                <div className="br-actions">
                  <button
                    className="br-cancel"
                    onClick={handleClose}
                    type="button"
                    disabled={status === "sending"}
                  >
                    Cancel
                  </button>
                  <button
                    className="br-submit"
                    onClick={() => void handleSubmit()}
                    type="button"
                    disabled={status === "sending" || description.trim().length < MIN_DESCRIPTION_LENGTH}
                  >
                    {status === "sending" ? "Sending..." : "Submit Report"}
                  </button>
                </div>

                {!isMobile ? (
                  <p className="br-kbd-hint">
                    <kbd>Cmd</kbd>+<kbd>Enter</kbd> to submit
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
  ) : null;

  return (
    <>
      <button
        className="eg-btn toolbar-btn--bug br-trigger"
        onClick={handleOpen}
        aria-label="Report a bug"
        title="Report a bug"
        type="button"
      >
        <svg
          className="br-trigger-icon"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M8 1.5C6.34 1.5 5 2.84 5 4.5V5H3.5L2.5 6.5H4.5V7.5H2V9H4.5V10.5L2.5 12H5V12.5C5 14.16 6.34 15.5 8 15.5C9.66 15.5 11 14.16 11 12.5V12H13.5L11.5 10.5V9H14V7.5H11.5V6.5H13.5L12.5 5H11V4.5C11 2.84 9.66 1.5 8 1.5ZM7 5V4.5C7 3.95 7.45 3.5 8 3.5C8.55 3.5 9 3.95 9 4.5V5H7ZM7 7H9V13H7V7Z"
            fill="currentColor"
          />
        </svg>
        <span className="br-trigger-label">Report a Bug</span>
      </button>
      {modal && typeof document !== "undefined" ? createPortal(modal, document.body) : null}
    </>
  );
}
