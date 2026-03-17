/**
 * Script to convert xlsx data files into TypeScript source files.
 * Run with: npx tsx scripts/convertData.ts
 *
 * Input files (from MM pipeline root):
 *   - conf_team_stats_2026.xlsx
 *   - conf_matchup_probs_2026.xlsx
 *   - team_stats_2026.xlsx
 *   - team_snapshot_2026.xlsx
 *   - model_rankings_2026.xlsx
 *   - matchup_probs_2026.xlsx
 *   - 2026_bracket_preds.xlsx
 *
 * Output files:
 *   - src/conferences/data/confTeams.ts
 *   - src/conferences/data/confMatchupProbs.ts
 *   - src/data/teamStats2026.ts
 *   - src/rankings/data/d1Rankings.ts
 *   - src/rankings/data/rankingsTrend2026.ts
 *   - src/lib/matchupProbData.ts
 *   - src/data/bracketPreds2026.ts
 */

import XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = ROOT;

// ─── Conference ID mapping (sheet name → key) ───
const SHEET_TO_CONF_ID: Record<string, string> = {
  "Atlantic 10": "a10",
  ACC: "acc",
  "American Athletic": "aac",
  "America East": "aec",
  "Atlantic Sun": "a_sun",
  "Big 12": "big12",
  "Big East": "bigEast",
  "Big Sky": "big_sky",
  "Big South": "bigsouth",
  "Big Ten": "bigTen",
  "Big West": "big_west",
  CAA: "caa",
  "Conference USA": "cusa",
  Horizon: "horizon",
  Ivy: "ivy",
  MAAC: "maac",
  MEAC: "meac",
  "Mid-American": "mac",
  "Missouri Valley": "mvc",
  "Mountain West": "mwc",
  Northeast: "nec",
  "Ohio Valley": "ovc",
  Patriot: "patriot",
  SEC: "sec",
  Southern: "southern",
  Southland: "southland",
  "Summit League": "summit",
  "Sun Belt": "sun_belt",
  SWAC: "swac",
  WAC: "wac",
  WCC: "wcc",
};

const CONF_DISPLAY_NAMES: Record<string, string> = {
  a10: "Atlantic 10",
  acc: "ACC",
  aac: "American Athletic",
  aec: "America East",
  a_sun: "Atlantic Sun",
  big12: "Big 12",
  bigEast: "Big East",
  big_sky: "Big Sky",
  bigsouth: "Big South",
  bigTen: "Big Ten",
  big_west: "Big West",
  caa: "CAA",
  cusa: "Conference USA",
  horizon: "Horizon",
  ivy: "Ivy",
  maac: "MAAC",
  meac: "MEAC",
  mac: "Mid-American",
  mvc: "Missouri Valley",
  mwc: "Mountain West",
  nec: "Northeast",
  ovc: "Ohio Valley",
  patriot: "Patriot",
  sec: "SEC",
  southern: "Southern",
  southland: "Southland",
  summit: "Summit League",
  sun_belt: "Sun Belt",
  swac: "SWAC",
  wac: "WAC",
  wcc: "WCC",
};

const CONF_SHORT_NAMES: Record<string, string> = {
  a10: "A-10",
  acc: "ACC",
  aac: "AAC",
  aec: "AEC",
  a_sun: "ASUN",
  big12: "Big 12",
  bigEast: "Big East",
  big_sky: "Big Sky",
  bigsouth: "Big South",
  bigTen: "Big Ten",
  big_west: "Big West",
  caa: "CAA",
  cusa: "C-USA",
  horizon: "Horizon",
  ivy: "Ivy",
  maac: "MAAC",
  meac: "MEAC",
  mac: "MAC",
  mvc: "MVC",
  mwc: "MWC",
  nec: "NEC",
  ovc: "OVC",
  patriot: "Patriot",
  sec: "SEC",
  southern: "SoCon",
  southland: "Southland",
  summit: "Summit",
  sun_belt: "Sun Belt",
  swac: "SWAC",
  wac: "WAC",
  wcc: "WCC",
};

const TEAM_STAT_KEYS = [
  "rank_POM",
  "rank_MAS",
  "rank_WLK",
  "rank_MOR",
  "elo_sos",
  "elo_last",
  "avg_net_rtg",
  "avg_off_rtg",
  "elo_trend",
  "avg_def_rtg",
  "last5_Margin",
  "rank_BIH",
  "rank_NET",
] as const;

type TeamStatKey = (typeof TEAM_STAT_KEYS)[number];

