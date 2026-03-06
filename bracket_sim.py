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
# # 2025 NCAA Tournament Bracket Simulator
#
# **Approach:**
# - Loads the trained model artifacts saved by model_mm.py (LightGBM + isotonic calibration)
#   If the artifact file is missing, trains an equivalent model and saves it for next time.
# - Extracts tournament-entry features for all 68 teams directly from the 2025 tournament
#   game rows in master_dataset.xlsx — these are the most accurate end-of-season stats.
# - Precomputes win probabilities for all C(68,2)=2,278 possible matchups at each round's DayNum
# - Simulates the tournament 10,000 times including First Four
# - Validates R64 probabilities against predictions.xlsx (should match closely)
# - Outputs Excel with per-team advance probabilities for each round

# %%
# ---------------------------------------------------------------------------
# IMPORTS & CONSTANTS
# ---------------------------------------------------------------------------
import warnings
import itertools
import re
import numpy as np
import pandas as pd
import lightgbm as lgb
import joblib
from pathlib import Path
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import log_loss, accuracy_score
from sklearn.isotonic import IsotonicRegression

warnings.filterwarnings("ignore")

BASE                = Path("c:/Users/franc/OneDrive/Jupyter/Business/MM")
DATA_PATH           = BASE / "master_dataset.xlsx"
OUT_PATH            = BASE / "bracket_sim_2025.xlsx"
MODEL_ARTIFACT_PATH = BASE / "model_mm_artifacts.pkl"

RANDOM_STATE = 42
np.random.seed(RANDOM_STATE)

N_SIMS = 10_000
SEASON = 2025

# ------------------------------------------------------------------
# Fallback hyperparameters (used only if artifacts missing)
# ------------------------------------------------------------------
_FALLBACK_PARAMS = {
    "num_leaves":        35,
    "max_depth":         10,
    "learning_rate":     0.011054849169633365,
    "min_child_samples": 59,
    "min_child_weight":  0.014006691643780054,
    "min_split_gain":    0.8232323493174569,
    "subsample":         0.7283621471887743,
    "colsample_bytree":  0.9291146346935999,
    "reg_alpha":         0.00011037384829573256,
    "reg_lambda":        2.1688844922726213e-07,
    "extra_trees":       False,
}
N_SPLITS = 5

# ------------------------------------------------------------------
# Feature columns (must match model_mm.py exactly — 33 total)
# ------------------------------------------------------------------
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

SOS_COLS = [
    "elo_sos_diff",
]

CONTEXT_COLS = ["location", "DayNum"]

FEATURE_COLS = (
    ELO_COLS +
    RANK_DIFF_COLS +
    EFF_COLS +
    FORM_COLS +
    SOS_COLS +
    CONTEXT_COLS
)

assert len(FEATURE_COLS) == 33, "Feature drift detected — must be 33 features"

CAT_FEATURES = ["location"]

DERIVED_DIFFS = {
    "elo_trend_diff":    ("team1_elo_trend",    "team2_elo_trend"),
    "off_rtg_diff":      ("team1_avg_off_rtg",  "team2_avg_off_rtg"),
    "def_rtg_diff":      ("team1_avg_def_rtg",  "team2_avg_def_rtg"),
    "net_rtg_diff":      ("team1_avg_net_rtg",  "team2_avg_net_rtg"),
    "oreb_pct_diff":     ("team1_avg_oreb_pct", "team2_avg_oreb_pct"),
    "tov_pct_diff":      ("team1_avg_tov_pct",  "team2_avg_tov_pct"),
    "last5_Margin_diff": ("team1_last5_Margin", "team2_last5_Margin"),
    "elo_sos_diff":      ("team1_elo_sos",       "team2_elo_sos"),
}

# ------------------------------------------------------------------
# Split DayNum conventions (match your dataset exactly)
# ------------------------------------------------------------------
ROUND_DAYNUMS = {
    "0": [134, 135],   # First Four
    "1": [136, 137],   # Round of 64
    "2": [138, 139],   # Round of 32
    "3": [143, 144],   # Sweet 16
    "4": [145, 146],   # Elite 8
    "5": [152],        # Final Four
    "6": [154],        # National Championship
}

def round_daynum(round_key: str, slot_name: str) -> int:
    """
    Deterministically assign DayNum for a simulated matchup.
    If a round has two possible days, assign based on slot parity
    so results are stable across runs.
    """
    days = ROUND_DAYNUMS[str(round_key)]
    if len(days) == 1:
        return days[0]

    # Deterministic parity from slot name
    parity = sum(ord(c) for c in slot_name) % 2
    return days[parity]

# ------------------------------------------------------------------
# Output column mapping
# ------------------------------------------------------------------
ROUND_COL_MAP = {
    "0": "odds_to_r64",
    "1": "pct_R32",
    "2": "pct_S16",
    "3": "pct_E8",
    "4": "pct_F4",
    "5": "pct_Finals",
    "6": "pct_Champion",
}

def slot_round_key(slot_name: str) -> str:
    """Return '0' for First Four, '1'-'6' for R1-R6."""
    if slot_name.startswith("R") and len(slot_name) >= 2 and slot_name[1].isdigit():
        return slot_name[1]
    return "0"


# %%
# ---------------------------------------------------------------------------
# PHASE 1: LOAD DATA
# ---------------------------------------------------------------------------
print("=" * 70)
print("PHASE 1: LOAD DATA")
print("=" * 70)

# Load master dataset — prefer parquet (fast) over xlsx (slow with openpyxl)
_parquet_path = DATA_PATH.with_suffix(".parquet")
if _parquet_path.exists():
    df = pd.read_parquet(_parquet_path)
    print(f"Loading from parquet: {_parquet_path.name}")
else:
    df = pd.read_excel(DATA_PATH, engine="openpyxl")
    print(f"Loading from Excel (slow): {DATA_PATH.name}")

print(
    f"Loaded master_dataset: {df.shape[0]:,} rows x {df.shape[1]} cols  "
    f"(seasons {df.Season.min()}-{df.Season.max()})"
)

# Load team snapshot — post-last-game features; falls back to empty dict
# (bracket_sim will then fall back to the max-DayNum row approach)
_snap_path = BASE / "team_snapshot_2026.parquet"
if _snap_path.exists():
    _snap_df = pd.read_parquet(_snap_path)
    _snapshot = _snap_df.set_index("TeamID").to_dict("index")
    print(f"Loaded team snapshot: {len(_snapshot):,} teams  "
          f"(DayNum {_snap_df['Last_DayNum'].min()}–{_snap_df['Last_DayNum'].max()})")
else:
    _snapshot = {}
    print("WARNING: team_snapshot_2026.parquet not found — "
          "falling back to max-DayNum row for 2026 features")

def _feats_from_snap(tid):
    """Return feature dict for tid from the post-last-game snapshot."""
    s = _snapshot[tid]
    return dict(
        elo_last    = s["elo_last"],     elo_trend   = s["elo_trend"],
        avg_off_rtg = s["avg_off_rtg"],  avg_def_rtg = s["avg_def_rtg"],
        avg_net_rtg = s["avg_net_rtg"],  avg_oreb_pct= s["avg_oreb_pct"],
        avg_tov_pct = s["avg_tov_pct"],  last5_Margin= s["last5_Margin"],
        POM = s["POM"], MAS = s["MAS"],  MOR = s["MOR"],
        WLK = s["WLK"], BIH = s["BIH"], NET = s["NET"],
        elo_sos     = s["elo_sos"],
    )

# ------------------------------------------------------------------
# Compute derived diff features (must match training pipeline)
# ------------------------------------------------------------------
for col, (a, b) in DERIVED_DIFFS.items():
    df[col] = df[a] - df[b]

# ------------------------------------------------------------------
# Encode location exactly as done during training
# ------------------------------------------------------------------
le_loc_fresh = LabelEncoder()
df["location"] = le_loc_fresh.fit_transform(df["location"].astype(str))

LOC_ENCODING = dict(
    zip(
        le_loc_fresh.classes_,
        le_loc_fresh.transform(le_loc_fresh.classes_),
    )
)

LOC_NEUTRAL = int(le_loc_fresh.transform(["N"])[0])

print(f"Location encoding: {LOC_ENCODING}  (neutral={LOC_NEUTRAL})")


# %%
# ---------------------------------------------------------------------------
# PHASE 2: LOAD OR TRAIN MODEL
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("PHASE 2: LOAD OR TRAIN MODEL")
print("=" * 70)

if MODEL_ARTIFACT_PATH.exists():
    # ── Fast path: load canonical trained model ────────────────────────────
    arts        = joblib.load(MODEL_ARTIFACT_PATH)
    final_model = arts["final_model"]
    iso         = arts["iso"]
    n_trees     = arts.get("n_trees", None)

    # Ensure location encoding matches training
    if "le_loc" in arts:
        le_loc = arts["le_loc"]
        saved_encoding = dict(zip(le_loc.classes_,
                                  le_loc.transform(le_loc.classes_)))
        assert saved_encoding == LOC_ENCODING, \
            f"Location encoding mismatch: saved={saved_encoding} vs current={LOC_ENCODING}"
    else:
        le_loc = le_loc_fresh

    # Ensure feature columns identical to training
    if "feature_cols" in arts:
        assert list(arts["feature_cols"]) == list(FEATURE_COLS), \
            "Feature columns mismatch between artifacts and current script."

    print(f"Loaded pre-trained model from {MODEL_ARTIFACT_PATH}")
    print(f"  Saved params: {arts.get('best_params', 'N/A')}")
    if n_trees is not None:
        print(f"  n_trees: {n_trees}")

    # ── Sanity check on 2024 validation ────────────────────────────────────
    df_val_ck = df[df.Season == 2024].reset_index(drop=True)
    X_val_ck  = df_val_ck[FEATURE_COLS]
    y_val_ck  = df_val_ck["team1_won"]

    if n_trees:
        p_raw_ck = final_model.predict_proba(X_val_ck,
                                             num_iteration=n_trees)[:, 1]
    else:
        p_raw_ck = final_model.predict_proba(X_val_ck)[:, 1]

    p_cal_ck = iso.predict(p_raw_ck).clip(1e-7, 1 - 1e-7)

    ncaa_ck = (df_val_ck["game_type"] == "NCAA").values

    print(f"\n  Val 2024 — all  | log loss: {log_loss(y_val_ck, p_cal_ck):.5f}  "
          f"acc: {accuracy_score(y_val_ck, (p_cal_ck >= 0.5).astype(int))*100:.2f}%")

    if ncaa_ck.sum() >= 2:
        print(f"  Val 2024 — NCAA | log loss: "
              f"{log_loss(y_val_ck.values[ncaa_ck], p_cal_ck[ncaa_ck]):.5f}  "
              f"acc: {accuracy_score(y_val_ck.values[ncaa_ck], (p_cal_ck[ncaa_ck] >= 0.5).astype(int))*100:.2f}%")

else:
    # ── Fallback: train model with hardcoded best params ───────────────────
    print(f"  {MODEL_ARTIFACT_PATH.name} not found — training fallback model.")
    print("  Run model_mm.py first to generate the canonical artifact file.\n")

    df_train  = df[df.Season <= 2023].copy().reset_index(drop=True)
    df_val_fb = df[df.Season == 2024].copy().reset_index(drop=True)

    X_train   = df_train[FEATURE_COLS]
    y_train   = df_train["team1_won"]
    X_val_fb  = df_val_fb[FEATURE_COLS]
    y_val_fb  = df_val_fb["team1_won"]

    def _weights(d: pd.DataFrame) -> np.ndarray:
        gt = d["game_type"].values
        dn = d["DayNum"].values
        w  = np.ones(len(d))
        for gt_val, wt in WEIGHT_MAP.items():
            w[gt == gt_val] = wt
        w[(gt == "Regular") & (dn >= 100)] = 2.0
        return w

    weights_tr = _weights(df_train)

    final_model = lgb.LGBMClassifier(
        objective="binary",
        metric="binary_logloss",
        verbosity=-1,
        boosting_type="gbdt",
        subsample_freq=1,
        n_jobs=-1,
        random_state=RANDOM_STATE,
        n_estimators=2000,
        **_FALLBACK_PARAMS,
    )

    final_model.fit(
        X_train,
        y_train,
        sample_weight=weights_tr,
        eval_set=[(X_val_fb, y_val_fb)],
        callbacks=[
            lgb.early_stopping(100, verbose=False),
            lgb.log_evaluation(-1),
        ],
        categorical_feature=CAT_FEATURES,
    )

    n_trees = final_model.best_iteration_ or 500
    print(f"  Final model: {n_trees} trees (early-stop on val 2024)")

    # ── Time-consistent calibration (OOF-style, no shuffle leakage) ───────
    p_raw_train = final_model.predict_proba(X_train,
                                            num_iteration=n_trees)[:, 1]

    iso = IsotonicRegression(out_of_bounds="clip")
    iso.fit(p_raw_train, y_train.values)

    p_cal_train = iso.predict(p_raw_train).clip(1e-7, 1 - 1e-7)
    print(f"  Train log loss (calibrated): {log_loss(y_train, p_cal_train):.5f}")

    # Save artifacts
    joblib.dump({
        "final_model":  final_model,
        "iso":          iso,
        "le_loc":       le_loc_fresh,
        "n_trees":      n_trees,
        "best_params":  _FALLBACK_PARAMS,
        "feature_cols": FEATURE_COLS,
    }, MODEL_ARTIFACT_PATH)

    print(f"  Saved model artifacts -> {MODEL_ARTIFACT_PATH}")

# %%
# ---------------------------------------------------------------------------
# PHASE 3: EXTRACT TOURNAMENT-ENTRY FEATURES FOR ALL 68 TEAMS
#
# Feature extraction strategy (most accurate end-of-season stats):
#   - Direct seeds (60 teams): features from their R64 game row (DayNum 136/137).
#     These rows represent each team's cumulative stats going INTO R64, which
#     includes all regular-season AND conference-tournament games.
#   - First Four teams (8 teams): features from their FF game row (DayNum 134/135).
#     These represent stats going INTO the First Four game (end of conf. tournament).
#
# Both sets use the same principle: take the tournament game row for the team's
# FIRST tournament appearance, where the stored features are "all games before
# this one" — i.e., the team's full end-of-regular-season statistical profile.
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("PHASE 3: EXTRACT TOURNAMENT-ENTRY FEATURES")
print("=" * 70)

