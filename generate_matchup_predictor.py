# ---
# jupyter:
#   jupytext:
#     formats: ipynb,py:percent
#     text_representation:
#       extension: .py
#       format_name: percent
#       format_version: '1.3'
#       jupytext_version: 1.19.1
#   kernelspec:
#     display_name: Python 3 (ipykernel)
#     language: python
#     name: python3
# ---

# %% [markdown]
# # Matchup Predictor — Daily Generator
#
# **Purpose:** Generate win-probability predictions for all ~66 K D1 team pairs
# (neutral / Team-A home / Team-B home) using the trained LightGBM model.
#
# **Run daily** — team Elo / rankings update after every game, so re-run whenever
# `team_snapshot_2026.xlsx` is refreshed.
#
# **Outputs:**
# - `matchup_predictor_2026.xlsx` — raw probability table (triggers GitHub Actions)
# - Auto-pushed to GitHub; Actions converts it → `src/data/matchupPredictor.ts`
#
# **Workflow after running:**
# 1. Script auto-pushes `matchup_predictor_2026.xlsx` to GitHub
# 2. GitHub Actions detects `.xlsx` change → runs `convertData.ts`
# 3. `convertData.ts` reads Excel → writes compact `src/data/matchupPredictor.ts`
# 4. Actions commits the TS file; Render auto-deploys the website

# %%
# ---------------------------------------------------------------------------
# IMPORTS & CONSTANTS
# ---------------------------------------------------------------------------
import sys
import io
import pickle
import datetime
import subprocess
import warnings

import numpy as np
import pandas as pd
from pathlib import Path

# Jupyter-safe stdout wrapper
try:
    buf = getattr(sys.stdout, "buffer", None)
    if buf is not None:
        sys.stdout = io.TextIOWrapper(buf, encoding="utf-8", errors="replace")
except Exception:
    pass

warnings.filterwarnings("ignore")

try:
    BASE = Path(__file__).resolve().parent
except NameError:
    BASE = Path.cwd()

ARTIFACT = BASE / "model_mm_artifacts.pkl"
SNAPSHOT = BASE / "team_snapshot_2026.xlsx"
OUT_XLSX = BASE / "matchup_predictor_2026.xlsx"

# DayNum context for predictions.
# 121 ≈ Mar 4 2026 (end of regular season).  Update each season.
DAYNUM = 121

print(f"BASE:     {BASE}")
print(f"ARTIFACT: {ARTIFACT}  exists={ARTIFACT.exists()}")
print(f"SNAPSHOT: {SNAPSHOT}  exists={SNAPSHOT.exists()}")
print(f"OUT_XLSX: {OUT_XLSX}")
print(f"DayNum:   {DAYNUM}")

# %%
# ---------------------------------------------------------------------------
# FEATURE COLUMNS  (must match model_mm.py exactly — 33 total)
# ---------------------------------------------------------------------------
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
SOS_COLS     = ["elo_sos_diff"]
CONTEXT_COLS = ["location", "DayNum"]

FEATURE_COLS = ELO_COLS + RANK_DIFF_COLS + EFF_COLS + FORM_COLS + SOS_COLS + CONTEXT_COLS
assert len(FEATURE_COLS) == 33, f"Expected 33 features, got {len(FEATURE_COLS)}"
print(f"Feature columns: {len(FEATURE_COLS)} ✓")

# %%
# ---------------------------------------------------------------------------
# LOAD MODEL ARTIFACTS
# ---------------------------------------------------------------------------
if not ARTIFACT.exists():
    raise FileNotFoundError(
        f"model_mm_artifacts.pkl not found at {ARTIFACT}. Run model_mm.py first."
    )

with open(ARTIFACT, "rb") as f:
    arts = pickle.load(f)

model      = arts["model"]
calibrator = arts["calibrator"]
le_loc     = arts["le_loc"]
n_trees    = arts.get("n_trees", None)
feat_cols  = list(arts["feature_cols"])

assert feat_cols == FEATURE_COLS, (
    f"Feature mismatch!\n  saved:    {feat_cols}\n  expected: {FEATURE_COLS}"
)

# Location encoding: label encoder sorted alphabetically → A=0, H=1, N=2
LOC_ENCODING = dict(zip(le_loc.classes_, le_loc.transform(le_loc.classes_)))
print(f"Model loaded:    n_trees={n_trees}")
print(f"Location codes:  {LOC_ENCODING}")