const TEAM_STAT_IMPORTANCE: Record<TeamStatKey, string> = {
  rank_POM: "21.88%",
  rank_MAS: "12.47%",
  rank_WLK: "12.28%",
  rank_MOR: "11.61%",
  elo_sos: "8.13%",
  elo_last: "7.33%",
  avg_net_rtg: "6.90%",
  avg_off_rtg: "5.20%",
  elo_trend: "3.84%",
  avg_def_rtg: "3.70%",
  last5_Margin: "2.74%",
  rank_BIH: "2.67%",
  rank_NET: "1.27%",
};

const TEAM_STAT_COLUMNS_SNAPSHOT: Record<TeamStatKey, string> = {
  rank_POM: "POM",
  rank_MAS: "MAS",
  rank_WLK: "WLK",
  rank_MOR: "MOR",
  elo_sos: "elo_sos",
  elo_last: "elo_last",
  avg_net_rtg: "avg_net_rtg",
  avg_off_rtg: "avg_off_rtg",
  elo_trend: "elo_trend",
  avg_def_rtg: "avg_def_rtg",
  last5_Margin: "last5_Margin",
  rank_BIH: "BIH",
  rank_NET: "NET",
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

// 3. Matchup Stats Data
function convertTeamStatsData(): void {
  const statsByName: Record<string, Record<TeamStatKey, number | null>> = {};

  const upsertStats = (
    teamNameRaw: unknown,
    row: Record<string, unknown>,
    columnMap: Record<TeamStatKey, string>
  ): void => {
    const teamName = String(teamNameRaw ?? "").trim();
    if (!teamName) return;

    const existing = statsByName[teamName] ?? ({} as Record<TeamStatKey, number | null>);
    for (const key of TEAM_STAT_KEYS) {
      const sourceColumn = columnMap[key];
      const rawValue = Number(row[sourceColumn]);
      existing[key] = Number.isFinite(rawValue) ? roundTeamStatValue(key, rawValue) : null;
    }
    statsByName[teamName] = existing;
  };

  const snapshotWb = XLSX.readFile(path.join(DATA_DIR, "team_snapshot_2026.xlsx"));
  const snapshotRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    snapshotWb.Sheets[snapshotWb.SheetNames[0]]
  );
  for (const row of snapshotRows) {
    upsertStats(row["TeamName"], row, TEAM_STAT_COLUMNS_SNAPSHOT);
  }

  const orderedStats = Object.fromEntries(
    Object.keys(statsByName)
      .sort((a, b) => a.localeCompare(b))
      .map((teamName) => [teamName, statsByName[teamName]])
  );

  const teamStatUnion = TEAM_STAT_KEYS.map((key) => ` | "${key}"`).join("\n");
  const teamStatOrderLiteral = TEAM_STAT_KEYS.map((key) => `  "${key}",`).join("\n");

  const output = `// Auto-generated from team_snapshot_2026.xlsx
export type TeamStatKey =
${teamStatUnion}
;

export const TEAM_STAT_ORDER: TeamStatKey[] = [
${teamStatOrderLiteral}
];

export const TEAM_STAT_IMPORTANCE: Record<TeamStatKey, string> = ${JSON.stringify(TEAM_STAT_IMPORTANCE, null, 2)};

export const TEAM_STATS_2026: Record<string, Record<TeamStatKey, number | null>> = ${JSON.stringify(orderedStats)};
`;

  const outPath = path.join(ROOT, "src/data/teamStats2026.ts");
  fs.writeFileSync(outPath, output, "utf-8");
  console.log(`[ok] Wrote ${outPath} (${Object.keys(orderedStats).length} teams)`);
}

function roundTeamStatValue(key: TeamStatKey, value: number): number {
  if (
    key === "rank_POM" ||
    key === "rank_MAS" ||
    key === "rank_WLK" ||
    key === "rank_MOR" ||
    key === "rank_BIH" ||
    key === "rank_NET"
  ) {
    return Math.round(value);
  }
  if (key === "elo_trend") return round4(value);
  if (key === "avg_net_rtg" || key === "avg_off_rtg" || key === "avg_def_rtg") return round2(value);
  if (key === "elo_sos" || key === "elo_last" || key === "last5_Margin") return round1(value);
  return round2(value);
}

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