seeds_df = pd.read_csv(BASE / "MNCAATourneySeeds.csv")
slots_df = pd.read_csv(BASE / "MNCAATourneySlots.csv")
teams_df = pd.read_csv(BASE / "MTeams.csv")

s2025     = seeds_df[seeds_df.Season == SEASON].copy()
slots2025 = slots_df[slots_df.Season == SEASON].copy()

tournament_ids = sorted(s2025["TeamID"].tolist())
ff_seed_codes  = {r["Seed"] for _, r in s2025.iterrows()
                  if "a" in r["Seed"] or "b" in r["Seed"]}
ff_team_ids    = set(s2025[s2025["Seed"].isin(ff_seed_codes)]["TeamID"])
direct_ids     = set(tournament_ids) - ff_team_ids

print(f"Tournament teams: {len(tournament_ids)}  "
      f"({len(direct_ids)} direct seeds, {len(ff_team_ids)} First Four)")

df_season = df[df.Season == SEASON].copy()

# Game rows by round
ff_rows  = df_season[df_season.DayNum.isin([134, 135]) & (df_season.game_type == "NCAA")]
r64_rows = df_season[df_season.DayNum.isin([136, 137]) & (df_season.game_type == "NCAA")]

# Lookup: (team_id_lo, team_id_hi) -> actual DayNum for each R64 game.
# Used in Phase 6 so the simulation uses the same DayNum (136 or 137) as
# predictions.xlsx for every R64 matchup, eliminating the ~2% discrepancy
# that arises when DayNum is a model feature.
r64_daynum_by_pair: dict[tuple[int, int], int] = {
    (min(int(r["team1_id"]), int(r["team2_id"])),
     max(int(r["team1_id"]), int(r["team2_id"]))): int(r["DayNum"])
    for _, r in r64_rows.iterrows()
}

print(f"First Four rows in dataset : {len(ff_rows)}   (DayNum 134/135)")
print(f"R64 rows in dataset        : {len(r64_rows)}  (DayNum 136/137)")


def _extract(row: pd.Series, side: str) -> dict:
    """Pull per-team features from one side ('team1' or 'team2') of a game row."""
    p = side + "_"
    return dict(
        elo_last    = row[p + "elo_last"],
        elo_trend   = row[p + "elo_trend"],
        avg_off_rtg = row[p + "avg_off_rtg"],
        avg_def_rtg = row[p + "avg_def_rtg"],
        avg_net_rtg = row[p + "avg_net_rtg"],
        avg_oreb_pct= row[p + "avg_oreb_pct"],
        avg_tov_pct = row[p + "avg_tov_pct"],
        last5_Margin= row[p + "last5_Margin"],
        POM         = row[p + "POM"],
        MAS         = row[p + "MAS"],
        MOR         = row[p + "MOR"],
        WLK         = row[p + "WLK"],
        BIH         = row[p + "BIH"],
        NET         = row[p + "NET"],
        elo_sos     = row[p + "elo_sos"],
    )


# ── First tournament appearance row for ALL 68 teams ─────────────────────────
# Stats stored in each row are "going into" that game, so the first NCAA
# game row for each team captures every pre-tournament result (regular season
# + conf-tourney championship) but nothing from the tournament itself.
#   - Direct seeds   : first appearance = R64 row (DayNum 136/137) ✓
#   - First Four teams : first appearance = FF row  (DayNum 134/135) ✓
# Iterating ascending and only writing on FIRST encounter (first-appearance wins)
# mirrors model_mm.py build_pretournament_snapshot exactly.
team_feats: dict[int, dict] = {}
tournament_id_set = set(tournament_ids)
ncaa_rows = df_season[df_season["game_type"] == "NCAA"].sort_values("DayNum")
for _, row in ncaa_rows.iterrows():
    for side, id_col in [("team1", "team1_id"), ("team2", "team2_id")]:
        tid = int(row[id_col])
        if tid in tournament_id_set and tid not in team_feats:
            team_feats[tid] = _extract(row, side)   # first appearance wins

missing = [tid for tid in tournament_ids if tid not in team_feats]
if missing:
    raise RuntimeError(f"No first-tournament-game row found for teams: {missing}")

print(f"Features extracted for all {len(team_feats)} tournament teams.")

# %%
# ---------------------------------------------------------------------------
# PHASE 4: BUILD BRACKET STRUCTURE
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("PHASE 4: BUILD BRACKET STRUCTURE")
print("=" * 70)

# Map ALL seed codes -> TeamID (including W16a/W16b etc.)
seed_map = {
    row["Seed"]: int(row["TeamID"])
    for _, row in s2025.iterrows()
}

# Build slot list sorted by round:
# First Four (0) < R1 (1) < ... < R6 (6)
all_slots = [
    (
        int(slot_round_key(r["Slot"])),  # round number
        r["Slot"],                       # slot name
        r["StrongSeed"],                 # strong seed ref
        r["WeakSeed"],                   # weak seed ref
    )
    for _, r in slots2025.iterrows()
]

all_slots.sort(key=lambda x: (x[0], x[1]))

# Lookup: slot -> round key
slot_round_lookup = {
    s[1]: str(s[0])
    for s in all_slots
}

# IMPORTANT:
# DayNum is now determined dynamically during simulation
# using round_daynum(round_key, slot_name)
# (no static slot_daynum_lookup anymore)

# Final ordered slot list
sorted_slots = [
    (s[1], s[2], s[3])
    for s in all_slots
]

print(f"Total slots: {len(all_slots)}")

for rnd_int in range(7):
    rnd_slots = [s for s in all_slots if s[0] == rnd_int]

    label = {
        0: "First Four",
        1: "R1 (R64)",
        2: "R2 (R32)",
        3: "R3 (S16)",
        4: "R4 (E8)",
        5: "R5 (F4)",
        6: "R6 (Champ)",
    }[rnd_int]

    if rnd_slots:
        print(f"  {label}: {len(rnd_slots)} games")

# %%
# ---------------------------------------------------------------------------
# PHASE 5: PRECOMPUTE WIN PROBABILITIES FOR ALL MATCHUPS
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("PHASE 5: PRECOMPUTE WIN PROBABILITIES")
print("=" * 70)

# Include ALL possible tournament DayNums:
# First Four: 134,135
# R64:        136,137
# R32:        138,139
# Sweet 16:   143,144
# Elite 8:    145,146
# Final Four: 152
# Champ:      154
DAYNUMS = [134, 135, 136, 137, 138, 139, 143, 144, 145, 146, 152, 154]

pairs = list(itertools.combinations(sorted(tournament_ids), 2))

print(f"Building feature matrix: {len(pairs):,} pairs × {len(DAYNUMS)} DayNums "
      f"= {len(pairs)*len(DAYNUMS):,} rows ...")

matchup_rows = []
matchup_keys = []

for t1_id, t2_id in pairs:
    f1 = team_feats[t1_id]
    f2 = team_feats[t2_id]

    for dn in DAYNUMS:
        matchup_rows.append({
            "team1_elo_last":  f1["elo_last"],
            "team2_elo_last":  f2["elo_last"],
            "elo_diff":        f1["elo_last"]   - f2["elo_last"],
            "team1_elo_trend": f1["elo_trend"],
            "team2_elo_trend": f2["elo_trend"],
            "elo_trend_diff":  f1["elo_trend"]  - f2["elo_trend"],
            "rankdiff_POM":    f1["POM"] - f2["POM"],
            "rankdiff_MAS":    f1["MAS"] - f2["MAS"],
            "rankdiff_MOR":    f1["MOR"] - f2["MOR"],
            "rankdiff_WLK":    f1["WLK"] - f2["WLK"],
            "rankdiff_BIH":    f1["BIH"] - f2["BIH"],
            "rankdiff_NET":    f1["NET"] - f2["NET"],
            "team1_avg_off_rtg":  f1["avg_off_rtg"],
            "team2_avg_off_rtg":  f2["avg_off_rtg"],
            "off_rtg_diff":       f1["avg_off_rtg"] - f2["avg_off_rtg"],
            "team1_avg_def_rtg":  f1["avg_def_rtg"],
            "team2_avg_def_rtg":  f2["avg_def_rtg"],
            "def_rtg_diff":       f1["avg_def_rtg"] - f2["avg_def_rtg"],
            "team1_avg_net_rtg":  f1["avg_net_rtg"],
            "team2_avg_net_rtg":  f2["avg_net_rtg"],
            "net_rtg_diff":       f1["avg_net_rtg"] - f2["avg_net_rtg"],
            "team1_avg_oreb_pct": f1["avg_oreb_pct"],
            "team2_avg_oreb_pct": f2["avg_oreb_pct"],
            "oreb_pct_diff":      f1["avg_oreb_pct"] - f2["avg_oreb_pct"],
            "team1_avg_tov_pct":  f1["avg_tov_pct"],
            "team2_avg_tov_pct":  f2["avg_tov_pct"],
            "tov_pct_diff":       f1["avg_tov_pct"] - f2["avg_tov_pct"],
            "team1_last5_Margin": f1["last5_Margin"],
            "team2_last5_Margin": f2["last5_Margin"],
            "last5_Margin_diff":  f1["last5_Margin"] - f2["last5_Margin"],
            "team1_elo_sos":      f1["elo_sos"],
            "team2_elo_sos":      f2["elo_sos"],
            "elo_sos_diff":       f1["elo_sos"]      - f2["elo_sos"],
            "location": LOC_NEUTRAL,
            "DayNum":   dn,
        })

        matchup_keys.append((t1_id, t2_id, dn))

X_matchups = pd.DataFrame(matchup_rows)[FEATURE_COLS]

# Use exact tree count from training
if n_trees:
    p_raw_all = final_model.predict_proba(
        X_matchups, num_iteration=n_trees
    )[:, 1]
else:
    p_raw_all = final_model.predict_proba(X_matchups)[:, 1]

p_cal_all = iso.predict(p_raw_all).clip(1e-7, 1 - 1e-7)

win_prob = {
    key: float(p)
    for key, p in zip(matchup_keys, p_cal_all)
}

print(f"Computed {len(win_prob):,} win probabilities.")
print(f"Prob range: [{p_cal_all.min():.3f}, {p_cal_all.max():.3f}]  mean={p_cal_all.mean():.3f}")

# %%
# ---------------------------------------------------------------------------
# PHASE 5b: VALIDATE R64 PROBABILITIES AGAINST predictions.xlsx
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("PHASE 5b: R64 VALIDATION vs predictions.xlsx")
print("=" * 70)

_pred_path  = BASE / "predictions.xlsx"
df_r64_cmp  = pd.DataFrame()
_preds_loaded = False

if _pred_path.exists():
    try:
        _preds = pd.read_excel(_pred_path, sheet_name="test_2025")
        _preds_loaded = True
    except PermissionError:
        print("  predictions.xlsx is locked — close it and rerun.")

if _preds_loaded:

    _r64 = _preds[
        (_preds["game_type"] == "NCAA") &
        (_preds["DayNum"].isin([136, 137]))
    ].copy()

    # Safer name mapping
    _name_to_id = {
        str(name).strip(): int(tid)
        for name, tid in zip(teams_df["TeamName"], teams_df["TeamID"])
    }

    diffs = []

    for _, row in _r64.iterrows():
        t1_name = str(row["team1_name"]).strip()
        t2_name = str(row["team2_name"]).strip()

        t1_id = _name_to_id.get(t1_name)
        t2_id = _name_to_id.get(t2_name)

        if t1_id is None or t2_id is None:
            continue

        # enforce (lo, hi) ordering
        if t1_id < t2_id:
            lo, hi = t1_id, t2_id
            p_pred_lo = float(row["prob_calibrated"])
        else:
            lo, hi = t2_id, t1_id
            p_pred_lo = 1.0 - float(row["prob_calibrated"])

        dn = int(row["DayNum"])

        p_sim = win_prob.get((lo, hi, dn))

        if p_sim is None:
            raise RuntimeError(
                f"Missing probability for ({lo},{hi}) DayNum={dn}"
            )

        diff = abs(p_sim - p_pred_lo)

        diffs.append({
            "team1": t1_name,
            "team2": t2_name,
            "DayNum": dn,
            "p_predictions_xlsx": round(p_pred_lo, 4),
            "p_bracket_sim": round(p_sim, 4),
            "abs_diff": round(diff, 4),
            "signed_diff": round(p_sim - p_pred_lo, 4),
        })

    df_r64_cmp = pd.DataFrame(diffs)

    if not df_r64_cmp.empty:
        n    = len(df_r64_cmp)
        mean = df_r64_cmp["abs_diff"].mean()
        std  = df_r64_cmp["abs_diff"].std(ddof=1)
        se   = std / np.sqrt(n)

        print(f"R64 games compared : {n}")
        print(f"  Mean abs diff    : {mean:.6f}")
        print(f"  Std dev          : {std:.6f}")
        print(f"  Std error (mean) : {se:.6f}")
        print(f"  Max abs diff     : {df_r64_cmp['abs_diff'].max():.6f}")
        print(f"  Games diff>0.005 : {(df_r64_cmp['abs_diff'] > 0.005).sum()}")

        print("\n  Top 5 absolute differences:")
        print(f"  {'Team 1':<25}  {'Team 2':<25}  {'preds.xlsx':>10}  {'sim':>10}  {'diff':>8}")
        print("  " + "-" * 85)

        for _, r in df_r64_cmp.sort_values("abs_diff", ascending=False).head(5).iterrows():
            print(f"  {r['team1']:<25}  {r['team2']:<25}  "
                  f"{r['p_predictions_xlsx']:>10.4f}  "
                  f"{r['p_bracket_sim']:>10.4f}  "
                  f"{r['abs_diff']:>8.4f}")
    else:
        print("  Could not match R64 rows — check name mapping.")

