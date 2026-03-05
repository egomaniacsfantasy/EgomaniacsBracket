"""
Generate all-pairs matchup predictions for the website's Team Matchup Predictor.

Usage (run locally — requires model_mm_artifacts.pkl):
    python scripts/generate_matchup_predictor.py

Reads:
    model_mm_artifacts.pkl       (LightGBM + isotonic calibration)
    team_snapshot_2026.xlsx      (all 365 D1 teams with features)

Writes:
    src/data/matchupPredictor.ts (static lookup table for the website)

The predictor uses DayNum=136 (NCAA R64) for all predictions.
Location variants: A (team1 away), N (neutral), H (team1 home).
"""

import sys
import pickle
import base64
import json
import numpy as np
import pandas as pd
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────
BASE     = Path(__file__).resolve().parent.parent
ARTIFACT = BASE / "model_mm_artifacts.pkl"
SNAPSHOT = BASE / "team_snapshot_2026.xlsx"
OUT_TS   = BASE / "src" / "data" / "matchupPredictor.ts"

DAYNUM = 136  # NCAA R64 (first main-bracket day)

# ── Feature columns (must match model_mm.py exactly — 33 features) ──────────
ELO_COLS = [
    "team1_elo_last", "team2_elo_last", "elo_diff",
    "team1_elo_trend", "team2_elo_trend", "elo_trend_diff",
]
RANK_DIFF_COLS = [
    "rankdiff_POM", "rankdiff_MAS", "rankdiff_MOR",
    "rankdiff_WLK", "rankdiff_BIH", "rankdiff_NET",
]
EFF_COLS = [
    "team1_avg_off_rtg",  "team2_avg_off_rtg",  "off_rtg_diff",
    "team1_avg_def_rtg",  "team2_avg_def_rtg",  "def_rtg_diff",
    "team1_avg_net_rtg",  "team2_avg_net_rtg",  "net_rtg_diff",
    "team1_avg_oreb_pct", "team2_avg_oreb_pct", "oreb_pct_diff",
    "team1_avg_tov_pct",  "team2_avg_tov_pct",  "tov_pct_diff",
]
FORM_COLS = [
    "team1_last5_Margin", "team2_last5_Margin", "last5_Margin_diff",
]
SOS_COLS  = ["elo_sos_diff"]
CONTEXT_COLS = ["location", "DayNum"]

FEATURE_COLS = ELO_COLS + RANK_DIFF_COLS + EFF_COLS + FORM_COLS + SOS_COLS + CONTEXT_COLS
assert len(FEATURE_COLS) == 33, f"Expected 33 features, got {len(FEATURE_COLS)}"


def load_artifacts():
    print(f"Loading model artifacts from {ARTIFACT}...")
    if not ARTIFACT.exists():
        print("ERROR: model_mm_artifacts.pkl not found. Run model_mm.py first.")
        sys.exit(1)
    with open(ARTIFACT, "rb") as f:
        arts = pickle.load(f)
    model      = arts["model"]
    calibrator = arts["calibrator"]
    le_loc     = arts["le_loc"]
    n_trees    = arts.get("n_trees", None)
    feat_cols  = list(arts["feature_cols"])
    assert feat_cols == FEATURE_COLS, f"Feature mismatch: {feat_cols} != {FEATURE_COLS}"
    print(f"  Model: n_trees={n_trees}, features={len(feat_cols)}")
    return model, calibrator, le_loc, n_trees