// ─── 4. Daily Rankings Trend Data (from model_rankings_daily_2026.csv) ───
function convertD1RankingsTrend(): void {
  const csvPath = path.join(DATA_DIR, "model_rankings_daily_2026.csv");
  const outPath = path.join(ROOT, "src/rankings/data/rankingsTrend2026.ts");

  const metricDefs = [
    { key: "mrRank", col: "MR_Rank", integer: true },
    { key: "mrScore", col: "MR_Score", integer: false },
    { key: "rankPOM", col: "Rank_POM", integer: true },
    { key: "rankMAS", col: "Rank_MAS", integer: true },
    { key: "rankMOR", col: "Rank_MOR", integer: true },
    { key: "rankWLK", col: "Rank_WLK", integer: true },
    { key: "rankBIH", col: "Rank_BIH", integer: true },
    { key: "rankNET", col: "Rank_NET", integer: true },
    { key: "elo", col: "Elo", integer: false },
    { key: "eloTrend", col: "Elo_Trend", integer: false },
    { key: "eloSos", col: "Elo_SOS", integer: false },
    { key: "netRtg", col: "Net_Rtg", integer: false },
    { key: "offRtg", col: "Off_Rtg", integer: false },
    { key: "defRtg", col: "Def_Rtg", integer: false },
    { key: "last5Margin", col: "Last5_Margin", integer: false },
  ] as const;
  const metricKeys = metricDefs.map((metric) => metric.key);

  if (!fs.existsSync(csvPath)) {
    const emptyOutput = `// Auto-generated from model_rankings_daily_2026.csv — do not edit manually
export const RANKING_TREND_DAYNUMS: number[] = [];
export const RANKING_TREND_METRICS = ${JSON.stringify(metricKeys)} as const;
export type RankingTrendMetric = (typeof RANKING_TREND_METRICS)[number];
export type RankingTrendSeries = Record<RankingTrendMetric, Array<number | null>>;
export const RANKING_TRENDS_BY_TEAM: Record<number, RankingTrendSeries> = {};
`;
    fs.writeFileSync(outPath, emptyOutput, "utf-8");
    console.warn("model_rankings_daily_2026.csv not found — wrote empty rankingsTrend2026.ts");
    return;
  }

  const wb = XLSX.readFile(csvPath, { raw: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
  const rows2026 = rows.filter((row) => Number(row["Season"] ?? 2026) === 2026);

  const daynums = Array.from(
    new Set(rows2026.map((row) => Number(row["DayNum"])).filter((value) => Number.isFinite(value)))
  )
    .sort((a, b) => a - b)
    .map((value) => Math.round(value));

  const rowByTeamByDay = new Map<number, Map<number, Record<string, unknown>>>();
  for (const row of rows2026) {
    const teamId = Number(row["TeamID"]);
    const daynum = Number(row["DayNum"]);
    if (!Number.isFinite(teamId) || !Number.isFinite(daynum)) continue;
    if (!rowByTeamByDay.has(teamId)) {
      rowByTeamByDay.set(teamId, new Map<number, Record<string, unknown>>());
    }
    rowByTeamByDay.get(teamId)!.set(Math.round(daynum), row);
  }

  const trendsByTeam: Record<number, Record<string, Array<number | null>>> = {};
  const sortedTeamIds = Array.from(rowByTeamByDay.keys()).sort((a, b) => a - b);
  for (const teamId of sortedTeamIds) {
    const dayMap = rowByTeamByDay.get(teamId)!;
    const metricSeries: Record<string, Array<number | null>> = {};
    for (const metric of metricDefs) {
      metricSeries[metric.key] = daynums.map((daynum) => {
        const row = dayMap.get(daynum);
        if (!row) return null;
        const raw = Number(row[metric.col]);
        if (!Number.isFinite(raw)) return null;
        if (metric.integer) return Math.round(raw);
        return raw;
      });
    }
    trendsByTeam[teamId] = metricSeries;
  }

  const output = `// Auto-generated from model_rankings_daily_2026.csv — do not edit manually
export const RANKING_TREND_DAYNUMS: number[] = ${JSON.stringify(daynums)};
export const RANKING_TREND_METRICS = ${JSON.stringify(metricKeys)} as const;
export type RankingTrendMetric = (typeof RANKING_TREND_METRICS)[number];
export type RankingTrendSeries = Record<RankingTrendMetric, Array<number | null>>;
export const RANKING_TRENDS_BY_TEAM: Record<number, RankingTrendSeries> = ${JSON.stringify(trendsByTeam)};
`;

  fs.writeFileSync(outPath, output, "utf-8");
  console.log(
    `✓ Wrote ${outPath} (${sortedTeamIds.length} teams, ${daynums.length} DayNums, ${metricDefs.length} metrics)`
  );
}

// ─── 4. NCAA Tournament Teams (from ProjectedBrackets.xlsx NCAA sheet) ───
function convertNCAATeams(): void {
  const pbPath = path.join(DATA_DIR, "ProjectedBrackets.xlsx");
  if (!fs.existsSync(pbPath)) {
    console.warn("ProjectedBrackets.xlsx not found — skipping teams.ts");
    return;
  }
  const wb = XLSX.readFile(pbPath);
  if (!wb.SheetNames.includes("NCAA")) {
    console.warn("ProjectedBrackets.xlsx has no NCAA sheet — skipping teams.ts");
    return;
  }

  // Load elo ratings from snapshot for fallback rating field
  const snapWb = XLSX.readFile(path.join(DATA_DIR, "team_snapshot_2026.xlsx"));
  const snapRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(snapWb.Sheets[snapWb.SheetNames[0]]);
  const ratingByName = new Map<string, number>();
  for (const r of snapRows) {
    const name = String(r["TeamName"] ?? "").trim().toLowerCase();
    const elo = Number(r["elo_last"]);
    if (name && Number.isFinite(elo)) ratingByName.set(name, elo);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["NCAA"]);
  const teams = rows.map((row) => {
    const rawSeed = String(row["Seed"] ?? "").trim();
    const region  = String(row["Region"] ?? "").trim();
    const name    = String(row["Team"] ?? "").trim();

    const seedNum    = parseInt(rawSeed, 10);
    const isFirstFour = /[ab]$/i.test(rawSeed);
    const seedLabel  = isFirstFour ? rawSeed.toLowerCase() : String(seedNum);
    const id         = `${region}-${seedLabel}`;
    const rating     = Math.round(ratingByName.get(name.toLowerCase()) ?? 1500);

    return { id, name, seed: seedNum, seedLabel, region, rating, isFirstFour };
  });

  const output = `import type { Team } from "../types";

export interface Team2026 extends Team {
  seedLabel: string;
  isFirstFour?: boolean;
}

// Auto-generated from ProjectedBrackets.xlsx (NCAA sheet) — do not edit manually
export const teams: Team2026[] = ${JSON.stringify(teams)};

export const teamsById = new Map(teams.map((team) => [team.id, team]));
`;

  const outPath = path.join(ROOT, "src/data/teams.ts");
  fs.writeFileSync(outPath, output, "utf-8");
  console.log(`✓ Wrote ${outPath} (${teams.length} teams)`);
}

// ─── 5. NCAA Tournament Matchup Probabilities ───
function convertNCAAMatchupProbs(): void {
  const wb = XLSX.readFile(path.join(DATA_DIR, "matchup_probs_2026.xlsx"));
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);

  // Map: Python round label → website round key, first DayNum column to use
  const roundMap: Array<{ pyLabel: string; daynum: number; webRound: string }> = [
    { pyLabel: "FF",     daynum: 134, webRound: "FF"    },
    { pyLabel: "R64",    daynum: 136, webRound: "R64"   },
    { pyLabel: "R32",    daynum: 138, webRound: "R32"   },
    { pyLabel: "S16",    daynum: 143, webRound: "S16"   },
    { pyLabel: "E8",     daynum: 145, webRound: "E8"    },
    { pyLabel: "F4",     daynum: 152, webRound: "F4"    },
    { pyLabel: "Finals", daynum: 154, webRound: "CHAMP" },
  ];

  const probs: Record<string, number> = {};

  for (const row of rows) {
    const t1 = String(row["team1_name"]);
    const t2 = String(row["team2_name"]);

    for (const { pyLabel, daynum, webRound } of roundMap) {
      const col = `prob_team1_wins_${pyLabel}_D${daynum}`;
      const p = Number(row[col]);
      if (Number.isFinite(p)) {
        probs[`${t1}|${t2}|${webRound}`] = round6(p);
        probs[`${t2}|${t1}|${webRound}`] = round6(1 - p);
      }
    }
  }

  const output = `// Auto-generated from matchup_probs_2026.xlsx — do not edit manually
export const MATCHUP_PROB_BY_STAGE: Record<string, number> = ${JSON.stringify(probs)};
`;

  const outPath = path.join(ROOT, "src/lib/matchupProbData.ts");
  fs.writeFileSync(outPath, output, "utf-8");
  console.log(`✓ Wrote ${outPath} (${Object.keys(probs).length} matchup-round entries)`);
}

// ─── 5. NCAA Tournament Bracket Predictions ───
function convertNCAABracketPreds(): void {
  const wb = XLSX.readFile(path.join(DATA_DIR, "2026_bracket_preds.xlsx"));
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);

  const preds: Record<string, {
    round2Prob: number;
    sweet16Prob: number;
    elite8Prob: number;
    final4Prob: number;
    titleGameProb: number;
    champProb: number;
  }> = {};

  for (const row of rows) {
    const name = String(row["TeamName"]);
    preds[name] = {
      round2Prob:    round6(Number(row["pct_R32"])      / 100),
      sweet16Prob:   round6(Number(row["pct_S16"])      / 100),
      elite8Prob:    round6(Number(row["pct_E8"])       / 100),
      final4Prob:    round6(Number(row["pct_F4"])       / 100),
      titleGameProb: round6(Number(row["pct_Finals"])   / 100),
      champProb:     round6(Number(row["pct_Champion"]) / 100),
    };
  }

  const output = `// Auto-generated from 2026_bracket_preds.xlsx — do not edit manually
export interface BracketPred {
  round2Prob: number;
  sweet16Prob: number;
  elite8Prob: number;
  final4Prob: number;
  titleGameProb: number;
  champProb: number;
}

/** Pre-computed Monte Carlo advancement probabilities keyed by team name. */
export const BRACKET_PREDS_2026: Record<string, BracketPred> = ${JSON.stringify(preds, null, 2)};
`;

  const outPath = path.join(ROOT, "src/data/bracketPreds2026.ts");
  fs.writeFileSync(outPath, output, "utf-8");
  console.log(`✓ Wrote ${outPath} (${Object.keys(preds).length} teams)`);
}

