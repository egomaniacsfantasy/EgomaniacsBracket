import type { LockedPicks } from "../lib/bracket";

/**
 * Actual NCAA tournament results that should behave like immutable conference locks:
 * they condition the simulator and cannot be changed in the UI.
 */
export const NCAA_KNOWN_RESULTS: LockedPicks = {
  "South-FF-16": "South-16a", // Prairie View (16a) def Lehigh (16b)
  "Midwest-FF-11": "Midwest-11a", // Miami OH (11a) def SMU (11b)
  "Midwest-FF-16": "Midwest-16b", // Howard (16b) def UMBC (16a)
  "West-FF-11": "West-11b", // Texas (11b) def NC State (11a)
  "East-R64-1": "East-9", // TCU (9) def Ohio St (8)
  "South-R64-3": "South-4", // Nebraska (4) def Troy (13)
};

export const NCAA_KNOWN_RESULT_IDS = new Set(Object.keys(NCAA_KNOWN_RESULTS));
