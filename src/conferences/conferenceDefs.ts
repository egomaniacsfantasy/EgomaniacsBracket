import type { ConferenceDef } from "./types";

/**
 * Conference tournament bracket definitions.
 *
 * Each conference defines:
 * - id: matches the key in CONF_TEAMS / CONF_MATCHUP_PROBS
 * - rounds: ordered from first round to final, with game counts
 * - probRoundMap: maps our round IDs to the probability column labels in the data
 *   (some conferences have more probability columns than actual bracket rounds)
 */

export interface ConfDefWithProbMap extends ConferenceDef {
  /** Maps bracket round ID → probability column label in CONF_MATCHUP_PROBS data */
  probRoundMap: Record<string, string>;
}

export const CONFERENCE_DEFS: ConfDefWithProbMap[] = [
  {
    id: "sec",
    name: "SEC Tournament",
    shortName: "SEC",
    teamCount: 16,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 4 },
      { id: "R2", label: "Second Round", gameCount: 4 },
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", R2: "R2", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "bigTen",
    name: "Big Ten Tournament",
    shortName: "Big Ten",
    teamCount: 18,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 2 },
      { id: "R2", label: "Second Round", gameCount: 4 },
      { id: "R3", label: "Third Round", gameCount: 4 },
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", R2: "R2", R3: "R3", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "big12",
    name: "Big 12 Tournament",
    shortName: "Big 12",
    teamCount: 16,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 4 },
      { id: "R2", label: "Second Round", gameCount: 4 },
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", R2: "R2", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "acc",
    name: "ACC Tournament",
    shortName: "ACC",
    teamCount: 15,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 3 },
      { id: "R2", label: "Second Round", gameCount: 4 },
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", R2: "R2", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "bigEast",
    name: "Big East Tournament",
    shortName: "Big East",
    teamCount: 11,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 3 },
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "mwc",
    name: "Mountain West Tournament",
    shortName: "MWC",
    teamCount: 12,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 4 },
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "a10",
    name: "Atlantic 10 Tournament",
    shortName: "A-10",
    teamCount: 14,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 2 },
      { id: "R2", label: "Second Round", gameCount: 4 },
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", R2: "R2", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "wcc",
    name: "WCC Tournament",
    shortName: "WCC",
    teamCount: 12,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 4 },
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    // Data has R1,R2,R3,QF,SF,Final but bracket only uses 4 rounds
    probRoundMap: { R1: "R1", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "mvc",
    name: "Missouri Valley Tournament",
    shortName: "MVC",
    teamCount: 11,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 3 },
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "mac",
    name: "MAC Tournament",
    shortName: "MAC",
    teamCount: 8,
    rounds: [
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { QF: "QF", SF: "SF", F: "Final" },
  },
];

export const CONFERENCE_DEFS_BY_ID = Object.fromEntries(
  CONFERENCE_DEFS.map((def) => [def.id, def])
) as Record<string, ConfDefWithProbMap>;