// ─── Matchup Predictor ───────────────────────────────────────────────────────

/**
 * Reads matchup_predictor_2026.xlsx (generated by generate_matchup_predictor.py)
 * and writes src/data/matchupPredictor.ts as a compact base64 Uint16 lookup table.
 *
 * Excel format (one row per ordered team pair, TeamID_A < TeamID_B):
 *   TeamID_A | TeamName_A | Conf_A | TeamID_B | TeamName_B | Conf_B |
 *   prob_neutral | prob_A_home | prob_B_home
 *
 * Storage layout in the Uint16Array:
 *   For pair index k (i < j in PREDICTOR_TEAMS sort order):
 *     arr[k*3+0] = prob_neutral   (P team[i] wins, neutral site)
 *     arr[k*3+1] = prob_A_home    (P team[i] wins, team[i] home)
 *     arr[k*3+2] = prob_B_home    (P team[i] wins, team[j] home)
 *   Each value = round(prob * 65535), decoded as val / 65535.
 */
function convertMatchupPredictor(): void {
  const xlsxPath = path.join(DATA_DIR, "matchup_predictor_2026.xlsx");
  if (!fs.existsSync(xlsxPath)) {
    console.log(`⚠  matchup_predictor_2026.xlsx not found — skipping matchupPredictor.ts`);
    return;
  }

  const wb = XLSX.readFile(xlsxPath);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);

  if (rows.length === 0) {
    console.log(`⚠  matchup_predictor_2026.xlsx is empty — skipping matchupPredictor.ts`);
    return;
  }

  // Collect unique teams (sorted by TeamID, same order as Python generator)
  const teamMap = new Map<number, { name: string; conf: string }>();
  for (const row of rows) {
    const aId = Number(row["TeamID_A"]);
    const bId = Number(row["TeamID_B"]);
    if (!teamMap.has(aId)) teamMap.set(aId, { name: String(row["TeamName_A"]), conf: String(row["Conf_A"]) });
    if (!teamMap.has(bId)) teamMap.set(bId, { name: String(row["TeamName_B"]), conf: String(row["Conf_B"]) });
  }

  const teams = [...teamMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, info]) => ({ id, ...info }));

  const N = teams.length;
  const numPairs = (N * (N - 1)) / 2;

  // Build pair-index lookup: "teamIdA|teamIdB" → pairIdx  (A < B by TeamID)
  const teamIdxMap = new Map(teams.map((t, i) => [t.id, i]));
  const probs = new Uint16Array(numPairs * 3);

  for (const row of rows) {
    const aId = Number(row["TeamID_A"]);
    const bId = Number(row["TeamID_B"]);
    const i = teamIdxMap.get(aId);
    const j = teamIdxMap.get(bId);
    if (i === undefined || j === undefined) continue;

    // Pair index in triangular matrix (i < j guaranteed since TeamID_A < TeamID_B in Python)
    const pairIdx = i * N - Math.floor((i * (i + 1)) / 2) + (j - i - 1);

    probs[pairIdx * 3 + 0] = Math.round(Number(row["prob_neutral"]) * 65535);
    probs[pairIdx * 3 + 1] = Math.round(Number(row["prob_A_home"]) * 65535);
    probs[pairIdx * 3 + 2] = Math.round(Number(row["prob_B_home"]) * 65535);
  }

  // Base64-encode the Uint16Array
  const b64 = Buffer.from(probs.buffer).toString("base64");
  const teamsJson = JSON.stringify(teams, null, 0);

  const output = `// Auto-generated from matchup_predictor_2026.xlsx — do not edit manually
// Run generate_matchup_predictor.py to regenerate matchup_predictor_2026.xlsx,
// then GitHub Actions will regenerate this file automatically.

/**
 * All D1 teams sorted by TeamID.
 * Array index is used to compute pair/location lookup offsets.
 */
export const PREDICTOR_TEAMS: ReadonlyArray<{
  id: number;
  name: string;
  conf: string;
}> = ${teamsJson};

/**
 * Base64-encoded Uint16Array of win probabilities.
 *
 * Layout: for each ordered pair (i, j) with i < j (by array index in PREDICTOR_TEAMS),
 * 3 consecutive uint16 values are stored:
 *   offset 0: P(team[i] wins | neutral site)
 *   offset 1: P(team[i] wins | team[i] home)
 *   offset 2: P(team[i] wins | team[j] home)
 *
 * Total pairs: ${numPairs.toLocaleString()}. Total uint16 values: ${(numPairs * 3).toLocaleString()}.
 * Each value encodes probability p as round(p * 65535).
 */
export const PREDICTOR_PROBS_B64 =
  "${b64}";

let _cache: Uint16Array | null = null;

function getProbs(): Uint16Array {
  if (!_cache) {
    const bytes = Uint8Array.from(atob(PREDICTOR_PROBS_B64), (c) => c.charCodeAt(0));
    _cache = new Uint16Array(bytes.buffer);
  }
  return _cache;
}

const N = PREDICTOR_TEAMS.length;

/**
 * Get win probability for teamA vs teamB.
 * @param teamAIdx  Index into PREDICTOR_TEAMS for team A
 * @param teamBIdx  Index into PREDICTOR_TEAMS for team B
 * @param loc       "N" = neutral, "H" = team A home, "A" = team A away (team B home)
 * @returns         P(team A wins), or null if indices are invalid
 */
export function getMatchupProb(teamAIdx: number, teamBIdx: number, loc: "N" | "H" | "A"): number | null {
  if (teamAIdx === teamBIdx || teamAIdx < 0 || teamBIdx < 0 || teamAIdx >= N || teamBIdx >= N) {
    return null;
  }
  const flipped = teamAIdx > teamBIdx;
  const i = flipped ? teamBIdx : teamAIdx;
  const j = flipped ? teamAIdx : teamBIdx;
  const pairIdx = i * N - Math.floor((i * (i + 1)) / 2) + (j - i - 1);
  let storageLoc: number;
  if (loc === "N") {
    storageLoc = 0;
  } else if ((!flipped && loc === "H") || (flipped && loc === "A")) {
    storageLoc = 1;
  } else {
    storageLoc = 2;
  }
  const raw = getProbs()[pairIdx * 3 + storageLoc] / 65535;
  return flipped ? 1 - raw : raw;
}

/**
 * Get team index in PREDICTOR_TEAMS by TeamID. Returns -1 if not found.
 */
export function getTeamIdx(teamId: number): number {
  let lo = 0;
  let hi = N - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cmp = PREDICTOR_TEAMS[mid].id - teamId;
    if (cmp === 0) return mid;
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
`;

  const outPath = path.join(ROOT, "src/data/matchupPredictor.ts");
  fs.writeFileSync(outPath, output, "utf-8");
  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log(`✓ Wrote ${outPath} (${teams.length} teams, ${numPairs.toLocaleString()} pairs, ${sizeMB} MB)`);
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
convertTeamStatsData();
convertD1Rankings();
convertD1RankingsTrend();
convertNCAATeams();
convertNCAAMatchupProbs();
convertNCAABracketPreds();
convertMatchupPredictor();
console.log("\nDone!");