elif not _pred_path.exists():
    print(f"  predictions.xlsx not found at {_pred_path} — skipping validation.")

# %%
# ---------------------------------------------------------------------------
# PHASE 6: SIMULATE 10,000 TOURNAMENTS
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print(f"PHASE 6: SIMULATE TOURNAMENT  ({N_SIMS:,} iterations)")
print("=" * 70)

advance_counts: dict[int, dict[str, int]] = {
    tid: {rk: 0 for rk in ROUND_COL_MAP}
    for tid in tournament_ids
}

rng = np.random.default_rng(RANDOM_STATE)
all_randoms = rng.random((N_SIMS, len(sorted_slots)))

for sim in range(N_SIMS):

    # Initialize bracket with seed references
    slot_winners = dict(seed_map)

    for j, (slot_name, strong_ref, weak_ref) in enumerate(sorted_slots):

        team_a = slot_winners[strong_ref]
        team_b = slot_winners[weak_ref]

        # enforce (lo, hi) ordering for win_prob lookup
        if team_a < team_b:
            t1, t2 = team_a, team_b
        else:
            t1, t2 = team_b, team_a

        rk = slot_round_lookup[slot_name]

        # -------------------------------------------------------------
        # Determine DayNum
        # -------------------------------------------------------------
        if rk == "1":
            # R64 — try real tournament DayNum first
            dn = r64_daynum_by_pair.get((t1, t2))

            if dn is None:
                # Hypothetical pairing (e.g., alternate First Four winner)
                dn = round_daynum("1", slot_name)

        else:
            # All other rounds use canonical round-day split
            dn = round_daynum(rk, slot_name)

        # -------------------------------------------------------------
        # Lookup probability
        # -------------------------------------------------------------
        try:
            p_t1 = win_prob[(t1, t2, dn)]
        except KeyError:
            raise RuntimeError(f"Missing win_prob for {(t1, t2, dn)}")

        # Convert probability to team_a perspective
        p_a = p_t1 if team_a == t1 else 1.0 - p_t1

        # Simulate winner
        winner = team_a if all_randoms[sim, j] < p_a else team_b

        slot_winners[slot_name] = winner
        advance_counts[winner][rk] += 1

    if (sim + 1) % 2000 == 0:
        print(f"  {sim+1:,}/{N_SIMS:,} simulations complete ...")

print(f"\nAll {N_SIMS:,} simulations complete.")

# %%
# ---------------------------------------------------------------------------
# BUILD & SAVE ALL-MATCHUP WIN PROBABILITY LOOKUP TABLE
# ---------------------------------------------------------------------------
print("\nBuilding matchup probability lookup table ...")

MATCHUP_PROB_PATH = BASE / "matchup_probs_2025.xlsx"

# Ensure required mappings exist (self-contained)
tid_to_name = dict(zip(teams_df["TeamID"], teams_df["TeamName"]))
seed_info   = {int(r["TeamID"]): r["Seed"] for _, r in s2025.iterrows()}

# Full round -> DayNum mapping (split days included)
ROUND_DAYNUM_MAP = {
    "0": [134, 135],        # First Four
    "1": [136, 137],        # R64
    "2": [138, 139],        # R32
    "3": [143, 144],        # Sweet 16
    "4": [145, 146],        # Elite 8
    "5": [152],             # Final Four
    "6": [154],             # Championship
}

ROUND_LABEL_MAP = {
    "0": "FF",
    "1": "R64",
    "2": "R32",
    "3": "S16",
    "4": "E8",
    "5": "F4",
    "6": "Finals",
}

matchup_rows = []

for t1_id, t2_id in pairs:   # pairs already defined earlier (t1_id < t2_id)

    row = {
        "team1_id":   t1_id,
        "team1_name": tid_to_name.get(t1_id, str(t1_id)),
        "team1_seed": seed_info.get(t1_id, ""),
        "team2_id":   t2_id,
        "team2_name": tid_to_name.get(t2_id, str(t2_id)),
        "team2_seed": seed_info.get(t2_id, ""),
    }

    for rk, dn_list in ROUND_DAYNUM_MAP.items():

        round_label = ROUND_LABEL_MAP[rk]

        for dn in dn_list:

            col1 = f"prob_team1_wins_{round_label}_D{dn}"
            col2 = f"prob_team2_wins_{round_label}_D{dn}"

            p = win_prob.get((t1_id, t2_id, dn))

            if p is not None:
                row[col1] = round(p, 6)
                row[col2] = round(1.0 - p, 6)
            else:
                row[col1] = None
                row[col2] = None

    matchup_rows.append(row)

df_matchups = pd.DataFrame(matchup_rows)

try:
    df_matchups.to_excel(MATCHUP_PROB_PATH, index=False)
    print(f"Saved: {MATCHUP_PROB_PATH}  "
          f"({len(df_matchups):,} matchups x {len(df_matchups.columns)} cols)")
except PermissionError:
    fb2 = MATCHUP_PROB_PATH.with_name("matchup_probs_2025_new.xlsx")
    df_matchups.to_excel(fb2, index=False)
    print(f"Saved (fallback — close Excel): {fb2}")

print("Done!")

# %%
# ---------------------------------------------------------------------------
# NEW BLOCK: BUILD 2025_bracket_preds DATASET
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("BUILDING 2025_bracket_preds")
print("=" * 70)

BRACKET_PREDS_PATH = BASE / "2025_bracket_preds.xlsx"

tid_to_name = dict(zip(teams_df["TeamID"], teams_df["TeamName"]))

rows = []

for _, seed_row in s2025.iterrows():
    tid       = int(seed_row["TeamID"])
    seed_code = seed_row["Seed"]
    region    = seed_code[0]
    seed_num  = seed_code[1:]
    is_ff     = ("a" in seed_num or "b" in seed_num)

    counts = advance_counts[tid]

    rows.append({
        "TeamID":        tid,
        "TeamName":      tid_to_name.get(tid, str(tid)),
        "Region":        region,
        "Seed":          seed_num,
        "Is_FirstFour":  is_ff,

        # Advancement probabilities
        "pct_R64":       round(counts["0"] / N_SIMS * 100, 1) if is_ff else 100.0,
        "pct_R32":       round(counts["1"] / N_SIMS * 100, 1),
        "pct_S16":       round(counts["2"] / N_SIMS * 100, 1),
        "pct_E8":        round(counts["3"] / N_SIMS * 100, 1),
        "pct_F4":        round(counts["4"] / N_SIMS * 100, 1),
        "pct_Finals":    round(counts["5"] / N_SIMS * 100, 1),
        "pct_Champion":  round(counts["6"] / N_SIMS * 100, 1),
    })

df_2025_preds = pd.DataFrame(rows)

# Sort by region then numeric seed order
def _seed_sort(seed):
    if "a" in seed:
        return float(seed.replace("a", ".1"))
    if "b" in seed:
        return float(seed.replace("b", ".2"))
    return float(seed.lstrip("0") or "0")

df_2025_preds["_seed_sort"] = df_2025_preds["Seed"].apply(_seed_sort)
df_2025_preds = (
    df_2025_preds
    .sort_values(["Region", "_seed_sort"])
    .drop(columns="_seed_sort")
    .reset_index(drop=True)
)

# Sanity check: champion column sums to ~100
champ_sum = df_2025_preds["pct_Champion"].sum()
print(f"Champion % sum: {champ_sum:.1f}%  (expected ~100%)")

# Save
try:
    df_2025_preds.to_excel(BRACKET_PREDS_PATH, index=False)
    print(f"Saved -> {BRACKET_PREDS_PATH}  "
          f"({len(df_2025_preds)} teams)")
except PermissionError:
    fb = BRACKET_PREDS_PATH.with_name("2025_bracket_preds_new.xlsx")
    df_2025_preds.to_excel(fb, index=False)
    print(f"Saved (fallback — close Excel): {fb}")

# %%

# %% [markdown]
# ## 2026 NCAA Tournament Bracket Projection
#
# **Teams:** Loaded from `ProjectedBrackets.xlsx` (NCAA tab) — 68-team projected bracket.
# **Feature source:** Each team's last regular-season game row in `master_dataset.xlsx` (through Mar 1 2026).
# **Model:** Same LightGBM + isotonic calibration artifacts as 2025.
# **Bracket:** Built dynamically from `ProjectedBrackets.xlsx`; slot structure auto-detected from First Four pairs.
# **Final Four pairings:** East vs South · Midwest vs West.
# **Outputs:** `matchup_probs_2026.xlsx` · `2026_bracket_preds.xlsx`

# %%

# ===========================================================================
# 2026 — SETUP: SEED MAP + BRACKET SLOTS (loaded from ProjectedBrackets.xlsx)
# ===========================================================================
import itertools, re

SEASON_26          = 2026
N_SIMS_26          = 10_000
OUT_MATCHUP_26     = BASE / "matchup_probs_2026.xlsx"
OUT_PREDS_26       = BASE / "2026_bracket_preds.xlsx"

BRACKET_FILE_26    = BASE / "ProjectedBrackets.xlsx"
BRACKET_SHEET_26   = "NCAA"
# Final Four: which region pairs meet in the semis (order matters for Champ slot)
FF_REGION_PAIRS_26 = [("E", "S"), ("MW", "W")]   # East vs South · Midwest vs West

print("=" * 70)
print("2026 SETUP: SEED MAP + BRACKET SLOTS")
print("=" * 70)


def _build_bracket_26(bracket_file, sheet, f4_region_pairs):
    """Load SEED_MAP and SLOTS dynamically from ProjectedBrackets.xlsx."""
    # -- name -> TeamID lookup --------------------------------------------------
    sp = pd.read_csv(BASE / "MTeamSpellings.csv")
    spell2tid = dict(zip(sp["TeamNameSpelling"].str.lower().str.strip(),
                         sp["TeamID"]))

    # -- read bracket ----------------------------------------------------------
    raw = pd.read_excel(bracket_file, sheet_name=sheet, header=0)
    raw.columns = [c.strip() for c in raw.columns]
    raw = raw.dropna(subset=["Team", "Region", "Seed"])
    raw["Region"] = raw["Region"].str.strip()
    raw["Seed"]   = raw["Seed"].astype(str).str.strip().str.lower()
    raw["Team"]   = raw["Team"].str.strip()

    region_abbr = {"East": "E", "South": "S", "Midwest": "MW", "West": "W"}

    seed_map   = {}   # "E01" / "S16a" / etc. -> TeamID
    ff_seeds   = {}   # {"E": {11}, "S": {16}, "MW": {11, 16}, "W": set()}
    unresolved = []

    for _, row in raw.iterrows():
        team_name = row["Team"]
        reg       = region_abbr.get(row["Region"], row["Region"])
        seed_str  = row["Seed"]

        m = re.match(r"^0?(\d+)([ab]?)$", seed_str)
        if not m:
            print(f"  WARNING: unparseable seed {seed_str!r} for {team_name!r}")
            continue
        seed_num = int(m.group(1))
        suffix   = m.group(2)
        key      = f"{reg}{seed_num:02d}{suffix}"

        tid = spell2tid.get(team_name.lower().strip())
        if tid is None:
            unresolved.append((key, team_name))
        else:
            seed_map[key] = int(tid)
            if suffix:
                ff_seeds.setdefault(reg, set()).add(seed_num)

    if unresolved:
        print(f"  WARNING – {len(unresolved)} teams unresolved in MTeamSpellings:")
        for key, nm in unresolved:
            print(f"    {key}: {nm!r}")

    # -- build slots -----------------------------------------------------------
    R64_PAIRS = [(1,16),(8,9),(5,12),(4,13),(6,11),(3,14),(7,10),(2,15)]
    REGIONS   = ["E", "S", "MW", "W"]
    slots = []

    # First Four (round_key=0) — one slot per FF pair, sorted by seed number
    for reg in REGIONS:
        for seed in sorted(ff_seeds.get(reg, set())):
            ff_name = f"FF_{reg}{seed:02d}"
            slots.append((ff_name, f"{reg}{seed:02d}a", f"{reg}{seed:02d}b", 0))

    # R64 (round_key=1)
    for reg in REGIONS:
        reg_ff = ff_seeds.get(reg, set())
        for i, (strong, weak) in enumerate(R64_PAIRS, 1):
            s_ref = f"FF_{reg}{strong:02d}" if strong in reg_ff else f"{reg}{strong:02d}"
            w_ref = f"FF_{reg}{weak:02d}"   if weak   in reg_ff else f"{reg}{weak:02d}"
            slots.append((f"{reg}_R1_{i}", s_ref, w_ref, 1))

    # R32 (round_key=2)
    for reg in REGIONS:
        for i in range(1, 5):
            slots.append((f"{reg}_R2_{i}", f"{reg}_R1_{2*i-1}", f"{reg}_R1_{2*i}", 2))

    # Sweet 16 (round_key=3)
    for reg in REGIONS:
        for i in range(1, 3):
            slots.append((f"{reg}_R3_{i}", f"{reg}_R2_{2*i-1}", f"{reg}_R2_{2*i}", 3))

    # Elite 8 (round_key=4)
    for reg in REGIONS:
        slots.append((f"{reg}_R4", f"{reg}_R3_1", f"{reg}_R3_2", 4))

    # Final Four (round_key=5)
    f4_names = []
    for r1, r2 in f4_region_pairs:
        name = f"R5_{''.join([r1, r2])}"
        slots.append((name, f"{r1}_R4", f"{r2}_R4", 5))
        f4_names.append(name)

    # Championship (round_key=6)
    slots.append(("R6", f4_names[0], f4_names[1], 6))

    return seed_map, slots


SEED_MAP_26, SLOTS_26 = _build_bracket_26(
    BRACKET_FILE_26, BRACKET_SHEET_26, FF_REGION_PAIRS_26
)

