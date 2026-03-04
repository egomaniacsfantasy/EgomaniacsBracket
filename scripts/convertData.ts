/**
 * One-time script to convert xlsx data files into TypeScript source files.
 * Run with: npx tsx scripts/convertData.ts
 *
 * Input files (from /Users/andrevlahakis/Downloads/Data God/):
 *   - conf_team_stats_2026.xlsx
 *   - conf_matchup_probs_2026.xlsx
 *   - team_snapshot_2026.xlsx
 *   - model_rankings_2026.xlsx
 *
 * Output files:
 *   - src/conferences/data/confTeams.ts
 *   - src/conferences/data/confMatchupProbs.ts
 *   - src/rankings/data/d1Rankings.ts
 */

import XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = "/Users/andrevlahakis/Downloads/Data God";
const ROOT = path.resolve(__dirname, "..");

// ─── Conference ID mapping (sheet name → key) ───
const SHEET_TO_CONF_ID: Record<string, string> = {
  "Atlantic 10": "a10",
  ACC: "acc",
  "Big 12": "big12",
  "Big East": "bigEast",
  "Big Ten": "bigTen",
  "Mid-American": "mac",
  "Missouri Valley": "mvc",
  "Mountain West": "mwc",
  SEC: "sec",
  WCC: "wcc",
};

const CONF_DISPLAY_NAMES: Record<string, string> = {
  a10: "Atlantic 10",
  acc: "ACC",
  big12: "Big 12",
  bigEast: "Big East",
  bigTen: "Big Ten",
  mac: "Mid-American",
  mvc: "Missouri Valley",
  mwc: "Mountain West",
  sec: "SEC",
  wcc: "WCC",
};

const CONF_SHORT_NAMES: Record<string, string> = {
  a10: "A-10",
  acc: "ACC",
  big12: "Big 12",
  bigEast: "Big East",
  bigTen: "Big Ten",
  mac: "MAC",
  mvc: "MVC",
  mwc: "MWC",
  sec: "SEC",
  wcc: "WCC",
};

// ─── 1. Conference Team Stats ───
function convertConfTeams(): void {
  const wb = XLSX.readFile(path.join(DATA_DIR, "conf_team_stats_2026.xlsx"));
  const result: Record<string, unknown[]> = {};

  for (const sheetName of wb.SheetNames) {
    const confId = SHEET_TO_CONF_ID[sheetName];
    if (!confId) {
      console.warn(`Skipping unknown sheet: ${sheetName}`);
      continue;
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]);
    const teams = rows.map((row) => ({
      id: Number(row["TeamID"]),
      name: String(row["TeamName"]),
      seed: Number(row["Seed"]),
      elo: Number(row["elo_last"]),
      eloTrend: round4(Number(row["elo_trend"])),
      eloSos: round1(Number(row["elo_sos"])),
      offRtg: round2(Number(row["avg_off_rtg"])),
      defRtg: round2(Number(row["avg_def_rtg"])),
      netRtg: round2(Number(row["avg_net_rtg"])),
      orebPct: round4(Number(row["avg_oreb_pct"])),
      tovPct: round4(Number(row["avg_tov_pct"])),
      last5Margin: round1(Number(row["last5_Margin"])),
      rankPOM: Number(row["rank_POM"]),
      rankMAS: Number(row["rank_MAS"]),
      rankMOR: Number(row["rank_MOR"]),
      rankWLK: Number(row["rank_WLK"]),
      rankBIH: Number(row["rank_BIH"]),
      rankNET: Number(row["rank_NET"]),
    }));

    teams.sort((a, b) => a.seed - b.seed);
    result[confId] = teams;
  }

  const output = `// Auto-generated from conf_team_stats_2026.xlsx — do not edit manually
export interface ConfTeam {
  id: number;
  name: string;
  seed: number;
  elo: number;
  eloTrend: number;
  eloSos: number;
  offRtg: number;
  defRtg: number;
  netRtg: number;
  orebPct: number;
  tovPct: number;
  last5Margin: number;
  rankPOM: number;
  rankMAS: number;
  rankMOR: number;
  rankWLK: number;
  rankBIH: number;
  rankNET: number;
}

export const CONF_DISPLAY_NAMES: Record<string, string> = ${JSON.stringify(CONF_DISPLAY_NAMES, null, 2)};

export const CONF_SHORT_NAMES: Record<string, string> = ${JSON.stringify(CONF_SHORT_NAMES, null, 2)};

export const CONF_IDS = ${JSON.stringify(Object.values(SHEET_TO_CONF_ID).sort())} as const;

export type ConferenceId = (typeof CONF_IDS)[number];

export const CONF_TEAMS: Record<string, ConfTeam[]> = ${JSON.stringify(result, null, 2)};
`;

  const outPath = path.join(ROOT, "src/conferences/data/confTeams.ts");
  fs.writeFileSync(outPath, output, "utf-8");
  console.log(`✓ Wrote ${outPath} (${Object.keys(result).length} conferences)`);
}