# %%
# ---------------------------------------------------------------------------
# LOAD TEAM SNAPSHOT
# ---------------------------------------------------------------------------
REQUIRED_COLS = [
    "TeamID", "TeamName", "Conf",
    "elo_last", "elo_trend", "elo_sos",
    "POM", "MAS", "MOR", "WLK", "BIH", "NET",
    "avg_off_rtg", "avg_def_rtg", "avg_net_rtg",
    "avg_oreb_pct", "avg_tov_pct", "last5_Margin",
]

snap = pd.read_excel(SNAPSHOT)
missing = [c for c in REQUIRED_COLS if c not in snap.columns]
if missing:
    raise ValueError(f"Missing columns in snapshot: {missing}")

snap = snap.dropna(subset=["TeamID"]).copy()
snap["TeamID"] = snap["TeamID"].astype(int)

# Fill missing ranking values with 400 (effectively unranked)
for col in ["POM", "MAS", "MOR", "WLK", "BIH", "NET"]:
    snap[col] = snap[col].fillna(400)

snap = snap.sort_values("TeamID").reset_index(drop=True)
N_TEAMS = len(snap)
N_PAIRS = N_TEAMS * (N_TEAMS - 1) // 2
print(f"Teams loaded:    {N_TEAMS} D1 teams → {N_PAIRS:,} unique pairs")

# %%
# ---------------------------------------------------------------------------
# BUILD FEATURE MATRIX  (N_PAIRS × 3 locations × 33 features)
# ---------------------------------------------------------------------------
# Location order stored in Excel: neutral(N), A-home(H), B-home(A)
# (A = team1 away / team2 home)
LOC_ORDER   = ["N", "H", "A"]          # what we store per pair
LOC_CODES   = [int(le_loc.transform([l])[0]) for l in LOC_ORDER]
LOC_LABELS  = ["prob_neutral", "prob_A_home", "prob_B_home"]

print(f"\nBuilding feature matrix: {N_PAIRS:,} pairs × 3 locs = {N_PAIRS*3:,} rows ...")
teams = snap.to_dict("records")

# Pre-allocate
rows = np.empty((N_PAIRS * 3, 33), dtype=np.float32)

row_idx = 0
for i in range(N_TEAMS):
    t1 = teams[i]
    for j in range(i + 1, N_TEAMS):
        t2 = teams[j]
        base_feats = [
            t1["elo_last"],
            t2["elo_last"],
            t1["elo_last"]      - t2["elo_last"],
            t1["elo_trend"],
            t2["elo_trend"],
            t1["elo_trend"]     - t2["elo_trend"],
            t1["POM"]           - t2["POM"],
            t1["MAS"]           - t2["MAS"],
            t1["MOR"]           - t2["MOR"],
            t1["WLK"]           - t2["WLK"],
            t1["BIH"]           - t2["BIH"],
            t1["NET"]           - t2["NET"],
            t1["avg_off_rtg"],
            t2["avg_off_rtg"],
            t1["avg_off_rtg"]   - t2["avg_off_rtg"],
            t1["avg_def_rtg"],
            t2["avg_def_rtg"],
            t1["avg_def_rtg"]   - t2["avg_def_rtg"],
            t1["avg_net_rtg"],
            t2["avg_net_rtg"],
            t1["avg_net_rtg"]   - t2["avg_net_rtg"],
            t1["avg_oreb_pct"],
            t2["avg_oreb_pct"],
            t1["avg_oreb_pct"]  - t2["avg_oreb_pct"],
            t1["avg_tov_pct"],
            t2["avg_tov_pct"],
            t1["avg_tov_pct"]   - t2["avg_tov_pct"],
            t1["last5_Margin"],
            t2["last5_Margin"],
            t1["last5_Margin"]  - t2["last5_Margin"],
            t1["elo_sos"]       - t2["elo_sos"],
        ]
        for loc_code in LOC_CODES:
            rows[row_idx, :31] = base_feats
            rows[row_idx, 31]  = loc_code
            rows[row_idx, 32]  = DAYNUM
            row_idx += 1

print(f"Feature matrix:  {rows.shape}  ✓")

# %%
# ---------------------------------------------------------------------------
# RUN MODEL PREDICTIONS
# ---------------------------------------------------------------------------
BATCH = 50_000
all_probs = []