tournament_ids_26 = sorted(set(SEED_MAP_26.values()))
ff_seed_codes_26  = {k for k in SEED_MAP_26 if "a" in k or "b" in k}
ff_team_ids_26    = {SEED_MAP_26[k] for k in ff_seed_codes_26}

assert len(tournament_ids_26) == 68, f"Expected 68, got {len(tournament_ids_26)}"
print(f"Teams: {len(tournament_ids_26)} total  "
      f"({len(ff_team_ids_26)} First Four, "
      f"{len(tournament_ids_26) - len(ff_team_ids_26)} direct seeds)")

assert len(SLOTS_26) == 67, f"Expected 67 slots, got {len(SLOTS_26)}"
slot_round_lookup_26 = {s[0]: str(s[3]) for s in SLOTS_26}
sorted_slots_26      = [(s[0], s[1], s[2]) for s in SLOTS_26]

for rk in range(7):
    n   = sum(1 for s in SLOTS_26 if s[3] == rk)
    lbl = {0:"FF",1:"R64",2:"R32",3:"S16",4:"E8",5:"F4",6:"Champ"}[rk]
    print(f"  Round {rk} ({lbl}): {n} games")

# ---------------------------------------------------------------------------
# 2026 PHASE A: EXTRACT TEAM FEATURES
# Uses post-last-game snapshot if available; falls back to max-DayNum row.
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("2026 PHASE A: EXTRACT TEAM FEATURES")
print("=" * 70)

df_26 = df[df.Season == SEASON_26].copy()
team_feats_26 = {}

for tid in tournament_ids_26:
    if tid in _snapshot:
        team_feats_26[tid] = _feats_from_snap(tid)
    else:
        # Fallback: max-DayNum row (pre-game features, one game stale)
        r1 = df_26[df_26["team1_id"] == tid]
        r2 = df_26[df_26["team2_id"] == tid]
        b1 = r1.loc[r1["DayNum"].idxmax()] if not r1.empty else None
        b2 = r2.loc[r2["DayNum"].idxmax()] if not r2.empty else None
        if   b1 is None and b2 is None:
            raise RuntimeError(f"No 2026 rows for TeamID={tid}")
        elif b1 is None:           team_feats_26[tid] = _extract(b2, "team2")
        elif b2 is None:           team_feats_26[tid] = _extract(b1, "team1")
        elif int(b1["DayNum"]) >= int(b2["DayNum"]): team_feats_26[tid] = _extract(b1, "team1")
        else:                      team_feats_26[tid] = _extract(b2, "team2")

last_days_26 = {}
for tid in tournament_ids_26:
    if tid in _snapshot:
        last_days_26[tid] = int(_snapshot[tid]["Last_DayNum"])
    else:
        last_days_26[tid] = int(pd.concat([
            df_26[df_26["team1_id"] == tid]["DayNum"],
            df_26[df_26["team2_id"] == tid]["DayNum"],
        ]).max())

snap_count = sum(1 for t in tournament_ids_26 if t in _snapshot)
dn_v = list(last_days_26.values())
print(f"Features extracted for {len(team_feats_26)} teams  "
      f"({snap_count} from snapshot, {len(team_feats_26)-snap_count} fallback).")
print(f"Last DayNum range: [{min(dn_v)}, {max(dn_v)}]")



# %%

# ---------------------------------------------------------------------------
# 2026 PHASE B: PRECOMPUTE WIN PROBABILITIES
# ---------------------------------------------------------------------------
print("=" * 70)
print("2026 PHASE B: PRECOMPUTE WIN PROBABILITIES")
print("=" * 70)

pairs_26        = list(itertools.combinations(sorted(tournament_ids_26), 2))
matchup_rows_26 = []
matchup_keys_26 = []

for t1_id, t2_id in pairs_26:
    f1, f2 = team_feats_26[t1_id], team_feats_26[t2_id]
    for dn in DAYNUMS:
        matchup_rows_26.append({
            "team1_elo_last":     f1["elo_last"],
            "team2_elo_last":     f2["elo_last"],
            "elo_diff":           f1["elo_last"]    - f2["elo_last"],
            "team1_elo_trend":    f1["elo_trend"],
            "team2_elo_trend":    f2["elo_trend"],
            "elo_trend_diff":     f1["elo_trend"]   - f2["elo_trend"],
            "rankdiff_POM":       f1["POM"]          - f2["POM"],
            "rankdiff_MAS":       f1["MAS"]          - f2["MAS"],
            "rankdiff_MOR":       f1["MOR"]          - f2["MOR"],
            "rankdiff_WLK":       f1["WLK"]          - f2["WLK"],
            "rankdiff_BIH":       f1["BIH"]          - f2["BIH"],
            "rankdiff_NET":       f1["NET"]          - f2["NET"],
            "team1_avg_off_rtg":  f1["avg_off_rtg"],
            "team2_avg_off_rtg":  f2["avg_off_rtg"],
            "off_rtg_diff":       f1["avg_off_rtg"]  - f2["avg_off_rtg"],
            "team1_avg_def_rtg":  f1["avg_def_rtg"],
            "team2_avg_def_rtg":  f2["avg_def_rtg"],
            "def_rtg_diff":       f1["avg_def_rtg"]  - f2["avg_def_rtg"],
            "team1_avg_net_rtg":  f1["avg_net_rtg"],
            "team2_avg_net_rtg":  f2["avg_net_rtg"],
            "net_rtg_diff":       f1["avg_net_rtg"]  - f2["avg_net_rtg"],
            "team1_avg_oreb_pct": f1["avg_oreb_pct"],
            "team2_avg_oreb_pct": f2["avg_oreb_pct"],
            "oreb_pct_diff":      f1["avg_oreb_pct"] - f2["avg_oreb_pct"],
            "team1_avg_tov_pct":  f1["avg_tov_pct"],
            "team2_avg_tov_pct":  f2["avg_tov_pct"],
            "tov_pct_diff":       f1["avg_tov_pct"]  - f2["avg_tov_pct"],
            "team1_last5_Margin": f1["last5_Margin"],
            "team2_last5_Margin": f2["last5_Margin"],
            "last5_Margin_diff":  f1["last5_Margin"] - f2["last5_Margin"],
            "team1_elo_sos":      f1["elo_sos"],
            "team2_elo_sos":      f2["elo_sos"],
            "elo_sos_diff":       f1["elo_sos"]      - f2["elo_sos"],
            "location": LOC_NEUTRAL,
            "DayNum":   dn,
        })
        matchup_keys_26.append((t1_id, t2_id, dn))

X_26 = pd.DataFrame(matchup_rows_26)[FEATURE_COLS]
p_raw_26 = (final_model.predict_proba(X_26, num_iteration=n_trees)[:, 1]
            if n_trees else final_model.predict_proba(X_26)[:, 1])
p_cal_26 = iso.predict(p_raw_26).clip(1e-7, 1 - 1e-7)
win_prob_26 = {k: float(p) for k, p in zip(matchup_keys_26, p_cal_26)}

print(f"Computed {len(win_prob_26):,} win probabilities.")
print(f"Range: [{p_cal_26.min():.3f}, {p_cal_26.max():.3f}]  mean={p_cal_26.mean():.3f}")

# ---------------------------------------------------------------------------
# 2026 PHASE C: SIMULATE 10,000 TOURNAMENTS
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print(f"2026 PHASE C: SIMULATE TOURNAMENT  ({N_SIMS_26:,} iterations)")
print("=" * 70)

advance_counts_26 = {
    tid: {rk: 0 for rk in ROUND_COL_MAP}
    for tid in tournament_ids_26
}

rng_26         = np.random.default_rng(RANDOM_STATE + 1)
all_randoms_26 = rng_26.random((N_SIMS_26, len(sorted_slots_26)))

for sim in range(N_SIMS_26):
    sw26 = dict(SEED_MAP_26)
    for j, (slot_name, strong_ref, weak_ref) in enumerate(sorted_slots_26):
        team_a = sw26[strong_ref]
        team_b = sw26[weak_ref]
        t1, t2 = (team_a, team_b) if team_a < team_b else (team_b, team_a)
        rk     = slot_round_lookup_26[slot_name]
        dn     = round_daynum(rk, slot_name)

        try:
            p_t1 = win_prob_26[(t1, t2, dn)]
        except KeyError:
            raise RuntimeError(f"Missing win_prob_26 for {(t1, t2, dn)}")

        p_a    = p_t1 if team_a == t1 else 1.0 - p_t1
        winner = team_a if all_randoms_26[sim, j] < p_a else team_b
        sw26[slot_name] = winner
        advance_counts_26[winner][rk] += 1

    if (sim + 1) % 2000 == 0:
        print(f"  {sim+1:,}/{N_SIMS_26:,} simulations complete ...")

print(f"\nAll {N_SIMS_26:,} simulations complete.")


# %%

# ---------------------------------------------------------------------------
# 2026 PHASE D: SAVE matchup_probs_2026.xlsx
# ---------------------------------------------------------------------------
print("=" * 70)
print("2026 PHASE D: SAVE MATCHUP PROBABILITIES")
print("=" * 70)

tid_to_name_26 = dict(zip(teams_df["TeamID"], teams_df["TeamName"]))
seed_info_26   = {tid: code for code, tid in SEED_MAP_26.items()}

matchup_rows_26_out = []
for t1_id, t2_id in pairs_26:
    row = {
        "team1_id":   t1_id,
        "team1_name": tid_to_name_26.get(t1_id, str(t1_id)),
        "team1_seed": seed_info_26.get(t1_id, ""),
        "team2_id":   t2_id,
        "team2_name": tid_to_name_26.get(t2_id, str(t2_id)),
        "team2_seed": seed_info_26.get(t2_id, ""),
    }
    for rk, dn_list in ROUND_DAYNUM_MAP.items():
        rl = ROUND_LABEL_MAP[rk]
        for dn in dn_list:
            p = win_prob_26.get((t1_id, t2_id, dn))
            row[f"prob_team1_wins_{rl}_D{dn}"] = round(p, 6) if p is not None else None
            row[f"prob_team2_wins_{rl}_D{dn}"] = round(1 - p, 6) if p is not None else None
    matchup_rows_26_out.append(row)

df_matchups_26 = pd.DataFrame(matchup_rows_26_out)
try:
    df_matchups_26.to_excel(OUT_MATCHUP_26, index=False)
    print(f"Saved -> {OUT_MATCHUP_26}  "
          f"({len(df_matchups_26):,} matchups x {len(df_matchups_26.columns)} cols)")
except PermissionError:
    fb = OUT_MATCHUP_26.with_name("matchup_probs_2026_new.xlsx")
    df_matchups_26.to_excel(fb, index=False)
    print(f"Saved (fallback — close Excel): {fb}")

# ---------------------------------------------------------------------------
# 2026 PHASE E: SAVE 2026_bracket_preds.xlsx
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("BUILDING 2026_bracket_preds")
print("=" * 70)

REGION_ORDER_26 = {"E": 0, "S": 1, "MW": 2, "W": 3}

def _region_seed_26(seed_code: str):
    """Return (region, seed_num) from a seed code like 'MW11a'."""
    for r in ("MW", "E", "S", "W"):
        if seed_code.startswith(r):
            return r, seed_code[len(r):]
    return seed_code[0], seed_code[1:]

def _seed_sort_26(seed_num: str) -> float:
    if "a" in seed_num: return float(seed_num.replace("a", ".1"))
    if "b" in seed_num: return float(seed_num.replace("b", ".2"))
    return float(seed_num.lstrip("0") or "0")

rows_26 = []
for seed_code, tid in SEED_MAP_26.items():
    reg26, snum26 = _region_seed_26(seed_code)
    is_ff26 = "a" in snum26 or "b" in snum26
    c = advance_counts_26[tid]
    rows_26.append({
        "TeamID":       tid,
        "TeamName":     tid_to_name_26.get(tid, str(tid)),
        "Region":       reg26,
        "Seed":         snum26,
        "Is_FirstFour": is_ff26,
        "pct_R64":      round(c["0"] / N_SIMS_26 * 100, 1) if is_ff26 else 100.0,
        "pct_R32":      round(c["1"] / N_SIMS_26 * 100, 1),
        "pct_S16":      round(c["2"] / N_SIMS_26 * 100, 1),
        "pct_E8":       round(c["3"] / N_SIMS_26 * 100, 1),
        "pct_F4":       round(c["4"] / N_SIMS_26 * 100, 1),
        "pct_Finals":   round(c["5"] / N_SIMS_26 * 100, 1),
        "pct_Champion": round(c["6"] / N_SIMS_26 * 100, 1),
    })

df_2026_preds = pd.DataFrame(rows_26)
df_2026_preds["_ro"] = df_2026_preds["Region"].map(REGION_ORDER_26)
df_2026_preds["_ss"] = df_2026_preds["Seed"].apply(_seed_sort_26)
df_2026_preds = (
    df_2026_preds.sort_values(["_ro", "_ss"])
    .drop(columns=["_ro", "_ss"])
    .reset_index(drop=True)
)

champ_sum_26 = df_2026_preds["pct_Champion"].sum()
print(f"Champion % sum: {champ_sum_26:.1f}%  (expected ~100%)")

print("\nTop 10 championship probabilities:")
top10_26 = df_2026_preds.nlargest(10, "pct_Champion")[
    ["TeamName", "Region", "Seed", "pct_Champion", "pct_F4", "pct_Finals"]
]
print(top10_26.to_string(index=False))

try:
    df_2026_preds.to_excel(OUT_PREDS_26, index=False)
    print(f"\nSaved -> {OUT_PREDS_26}  ({len(df_2026_preds)} teams)")
except PermissionError:
    fb = OUT_PREDS_26.with_name("2026_bracket_preds_new.xlsx")
    df_2026_preds.to_excel(fb, index=False)
    print(f"Saved (fallback — close Excel): {fb}")

# %%

# ---------------------------------------------------------------------------
# 2026 PHASE F: SAVE TEAM STATS SNAPSHOT
# All 68 teams' model input features (end-of-regular-season profile)
# ---------------------------------------------------------------------------
print("=" * 70)
print("2026 PHASE F: SAVE TEAM STATS SNAPSHOT")
print("=" * 70)