def load_teams():
    print(f"Loading team snapshot from {SNAPSHOT}...")
    df = pd.read_excel(SNAPSHOT)
    required = ["TeamID", "TeamName", "Conf", "elo_last", "elo_trend", "elo_sos",
                "POM", "MAS", "MOR", "WLK", "BIH", "NET",
                "avg_off_rtg", "avg_def_rtg", "avg_net_rtg",
                "avg_oreb_pct", "avg_tov_pct", "last5_Margin"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        print(f"ERROR: Missing columns in snapshot: {missing}")
        sys.exit(1)
    df = df.dropna(subset=["TeamID"]).copy()
    df["TeamID"] = df["TeamID"].astype(int)
    # Fill NaN ranking columns with a high default (unranked)
    rank_cols = ["POM", "MAS", "MOR", "WLK", "BIH", "NET"]
    df[rank_cols] = df[rank_cols].fillna(400)
    df = df.sort_values("TeamID").reset_index(drop=True)
    print(f"  Teams: {len(df)} D1 teams")
    return df


def build_feature_matrix(df: pd.DataFrame, loc_codes: list[int]) -> np.ndarray:
    """Build shape (num_pairs * 3, 33) feature matrix for all ordered pairs × 3 locs."""
    n = len(df)
    teams = df.to_dict("records")
    num_pairs = n * (n - 1) // 2
    total_rows = num_pairs * 3

    print(f"  Building feature matrix: {n} teams → {num_pairs:,} pairs × 3 locs = {total_rows:,} rows...")

    rows = []
    for i in range(n):
        t1 = teams[i]
        for j in range(i + 1, n):
            t2 = teams[j]
            for loc_code in loc_codes:
                row = [
                    t1["elo_last"],
                    t2["elo_last"],
                    t1["elo_last"] - t2["elo_last"],
                    t1["elo_trend"],
                    t2["elo_trend"],
                    t1["elo_trend"] - t2["elo_trend"],
                    t1["POM"]   - t2["POM"],
                    t1["MAS"]   - t2["MAS"],
                    t1["MOR"]   - t2["MOR"],
                    t1["WLK"]   - t2["WLK"],
                    t1["BIH"]   - t2["BIH"],
                    t1["NET"]   - t2["NET"],
                    t1["avg_off_rtg"],
                    t2["avg_off_rtg"],
                    t1["avg_off_rtg"] - t2["avg_off_rtg"],
                    t1["avg_def_rtg"],
                    t2["avg_def_rtg"],
                    t1["avg_def_rtg"] - t2["avg_def_rtg"],
                    t1["avg_net_rtg"],
                    t2["avg_net_rtg"],
                    t1["avg_net_rtg"] - t2["avg_net_rtg"],
                    t1["avg_oreb_pct"],
                    t2["avg_oreb_pct"],
                    t1["avg_oreb_pct"] - t2["avg_oreb_pct"],
                    t1["avg_tov_pct"],
                    t2["avg_tov_pct"],
                    t1["avg_tov_pct"] - t2["avg_tov_pct"],
                    t1["last5_Margin"],
                    t2["last5_Margin"],
                    t1["last5_Margin"] - t2["last5_Margin"],
                    t1["elo_sos"] - t2["elo_sos"],
                    loc_code,
                    DAYNUM,
                ]
                rows.append(row)

    return np.array(rows, dtype=np.float32)


def predict_calibrated(model, calibrator, n_trees: int | None, X: np.ndarray) -> np.ndarray:
    import lightgbm as lgb
    import pandas as pd_mod

    BATCH = 50_000
    preds = []
    for start in range(0, len(X), BATCH):
        batch = pd_mod.DataFrame(X[start:start + BATCH], columns=FEATURE_COLS)
        # Encode categorical location column as integer category for LightGBM
        batch["location"] = batch["location"].astype(int)
        raw = model.predict(
            batch,
            num_iteration=n_trees if n_trees else model.best_iteration,
            categorical_feature=["location"],
        )
        cal = calibrator.predict(raw)
        preds.append(cal)
        print(f"    Predicted rows {start}–{start + len(batch) - 1}...")

    return np.concatenate(preds, axis=0)


def encode_probs(probs: np.ndarray) -> str:
    """Encode float probabilities as uint16 packed in base64."""
    uint16 = np.clip(probs, 0.0, 1.0)
    uint16 = (uint16 * 65535).round().astype(np.uint16)
    return base64.b64encode(uint16.tobytes()).decode("ascii")


def write_ts(df: pd.DataFrame, probs_b64: str, num_pairs: int):
    teams_json = json.dumps([
        {"id": int(row["TeamID"]), "name": str(row["TeamName"]), "conf": str(row["Conf"])}
        for _, row in df.iterrows()
    ], separators=(",", ":"))

    content = f"""// Auto-generated by scripts/generate_matchup_predictor.py — do not edit manually
// Run: python scripts/generate_matchup_predictor.py
// DayNum={DAYNUM} (NCAA R64), 3 location variants per pair (neutral / team-i home / team-j home)

/**
 * All D1 teams sorted by TeamID.
 * Array index is used to compute pair/location lookup offsets.
 */
export const PREDICTOR_TEAMS: ReadonlyArray<{{
  id: number;
  name: string;
  conf: string;
}}> = {teams_json};

/**
 * Base64-encoded Uint16Array of win probabilities.
 *
 * Layout: for each ordered pair (i, j) with i < j (by array index in PREDICTOR_TEAMS),
 * 3 consecutive uint16 values are stored:
 *   offset 0: P(team[i] wins | neutral site)
 *   offset 1: P(team[i] wins | team[i] home)
 *   offset 2: P(team[i] wins | team[j] home)
 *
 * Total pairs: {num_pairs:,}. Total uint16 values: {num_pairs * 3:,}.
 * Each value encodes probability p as round(p * 65535).
 *
 * Use getMatchupProb() below to look up by team array index + location.
 */
export const PREDICTOR_PROBS_B64 =
  "{probs_b64}";

let _cache: Uint16Array | null = null;

function getProbs(): Uint16Array {{
  if (!_cache) {{
    const bytes = Uint8Array.from(atob(PREDICTOR_PROBS_B64), (c) => c.charCodeAt(0));
    _cache = new Uint16Array(bytes.buffer);
  }}
  return _cache;
}}

const N = PREDICTOR_TEAMS.length;

/**
 * Get win probability for teamA vs teamB.
 *
 * @param teamAIdx  Index into PREDICTOR_TEAMS for team A
 * @param teamBIdx  Index into PREDICTOR_TEAMS for team B
 * @param loc       "N" = neutral, "H" = team A home, "A" = team A away (team B home)
 * @returns         P(team A wins), or null if indices are invalid
 */
export function getMatchupProb(teamAIdx: number, teamBIdx: number, loc: "N" | "H" | "A"): number | null {{
  if (teamAIdx === teamBIdx || teamAIdx < 0 || teamBIdx < 0 || teamAIdx >= N || teamBIdx >= N) {{
    return null;
  }}

  const flipped = teamAIdx > teamBIdx;
  const i = flipped ? teamBIdx : teamAIdx;
  const j = flipped ? teamAIdx : teamBIdx;

  // Triangular matrix index
  const pairIdx = i * N - Math.floor((i * (i + 1)) / 2) + (j - i - 1);

  // Storage loc: 0=neutral, 1=team[i] home, 2=team[j] home
  let storageLoc: number;
  if (loc === "N") {{
    storageLoc = 0;
  }} else if ((!flipped && loc === "H") || (flipped && loc === "A")) {{
    storageLoc = 1; // team[i] is home
  }} else {{
    storageLoc = 2; // team[j] is home
  }}

  const raw = getProbs()[pairIdx * 3 + storageLoc] / 65535;
  return flipped ? 1 - raw : raw;
}}

/**
 * Get team index in PREDICTOR_TEAMS by TeamID. Returns -1 if not found.
 */
export function getTeamIdx(teamId: number): number {{
  // Binary search (PREDICTOR_TEAMS is sorted by id)
  let lo = 0;
  let hi = N - 1;
  while (lo <= hi) {{
    const mid = (lo + hi) >> 1;
    const cmp = PREDICTOR_TEAMS[mid].id - teamId;
    if (cmp === 0) return mid;
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }}
  return -1;
}}
"""

    OUT_TS.parent.mkdir(parents=True, exist_ok=True)
    OUT_TS.write_text(content, encoding="utf-8")
    size_kb = OUT_TS.stat().st_size / 1024
    print(f"\n✓ Wrote {OUT_TS}  ({size_kb:.0f} KB)")


def main():
    model, calibrator, le_loc, n_trees = load_artifacts()
    df = load_teams()

    # Location encoding: le_loc maps "A"→0, "H"→1, "N"→2 (alphabetical)
    loc_labels = ["N", "H", "A"]  # storage order: neutral, i-home, j-home
    loc_codes  = [int(le_loc.transform([lbl])[0]) for lbl in loc_labels]
    print(f"  Location encoding: {dict(zip(loc_labels, loc_codes))}")

    X = build_feature_matrix(df, loc_codes)
    print(f"  Feature matrix shape: {X.shape}")

    probs = predict_calibrated(model, calibrator, n_trees, X)
    print(f"  Predictions: min={probs.min():.3f}, max={probs.max():.3f}, mean={probs.mean():.3f}")

    n = len(df)
    num_pairs = n * (n - 1) // 2
    # probs is laid out as [pair0_loc0, pair0_loc1, pair0_loc2, pair1_loc0, ...]
    probs_b64 = encode_probs(probs)
    print(f"  Encoded: {len(probs_b64):,} chars base64")

    write_ts(df, probs_b64, num_pairs)
    print("Done.")


if __name__ == "__main__":
    main()
