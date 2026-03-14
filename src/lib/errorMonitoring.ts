import { trackEvent } from "./analytics";

let initialized = false;

type ErrorPayload = Record<string, unknown>;

/**
 * Lightweight error monitoring using PostHog.
 * Captures unhandled errors and promise rejections
 * and sends them as PostHog events for visibility.
 *
 * Call initErrorMonitoring() once at app startup.
 */
export function initErrorMonitoring(): void {
  if (initialized) return;
  initialized = true;

  window.addEventListener("error", (event) => {
    reportError({
      type: "unhandled_error",
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      col: event.colno,
      stack: event.error instanceof Error ? event.error.stack?.slice(0, 500) : undefined,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportError({
      type: "unhandled_rejection",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack?.slice(0, 500) : undefined,
    });
  });
}

/**
 * Manually report an error from a catch block.
 * Use this in critical flows like auth, bracket save, etc.
 */
export function captureError(context: string, error: unknown): void {
  reportError({
    type: "caught_error",
    context,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined,
  });
}

function reportError(errorData: ErrorPayload): void {
  try {
    trackEvent("frontend_error", errorData);

    if (import.meta.env.DEV) {
      console.error("[Error Monitor]", errorData);
    }
  } catch {
    // Error monitoring should never throw.
  }
}
