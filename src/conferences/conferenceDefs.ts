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
  {
    id: "aec",
    name: "America East Tournament",
    shortName: "AEC",
    teamCount: 8,
    rounds: [
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "a_sun",
    name: "Atlantic Sun Tournament",
    shortName: "ASUN",
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
    id: "big_sky",
    name: "Big Sky Tournament",
    shortName: "Big Sky",
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
    id: "big_west",
    name: "Big West Tournament",
    shortName: "Big West",
    teamCount: 8,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 2 },
      { id: "QF", label: "Quarterfinals", gameCount: 2 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "horizon",
    name: "Horizon League Tournament",
    shortName: "Horizon",
    teamCount: 11,
    rounds: [
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { SF: "SF", F: "Final" },
  },
  {
    id: "ivy",
    name: "Ivy League Tournament",
    shortName: "Ivy",
    teamCount: 4,
    rounds: [
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { SF: "SF", F: "Final" },
  },
  {
    id: "maac",
    name: "MAAC Tournament",
    shortName: "MAAC",
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
    id: "meac",
    name: "MEAC Tournament",
    shortName: "MEAC",
    teamCount: 7,
    rounds: [
      { id: "QF", label: "Quarterfinals", gameCount: 3 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "nec",
    name: "Northeast Conference Tournament",
    shortName: "NEC",
    teamCount: 8,
    rounds: [
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "ovc",
    name: "Ohio Valley Tournament",
    shortName: "OVC",
    teamCount: 8,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 2 },
      { id: "QF", label: "Quarterfinals", gameCount: 2 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "swac",
    name: "SWAC Tournament",
    shortName: "SWAC",
    teamCount: 12,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 2 },
      { id: "R2", label: "Second Round", gameCount: 2 },
      { id: "QF", label: "Quarterfinals", gameCount: 4 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", R2: "R2", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "summit",
    name: "Summit League Tournament",
    shortName: "Summit",
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
    id: "sun_belt",
    name: "Sun Belt Tournament",
    shortName: "Sun Belt",
    teamCount: 14,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 2 },
      { id: "R2", label: "Second Round", gameCount: 2 },
      { id: "R3", label: "Third Round", gameCount: 2 },
      { id: "R4", label: "Fourth Round", gameCount: 2 },
      { id: "QF", label: "Quarterfinals", gameCount: 2 },
      { id: "SF", label: "Semifinals", gameCount: 2 },
      { id: "F", label: "Final", gameCount: 1 },
    ],
    probRoundMap: { R1: "R1", R2: "R2", R3: "R3", R4: "R4", QF: "QF", SF: "SF", F: "Final" },
  },
  {
    id: "wac",
    name: "WAC Tournament",
    shortName: "WAC",
    teamCount: 7,
    rounds: [
      { id: "R1", label: "First Round", gameCount: 1 },
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
    "wcc-R3-0": 1362, // San Francisco (5) def Portland (9)
    "wcc-R3-1": 1334, // Pacific (6) def Seattle (7)
    "wcc-QF-0": 1333, // Oregon St (4) def San Francisco (5)
    "wcc-QF-1": 1365, // Santa Clara (3) def Pacific (6)
    "wcc-SF-0": 1211, // Gonzaga (1) def Oregon St (4)
    "wcc-SF-1": 1365, // Santa Clara (3) def St Mary's CA (2)
    "wcc-F-0":  1211, // Gonzaga (1) def Santa Clara (3) — CHAMPION
  },
  mvc: {
    "mvc-R1-0": 1179, // Drake (9) def S Illinois (8)
    "mvc-R1-1": 1434, // Valparaiso (7) def Indiana St (10)
    "mvc-R1-2": 1320, // Northern Iowa (6) def Evansville (11)
    "mvc-QF-0": 1179, // Drake (9) def Belmont (1)
    "mvc-QF-1": 1227, // IL Chicago (5) def Murray St (4)
    "mvc-QF-2": 1133, // Bradley (2) def Valparaiso (7)
    "mvc-QF-3": 1320, // Northern Iowa (6) def Illinois St (3)
    "mvc-SF-0": 1227, // IL Chicago (5) def Drake (9)
    "mvc-SF-1": 1320, // Northern Iowa (6) def Bradley (2)
    "mvc-F-0":  1320, // Northern Iowa (6) def IL Chicago (5) — CHAMPION
  },
  bigsouth: {
    "bigsouth-R1-0": 1367, // SC Upstate (8) def Gardner Webb (9)
    "bigsouth-QF-0": 1219, // High Point (1) def SC Upstate (8)
    "bigsouth-QF-1": 1421, // UNC Asheville (4) def Longwood (5)
    "bigsouth-QF-2": 1457, // Winthrop (2) def Charleston So (7)
    "bigsouth-QF-3": 1342, // Presbyterian (6) def Radford (3)
    "bigsouth-SF-0": 1219, // High Point (1) def UNC Asheville (4)
    "bigsouth-SF-1": 1457, // Winthrop (2) def Presbyterian (6)
    "bigsouth-F-0":  1219, // High Point (1) def Winthrop (2)
  },
  southern: {
    "southern-R1-0": 1154, // Citadel (9) def Chattanooga (8)
    "southern-R1-1": 1422, // UNC Greensboro (7) def VMI (10)
    "southern-QF-0": 1190, // ETSU (1) def Citadel (9)
    "southern-QF-1": 1441, // W Carolina (5) def Samford (4)
    "southern-QF-2": 1422, // UNC Greensboro (7) def Mercer (2)
    "southern-QF-3": 1202, // Furman (6) def Wofford (3)
    "southern-SF-0": 1190, // ETSU (1) def W Carolina (5)
    "southern-SF-1": 1202, // Furman (6) def UNC Greensboro (7)
    "southern-F-0":  1202, // Furman (6) def ETSU (1)
  },
  caa: {
    "caa-R1-0": 1318, // Northeastern (13) def NC A&T (12)
    "caa-R2-0": 1144, // Campbell (9) def Stony Brook (8)
    "caa-R2-1": 1180, // Drexel (5) def Northeastern (13)
    "caa-R2-2": 1406, // Towson (7) def Hampton (10)
    "caa-R2-3": 1456, // William & Mary (6) def Elon (11)
    "caa-QF-0": 1144, // Campbell (9) def UNC Wilmington (1)
    "caa-QF-1": 1284, // Monmouth (4) def Drexel (5)
    "caa-QF-2": 1406, // Towson (7) def Col Charleston (2)
    "caa-QF-3": 1220, // Hofstra (3) def William & Mary (6)
    "caa-SF-0": 1284, // Monmouth (4) def Campbell (9)
    "caa-SF-1": 1220, // Hofstra (3) def Towson (7)
    "caa-F-0":  1220, // Hofstra (3) def Monmouth (4) — CHAMPION
  },
  patriot: {
    "patriot-SF-0": 1131, // Boston Univ (4) def Navy (1)
    "patriot-SF-1": 1250, // Lehigh (2) def Colgate (3)
  },
  aec: {
    "aec-QF-0": 1420, // UMBC (1) def New Hampshire (8)
    "aec-QF-1": 1262, // MA Lowell (4) def Albany (5)
    "aec-QF-2": 1312, // NJIT (3) def Maine (6)
    "aec-QF-3": 1436, // Vermont (2) def Bryant (7)
    "aec-SF-0": 1420, // UMBC (1) def MA Lowell (4)
    "aec-SF-1": 1436, // Vermont (2) def NJIT (3)
  },
  a_sun: {
    "a_sun-R1-0": 1468, // Bellarmine (8) def Jacksonville (9)
    "a_sun-R1-1": 1195, // FGCU (5) def North Alabama (12)
    "a_sun-R1-2": 1184, // E Kentucky (7) def Stetson (10)
    "a_sun-R1-3": 1480, // West Georgia (6) def North Florida (11)
    "a_sun-QF-0": 1146, // Cent Arkansas (1) def Bellarmine (8)
    "a_sun-QF-1": 1195, // FGCU (5) def Lipscomb (4)
    "a_sun-QF-2": 1122, // Austin Peay (2) def E Kentucky (7)
    "a_sun-QF-3": 1474, // Queens (3) def West Georgia (6)
    "a_sun-SF-0": 1146, // Cent Arkansas (1) def FGCU (5)
    "a_sun-SF-1": 1474, // Queens (3) def Austin Peay (2)
    "a_sun-F-0":  1474, // Queens (3) def Cent Arkansas (1) — CHAMPION
  },
  big_sky: {
    "big_sky-R1-0": 1226, // Idaho St (9) def Northern Arizona (10)
    "big_sky-R1-1": 1225, // Idaho (7) def CS Sacramento (8)
    "big_sky-QF-0": 1340, // Portland St (1) def Idaho St (9)
    "big_sky-QF-1": 1225, // Idaho (7) def Montana St (2)
    "big_sky-QF-2": 1285, // Montana (4) def N Colorado (5)
    "big_sky-QF-3": 1186, // E Washington (3) def Weber St (6)
    "big_sky-SF-0": 1285, // Montana (4) def Portland St (1)
    "big_sky-SF-1": 1225, // Idaho (7) def E Washington (3)
  },
  horizon: {
    "horizon-SF-0": 1460, // Wright St (1) def N Kentucky (7)
    "horizon-SF-1": 1178, // Detroit (3) def Robert Morris (2)
    "horizon-F-0":  1460, // Wright St (1) def Detroit (3) — CHAMPION
  },
  swac: {
    "swac-R1-0": 1108, // Alcorn St (11) def Alabama St (10)
    "swac-R1-1": 1212, // Grambling (9) def MS Valley St (12)
    "swac-R2-0": 1341, // Prairie View (8) def Alcorn St (11)
    "swac-R2-1": 1238, // Jackson St (7) def Grambling (9)
  },
  maac: {
    "maac-R1-0": 1357, // Sacred Heart (9) def Iona (8)
    "maac-R1-1": 1193, // Fairfield (7) def Manhattan (10)
    "maac-QF-0": 1467, // Merrimack (1) def Sacred Heart (9)
    "maac-QF-1": 1265, // Marist (5) def Quinnipiac (4)
    "maac-QF-2": 1193, // Fairfield (7) def St Peter's (2)
    "maac-QF-3": 1373, // Siena (3) def Mt St Mary's (6)
    "maac-SF-0": 1467, // Merrimack (1) def Marist (5)
    "maac-SF-1": 1373, // Siena (3) def Fairfield (7)
    "maac-F-0":  1373, // Siena (3) def Merrimack (1) — CHAMPION
  },
  nec: {
    "nec-QF-0": 1254, // LIU Brooklyn (1) def Chicago St (8)
    "nec-QF-1": 1447, // Wagner (7) def Central Conn (2)
    "nec-QF-2": 1479, // Mercyhurst (3) def F Dickinson (6)
    "nec-QF-3": 1476, // Stonehill (5) def Le Moyne (4)
    "nec-SF-0": 1254, // LIU Brooklyn (1) def Wagner (7)
    "nec-SF-1": 1479, // Mercyhurst (3) def Stonehill (5)
    "nec-F-0":  1254, // LIU Brooklyn (1) def Mercyhurst (3) — CHAMPION
  },
  ovc: {
    "ovc-R1-0": 1183, // E Illinois (8) def SIUE (5)
    "ovc-R1-1": 1473, // Lindenwood (6) def Ark Little Rock (7)
    "ovc-QF-0": 1404, // TN Martin (4) def E Illinois (8)
    "ovc-QF-1": 1369, // SE Missouri St (3) def Lindenwood (6)
    "ovc-SF-0": 1398, // Tennessee St (1) def TN Martin (4)
    "ovc-SF-1": 1287, // Morehead St (2) def SE Missouri St (3)
    "ovc-F-0":  1398, // Tennessee St (1) def Morehead St (2) — CHAMPION
  },
  summit: {
    "summit-R1-0": 1331, // Oral Roberts (8) def Missouri KC (9)
    "summit-QF-0": 1295, // N Dakota St (1) def Oral Roberts (8)
    "summit-QF-1": 1303, // Omaha (5) def South Dakota (4)
    "summit-QF-2": 1472, // St Thomas MN (2) def S Dakota St (7)
    "summit-QF-3": 1315, // N Dakota (3) def Denver (6)
    "summit-SF-0": 1295, // N Dakota St (1) def Omaha (5)
    "summit-SF-1": 1315, // N Dakota (3) def St Thomas MN (2)
    "summit-F-0":  1295, // N Dakota St (1) def N Dakota (3) — CHAMPION
  },
  sun_belt: {
    "sun_belt-R1-0": 1418, // Louisiana (12) def Georgia St (13)
    "sun_belt-R1-1": 1330, // Old Dominion (11) def ULM (14)
    "sun_belt-R2-0": 1241, // James Madison (9) def Louisiana (12)
    "sun_belt-R2-1": 1204, // Ga Southern (10) def Old Dominion (11)
    "sun_belt-R3-0": 1379, // Southern Miss (8) def James Madison (9)
    "sun_belt-R3-1": 1204, // Ga Southern (10) def Arkansas St (7)
    "sun_belt-R4-0": 1379, // Southern Miss (8) def Texas St (5)
    "sun_belt-R4-1": 1204, // Ga Southern (10) def South Alabama (6)
    "sun_belt-QF-0": 1379, // Southern Miss (8) def Appalachian St (4)
    "sun_belt-QF-1": 1204, // Ga Southern (10) def Coastal Car (3)
    "sun_belt-SF-0": 1407, // Troy (1) def Southern Miss (8)
    "sun_belt-SF-1": 1204, // Ga Southern (10) def Marshall (2)
    "sun_belt-F-0":  1407, // Troy (1) def Ga Southern (10)
  },
  southland: {
    "southland-R1-0": 1309, // New Orleans (5) def Houston Chr (8)
    "southland-R1-1": 1311, // Nicholls St (6) def Northwestern LA (7)
    "southland-QF-0": 1394, // TAM C. Christi (4) def New Orleans (5)
    "southland-QF-1": 1410, // UTRGV (3) def Nicholls St (6)
    "southland-SF-0": 1372, // SF Austin (1) def TAM C. Christi (4)
    "southland-SF-1": 1270, // McNeese St (2) def UTRGV (3)
  },
  cusa: {
    "cusa-R1-0": 1283, // Missouri St (9) def Florida Intl (8)
    "cusa-R1-1": 1308, // New Mexico St (10) def Jacksonville St (7)
  },
  acc: {
    "acc-R1-0": 1338, // Pittsburgh (15) def Stanford (10)
    "acc-R1-1": 1448, // Wake Forest (13) def Virginia Tech (12)
    "acc-R1-2": 1374, // SMU (11) def Syracuse (14)
  },
  big12: {
    "big12-R1-0": 1153, // Cincinnati (9) def Utah (16)
    "big12-R1-1": 1113, // Arizona St (12) def Baylor (13)
    "big12-R1-2": 1140, // BYU (10) def Kansas St (15)
    "big12-R1-3": 1329, // Oklahoma St (14) def Colorado (11)
  },
  bigTen: {
    "bigTen-R1-0": 1268, // Maryland (17) def Oregon (16)
    "bigTen-R1-1": 1321, // Northwestern (15) def Penn St (18)
  },
};