OUT_STATS_26 = BASE / "team_stats_2026.xlsx"

stats_rows = []
for seed_code, tid in SEED_MAP_26.items():
    reg26, snum26 = _region_seed_26(seed_code)
    f = team_feats_26[tid]
    stats_rows.append({
        "TeamID":         tid,
        "TeamName":       tid_to_name_26.get(tid, str(tid)),
        "Region":         reg26,
        "Seed":           snum26,
        "Is_FirstFour":   "a" in snum26 or "b" in snum26,
        "Last_DayNum":    last_days_26[tid],
        # Elo
        "elo_last":       round(f["elo_last"],   1),
        "elo_trend":      round(f["elo_trend"],  4),
        # Efficiency ratings
        "avg_off_rtg":    round(f["avg_off_rtg"],  2),
        "avg_def_rtg":    round(f["avg_def_rtg"],  2),
        "avg_net_rtg":    round(f["avg_net_rtg"],  2),
        # Possession stats
        "avg_oreb_pct":   round(f["avg_oreb_pct"], 4),
        "avg_tov_pct":    round(f["avg_tov_pct"],  4),
        # Recent form
        "last5_Margin":   round(f["last5_Margin"], 2),
        # Rankings (lower = better)
        "rank_POM":       int(f["POM"]),
        "rank_MAS":       int(f["MAS"]),
        "rank_MOR":       int(f["MOR"]),
        "rank_WLK":       int(f["WLK"]),
        "rank_BIH":       int(f["BIH"]),
        "rank_NET":       int(f["NET"]),
        # Schedule strength
        "elo_sos":        round(f["elo_sos"], 1),
    })

df_stats_26 = pd.DataFrame(stats_rows)
df_stats_26["_ro"] = df_stats_26["Region"].map({"E": 0, "S": 1, "MW": 2, "W": 3})
df_stats_26["_ss"] = df_stats_26["Seed"].apply(_seed_sort_26)
df_stats_26 = (
    df_stats_26.sort_values(["_ro", "_ss"])
    .drop(columns=["_ro", "_ss"])
    .reset_index(drop=True)
)

try:
    df_stats_26.to_excel(OUT_STATS_26, index=False)
    print(f"Saved -> {OUT_STATS_26}  ({len(df_stats_26)} teams x {len(df_stats_26.columns)} cols)")
except PermissionError:
    fb = OUT_STATS_26.with_name("team_stats_2026_new.xlsx")
    df_stats_26.to_excel(fb, index=False)
    print(f"Saved (fallback — close Excel): {fb}")

print("\nSnapshot (sorted by region/seed):")
print(df_stats_26[["TeamName","Region","Seed","elo_last","avg_net_rtg",
                    "last5_Margin","rank_NET","rank_POM"]].to_string(index=False))


# %%

# ===========================================================================
# CONFERENCE TOURNAMENT SIMULATIONS — SHARED SETUP
# ===========================================================================
# DayNum reference (DayZero = Nov 3, 2025; March 1 = DayNum 118):
#   March  5=122,  6=123,  7=124,  8=125,  9=126
#   March 10=127, 11=128, 12=129, 13=130, 14=131, 15=132

OUT_CONF         = BASE / "conf_tourney_preds_2026.xlsx"
OUT_CONF_STATS   = BASE / "conf_team_stats_2026.xlsx"
OUT_CONF_MATCHUP = BASE / "conf_matchup_probs_2026.xlsx"
N_SIMS_CONF      = 10_000

_sp_conf        = pd.read_csv(BASE / "MTeamSpellings.csv")
_spell2tid_conf = dict(zip(_sp_conf["TeamNameSpelling"].str.lower().str.strip(),
                           _sp_conf["TeamID"]))
# Augment with all 365 D1 canonical names from snapshot (fallback for any team
# not covered by MTeamSpellings.csv — does not overwrite existing entries)
_snap_path_conf = BASE / "team_snapshot_2026.parquet"
_snap_names_df  = (pd.read_parquet(_snap_path_conf) if _snap_path_conf.exists()
                   else pd.read_excel(BASE / "team_snapshot_2026.xlsx"))
for _, _r in _snap_names_df[["TeamID", "TeamName"]].drop_duplicates().iterrows():
    _key = str(_r["TeamName"]).lower().strip()
    if _key not in _spell2tid_conf:
        _spell2tid_conf[_key] = int(_r["TeamID"])


def _conf_seed_map(sheet):
    """Load {seed_str: TeamID} from a ProjectedBrackets.xlsx tab."""
    raw = pd.read_excel(BRACKET_FILE_26, sheet_name=sheet, header=0)
    raw.columns = [c.strip() for c in raw.columns]
    raw = raw.dropna(subset=["Team", "Seed"])
    raw["Team"] = raw["Team"].str.strip()
    raw["Seed"] = raw["Seed"].astype(str).str.strip()
    sm = {}
    unresolved = []
    for _, row in raw.iterrows():
        tid = _spell2tid_conf.get(row["Team"].lower().strip())
        if tid:
            sm[row["Seed"]] = int(tid)
        else:
            unresolved.append(f"  seed {row['Seed']}: {row['Team']!r}")
    if unresolved:
        raise ValueError(
            f"Unresolved teams in ProjectedBrackets.xlsx sheet {sheet!r} - "
            f"add spellings to MTeamSpellings.csv:\n" + "\n".join(unresolved)
        )
    return sm


def _conf_feats(seed_map):
    """
    Extract post-last-game features for every team in seed_map.
    Uses team_snapshot_2026 if available; falls back to max-DayNum row.
    """
    feats = {}
    for tid in set(seed_map.values()):
        if tid in _snapshot:
            feats[tid] = _feats_from_snap(tid)
            continue
        # Fallback: max-DayNum row (one game stale)
        r1 = df_26[df_26["team1_id"] == tid]
        r2 = df_26[df_26["team2_id"] == tid]
        b1 = r1.loc[r1["DayNum"].idxmax()] if not r1.empty else None
        b2 = r2.loc[r2["DayNum"].idxmax()] if not r2.empty else None
        if   b1 is None and b2 is None:
            raise RuntimeError(f"No 2026 rows for TeamID={tid}")
        elif b1 is None:
            feats[tid] = _extract(b2, "team2")
        elif b2 is None:
            feats[tid] = _extract(b1, "team1")
        elif int(b1["DayNum"]) >= int(b2["DayNum"]):
            feats[tid] = _extract(b1, "team1")
        else:
            feats[tid] = _extract(b2, "team2")
    return feats


def _conf_win_probs(team_feats, daynums):
    """Precompute calibrated win probs for all pairs × daynums."""
    tids = sorted(team_feats.keys())
    rows, keys = [], []
    for t1_id, t2_id in itertools.combinations(tids, 2):
        f1, f2 = team_feats[t1_id], team_feats[t2_id]
        for dn in daynums:
            rows.append({
                "team1_elo_last":     f1["elo_last"],
                "team2_elo_last":     f2["elo_last"],
                "elo_diff":           f1["elo_last"]     - f2["elo_last"],
                "team1_elo_trend":    f1["elo_trend"],
                "team2_elo_trend":    f2["elo_trend"],
                "elo_trend_diff":     f1["elo_trend"]    - f2["elo_trend"],
                "rankdiff_POM":       f1["POM"]           - f2["POM"],
                "rankdiff_MAS":       f1["MAS"]           - f2["MAS"],
                "rankdiff_MOR":       f1["MOR"]           - f2["MOR"],
                "rankdiff_WLK":       f1["WLK"]           - f2["WLK"],
                "rankdiff_BIH":       f1["BIH"]           - f2["BIH"],
                "rankdiff_NET":       f1["NET"]           - f2["NET"],
                "team1_avg_off_rtg":  f1["avg_off_rtg"],
                "team2_avg_off_rtg":  f2["avg_off_rtg"],
                "off_rtg_diff":       f1["avg_off_rtg"]  - f2["avg_off_rtg"],
                "team1_avg_def_rtg":  f1["avg_def_rtg"],
                "team2_avg_def_rtg":  f2["avg_def_rtg"],
                "def_rtg_diff":       f1["avg_def_rtg"]  - f2["avg_def_rtg"],
                "team1_avg_net_rtg":  f1["avg_net_rtg"],
                "team2_avg_net_rtg":  f2["avg_net_rtg"],
                "net_rtg_diff":       f1["avg_net_rtg"]  - f2["avg_net_rtg"],
                "team1_avg_oreb_pct": f1["avg_oreb_pct"],
                "team2_avg_oreb_pct": f2["avg_oreb_pct"],
                "oreb_pct_diff":      f1["avg_oreb_pct"] - f2["avg_oreb_pct"],
                "team1_avg_tov_pct":  f1["avg_tov_pct"],
                "team2_avg_tov_pct":  f2["avg_tov_pct"],
                "tov_pct_diff":       f1["avg_tov_pct"]  - f2["avg_tov_pct"],
                "team1_last5_Margin": f1["last5_Margin"],
                "team2_last5_Margin": f2["last5_Margin"],
                "last5_Margin_diff":  f1["last5_Margin"] - f2["last5_Margin"],
                "team1_elo_sos":      f1["elo_sos"],
                "team2_elo_sos":      f2["elo_sos"],
                "elo_sos_diff":       f1["elo_sos"]      - f2["elo_sos"],
                "location": LOC_NEUTRAL,
                "DayNum":   dn,
            })
            keys.append((t1_id, t2_id, dn))
    X     = pd.DataFrame(rows)[FEATURE_COLS]
    p_raw = (final_model.predict_proba(X, num_iteration=n_trees)[:, 1]
             if n_trees else final_model.predict_proba(X)[:, 1])
    p_cal = iso.predict(p_raw).clip(1e-7, 1 - 1e-7)
    return {k: float(p) for k, p in zip(keys, p_cal)}


_STAGE_ORDER = ["R1", "R2", "R3", "QF", "SF", "Final"]


def _conf_stats_df(seed_map, team_feats):
    """Build team stats DataFrame for one conference (mirrors team_stats_2026 format)."""
    tid2name = dict(zip(teams_df["TeamID"], teams_df["TeamName"]))
    rows = []
    for seed_str, tid in sorted(seed_map.items(), key=lambda x: int(x[0])):
        f = team_feats[tid]
        dn1 = df_26.loc[df_26["team1_id"] == tid, "DayNum"]
        dn2 = df_26.loc[df_26["team2_id"] == tid, "DayNum"]
        last_dn = int(max(dn1.max() if not dn1.empty else 0,
                          dn2.max() if not dn2.empty else 0))
        rows.append({
            "Seed":         int(seed_str),
            "TeamName":     tid2name.get(tid, str(tid)),
            "TeamID":       tid,
            "Last_DayNum":  last_dn,
            "elo_last":     round(f["elo_last"],    1),
            "elo_trend":    round(f["elo_trend"],   4),
            "avg_off_rtg":  round(f["avg_off_rtg"], 2),
            "avg_def_rtg":  round(f["avg_def_rtg"], 2),
            "avg_net_rtg":  round(f["avg_net_rtg"], 2),
            "avg_oreb_pct": round(f["avg_oreb_pct"],4),
            "avg_tov_pct":  round(f["avg_tov_pct"], 4),
            "last5_Margin": round(f["last5_Margin"],2),
            "rank_POM":     int(f["POM"]),
            "rank_MAS":     int(f["MAS"]),
            "rank_MOR":     int(f["MOR"]),
            "rank_WLK":     int(f["WLK"]),
            "rank_BIH":     int(f["BIH"]),
            "rank_NET":     int(f["NET"]),
            "elo_sos":      round(f["elo_sos"],     1),
        })
    return pd.DataFrame(rows)


def _conf_matchups_df(seed_map, slots, win_probs):
    """
    Build head-to-head matchup probability DataFrame for one conference.
    One row per team pair; one column pair per (stage, DayNum) in the bracket.
    win_probs keys: (min_tid, max_tid, daynum) -> p(min_tid wins).
    """
    tid2name    = dict(zip(teams_df["TeamID"], teams_df["TeamName"]))
    seed_by_tid = {v: k for k, v in seed_map.items()}
    tids        = sorted(seed_map.values())

    # Ordered (stage, daynum) pairs present in this conference
    stage_dn_pairs, seen = [], set()
    for _, _, _, dn, stage in slots:
        if (stage, dn) not in seen:
            stage_dn_pairs.append((stage, dn))
            seen.add((stage, dn))

    rows = []
    for t1_id, t2_id in itertools.combinations(tids, 2):   # t1_id < t2_id always
        row = {
            "team1_id":   t1_id,
            "team1_name": tid2name.get(t1_id, str(t1_id)),
            "team1_seed": int(seed_by_tid.get(t1_id, 0)),
            "team2_id":   t2_id,
            "team2_name": tid2name.get(t2_id, str(t2_id)),
            "team2_seed": int(seed_by_tid.get(t2_id, 0)),
        }
        for stage, dn in stage_dn_pairs:
            p = win_probs.get((t1_id, t2_id, dn))
            row[f"prob_team1_wins_{stage}_D{dn}"] = round(p,     6) if p is not None else None
            row[f"prob_team2_wins_{stage}_D{dn}"] = round(1 - p, 6) if p is not None else None
        rows.append(row)
    return pd.DataFrame(rows)


