import type { OddsDisplayMode } from "../types";

/** Conference round identifier (string-based, not fixed enum like NCAA Round) */
export type ConfRoundId = string;

/** Conference game template — parallel to GameTemplate but with string rounds */
export interface ConfGameTemplate {
  id: string; // e.g. "sec-QF-0"
  confId: string;
  round: ConfRoundId;
  slot: number;
  /** Source games whose winners feed into this game. null for initial-round games. */
  sourceGameIds: [string | null, string | null] | null;
  /** Initial team IDs (by numeric ID). For first-round games or byes. */
  initialTeamIds: [number | null, number | null] | null;
}

/** Resolved conference game — parallel to ResolvedGame */
export interface ConfResolvedGame extends ConfGameTemplate {
  teamAId: number | null;
  teamBId: number | null;
  winnerId: number | null;
  lockedByUser: boolean;
  customProbA: number | null;
}

/** Conference futures row with per-round advancement probabilities */
export interface ConfFuturesRow {
  teamId: number;
  teamName: string;
  seed: number;
  /** Probability of advancing past each round (key = round label) */
  roundProbs: Record<string, number>;
  /** Probability of winning the tournament */
  champProb: number;
}

/** Conference simulation output */
export interface ConfSimulationOutput {
  futures: ConfFuturesRow[];
  gameWinProbs: Record<string, Array<{ teamId: number; prob: number }>>;
}

/** Conference bracket definition */
export interface ConfRoundDef {
  id: ConfRoundId;
  label: string; // Display name like "Quarterfinals"
  gameCount: number;
}

export interface ConferenceDef {
  id: string;
  name: string;
  shortName: string;
  teamCount: number;
  rounds: ConfRoundDef[];
}

export type { OddsDisplayMode };
