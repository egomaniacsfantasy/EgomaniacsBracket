import posthog from "posthog-js";

const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {});
const POSTHOG_KEY = env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

let initialized = false;

export function initAnalytics() {
  if (initialized || !POSTHOG_KEY) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: true,
    autocapture: true,
  });
  initialized = true;
}

export function trackEvent(event: string, properties?: Record<string, unknown>) {
  if (!initialized) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // no-op
  }
}