def _run_conf(conf_name, seed_map, slots, rng_seed, forced_winners=None):
    """
    Simulate a conference tournament N_SIMS_CONF times.

    slots: list of (slot_name, strong_ref, weak_ref, daynum, stage)
      - strong_ref / weak_ref: seed string ("1","12") or a prior slot_name
      - stage: "R1","R2","R3","QF","SF","Final"

    forced_winners: dict of {slot_name: seed_str} for games already played.
      The specified seed always wins that slot (both teams still count as appeared).

    Returns (df_adv, df_stats, df_matchups):
      df_adv      — advancement probabilities per team per round (100% for bye rounds)
      df_stats    — end-of-season model input features for each team
      df_matchups — head-to-head win probabilities for every pair × every round DayNum
    """
    print(f"\n{'='*60}")
    print(f"{conf_name}  ({N_SIMS_CONF:,} sims, {len(seed_map)} teams)")
    print(f"{'='*60}")

    team_feats = _conf_feats(seed_map)
    daynums    = sorted(set(s[3] for s in slots))
    win_probs  = _conf_win_probs(team_feats, daynums)
    team_ids   = list(seed_map.values())

    # Ordered list of stages actually present in this conference's bracket
    stages_present = [s for s in _STAGE_ORDER if any(sl[4] == s for sl in slots)]

    # Each team's entry stage = first slot where their seed_str appears directly
    seed_entry = {}
    for seed_str in seed_map:
        for slot_name, strong_ref, weak_ref, daynum, stage in slots:
            if strong_ref == seed_str or weak_ref == seed_str:
                seed_entry[seed_str] = stage
                break
    tid_entry = {seed_map[s]: seed_entry[s] for s in seed_map}

    # Track appearances per stage and championship wins
    appear    = {stage: {tid: 0 for tid in team_ids} for stage in stages_present}
    won_final = {tid: 0 for tid in team_ids}

    _forced = forced_winners or {}
    rng     = np.random.default_rng(rng_seed)
    randoms = rng.random((N_SIMS_CONF, len(slots)))

    for sim in range(N_SIMS_CONF):
        sw = dict(seed_map)
        for j, (slot_name, strong_ref, weak_ref, daynum, stage) in enumerate(slots):
            team_a = sw[strong_ref]
            team_b = sw[weak_ref]

            if stage in appear:
                appear[stage][team_a] += 1
                appear[stage][team_b] += 1

            if slot_name in _forced:
                winner = sw[_forced[slot_name]]
            else:
                t1, t2 = (team_a, team_b) if team_a < team_b else (team_b, team_a)
                p_t1   = win_probs[(t1, t2, daynum)]
                p_a    = p_t1 if team_a == t1 else 1.0 - p_t1
                winner = team_a if randoms[sim, j] < p_a else team_b
            sw[slot_name] = winner

            if stage == "Final":
                won_final[winner] += 1

    tid2name = dict(zip(teams_df["TeamID"], teams_df["TeamName"]))
    out_rows = []
    for seed_str, tid in sorted(seed_map.items(), key=lambda x: int(x[0])):
        entry_idx = _STAGE_ORDER.index(tid_entry[tid])
        row = {"Seed": int(seed_str), "TeamName": tid2name.get(tid, str(tid))}
        for stage in stages_present:
            stage_idx = _STAGE_ORDER.index(stage)
            if stage_idx < entry_idx:
                row[f"pct_{stage}"] = 100.0          # bye — guaranteed entry
            else:
                row[f"pct_{stage}"] = round(appear[stage][tid] / N_SIMS_CONF * 100, 1)
        row["pct_Champion"] = round(won_final[tid] / N_SIMS_CONF * 100, 1)
        out_rows.append(row)

    df_out     = pd.DataFrame(out_rows)
    df_stats   = _conf_stats_df(seed_map, team_feats)
    df_matchup = _conf_matchups_df(seed_map, slots, win_probs)

    champ_sum = df_out["pct_Champion"].sum()
    print(f"  Champion% sum: {champ_sum:.1f}%  (expected ~100%)")
    top3 = df_out.nlargest(3, "pct_Champion")[["TeamName", "Seed", "pct_Champion"]]
    print(top3.to_string(index=False))
    return df_out, df_stats, df_matchup


_conf_results         = {}   # key -> advancement pct DataFrame
_conf_stats_results   = {}   # key -> team stats DataFrame
_conf_matchup_results = {}   # key -> matchup probs DataFrame
print("Conference tournament helpers loaded.")
print(f"Outputs -> {OUT_CONF} | {OUT_CONF_STATS} | {OUT_CONF_MATCHUP}")

# %%

# ---------------------------------------------------------------------------
# CONFERENCE TOURNAMENT: Atlantic 10 (A10)
# 14 teams | R1 Mar 11 · R2 Mar 12 · QF Mar 13 · SF Mar 14 · Final Mar 15
# ---------------------------------------------------------------------------
_A10_sm = _conf_seed_map("A10")
_A10_SLOTS = [
    # First Round (DayNum 128)
    ("A10_R1_1", "12", "13",        128, "R1"),
    ("A10_R1_2", "11", "14",        128, "R1"),
    # Second Round (DayNum 129)
    ("A10_R2_1", "8",  "9",         129, "R2"),
    ("A10_R2_2", "7",  "10",        129, "R2"),
    ("A10_R2_3", "5",  "A10_R1_1", 129, "R2"),
    ("A10_R2_4", "6",  "A10_R1_2", 129, "R2"),
    # Quarterfinals (DayNum 130)
    ("A10_QF_1", "1",        "A10_R2_1", 130, "QF"),
    ("A10_QF_2", "4",        "A10_R2_3", 130, "QF"),
    ("A10_QF_3", "2",        "A10_R2_2", 130, "QF"),
    ("A10_QF_4", "3",        "A10_R2_4", 130, "QF"),
    # Semifinals (DayNum 131)
    ("A10_SF_1", "A10_QF_1", "A10_QF_2", 131, "SF"),
    ("A10_SF_2", "A10_QF_3", "A10_QF_4", 131, "SF"),
    # Championship (DayNum 132)
    ("A10_Final", "A10_SF_1", "A10_SF_2", 132, "Final"),
]
_conf_results["A10"], _conf_stats_results["A10"], _conf_matchup_results["A10"] = _run_conf("Atlantic 10", _A10_sm, _A10_SLOTS, rng_seed=200)

# %%

# ---------------------------------------------------------------------------
# CONFERENCE TOURNAMENT: ACC
# 15 teams | R1 Mar 10 · R2 Mar 11 · QF Mar 12 · SF Mar 13 · Final Mar 14
# ---------------------------------------------------------------------------
_ACC_sm = _conf_seed_map("ACC")
_ACC_SLOTS = [
    # First Round (DayNum 127)
    ("ACC_R1_1", "12", "13",        127, "R1"),
    ("ACC_R1_2", "11", "14",        127, "R1"),
    ("ACC_R1_3", "10", "15",        127, "R1"),
    # Second Round (DayNum 128)
    ("ACC_R2_1", "8",  "9",         128, "R2"),
    ("ACC_R2_2", "7",  "ACC_R1_3", 128, "R2"),
    ("ACC_R2_3", "5",  "ACC_R1_1", 128, "R2"),
    ("ACC_R2_4", "6",  "ACC_R1_2", 128, "R2"),
    # Quarterfinals (DayNum 129)
    ("ACC_QF_1", "1",        "ACC_R2_1", 129, "QF"),
    ("ACC_QF_2", "4",        "ACC_R2_3", 129, "QF"),
    ("ACC_QF_3", "2",        "ACC_R2_2", 129, "QF"),
    ("ACC_QF_4", "3",        "ACC_R2_4", 129, "QF"),
    # Semifinals (DayNum 130)
    ("ACC_SF_1", "ACC_QF_1", "ACC_QF_2", 130, "SF"),
    ("ACC_SF_2", "ACC_QF_3", "ACC_QF_4", 130, "SF"),
    # Championship (DayNum 131)
    ("ACC_Final", "ACC_SF_1", "ACC_SF_2", 131, "Final"),
]
_conf_results["ACC"], _conf_stats_results["ACC"], _conf_matchup_results["ACC"] = _run_conf("ACC", _ACC_sm, _ACC_SLOTS, rng_seed=201)

# %%

# ---------------------------------------------------------------------------
# CONFERENCE TOURNAMENT: Big 12
# 16 teams | R1 Mar 10 · R2 Mar 11 · QF Mar 12 · SF Mar 13 · Final Mar 14
# ---------------------------------------------------------------------------
_B12_sm = _conf_seed_map("Big12")
_B12_SLOTS = [
    # First Round (DayNum 127)
    ("B12_R1_1", "12", "13",       127, "R1"),
    ("B12_R1_2", "11", "14",       127, "R1"),
    ("B12_R1_3", "10", "15",       127, "R1"),
    ("B12_R1_4", "9",  "16",       127, "R1"),
    # Second Round (DayNum 128)
    ("B12_R2_1", "8",  "B12_R1_4", 128, "R2"),
    ("B12_R2_2", "7",  "B12_R1_3", 128, "R2"),
    ("B12_R2_3", "5",  "B12_R1_1", 128, "R2"),
    ("B12_R2_4", "6",  "B12_R1_2", 128, "R2"),
    # Quarterfinals (DayNum 129)
    ("B12_QF_1", "1",      "B12_R2_1", 129, "QF"),
    ("B12_QF_2", "4",      "B12_R2_3", 129, "QF"),
    ("B12_QF_3", "2",      "B12_R2_2", 129, "QF"),
    ("B12_QF_4", "3",      "B12_R2_4", 129, "QF"),
    # Semifinals (DayNum 130)
    ("B12_SF_1", "B12_QF_1", "B12_QF_2", 130, "SF"),
    ("B12_SF_2", "B12_QF_3", "B12_QF_4", 130, "SF"),
    # Championship (DayNum 131)
    ("B12_Final", "B12_SF_1", "B12_SF_2", 131, "Final"),
]
_conf_results["Big12"], _conf_stats_results["Big12"], _conf_matchup_results["Big12"] = _run_conf("Big 12", _B12_sm, _B12_SLOTS, rng_seed=202)

# %%

# ---------------------------------------------------------------------------
# CONFERENCE TOURNAMENT: Big East
# 11 teams | R1 Mar 11 · QF Mar 12 · SF Mar 13 · Final Mar 14
# Seeds 1-4 and 5 have first-round byes; 5 seed enters directly in QF
# ---------------------------------------------------------------------------
_BE_sm = _conf_seed_map("BigEast")
_BE_SLOTS = [
    # First Round (DayNum 128)
    ("BE_R1_1", "8", "9",        128, "R1"),
    ("BE_R1_2", "7", "10",       128, "R1"),
    ("BE_R1_3", "6", "11",       128, "R1"),
    # Quarterfinals (DayNum 129) — seeds 1-5 enter here
    ("BE_QF_1", "1",     "BE_R1_1", 129, "QF"),
    ("BE_QF_2", "4",     "5",       129, "QF"),
    ("BE_QF_3", "2",     "BE_R1_2", 129, "QF"),
    ("BE_QF_4", "3",     "BE_R1_3", 129, "QF"),
    # Semifinals (DayNum 130)
    ("BE_SF_1", "BE_QF_1", "BE_QF_2", 130, "SF"),
    ("BE_SF_2", "BE_QF_3", "BE_QF_4", 130, "SF"),
    # Championship (DayNum 131)
    ("BE_Final", "BE_SF_1", "BE_SF_2", 131, "Final"),
]
_conf_results["BigEast"], _conf_stats_results["BigEast"], _conf_matchup_results["BigEast"] = _run_conf("Big East", _BE_sm, _BE_SLOTS, rng_seed=203)

# %%

# ---------------------------------------------------------------------------
# CONFERENCE TOURNAMENT: Big Ten
# 18 teams | R1 Mar 10 · R2 Mar 11 · R3 Mar 12 · QF Mar 13 · SF Mar 14 · Final Mar 15
# ---------------------------------------------------------------------------
_BT_sm = _conf_seed_map("BigTen")
_BT_SLOTS = [
    # First Round (DayNum 127)
    ("BT_R1_1", "16", "17",       127, "R1"),
    ("BT_R1_2", "15", "18",       127, "R1"),
    # Second Round (DayNum 128)
    ("BT_R2_1", "9",  "BT_R1_1", 128, "R2"),
    ("BT_R2_2", "12", "13",        128, "R2"),
    ("BT_R2_3", "10", "BT_R1_2", 128, "R2"),
    ("BT_R2_4", "11", "14",        128, "R2"),
    # Third Round (DayNum 129)
    ("BT_R3_1", "8",  "BT_R2_1", 129, "R3"),
    ("BT_R3_2", "5",  "BT_R2_2", 129, "R3"),
    ("BT_R3_3", "7",  "BT_R2_3", 129, "R3"),
    ("BT_R3_4", "6",  "BT_R2_4", 129, "R3"),
    # Quarterfinals (DayNum 130)
    ("BT_QF_1", "1",     "BT_R3_1", 130, "QF"),
    ("BT_QF_2", "4",     "BT_R3_2", 130, "QF"),
    ("BT_QF_3", "2",     "BT_R3_3", 130, "QF"),
    ("BT_QF_4", "3",     "BT_R3_4", 130, "QF"),
    # Semifinals (DayNum 131)
    ("BT_SF_1", "BT_QF_1", "BT_QF_2", 131, "SF"),
    ("BT_SF_2", "BT_QF_3", "BT_QF_4", 131, "SF"),
    # Championship (DayNum 132)
    ("BT_Final", "BT_SF_1", "BT_SF_2", 132, "Final"),
]
_conf_results["BigTen"], _conf_stats_results["BigTen"], _conf_matchup_results["BigTen"] = _run_conf("Big Ten", _BT_sm, _BT_SLOTS, rng_seed=204)

# %%

# ---------------------------------------------------------------------------
# CONFERENCE TOURNAMENT: Mid-American (MAC)
# 8 teams | QF Mar 12 · SF Mar 13 · Final Mar 14
# ---------------------------------------------------------------------------
_MAC_sm = _conf_seed_map("MidAmerican")
_MAC_SLOTS = [
    # Quarterfinals (DayNum 129)
    ("MAC_QF_1", "1", "8",        129, "QF"),
    ("MAC_QF_2", "4", "5",        129, "QF"),
    ("MAC_QF_3", "2", "7",        129, "QF"),
    ("MAC_QF_4", "3", "6",        129, "QF"),
    # Semifinals (DayNum 130)
    ("MAC_SF_1", "MAC_QF_1", "MAC_QF_2", 130, "SF"),
    ("MAC_SF_2", "MAC_QF_3", "MAC_QF_4", 130, "SF"),
    # Championship (DayNum 131)
    ("MAC_Final", "MAC_SF_1", "MAC_SF_2", 131, "Final"),
]
_conf_results["MidAmerican"], _conf_stats_results["MidAmerican"], _conf_matchup_results["MidAmerican"] = _run_conf("Mid-American", _MAC_sm, _MAC_SLOTS, rng_seed=205)