// ─── 2. Conference Matchup Probabilities ───
function convertConfMatchupProbs(): void {
  const wb = XLSX.readFile(path.join(DATA_DIR, "conf_matchup_probs_2026.xlsx"));
  const result: Record<string, Record<string, number>> = {};
  const roundStructures: Record<string, string[]> = {};

  for (const sheetName of wb.SheetNames) {
    const confId = SHEET_TO_CONF_ID[sheetName];
    if (!confId) continue;

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]);
    const probs: Record<string, number> = {};

    // Extract round labels from column headers
    const headers = Object.keys(rows[0] || {});
    const roundLabels: string[] = [];
    for (const h of headers) {
      const match = h.match(/^prob_team1_wins_(\w+)_D\d+$/);
      if (match && !roundLabels.includes(match[1])) {
        roundLabels.push(match[1]);
      }
    }
    roundStructures[confId] = roundLabels;

    for (const row of rows) {
      const t1Id = Number(row["team1_id"]);
      const t2Id = Number(row["team2_id"]);

      for (const h of headers) {
        const match = h.match(/^prob_team1_wins_(\w+)_D\d+$/);
        if (match) {
          const roundLabel = match[1];
          const prob = Number(row[h]);
          if (Number.isFinite(prob)) {
            // Store as "team1Id|team2Id|round" → team1 win probability
            probs[`${t1Id}|${t2Id}|${roundLabel}`] = round6(prob);
          }
        }
      }
    }

    result[confId] = probs;
  }

  const output = `// Auto-generated from conf_matchup_probs_2026.xlsx — do not edit manually

/** Round structures per conference (ordered from first to final) */
export const CONF_ROUND_LABELS: Record<string, string[]> = ${JSON.stringify(roundStructures, null, 2)};

/**
 * Conference matchup probabilities.
 * Key format: "team1Id|team2Id|roundLabel" → probability team1 wins.
 * For the reverse matchup, use 1 - prob.
 */
export const CONF_MATCHUP_PROBS: Record<string, Record<string, number>> = ${JSON.stringify(result)};
`;

  const outPath = path.join(ROOT, "src/conferences/data/confMatchupProbs.ts");
  fs.writeFileSync(outPath, output, "utf-8");
  console.log(`✓ Wrote ${outPath} (${Object.keys(result).length} conferences)`);
  for (const [confId, rounds] of Object.entries(roundStructures)) {
    console.log(`  ${confId}: ${rounds.join(" → ")}`);
  }
}

