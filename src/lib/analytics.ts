import posthog from "posthog-js";

const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {});
const POSTHOG_KEY = env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

let initialized = false;

export function initAnalytics() {
  if (initialized) return;
  if (!POSTHOG_KEY) {
    // If a global PostHog snippet is already present, allow tracking through it.
    initialized = Boolean((window as unknown as { posthog?: { capture?: (event: string, props?: Record<string, unknown>) => void } }).posthog?.capture);
    return;
  }
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: true,
    autocapture: true,
  });
  initialized = true;
}

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  try {
    if (initialized) {
      posthog.capture(event, properties);
      return;
    }
    const globalPosthog = (window as unknown as { posthog?: { capture?: (name: string, props?: Record<string, unknown>) => void } }).posthog;
    if (globalPosthog?.capture) {
      globalPosthog.capture(event, properties);
    }
  } catch {
    // no-op
  }
}