# %%

# ---------------------------------------------------------------------------
# CONFERENCE TOURNAMENT: Missouri Valley (MVC)
# 11 teams | R1 Mar 5 · QF Mar 6 · SF Mar 7 · Final Mar 8
# Same bracket format as Big East
# ---------------------------------------------------------------------------
_MVC_sm = _conf_seed_map("MissouriValley")
_MVC_SLOTS = [
    # First Round (DayNum 122)
    ("MVC_R1_1", "8", "9",          122, "R1"),
    ("MVC_R1_2", "7", "10",         122, "R1"),
    ("MVC_R1_3", "6", "11",         122, "R1"),
    # Quarterfinals (DayNum 123)
    ("MVC_QF_1", "1",      "MVC_R1_1", 123, "QF"),
    ("MVC_QF_2", "4",      "5",        123, "QF"),
    ("MVC_QF_3", "2",      "MVC_R1_2", 123, "QF"),
    ("MVC_QF_4", "3",      "MVC_R1_3", 123, "QF"),
    # Semifinals (DayNum 124)
    ("MVC_SF_1", "MVC_QF_1", "MVC_QF_2", 124, "SF"),
    ("MVC_SF_2", "MVC_QF_3", "MVC_QF_4", 124, "SF"),
    # Championship (DayNum 125)
    ("MVC_Final", "MVC_SF_1", "MVC_SF_2", 125, "Final"),
]
# Actual R1 results (Mar 5): (9) Drake def (8) SIU; (7) Valparaiso def (1) Indiana State*;
# (6) Northern Iowa def (11) Evansville. *Indiana State seeded as "10" in our bracket (regular-season #1)
_MVC_forced = {"MVC_R1_1": "9", "MVC_R1_2": "7", "MVC_R1_3": "6"}
_conf_results["MissouriValley"], _conf_stats_results["MissouriValley"], _conf_matchup_results["MissouriValley"] = _run_conf("Missouri Valley", _MVC_sm, _MVC_SLOTS, rng_seed=206, forced_winners=_MVC_forced)

# %%

# ---------------------------------------------------------------------------
# CONFERENCE TOURNAMENT: Mountain West (MWC)
# 12 teams | R1 Mar 11 · QF Mar 12 · SF Mar 13 · Final Mar 14
# ---------------------------------------------------------------------------
_MWC_sm = _conf_seed_map("MountainWest")
_MWC_SLOTS = [
    # First Round (DayNum 128)
    ("MWC_R1_1", "8",  "9",         128, "R1"),
    ("MWC_R1_2", "5",  "12",        128, "R1"),
    ("MWC_R1_3", "7",  "10",        128, "R1"),
    ("MWC_R1_4", "6",  "11",        128, "R1"),
    # Quarterfinals (DayNum 129)
    ("MWC_QF_1", "1",      "MWC_R1_1", 129, "QF"),
    ("MWC_QF_2", "4",      "MWC_R1_2", 129, "QF"),
    ("MWC_QF_3", "2",      "MWC_R1_3", 129, "QF"),
    ("MWC_QF_4", "3",      "MWC_R1_4", 129, "QF"),
    # Semifinals (DayNum 130)
    ("MWC_SF_1", "MWC_QF_1", "MWC_QF_2", 130, "SF"),
    ("MWC_SF_2", "MWC_QF_3", "MWC_QF_4", 130, "SF"),
    # Championship (DayNum 131)
    ("MWC_Final", "MWC_SF_1", "MWC_SF_2", 131, "Final"),
]
_conf_results["MountainWest"], _conf_stats_results["MountainWest"], _conf_matchup_results["MountainWest"] = _run_conf("Mountain West", _MWC_sm, _MWC_SLOTS, rng_seed=207)

# %%

# ---------------------------------------------------------------------------
# CONFERENCE TOURNAMENT: SEC
# 16 teams | R1 Mar 11 · R2 Mar 12 · QF Mar 13 · SF Mar 14 · Final Mar 15
# Same bracket format as Big 12, one day later
# ---------------------------------------------------------------------------
_SEC_sm = _conf_seed_map("SEC")
_SEC_SLOTS = [
    # First Round (DayNum 128)
    ("SEC_R1_1", "12", "13",       128, "R1"),
    ("SEC_R1_2", "11", "14",       128, "R1"),
    ("SEC_R1_3", "10", "15",       128, "R1"),
    ("SEC_R1_4", "9",  "16",       128, "R1"),
    # Second Round (DayNum 129)
    ("SEC_R2_1", "8",  "SEC_R1_4", 129, "R2"),
    ("SEC_R2_2", "7",  "SEC_R1_3", 129, "R2"),
    ("SEC_R2_3", "5",  "SEC_R1_1", 129, "R2"),
    ("SEC_R2_4", "6",  "SEC_R1_2", 129, "R2"),
    # Quarterfinals (DayNum 130)
    ("SEC_QF_1", "1",      "SEC_R2_1", 130, "QF"),
    ("SEC_QF_2", "4",      "SEC_R2_3", 130, "QF"),
    ("SEC_QF_3", "2",      "SEC_R2_2", 130, "QF"),
    ("SEC_QF_4", "3",      "SEC_R2_4", 130, "QF"),
    # Semifinals (DayNum 131)
    ("SEC_SF_1", "SEC_QF_1", "SEC_QF_2", 131, "SF"),
    ("SEC_SF_2", "SEC_QF_3", "SEC_QF_4", 131, "SF"),
    # Championship (DayNum 132)
    ("SEC_Final", "SEC_SF_1", "SEC_SF_2", 132, "Final"),
]
_conf_results["SEC"], _conf_stats_results["SEC"], _conf_matchup_results["SEC"] = _run_conf("SEC", _SEC_sm, _SEC_SLOTS, rng_seed=208)

# %%

# ---------------------------------------------------------------------------
# CONFERENCE TOURNAMENT: West Coast Conference (WCC)
# 12 teams | 6 rounds: R1 Mar 5 · R2 Mar 6 · R3 Mar 7 · QF Mar 8 · SF Mar 9 · Final Mar 10
# Seeds 1-2 enter at SF; seeds 3-4 enter at QF; seeds 5-6 at R3; 7-8 at R2; 9-12 at R1
# ---------------------------------------------------------------------------
_WCC_sm = _conf_seed_map("WCC")
_WCC_SLOTS = [
    # First Round (DayNum 122)
    ("WCC_R1_1", "9",  "12",        122, "R1"),
    ("WCC_R1_2", "10", "11",        122, "R1"),
    # Second Round (DayNum 123)
    ("WCC_R2_1", "8",  "WCC_R1_1", 123, "R2"),
    ("WCC_R2_2", "7",  "WCC_R1_2", 123, "R2"),
    # Third Round (DayNum 124)
    ("WCC_R3_1", "5",  "WCC_R2_1", 124, "R3"),
    ("WCC_R3_2", "6",  "WCC_R2_2", 124, "R3"),
    # Quarterfinals (DayNum 125)
    ("WCC_QF_1", "4",  "WCC_R3_1", 125, "QF"),
    ("WCC_QF_2", "3",  "WCC_R3_2", 125, "QF"),
    # Semifinals (DayNum 126) — seeds 1-2 enter here
    ("WCC_SF_1", "1",       "WCC_QF_1", 126, "SF"),
    ("WCC_SF_2", "2",       "WCC_QF_2", 126, "SF"),
    # Championship (DayNum 127)
    ("WCC_Final", "WCC_SF_1", "WCC_SF_2", 127, "Final"),
]
# Actual R1 results (Mar 5): (9) Portland def (12) Pepperdine; (11) San Diego def (10) LMU
_WCC_forced = {"WCC_R1_1": "9", "WCC_R1_2": "11"}
_conf_results["WCC"], _conf_stats_results["WCC"], _conf_matchup_results["WCC"] = _run_conf("WCC", _WCC_sm, _WCC_SLOTS, rng_seed=209, forced_winners=_WCC_forced)

# %%

# ---------------------------------------------------------------------------
# SAVE ALL CONFERENCE TOURNAMENT RESULTS
# One sheet per conference in conf_tourney_preds_2026.xlsx
# ---------------------------------------------------------------------------
print("=" * 60)
print("SAVING CONFERENCE TOURNAMENT PREDICTIONS")
print("=" * 60)

_CONF_SHEET_NAMES = {
    "A10":            "Atlantic 10",
    "ACC":            "ACC",
    "Big12":          "Big 12",
    "BigEast":        "Big East",
    "BigTen":         "Big Ten",
    "MidAmerican":    "Mid-American",
    "MissouriValley": "Missouri Valley",
    "MountainWest":   "Mountain West",
    "SEC":            "SEC",
    "WCC":            "WCC",
}

def _write_conf_excel(path, result_dict, sheet_names):
    try:
        with pd.ExcelWriter(path, engine="openpyxl") as writer:
            for key, sheet_name in sheet_names.items():
                if key in result_dict:
                    result_dict[key].to_excel(writer, sheet_name=sheet_name, index=False)
        print(f"Saved -> {path}  ({len(result_dict)} sheets)")
    except PermissionError:
        fb = path.with_name(path.stem + "_new.xlsx")
        with pd.ExcelWriter(fb, engine="openpyxl") as writer:
            for key, sheet_name in sheet_names.items():
                if key in result_dict:
                    result_dict[key].to_excel(writer, sheet_name=sheet_name, index=False)
        print(f"Saved (fallback — close Excel): {fb}")

_write_conf_excel(OUT_CONF,         _conf_results,         _CONF_SHEET_NAMES)
_write_conf_excel(OUT_CONF_STATS,   _conf_stats_results,   _CONF_SHEET_NAMES)
_write_conf_excel(OUT_CONF_MATCHUP, _conf_matchup_results, _CONF_SHEET_NAMES)

# %%
# ---------------------------------------------------------------------------
# PHASE G: MODEL POWER RANKINGS (Markov Chain / PageRank)
#
# For every team in the 2026 snapshot we compute all C(n,2) pairwise win
# probabilities at DayNum=136 (neutral court), then find the stationary
# distribution of the column-normalised win-probability matrix via power
# iteration.
#
# Math:
#   P[i,j] = P(team i beats team j)   (P[i,i] = 0, P[i,j]+P[j,i] = 1)
#   M[i,j] = P[i,j] / sum_k P[k,j]   (column-normalised)
#   π = M @ π  ->  dominant eigenvector  (Perron-Frobenius guarantees uniqueness)
#
# Interpretation: team i's score = weighted sum of (prob i beats j) × (j's
# score), normalised by how hard j is to beat.  Beating a hard-to-beat team
# contributes more.  Power iteration resolves the circular dependency.
#
# Output columns:
#   MR_Rank      – 1 = best
#   MR_Score     – stationary prob × n  (mean = 1.0, best teams ≈ 2-4)
#   Exp_Wins_pct – unweighted expected win % vs all other teams  (sanity check)
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("PHASE G: MODEL POWER RANKINGS (Markov / PageRank)")
print("=" * 70)

_MR_DAYNUM   = 136          # neutral-site DayNum used for all matchups
_MR_MAX_ITER = 300          # power-iteration cap
_MR_TOL      = 1e-10        # convergence threshold (max |π_new - π|)

OUT_RANKINGS_26 = BASE / "model_rankings_2026.xlsx"

if not _snapshot:
    print("  Snapshot not loaded — skipping rankings (run build_mm_dataset first).")
