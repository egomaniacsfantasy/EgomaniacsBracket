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
  "East-R64-0": "East-1", // Duke (1) def Siena (16)
  "East-R64-1": "East-9", // TCU (9) def Ohio St (8)
  "East-R64-4": "East-6", // Louisville (6) def South Florida (11)
  "East-R64-5": "East-3", // Michigan St (3) def N Dakota St (14)
  "South-R64-2": "South-5", // Vanderbilt (5) def McNeese St (12)
  "South-R64-3": "South-4", // Nebraska (4) def Troy (13)
  "South-R64-4": "South-11", // VCU (11) def North Carolina (6)
  "South-R64-5": "South-3", // Illinois (3) def Penn (14)
  "South-R64-6": "South-10", // Texas A&M (10) def St Mary's CA (7)
  "South-R64-7": "South-2", // Houston (2) def Idaho (15)
  "Midwest-R64-0": "Midwest-1", // Michigan (1) def Howard (16)
  "Midwest-R64-1": "Midwest-9", // St Louis (9) def Georgia (8)
  "Midwest-R64-2": "Midwest-5", // Texas Tech (5) def Akron (12)
  "Midwest-R64-6": "Midwest-7", // Kentucky (7) def Santa Clara (10)
  "West-R64-0": "West-1", // Arizona (1) def LIU Brooklyn (16)
  "West-R64-2": "West-12", // High Point (12) def Wisconsin (5)
  "West-R64-3": "West-4", // Arkansas (4) def Hawaii (13)
  "West-R64-4": "West-11b", // Texas (11) def BYU (6)
  "West-R64-5": "West-3", // Gonzaga (3) def Kennesaw (14)
};

export const NCAA_KNOWN_RESULT_IDS = new Set(Object.keys(NCAA_KNOWN_RESULTS));

/**
 * Only the collapsed First Four winners should be injected into saved bracket
 * resolution. Later-round actual results must never overwrite a user's pick.
 */
export const NCAA_KNOWN_ENTRANT_RESULTS: LockedPicks = Object.fromEntries(
  Object.entries(NCAA_KNOWN_RESULTS).filter(([matchup_id]) => templatesById.get(matchup_id)?.round === "FF")
) as LockedPicks;

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