// ─── 3. D1 Rankings Data ───
function convertD1Rankings(): void {
  // Read team_snapshot for detailed stats
  const snapshotWb = XLSX.readFile(path.join(DATA_DIR, "team_snapshot_2026.xlsx"));
  const snapshotRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    snapshotWb.Sheets[snapshotWb.SheetNames[0]]
  );

  // Read model_rankings for composite rank and score
  const rankingsWb = XLSX.readFile(path.join(DATA_DIR, "model_rankings_2026.xlsx"));
  const rankingsRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    rankingsWb.Sheets[rankingsWb.SheetNames[0]]
  );

  // Build rankings lookup by TeamID
  const rankingsById = new Map<number, Record<string, unknown>>();
  for (const row of rankingsRows) {
    rankingsById.set(Number(row["TeamID"]), row);
  }

  const teams = snapshotRows.map((row) => {
    const teamId = Number(row["TeamID"]);
    const ranking = rankingsById.get(teamId);

    return {
      id: teamId,
      name: String(row["TeamName"]),
      conf: String(row["Conf"]),
      mrRank: ranking ? Number(ranking["MR_Rank"]) : 999,
      mrScore: ranking ? round4(Number(ranking["MR_Score"])) : 0,
      expWinsPct: ranking ? round2(Number(ranking["Exp_Wins_pct"])) : 0,
      elo: round1(Number(row["elo_last"])),
      eloTrend: round4(Number(row["elo_trend"])),
      eloSos: round1(Number(row["elo_sos"])),
      rankPOM: Number(row["POM"]) || 999,
      rankMAS: Number(row["MAS"]) || 999,
      rankMOR: Number(row["MOR"]) || 999,
      rankWLK: Number(row["WLK"]) || 999,
      rankBIH: Number(row["BIH"]) || 999,
      rankNET: Number(row["NET"]) || 999,
      offRtg: round2(Number(row["avg_off_rtg"])),
      defRtg: round2(Number(row["avg_def_rtg"])),
      netRtg: round2(Number(row["avg_net_rtg"])),
      orebPct: round4(Number(row["avg_oreb_pct"])),
      tovPct: round4(Number(row["avg_tov_pct"])),
      avgScore: round1(Number(row["avg_Score"])),
      avgOppScore: round1(Number(row["avg_OppScore"])),
      last5Margin: round1(Number(row["last5_Margin"])),
      last10Margin: round1(Number(row["last10_Margin"])),
      nGames: Number(row["N_games"]) || 0,
    };
  });

  // Sort by composite model rank
  teams.sort((a, b) => a.mrRank - b.mrRank);

  const output = `// Auto-generated from team_snapshot_2026.xlsx + model_rankings_2026.xlsx — do not edit manually
export interface D1Team {
  id: number;
  name: string;
  conf: string;
  mrRank: number;
  mrScore: number;
  expWinsPct: number;
  elo: number;
  eloTrend: number;
  eloSos: number;
  rankPOM: number;
  rankMAS: number;
  rankMOR: number;
  rankWLK: number;
  rankBIH: number;
  rankNET: number;
  offRtg: number;
  defRtg: number;
  netRtg: number;
  orebPct: number;
  tovPct: number;
  avgScore: number;
  avgOppScore: number;
  last5Margin: number;
  last10Margin: number;
  nGames: number;
}

export const CONF_NAME_MAP: Record<string, string> = {
  a_sun: "Atlantic Sun",
  a_ten: "Atlantic 10",
  aac: "AAC",
  acc: "ACC",
  aec: "America East",
  big_east: "Big East",
  big_sky: "Big Sky",
  big_south: "Big South",
  big_ten: "Big Ten",
  big_twelve: "Big 12",
  big_west: "Big West",
  caa: "CAA",
  cusa: "C-USA",
  horizon: "Horizon",
  ivy: "Ivy",
  maac: "MAAC",
  mac: "MAC",
  meac: "MEAC",
  mvc: "MVC",
  mwc: "MWC",
  nec: "NEC",
  ovc: "OVC",
  patriot: "Patriot",
  sec: "SEC",
  southern: "Southern",
  southland: "Southland",
  summit: "Summit",
  sun_belt: "Sun Belt",
  swac: "SWAC",
  wac: "WAC",
  wcc: "WCC",
};

export const D1_TEAMS: D1Team[] = ${JSON.stringify(teams, null, 2)};
`;

  const outPath = path.join(ROOT, "src/rankings/data/d1Rankings.ts");
  fs.writeFileSync(outPath, output, "utf-8");
  console.log(`✓ Wrote ${outPath} (${teams.length} teams)`);
}

// ─── Helpers ───
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function round6(n: number): number {
  return Math.round(n * 1000000) / 1000000;
}

// ─── Main ───
console.log("Converting xlsx data files to TypeScript...\n");
convertConfTeams();
convertConfMatchupProbs();
convertD1Rankings();
console.log("\nDone!");
