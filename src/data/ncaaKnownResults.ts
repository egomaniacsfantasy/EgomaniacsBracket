import type { LockedPicks } from "../lib/bracket";

/**
 * Actual NCAA tournament results that should behave like immutable conference locks:
 * they condition the simulator and cannot be changed in the UI.
 */
export const NCAA_KNOWN_RESULTS: LockedPicks = {
  "Midwest-FF-16": "Midwest-16b", // Howard (16b) def UMBC (16a)
  "West-FF-11": "West-11b", // Texas (11b) def NC State (11a)
};

export const NCAA_KNOWN_RESULT_IDS = new Set(Object.keys(NCAA_KNOWN_RESULTS));