print(f"\nRunning model predictions in batches of {BATCH:,} ...")
for start in range(0, len(rows), BATCH):
    batch_df = pd.DataFrame(rows[start:start + BATCH], columns=FEATURE_COLS)
    batch_df["location"] = batch_df["location"].astype(int)
    raw  = model.predict(
        batch_df,
        num_iteration=n_trees if n_trees else model.best_iteration,
        categorical_feature=["location"],
    )
    cal = calibrator.predict(raw)
    all_probs.append(cal)
    end = min(start + BATCH, len(rows))
    print(f"  rows {start:>7,} – {end:>7,}  mean_prob={cal.mean():.4f}")

all_probs_flat = np.concatenate(all_probs)
print(f"\nPredictions done: {len(all_probs_flat):,} values")
print(f"  min={all_probs_flat.min():.4f}  max={all_probs_flat.max():.4f}  mean={all_probs_flat.mean():.4f}")

# %%
# ---------------------------------------------------------------------------
# BUILD OUTPUT DATAFRAME & WRITE EXCEL
# ---------------------------------------------------------------------------
# Reshape into (N_PAIRS, 3)  →  one row per pair, three prob columns
probs_matrix = all_probs_flat.reshape(N_PAIRS, 3)

# Build pair metadata arrays
team_id_a   = np.empty(N_PAIRS, dtype=np.int32)
team_name_a = np.empty(N_PAIRS, dtype=object)
conf_a      = np.empty(N_PAIRS, dtype=object)
team_id_b   = np.empty(N_PAIRS, dtype=np.int32)
team_name_b = np.empty(N_PAIRS, dtype=object)
conf_b      = np.empty(N_PAIRS, dtype=object)

pair_idx = 0
for i in range(N_TEAMS):
    for j in range(i + 1, N_TEAMS):
        team_id_a[pair_idx]   = teams[i]["TeamID"]
        team_name_a[pair_idx] = teams[i]["TeamName"]
        conf_a[pair_idx]      = teams[i]["Conf"]
        team_id_b[pair_idx]   = teams[j]["TeamID"]
        team_name_b[pair_idx] = teams[j]["TeamName"]
        conf_b[pair_idx]      = teams[j]["Conf"]
        pair_idx += 1

out_df = pd.DataFrame({
    "TeamID_A":    team_id_a,
    "TeamName_A":  team_name_a,
    "Conf_A":      conf_a,
    "TeamID_B":    team_id_b,
    "TeamName_B":  team_name_b,
    "Conf_B":      conf_b,
    "prob_neutral": np.round(probs_matrix[:, 0], 6),
    "prob_A_home":  np.round(probs_matrix[:, 1], 6),
    "prob_B_home":  np.round(probs_matrix[:, 2], 6),
})

print(f"\nWriting {OUT_XLSX.name}  ({len(out_df):,} rows) ...")
out_df.to_excel(OUT_XLSX, index=False)
size_mb = OUT_XLSX.stat().st_size / 1024 / 1024
print(f"  Written: {size_mb:.1f} MB  ✓")
print(out_df.head(3).to_string(index=False))

# %%
# ---------------------------------------------------------------------------
# AUTO-PUSH TO GITHUB
# Stages matchup_predictor_2026.xlsx and pushes.
# GitHub Actions detects the .xlsx change → runs convertData.ts →
# generates src/data/matchupPredictor.ts → commits back automatically.
# ---------------------------------------------------------------------------
import subprocess, datetime

def _git(*args, cwd=str(BASE)):
    return subprocess.run(
        ["git"] + list(args), cwd=cwd, capture_output=True, text=True
    )

_push_files = ["matchup_predictor_2026.xlsx"]

print("\n" + "=" * 60)
print("AUTO-PUSH: staging output files → GitHub")
print("=" * 60)

try:
    _existing = [f for f in _push_files if (BASE / f).exists()]
    _git("add", *_existing)
    _status = _git("status", "--porcelain")
    if not _status.stdout.strip():
        print("  No changes to commit — GitHub already up to date.")
    else:
        _msg = f"Update matchup predictor outputs ({datetime.date.today()})"
        _commit = _git("commit", "-m", _msg)
        if _commit.returncode != 0:
            print(f"  Commit failed: {_commit.stderr.strip()}")
        else:
            _push = _git("push")
            if _push.returncode == 0:
                print(f"  Pushed: {_msg}")
            else:
                print(f"  Push failed: {_push.stderr.strip()}")
except Exception as _e:
    print(f"  Git push skipped: {_e}")

# %%