else:
    # ── Team list (sorted for reproducibility) ─────────────────────────────
    _mr_tids = sorted(_snapshot.keys())
    _mr_n    = len(_mr_tids)
    _mr_idx  = {tid: i for i, tid in enumerate(_mr_tids)}
    print(f"  Teams in snapshot : {_mr_n}")
    print(f"  Pairs to evaluate : {_mr_n * (_mr_n - 1) // 2:,}")

    # ── Build all C(n,2) matchup rows ──────────────────────────────────────
    _mr_matchup_rows = []
    _mr_keys         = []   # list of (idx_a, idx_b) — a < b; stored prob = P(a beats b)

    for _ai in range(_mr_n):
        _tid_a = _mr_tids[_ai]
        _fa    = _feats_from_snap(_tid_a)
        for _bi in range(_ai + 1, _mr_n):
            _tid_b = _mr_tids[_bi]
            _fb    = _feats_from_snap(_tid_b)
            _mr_matchup_rows.append({
                "team1_elo_last":     _fa["elo_last"],
                "team2_elo_last":     _fb["elo_last"],
                "elo_diff":           _fa["elo_last"]     - _fb["elo_last"],
                "team1_elo_trend":    _fa["elo_trend"],
                "team2_elo_trend":    _fb["elo_trend"],
                "elo_trend_diff":     _fa["elo_trend"]    - _fb["elo_trend"],
                "rankdiff_POM":       _fa["POM"]          - _fb["POM"],
                "rankdiff_MAS":       _fa["MAS"]          - _fb["MAS"],
                "rankdiff_MOR":       _fa["MOR"]          - _fb["MOR"],
                "rankdiff_WLK":       _fa["WLK"]          - _fb["WLK"],
                "rankdiff_BIH":       _fa["BIH"]          - _fb["BIH"],
                "rankdiff_NET":       _fa["NET"]           - _fb["NET"],
                "team1_avg_off_rtg":  _fa["avg_off_rtg"],
                "team2_avg_off_rtg":  _fb["avg_off_rtg"],
                "off_rtg_diff":       _fa["avg_off_rtg"]  - _fb["avg_off_rtg"],
                "team1_avg_def_rtg":  _fa["avg_def_rtg"],
                "team2_avg_def_rtg":  _fb["avg_def_rtg"],
                "def_rtg_diff":       _fa["avg_def_rtg"]  - _fb["avg_def_rtg"],
                "team1_avg_net_rtg":  _fa["avg_net_rtg"],
                "team2_avg_net_rtg":  _fb["avg_net_rtg"],
                "net_rtg_diff":       _fa["avg_net_rtg"]  - _fb["avg_net_rtg"],
                "team1_avg_oreb_pct": _fa["avg_oreb_pct"],
                "team2_avg_oreb_pct": _fb["avg_oreb_pct"],
                "oreb_pct_diff":      _fa["avg_oreb_pct"] - _fb["avg_oreb_pct"],
                "team1_avg_tov_pct":  _fa["avg_tov_pct"],
                "team2_avg_tov_pct":  _fb["avg_tov_pct"],
                "tov_pct_diff":       _fa["avg_tov_pct"]  - _fb["avg_tov_pct"],
                "team1_last5_Margin": _fa["last5_Margin"],
                "team2_last5_Margin": _fb["last5_Margin"],
                "last5_Margin_diff":  _fa["last5_Margin"] - _fb["last5_Margin"],
                "team1_elo_sos":      _fa["elo_sos"],
                "team2_elo_sos":      _fb["elo_sos"],
                "elo_sos_diff":       _fa["elo_sos"]       - _fb["elo_sos"],
                "location":           LOC_NEUTRAL,
                "DayNum":             _MR_DAYNUM,
            })
            _mr_keys.append((_ai, _bi))

    # ── Model inference (single batched call) ──────────────────────────────
    _X_mr  = pd.DataFrame(_mr_matchup_rows)[FEATURE_COLS]
    _p_raw = (final_model.predict_proba(_X_mr, num_iteration=n_trees)[:, 1]
              if n_trees else final_model.predict_proba(_X_mr)[:, 1])
    _p_cal = iso.predict(_p_raw).clip(1e-7, 1 - 1e-7)
    print(f"  Model prob range  : [{_p_cal.min():.3f}, {_p_cal.max():.3f}]"
          f"  mean={_p_cal.mean():.3f}")

    # ── Build P matrix: P[i,j] = P(team i beats team j) ───────────────────
    _P = np.zeros((_mr_n, _mr_n))
    for (_ai, _bi), _p in zip(_mr_keys, _p_cal):
        _P[_ai, _bi] = float(_p)
        _P[_bi, _ai] = 1.0 - float(_p)

    # ── Column-normalise -> transition matrix M ─────────────────────────────
    # Column j sums to: "total probability mass of beating team j"
    # Dividing gives: P(team i is the one who beats team j | someone does)
    # Beating a hard-to-beat team (small column sum) yields more credit.
    _col_sums = _P.sum(axis=0)                      # always > 0 (probs clipped)
    _M        = _P / _col_sums[np.newaxis, :]

    # ── Power iteration: find π s.t. π = M @ π ────────────────────────────
    _pi = np.full(_mr_n, 1.0 / _mr_n)
    for _it in range(_MR_MAX_ITER):
        _pi_new = _M @ _pi
        _pi_new /= _pi_new.sum()
        if np.max(np.abs(_pi_new - _pi)) < _MR_TOL:
            print(f"  Converged in {_it + 1} iterations")
            break
        _pi = _pi_new
    else:
        print(f"  WARNING: did not converge in {_MR_MAX_ITER} iterations")
    _pi = _pi_new

    # ── Expected wins (unweighted, sanity check) ───────────────────────────
    _exp_wins = _P.sum(axis=1) / (_mr_n - 1)        # mean win prob vs all opponents

    # ── Build output DataFrame ─────────────────────────────────────────────
    _tid2name = dict(zip(teams_df["TeamID"], teams_df["TeamName"]))
    _mr_out   = []
    for _i, _tid in enumerate(_mr_tids):
        _s = _snapshot[_tid]
        _mr_out.append({
            "TeamID":        _tid,
            "TeamName":      _tid2name.get(_tid, str(_tid)),
            "Conf":          _s.get("Conf",         ""),
            "Last_DayNum":   _s.get("Last_DayNum",  ""),
            "N_games":       _s.get("N_games",       ""),
            "MR_Score":      round(float(_pi[_i]) * _mr_n, 4),  # scaled: mean = 1
            "Exp_Wins_pct":  round(float(_exp_wins[_i]) * 100, 2),
            "Elo":           round(float(_s["elo_last"]), 1),
            "NET":           int(_s["NET"]),
            "POM":           int(_s["POM"]),
            "MAS":           int(_s["MAS"]),
        })

    df_rankings_26 = (
        pd.DataFrame(_mr_out)
        .sort_values("MR_Score", ascending=False)
        .reset_index(drop=True)
    )
    df_rankings_26.insert(0, "MR_Rank", range(1, len(df_rankings_26) + 1))

    _top10_cols = ["MR_Rank", "TeamName", "Conf", "MR_Score",
                   "Exp_Wins_pct", "Elo", "NET", "POM"]
    print(f"\n  Top 10 teams:")
    print(df_rankings_26[_top10_cols].head(10).to_string(index=False))

    try:
        df_rankings_26.to_excel(OUT_RANKINGS_26, index=False)
        print(f"\nSaved -> {OUT_RANKINGS_26}  ({len(df_rankings_26)} teams)")
    except PermissionError:
        _fb = OUT_RANKINGS_26.with_name("model_rankings_2026_new.xlsx")
        df_rankings_26.to_excel(_fb, index=False)
        print(f"Saved (fallback — close Excel): {_fb}")

# %%
# ---------------------------------------------------------------------------
# ALL-D1 MATCHUP PREDICTOR
# Win probabilities for all C(365,2)=66,430 D1 pairs × 3 locations.
# Uses identical feature construction + predict pattern as the bracket sim.
# Output: matchup_predictor_2026.xlsx -> triggers GitHub Actions -> matchupPredictor.ts
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("ALL-D1 MATCHUP PREDICTOR")
print("=" * 70)

DAYNUM_PREDICTOR = 121       # current regular-season context (~Mar 4 2026)
OUT_PREDICTOR_26 = BASE / "matchup_predictor_2026.xlsx"

# Load all 365 D1 teams from snapshot (parquet preferred, xlsx fallback)
_pred_snap_path = BASE / "team_snapshot_2026.parquet"
if _pred_snap_path.exists():
    _pred_snap_df = pd.read_parquet(_pred_snap_path)
else:
    _pred_snap_df = pd.read_excel(BASE / "team_snapshot_2026.xlsx")

_pred_snap_df = _pred_snap_df.dropna(subset=["TeamID"]).copy()
_pred_snap_df["TeamID"] = _pred_snap_df["TeamID"].astype(int)
for _rc in ["POM", "MAS", "MOR", "WLK", "BIH", "NET"]:
    _pred_snap_df[_rc] = _pred_snap_df[_rc].fillna(400)
_pred_snap_df = _pred_snap_df.sort_values("TeamID").reset_index(drop=True)

_pred_teams = _pred_snap_df.to_dict("records")
_N_pred     = len(_pred_teams)
_pred_pairs = list(itertools.combinations(range(_N_pred), 2))

LOC_H = int(le_loc_fresh.transform(["H"])[0])   # team1 (lower ID) is home
LOC_A = int(le_loc_fresh.transform(["A"])[0])   # team1 away = team2 home

print(f"Teams: {_N_pred}  |  Pairs: {len(_pred_pairs):,}  |  Rows: {len(_pred_pairs)*3:,}")

_pred_rows = []
_pred_meta = []

for _pi, _pj in _pred_pairs:
    f1 = _pred_teams[_pi]
    f2 = _pred_teams[_pj]
    _base = dict(
        team1_elo_last    = f1["elo_last"],
        team2_elo_last    = f2["elo_last"],
        elo_diff          = f1["elo_last"]     - f2["elo_last"],
        team1_elo_trend   = f1["elo_trend"],
        team2_elo_trend   = f2["elo_trend"],
        elo_trend_diff    = f1["elo_trend"]    - f2["elo_trend"],
        rankdiff_POM      = f1["POM"]          - f2["POM"],
        rankdiff_MAS      = f1["MAS"]          - f2["MAS"],
        rankdiff_MOR      = f1["MOR"]          - f2["MOR"],
        rankdiff_WLK      = f1["WLK"]          - f2["WLK"],
        rankdiff_BIH      = f1["BIH"]          - f2["BIH"],
        rankdiff_NET      = f1["NET"]          - f2["NET"],
        team1_avg_off_rtg = f1["avg_off_rtg"],
        team2_avg_off_rtg = f2["avg_off_rtg"],
        off_rtg_diff      = f1["avg_off_rtg"]  - f2["avg_off_rtg"],
        team1_avg_def_rtg = f1["avg_def_rtg"],
        team2_avg_def_rtg = f2["avg_def_rtg"],
        def_rtg_diff      = f1["avg_def_rtg"]  - f2["avg_def_rtg"],
        team1_avg_net_rtg = f1["avg_net_rtg"],
        team2_avg_net_rtg = f2["avg_net_rtg"],
        net_rtg_diff      = f1["avg_net_rtg"]  - f2["avg_net_rtg"],
        team1_avg_oreb_pct= f1["avg_oreb_pct"],
        team2_avg_oreb_pct= f2["avg_oreb_pct"],
        oreb_pct_diff     = f1["avg_oreb_pct"] - f2["avg_oreb_pct"],
        team1_avg_tov_pct = f1["avg_tov_pct"],
        team2_avg_tov_pct = f2["avg_tov_pct"],
        tov_pct_diff      = f1["avg_tov_pct"]  - f2["avg_tov_pct"],
        team1_last5_Margin= f1["last5_Margin"],
        team2_last5_Margin= f2["last5_Margin"],
        last5_Margin_diff = f1["last5_Margin"] - f2["last5_Margin"],
        team1_elo_sos     = f1["elo_sos"],
        team2_elo_sos     = f2["elo_sos"],
        elo_sos_diff      = f1["elo_sos"]      - f2["elo_sos"],
    )
    for _loc in [LOC_NEUTRAL, LOC_H, LOC_A]:
        _row = dict(_base)
        _row["location"] = _loc
        _row["DayNum"]   = DAYNUM_PREDICTOR
        _pred_rows.append(_row)
    _pred_meta.append((
        int(f1["TeamID"]), f1["TeamName"], f1["Conf"],
        int(f2["TeamID"]), f2["TeamName"], f2["Conf"],
    ))

X_pred = pd.DataFrame(_pred_rows)[FEATURE_COLS]

if n_trees:
    _p_raw_pred = final_model.predict_proba(X_pred, num_iteration=n_trees)[:, 1]
else:
    _p_raw_pred = final_model.predict_proba(X_pred)[:, 1]

_p_cal_pred = iso.predict(_p_raw_pred).clip(1e-7, 1 - 1e-7)
_p_mat_pred = _p_cal_pred.reshape(len(_pred_pairs), 3)

_pred_out = pd.DataFrame(
    _pred_meta,
    columns=["TeamID_A", "TeamName_A", "Conf_A", "TeamID_B", "TeamName_B", "Conf_B"],
)
_pred_out["prob_neutral"] = np.round(_p_mat_pred[:, 0], 6)
_pred_out["prob_A_home"]  = np.round(_p_mat_pred[:, 1], 6)
_pred_out["prob_B_home"]  = np.round(_p_mat_pred[:, 2], 6)

print(f"Predictions done: {len(_p_cal_pred):,} values")
print(f"  min={_p_cal_pred.min():.4f}  max={_p_cal_pred.max():.4f}  mean={_p_cal_pred.mean():.4f}")
print(f"Writing {OUT_PREDICTOR_26.name}  ({len(_pred_out):,} rows) ...")

try:
    _pred_out.to_excel(OUT_PREDICTOR_26, index=False)
    print(f"  Written: {OUT_PREDICTOR_26.stat().st_size / 1024 / 1024:.1f} MB")
except PermissionError:
    _fb = OUT_PREDICTOR_26.with_name("matchup_predictor_2026_new.xlsx")
    _pred_out.to_excel(_fb, index=False)
    print(f"  Saved (fallback — close Excel): {_fb}")

print(_pred_out.head(3).to_string(index=False))

# %%
# ---------------------------------------------------------------------------
# AUTO-PUSH TO GITHUB
# Stages and pushes all output files produced by this run.
# Silently skips if git is unavailable or there are no changes.
# ---------------------------------------------------------------------------
import subprocess, datetime

def _git(*args, cwd=str(BASE)):
    return subprocess.run(["git"] + list(args), cwd=cwd,
                          capture_output=True, text=True)

_push_files = [
    "2026_bracket_preds.xlsx",
    "matchup_probs_2026.xlsx",
    "matchup_predictor_2026.xlsx",
    "team_stats_2026.xlsx",
    "conf_tourney_preds_2026.xlsx",
    "conf_team_stats_2026.xlsx",
    "conf_matchup_probs_2026.xlsx",
    "model_rankings_2026.xlsx",
]

print("\n" + "=" * 60)
print("AUTO-PUSH: staging output files -> GitHub")
print("=" * 60)

try:
    # Only add files that exist
    _existing = [f for f in _push_files if (BASE / f).exists()]
    _git("add", *_existing)
    _status = _git("status", "--porcelain")
    if not _status.stdout.strip():
        print("  No changes to commit — GitHub already up to date.")
    else:
        _msg = f"Update bracket sim outputs ({datetime.date.today()})"
        _commit = _git("commit", "-m", _msg)
        if _commit.returncode != 0:
            print(f"  Commit failed: {_commit.stderr.strip()}")
        else:
            _pull = _git("pull", "--rebase", "--autostash")
            if _pull.returncode != 0:
                print(f"  Pull failed: {_pull.stderr.strip()}")
            else:
                _push = _git("push")
                if _push.returncode == 0:
                    print(f"  Pushed: {_msg}")
                else:
                    print(f"  Push failed: {_push.stderr.strip()}")
except Exception as _e:
    print(f"  Git push skipped: {_e}")

# %%
