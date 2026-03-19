import type { LockedPicks } from "../lib/bracket";
import type { TournamentResultLike } from "../lib/bracketScoring";
import { templatesById } from "./bracket";

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

const SCORING_ROUND_BY_BRACKET_ROUND: Record<string, number> = {
  R64: 64,
  R32: 32,
  S16: 16,
  E8: 8,
  F4: 4,
  CHAMP: 2,
};

export const NCAA_KNOWN_SCORING_RESULTS: TournamentResultLike[] = Object.entries(NCAA_KNOWN_RESULTS).flatMap(
  ([matchup_id, winner_team_id]) => {
    const template = templatesById.get(matchup_id);
    if (!template) return [];
    const round = SCORING_ROUND_BY_BRACKET_ROUND[template.round];
    if (!round) return [];
    return [{ matchup_id, winner_team_id, round }];
  }
);
