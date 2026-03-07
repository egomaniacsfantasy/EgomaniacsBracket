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
      { id: "R1", label: "First Round", gameCount: 2 },
      { id: "R2", label: "Second Round", gameCount: 2 },
      { id: "R3", label: "Third Round", gameCount: 2 },
      { id: "QF", label: "Quarterfinals", gameCount: 2 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", R2: "R2", R3: "R3", QF: "QF", SF: "SF", F: "Final" },
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
  {
    id: "aac",
    name: "American Athletic Tournament",
    shortName: "AAC",
    teamCount: 10,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 2 },
      { id: "R2", label: "Second Round", gameCount: 2 },
      { id: "QF", label: "Quarterfinals", gameCount: 2 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", R2: "R2", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "bigsouth",
    name: "Big South Tournament",
    shortName: "Big South",
    teamCount: 9,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 1 },
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "caa",
    name: "CAA Tournament",
    shortName: "CAA",
    teamCount: 13,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 1 },
      { id: "R2", label: "Second Round", gameCount: 4 },
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", R2: "R2", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "cusa",
    name: "Conference USA Tournament",
    shortName: "C-USA",
    teamCount: 10,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 2 },
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "patriot",
    name: "Patriot League Tournament",
    shortName: "Patriot",
    teamCount: 4,
    rounds: [
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { SF: "SF", F: "Final" },
  },
  {
    id: "southern",
    name: "Southern Conference Tournament",
    shortName: "SoCon",
    teamCount: 10,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 2 },
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "southland",
    name: "Southland Tournament",
    shortName: "Southland",
    teamCount: 8,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 2 },
      { id: "QF", label: "Quarterfinals", gameCount: 2 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", QF: "QF", SF: "SF", F: "Final" },
  },
];

export const CONFERENCE_DEFS_BY_ID = Object.fromEntries(
  CONFERENCE_DEFS.map((def) => [def.id, def])
) as Record<string, ConfDefWithProbMap>;

/**
 * Actual game results for completed conference tournament games.
 * Maps confId → { gameId → winning teamId }.
 * These are merged into the simulation as permanent locked picks.
 */
export const CONF_KNOWN_RESULTS: Record<string, Record<string, number>> = {
  wcc: {
    "wcc-R1-0": 1339, // Portland (9) def Pepperdine (12)
    "wcc-R1-1": 1360, // San Diego (11) def LMU (10)
    "wcc-R2-0": 1339, // Portland (9) def Washington St (8)
    "wcc-R2-1": 1370, // Seattle (7) def San Diego (11)
  },
  mvc: {
    "mvc-R1-0": 1179, // Drake (9) def S Illinois (8)
    "mvc-R1-1": 1434, // Valparaiso (7) def Indiana St (10)
    "mvc-R1-2": 1320, // Northern Iowa (6) def Evansville (11)
    "mvc-QF-0": 1179, // Drake (9) def Belmont (1)
    "mvc-QF-1": 1227, // IL Chicago (5) def Murray St (4)
    "mvc-QF-2": 1133, // Bradley (2) def Valparaiso (7)
    "mvc-QF-3": 1320, // Northern Iowa (6) def Illinois St (3)
  },
  bigsouth: {
    "bigsouth-R1-0": 1367, // SC Upstate (8) def Gardner Webb (9)
    "bigsouth-QF-0": 1219, // High Point (1) def SC Upstate (8)
    "bigsouth-QF-1": 1421, // UNC Asheville (4) def Longwood (5)
    "bigsouth-QF-2": 1457, // Winthrop (2) def Charleston So (7)
    "bigsouth-QF-3": 1342, // Presbyterian (6) def Radford (3)
  },
  southern: {
    "southern-R1-0": 1154, // Citadel (9) def Chattanooga (8)
    "southern-R1-1": 1422, // UNC Greensboro (7) def VMI (10)
  },
  caa: {
    "caa-R1-0": 1318, // Northeastern (13) def NC A&T (12)
  },
};
