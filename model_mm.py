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
# # March Madness LightGBM Pipeline v3
#
# **Architecture (simplified):**
# - Single LightGBM binary classifier predicting `team1_won`
# - No regression branch, no Stage 2 tournament specialist
# - Isotonic calibration fitted on OOF predictions
#
# **Features (32 total):**
# - Elo (6): team1/2_elo_last, elo_diff, team1/2_elo_trend, elo_trend_diff
# - Rankings — diffs only (6): POM, MAS, MOR, WLK, BIH, NET
# - Efficiency — raw + diff (15): off/def/net_rtg, oreb_pct, tov_pct × 3
# - Form (3): team1/2_last5_Margin, last5_Margin_diff
# - Context (2): location, DayNum
#
# **Splits:**
# - Train : 2014–2023 (all game types)
# - Val   : 2024      (all game types)
# - Test  : 2025      (all game types)
#
# **Metrics reported on:**
# - Train OOF | Val 2024 all | Val 2024 NCAA only | Test 2025 all | Test 2025 NCAA only

# %%
# ---------------------------------------------------------------------------
# IMPORTS & CONSTANTS
# ---------------------------------------------------------------------------
import warnings
import sys
import io
import numpy as np
import pandas as pd
import lightgbm as lgb
import optuna
import shap
import joblib
from pathlib import Path

from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import (
    log_loss,
    brier_score_loss,
    accuracy_score,
    roc_auc_score,
)
from sklearn.isotonic import IsotonicRegression
from sklearn.preprocessing import LabelEncoder

# ---------------------------------------------------------------------------
# GLOBAL SETTINGS
# ---------------------------------------------------------------------------
warnings.filterwarnings("ignore")
optuna.logging.set_verbosity(optuna.logging.WARNING)

# Jupyter-safe stdout wrapper (prevents buffer crash in notebook)
try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

BASE      = Path("c:/Users/franc/OneDrive/Jupyter/Business/MM")
DATA_PATH = BASE / "master_dataset.xlsx"
OUT_PATH  = BASE / "predictions.xlsx"

RANDOM_STATE         = 42
N_TRIALS             = 100
N_SPLITS             = 5
EARLY_STOP_TRIALS    = 20
EARLY_STOP_MIN_DELTA = 1e-5


# ── Feature columns (32 total) ───────────────────────────────────────────────

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
    ELO_COLS
    + RANK_DIFF_COLS
    + EFF_COLS
    + FORM_COLS
    + SOS_COLS
    + CONTEXT_COLS
)

# 6 + 6 + 15 + 3 + 1 + 2 = 33 features

CAT_FEATURES = ["location"]  # LightGBM native categorical


# ---------------------------------------------------------------------------
# DERIVED DIFFERENCE FEATURES
# ---------------------------------------------------------------------------

DERIVED_DIFFS = {
    "elo_trend_diff":     ("team1_elo_trend",    "team2_elo_trend"),
    "off_rtg_diff":       ("team1_avg_off_rtg",  "team2_avg_off_rtg"),
    "def_rtg_diff":       ("team1_avg_def_rtg",  "team2_avg_def_rtg"),
    "net_rtg_diff":       ("team1_avg_net_rtg",  "team2_avg_net_rtg"),
    "oreb_pct_diff":      ("team1_avg_oreb_pct", "team2_avg_oreb_pct"),
    "tov_pct_diff":       ("team1_avg_tov_pct",  "team2_avg_tov_pct"),
    "last5_Margin_diff":  ("team1_last5_Margin", "team2_last5_Margin"),
    "elo_sos_diff":       ("team1_elo_sos",       "team2_elo_sos"),
}


# ---------------------------------------------------------------------------
# TEAM BASE STATS (for frozen pre-tournament snapshot)
# ---------------------------------------------------------------------------

TEAM_BASE_STATS = [
    "elo_last", "elo_trend",
    "avg_off_rtg", "avg_def_rtg", "avg_net_rtg",
    "avg_oreb_pct", "avg_tov_pct",
    "last5_Margin",
    "POM", "MAS", "MOR", "WLK", "BIH", "NET",
    "elo_sos",
]


# ---------------------------------------------------------------------------
# DIFF COLUMNS THAT REQUIRE RECOMPUTE AFTER SNAPSHOT SUBSTITUTION
# ---------------------------------------------------------------------------

ALL_DIFF_COLS_RECOMPUTE = {
    "elo_diff":      ("team1_elo_last", "team2_elo_last"),
    "rankdiff_POM":  ("team1_POM",      "team2_POM"),
    "rankdiff_MAS":  ("team1_MAS",      "team2_MAS"),
    "rankdiff_MOR":  ("team1_MOR",      "team2_MOR"),
    "rankdiff_WLK":  ("team1_WLK",      "team2_WLK"),
    "rankdiff_BIH":  ("team1_BIH",      "team2_BIH"),
    "rankdiff_NET":  ("team1_NET",      "team2_NET"),
    **DERIVED_DIFFS,
}


# ---------------------------------------------------------------------------
# PRE-TOURNAMENT SNAPSHOT BUILDER
# ---------------------------------------------------------------------------

def build_pretournament_snapshot(df_full: pd.DataFrame) -> dict:
    """
    Capture pre-tournament stats for each (Season, TeamID) from their FIRST
    NCAA tournament appearance.

    Ensures no tournament leakage across rounds.
    """

    snaps: dict = {}

    ncaa = (
        df_full[df_full["game_type"] == "NCAA"]
        .sort_values(["Season", "DayNum"])
    )

    for _, row in ncaa.iterrows():
        season = int(row["Season"])

        for side, id_col in [("team1", "team1_id"),
                             ("team2", "team2_id")]:

            tid = int(row[id_col])

            if (season, tid) not in snaps:
                snaps[(season, tid)] = {
                    stat: row[f"{side}_{stat}"]
                    for stat in TEAM_BASE_STATS
                }

    return snaps


# ---------------------------------------------------------------------------
# APPLY PRE-TOURNAMENT SNAPSHOT
# ---------------------------------------------------------------------------

def apply_pretournament_features(
    df_sub: pd.DataFrame,
    snaps: dict
) -> pd.DataFrame:

    df_out = df_sub.copy()
    ncaa_mask = df_out["game_type"] == "NCAA"

    if not ncaa_mask.any():
        return df_out

    df_ncaa = df_out.loc[ncaa_mask].copy()

    for idx, row in df_ncaa.iterrows():

        season = int(row["Season"])

        for side, id_col in [("team1", "team1_id"),
                             ("team2", "team2_id")]:

            tid = int(row[id_col])
            snap = snaps.get((season, tid))

            if snap is not None:
                for stat, val in snap.items():
                    df_ncaa.at[idx, f"{side}_{stat}"] = val

    # Recompute all diff features
    for diff_col, (col_a, col_b) in ALL_DIFF_COLS_RECOMPUTE.items():
        if col_a in df_ncaa.columns and col_b in df_ncaa.columns:
            df_ncaa[diff_col] = (
                df_ncaa[col_a].values
                - df_ncaa[col_b].values
            )

    df_out.update(df_ncaa)
    return df_out


# ---------------------------------------------------------------------------
# OUTPUT COLUMNS
# ---------------------------------------------------------------------------

INFO_COLS = [
    "Season", "DayNum", "game_type", "location",
    "team1_name", "team2_name",
    "team1_score", "team2_score",
    "score_diff", "team1_won",
]

DIFF_OUTPUT_COLS = list(DERIVED_DIFFS.keys())

# %%

# %%
# ---------------------------------------------------------------------------
# PHASE 1: LOAD & PREP DATA
# ---------------------------------------------------------------------------
print("=" * 70)
print("PHASE 1: LOAD & PREP DATA")
print("=" * 70)

_parquet_path = DATA_PATH.with_suffix(".parquet")
if _parquet_path.exists():
    df = pd.read_parquet(_parquet_path)
    print(f"Loading from parquet: {_parquet_path.name}")
else:
    df = pd.read_excel(DATA_PATH, engine="openpyxl")
    print(f"Loading from Excel (slow): {DATA_PATH.name}")
print(f"Loaded: {df.shape[0]:,} rows x {df.shape[1]} cols")
print(f"Seasons: {df['Season'].min()} - {df['Season'].max()}")
print(f"\ngame_type distribution:")
print(df["game_type"].value_counts().to_string())

# Compute 7 derived diff features
for col, (a, b) in DERIVED_DIFFS.items():
    df[col] = df[a] - df[b]
print(f"\nDerived {len(DERIVED_DIFFS)} diff features: {list(DERIVED_DIFFS.keys())}")

# Class balance check
team1_win_rate = df["team1_won"].mean()
print(f"\nteam1_won rate : {team1_win_rate:.4f}  (expected ~0.50 — arbitrary ID assignment)")

# Encode location as integer for LightGBM categorical handling
le_loc = LabelEncoder()
df["location"] = le_loc.fit_transform(df["location"].astype(str))
print(f"location encoding: {dict(zip(le_loc.classes_, le_loc.transform(le_loc.classes_)))}")

# Verify all 33 feature columns are present
missing = [c for c in FEATURE_COLS if c not in df.columns]
if missing:
    raise ValueError(f"Missing feature columns: {missing}")
print(f"\nAll {len(FEATURE_COLS)} feature columns verified.")
print("Feature list:")
for i, f in enumerate(FEATURE_COLS, 1):
    print(f"  {i:2d}. {f}")

# %%
# ---------------------------------------------------------------------------
# PHASE 2: SPLIT & SAMPLE WEIGHTS
# ---------------------------------------------------------------------------
print("=" * 70)
print("PHASE 2: SPLIT & SAMPLE WEIGHTS")
print("=" * 70)

train_mask = df["Season"] <= 2023
val_mask   = df["Season"] == 2024
test_mask  = df["Season"] == 2025

df_train = df[train_mask].copy().reset_index(drop=True)
df_val   = df[val_mask].copy().reset_index(drop=True)
df_test  = df[test_mask].copy().reset_index(drop=True)

print(f"Train : {len(df_train):,} rows  (2014-2023, all game types)")
print(f"Val   : {len(df_val):,}  rows  (2024, all game types)")
print(f"Test  : {len(df_test):,}  rows  (2025, all game types)")

print(f"\nVal game_type distribution:")
print(df_val["game_type"].value_counts().to_string())
print(f"\nTest game_type distribution:")
print(df_test["game_type"].value_counts().to_string())

X_train = df_train[FEATURE_COLS].copy()
X_val   = df_val[FEATURE_COLS].copy()
X_test  = df_test[FEATURE_COLS].copy()

y_train = df_train["team1_won"].copy()
y_val   = df_val["team1_won"].copy()
y_test  = df_test["team1_won"].copy()

# Sample weights: prioritise tournament and late-season games
WEIGHT_MAP = {"NCAA": 6.0, "Secondary": 3.0, "ConfTourney": 2.0}


def compute_weights(df_sub: pd.DataFrame) -> np.ndarray:
    gt = df_sub["game_type"].values
    dn = df_sub["DayNum"].values
    w  = np.ones(len(df_sub))
    for game_t, wt in WEIGHT_MAP.items():
        w[gt == game_t] = wt
    w[(gt == "Regular") & (dn >= 100)] = 2.0
    return w


weights_train = compute_weights(df_train)
print(f"\nSample weight distribution (train):")
for wt in sorted(set(weights_train)):
    print(f"  weight={wt:.1f}: {(weights_train == wt).sum():,} rows")

# Stratification array (game_type strings) for StratifiedKFold
strat_train = df_train["game_type"].values

# Boolean masks for NCAA-only evaluation slices
ncaa_val_mask  = (df_val["game_type"]  == "NCAA").values
ncaa_test_mask = (df_test["game_type"] == "NCAA").values
print(f"\nNCaa games in val  : {ncaa_val_mask.sum()}")
print(f"NCAA games in test : {ncaa_test_mask.sum()}")

# %%
# ---------------------------------------------------------------------------
# PHASE 3: OPTUNA HYPERPARAMETER SEARCH (Rolling Forward CV)
# ---------------------------------------------------------------------------
print("=" * 70)
print(f"PHASE 3: OPTUNA SEARCH  (Rolling Forward CV)")
print("=" * 70)


def _params(trial: optuna.Trial) -> dict:
    return {
        "objective":         "binary",
        "metric":            "binary_logloss",
        "verbosity":         -1,
        "boosting_type":     "gbdt",
        "subsample_freq":    1,
        "n_jobs":            -1,
        "random_state":      RANDOM_STATE,
        "num_leaves":        trial.suggest_int("num_leaves", 20, 300),
        "max_depth":         trial.suggest_int("max_depth", 3, 12),
        "learning_rate":     trial.suggest_float("learning_rate", 0.005, 0.3, log=True),
        "min_child_samples": trial.suggest_int("min_child_samples", 10, 100),
        "min_child_weight":  trial.suggest_float("min_child_weight", 1e-4, 1.0, log=True),
        "min_split_gain":    trial.suggest_float("min_split_gain", 0.0, 1.0),
        "subsample":         trial.suggest_float("subsample", 0.5, 1.0),
        "colsample_bytree":  trial.suggest_float("colsample_bytree", 0.4, 1.0),
        "reg_alpha":         trial.suggest_float("reg_alpha", 1e-8, 10.0, log=True),
        "reg_lambda":        trial.suggest_float("reg_lambda", 1e-8, 10.0, log=True),
        "extra_trees":       trial.suggest_categorical("extra_trees", [True, False]),
    }


def _rolling_season_splits(df_train: pd.DataFrame):
    seasons = sorted(df_train["Season"].unique())
    splits = []

    # Require at least 3 initial seasons before first validation
    for i in range(3, len(seasons)):
        train_seasons = seasons[:i]
        val_season    = seasons[i]

        tr_idx = df_train["Season"].isin(train_seasons).values
        vl_idx = (df_train["Season"] == val_season).values

        splits.append((np.where(tr_idx)[0], np.where(vl_idx)[0]))

    return splits


rolling_splits = _rolling_season_splits(df_train)

print(f"Number of rolling folds: {len(rolling_splits)}")
print("Validation seasons per fold:",
      sorted(df_train.iloc[vl]["Season"].unique()[0]
             for _, vl in rolling_splits))


def objective(trial: optuna.Trial) -> float:
    params = _params(trial)
    scores = []

    for tr_idx, vl_idx in rolling_splits:

        model = lgb.LGBMClassifier(**params, n_estimators=2000)

        model.fit(
            X_train.iloc[tr_idx],
            y_train.iloc[tr_idx],
            sample_weight=weights_train[tr_idx],
            eval_set=[(X_train.iloc[vl_idx], y_train.iloc[vl_idx])],
            callbacks=[
                lgb.early_stopping(50, verbose=False),
                lgb.log_evaluation(-1),
            ],
            categorical_feature=CAT_FEATURES,
        )

        preds = model.predict_proba(X_train.iloc[vl_idx])[:, 1]

        scores.append(
            log_loss(
                y_train.iloc[vl_idx],
                preds
            )
        )

    return float(np.mean(scores))


def _convergence_callback(study: optuna.Study,
                          trial: optuna.trial.FrozenTrial) -> None:

    if trial.number < EARLY_STOP_TRIALS:
        return

    trials_since_best = trial.number - study.best_trial.number

    if trials_since_best >= EARLY_STOP_TRIALS:
        print(
            f"\n[Early stop] No improvement in last "
            f"{EARLY_STOP_TRIALS} trials "
            f"(best={study.best_value:.6f})."
        )
        study.stop()


study = optuna.create_study(
    direction="minimize",
    sampler=optuna.samplers.TPESampler(seed=RANDOM_STATE),
)

study.optimize(
    objective,
    n_trials=N_TRIALS,
    show_progress_bar=True,
    callbacks=[_convergence_callback],
)

best_params = study.best_params

print(f"\nBest Rolling CV log loss: {study.best_value:.5f}")
print("Best hyperparameters:")
for k, v in best_params.items():
    print(f"{k:<25}: {v}")

# %%
# ---------------------------------------------------------------------------
# PHASE 4: FINAL MODEL TRAINING + OOF PREDICTIONS
# ---------------------------------------------------------------------------
print("=" * 70)
print("PHASE 4: FINAL MODEL TRAINING + OOF PREDICTIONS")
print("=" * 70)

# Train final model on all training data; early-stop on val to find n_trees
final_model = lgb.LGBMClassifier(
    objective="binary",
    metric="binary_logloss",
    verbosity=-1,
    boosting_type="gbdt",
    subsample_freq=1,
    n_jobs=-1,
    random_state=RANDOM_STATE,
    n_estimators=2000,
    **best_params,
)

final_model.fit(
    X_train,
    y_train,
    sample_weight=weights_train,
    eval_set=[(X_val, y_val)],
    callbacks=[
        lgb.early_stopping(100, verbose=False),
        lgb.log_evaluation(-1),
    ],
    categorical_feature=CAT_FEATURES,
)

n_trees = final_model.best_iteration_ or 500
print(f"Final model n_estimators (early stop on val): {n_trees}")


# ---------------------------------------------------------------------------
# OOF PREDICTIONS USING ROLLING FORWARD SPLITS (NO LEAKAGE)
# ---------------------------------------------------------------------------

def _rolling_season_splits_oof(df_train: pd.DataFrame):
    seasons = sorted(df_train["Season"].unique())
    splits = []

    for i in range(3, len(seasons)):
        train_seasons = seasons[:i]
        val_season    = seasons[i]

        tr_idx = df_train["Season"].isin(train_seasons).values
        vl_idx = (df_train["Season"] == val_season).values

        splits.append((np.where(tr_idx)[0], np.where(vl_idx)[0]))

    return splits


rolling_oof_splits = _rolling_season_splits_oof(df_train)

# Initialize with NaNs so unpredicted rows are excluded from metrics
oof_prob = np.full(len(X_train), np.nan)

for fold, (tr_idx, vl_idx) in enumerate(rolling_oof_splits, 1):

    m = lgb.LGBMClassifier(
        objective="binary",
        metric="binary_logloss",
        verbosity=-1,
        boosting_type="gbdt",
        subsample_freq=1,
        n_jobs=-1,
        random_state=RANDOM_STATE,
        n_estimators=n_trees,
        **best_params,
    )

    m.fit(
        X_train.iloc[tr_idx],
        y_train.iloc[tr_idx],
        sample_weight=weights_train[tr_idx],
        categorical_feature=CAT_FEATURES,
    )

    oof_prob[vl_idx] = m.predict_proba(X_train.iloc[vl_idx])[:, 1]

    print(
        f"  OOF fold {fold} "
        f"(val season = {df_train.iloc[vl_idx]['Season'].iloc[0]}) done."
    )


# Compute OOF metrics only on rows that received predictions
valid_mask = ~np.isnan(oof_prob)

print(
    f"\nOOF log loss (raw, pre-calibration): "
    f"{log_loss(y_train[valid_mask], oof_prob[valid_mask]):.5f}"
)

# %%
# ---------------------------------------------------------------------------
# PHASE 5: ISOTONIC CALIBRATION
# ---------------------------------------------------------------------------
print("=" * 70)
print("PHASE 5: ISOTONIC CALIBRATION")
print("=" * 70)

# Use only rows that actually received OOF predictions
valid_mask = ~np.isnan(oof_prob)

iso = IsotonicRegression(out_of_bounds="clip")
iso.fit(oof_prob[valid_mask], y_train.values[valid_mask])

# Calibrate OOF (only valid rows)
oof_cal = np.full(len(oof_prob), np.nan)
oof_cal[valid_mask] = iso.predict(oof_prob[valid_mask]).clip(1e-7, 1 - 1e-7)

# Raw predictions for val/test
p_raw_val  = final_model.predict_proba(X_val)[:, 1]
p_raw_test = final_model.predict_proba(X_test)[:, 1]

# Calibrated val/test
p_cal_val  = iso.predict(p_raw_val).clip(1e-7, 1 - 1e-7)
p_cal_test = iso.predict(p_raw_test).clip(1e-7, 1 - 1e-7)

# OOF metrics (only valid rows)
print(f"OOF log loss  pre-calibration : "
      f"{log_loss(y_train[valid_mask], oof_prob[valid_mask]):.5f}")

print(f"OOF log loss post-calibration : "
      f"{log_loss(y_train[valid_mask], oof_cal[valid_mask]):.5f}")

# Validation metrics
print(f"\nVal raw log loss  : {log_loss(y_val, p_raw_val):.5f}")
print(f"Val cal log loss  : {log_loss(y_val, p_cal_val):.5f}")

# %%
# ---------------------------------------------------------------------------
# PHASE 5b: PRE-TOURNAMENT FEATURE SUBSTITUTION
# For all NCAA tournament games, freeze each team's features at their
# end-of-regular-season/conf-tourney snapshot (their first NCAA game row).
# This prevents the model from seeing stats updated by earlier tournament rounds,
# giving an honest picture of real-world inference-time performance.
# Applied to BOTH Phase 6 evaluation and Phase 8 output — training is unchanged.
# ---------------------------------------------------------------------------
print("=" * 70)
print("PHASE 5b: PRE-TOURNAMENT FEATURE SUBSTITUTION")
print("=" * 70)

pretournament_snaps = build_pretournament_snapshot(df)
print(f"Pre-tournament snapshots built: {len(pretournament_snaps):,} (season, team_id) pairs "
      f"across {df[df['game_type']=='NCAA']['Season'].nunique()} seasons.")

df_val_h  = apply_pretournament_features(df_val,  pretournament_snaps)
df_test_h = apply_pretournament_features(df_test, pretournament_snaps)

X_val_h  = df_val_h[FEATURE_COLS]
X_test_h = df_test_h[FEATURE_COLS]

p_raw_val_h  = final_model.predict_proba(X_val_h)[:, 1]
p_raw_test_h = final_model.predict_proba(X_test_h)[:, 1]
p_cal_val_h  = iso.predict(p_raw_val_h).clip(1e-7, 1 - 1e-7)
p_cal_test_h = iso.predict(p_raw_test_h).clip(1e-7, 1 - 1e-7)

# Quick comparison: original vs honest log loss for NCAA-only slices
print(f"\n  {'Slice':<40} {'Original':>10}  {'Honest':>10}  {'Delta':>10}")
print(f"  {'─'*40}  {'─'*10}  {'─'*10}  {'─'*10}")
if ncaa_val_mask.sum() >= 2:
    _ll_o = log_loss(y_val.values[ncaa_val_mask], p_cal_val[ncaa_val_mask])
    _ll_h = log_loss(y_val.values[ncaa_val_mask], p_cal_val_h[ncaa_val_mask])
    print(f"  {'Val 2024 NCAA log loss':<40} {_ll_o:>10.5f}  {_ll_h:>10.5f}  {_ll_h-_ll_o:>+10.5f}")
if ncaa_test_mask.sum() >= 2:
    _ll_o = log_loss(y_test.values[ncaa_test_mask], p_cal_test[ncaa_test_mask])
    _ll_h = log_loss(y_test.values[ncaa_test_mask], p_cal_test_h[ncaa_test_mask])
    print(f"  {'Test 2025 NCAA log loss':<40} {_ll_o:>10.5f}  {_ll_h:>10.5f}  {_ll_h-_ll_o:>+10.5f}")
print(f"\n  NOTE: +delta means honest features slightly hurt performance (expected if model")
print(f"        exploited in-tournament stat updates); -delta would be unusual.")

# %%
# ---------------------------------------------------------------------------
# PHASE 6: EVALUATION
# ---------------------------------------------------------------------------
print("=" * 70)
print("PHASE 6: EVALUATION")
print("=" * 70)


def report_metrics(label: str, y_true, p_cal) -> dict | None:
    """Compute and print log loss / Brier / AUC / accuracy for one slice."""
    y_true = np.asarray(y_true)
    p_cal  = np.asarray(p_cal)

    if len(np.unique(y_true)) < 2:
        print(f"\n  {label}: only one class present — metrics skipped.")
        return None

    pred = (p_cal >= 0.5).astype(int)
    ll   = log_loss(y_true, p_cal)
    bs   = brier_score_loss(y_true, p_cal)
    auc  = roc_auc_score(y_true, p_cal)
    acc  = accuracy_score(y_true, pred)

    print(f"\n{'─'*55}")
    print(f"  {label}  (n={len(y_true):,})")
    print(f"{'─'*55}")
    print(f"  Log Loss : {ll:.5f}")
    print(f"  Brier    : {bs:.5f}")
    print(f"  AUC      : {auc:.5f}")
    print(f"  Accuracy : {acc*100:.2f}%")

    return {
        "label": label,
        "n": len(y_true),
        "log_loss": ll,
        "brier": bs,
        "auc": auc,
        "accuracy": acc,
    }


results = []

# ── ORIGINAL (rolling features — in-tournament stats allowed) ─────────
print("\n── ORIGINAL (rolling features — in-tournament stats allowed) ──────────")

# 1. Train OOF (forward-only seasons)
valid_mask = ~np.isnan(oof_cal)

r = report_metrics(
    "Train OOF (2017-2023 forward only)",
    y_train.values[valid_mask],
    oof_cal[valid_mask],
)
if r:
    results.append({**r, "variant": "original"})


# 2. Val 2024 — ALL games [original]
r = report_metrics("Val 2024 — ALL games [original]", y_val.values, p_cal_val)
if r:
    results.append({**r, "variant": "original"})


# 3. Test 2025 — ALL games [original]
r = report_metrics("Test 2025 — ALL games [original]", y_test.values, p_cal_test)
if r:
    results.append({**r, "variant": "original"})


# 4. Val 2024 — NCAA only [original]
if ncaa_val_mask.sum() >= 2:
    r = report_metrics(
        "Val 2024 — NCAA only [original]",
        y_val.values[ncaa_val_mask],
        p_cal_val[ncaa_val_mask],
    )
    if r:
        results.append({**r, "variant": "original"})


# 5. Test 2025 — NCAA only [original]
if ncaa_test_mask.sum() >= 2:
    r = report_metrics(
        "Test 2025 — NCAA only [original]",
        y_test.values[ncaa_test_mask],
        p_cal_test[ncaa_test_mask],
    )
    if r:
        results.append({**r, "variant": "original"})


# ── HONEST (pre-tournament freeze for NCAA rows) ────────
print("\n── HONEST (pre-tournament feature freeze for NCAA rows) ───────")


# 6. Val 2024 — ALL games [honest]
r = report_metrics(
    "Val 2024 — ALL games [honest]",
    y_val.values,
    p_cal_val_h,
)
if r:
    results.append({**r, "variant": "honest"})


# 7. Test 2025 — ALL games [honest]
r = report_metrics(
    "Test 2025 — ALL games [honest]",
    y_test.values,
    p_cal_test_h,
)
if r:
    results.append({**r, "variant": "honest"})


# 8. Val 2024 — NCAA only [honest]
if ncaa_val_mask.sum() >= 2:
    r = report_metrics(
        "Val 2024 — NCAA only [honest]",
        y_val.values[ncaa_val_mask],
        p_cal_val_h[ncaa_val_mask],
    )
    if r:
        results.append({**r, "variant": "honest"})


# 9. Test 2025 — NCAA only [honest]
if ncaa_test_mask.sum() >= 2:
    r = report_metrics(
        "Test 2025 — NCAA only [honest]",
        y_test.values[ncaa_test_mask],
        p_cal_test_h[ncaa_test_mask],
    )
    if r:
        results.append({**r, "variant": "honest"})

# %%
# ---------------------------------------------------------------------------
# PHASE 7: SHAP FEATURE IMPORTANCE
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("PHASE 7: SHAP FEATURE IMPORTANCE")
print("=" * 70)

n_shap = min(5000, len(X_train))
X_shap = X_train.sample(n_shap, random_state=RANDOM_STATE)
print(f"Computing SHAP on {n_shap:,} training samples...")

explainer = shap.TreeExplainer(final_model)
sv = explainer.shap_values(X_shap)
if isinstance(sv, list):
    sv = sv[1]

shap_imp = (
    pd.Series(np.abs(sv).mean(axis=0), index=FEATURE_COLS)
    .sort_values(ascending=False)
)
print("\nSHAP Feature Importance  (mean |SHAP|, sorted):")
for feat, val in shap_imp.items():
    bar = "\u2588" * int(val / shap_imp.max() * 40)
    print(f"  {feat:<38} {val:.5f}  {bar}")

# %%
# ---------------------------------------------------------------------------
# PHASE 8: FINAL SUMMARY TABLE + SAVE OUTPUT
# ---------------------------------------------------------------------------
print("\n" + "=" * 70)
print("PHASE 8: FINAL SUMMARY + SAVE")
print("=" * 70)

# Summary table
print(f"\n  {'Split':<42}  {'n':>6}  {'LogLoss':>8}  {'Brier':>7}  {'AUC':>7}  {'Acc':>7}")
print(f"  {'-'*42}  {'-'*6}  {'-'*8}  {'-'*7}  {'-'*7}  {'-'*7}")
for r in results:
    print(f"  {r['label']:<42}  {r['n']:>6,}  "
          f"{r['log_loss']:>8.5f}  {r['brier']:>7.5f}  "
          f"{r['auc']:>7.5f}  {r['accuracy']*100:>6.2f}%")

# Delta rows: honest − original for NCAA-only slices
_orig_map = {r["label"].replace("[original]", "").strip(): r
             for r in results if r.get("variant") == "original"}
_hon_map  = {r["label"].replace("[honest  ]", "").strip(): r
             for r in results if r.get("variant") == "honest"}
if _hon_map:
    print(f"\n  {'─ Δ honest − original (NCAA slices only)':─<80}")
    print(f"  {'Slice':<42}  {'':>6}  {'ΔLogLoss':>8}  {'ΔBrier':>7}  "
          f"{'ΔAUC':>7}  {'ΔAcc':>7}")
    print(f"  {'-'*42}  {'-'*6}  {'-'*8}  {'-'*7}  {'-'*7}  {'-'*7}")
    for key in _hon_map:
        if key in _orig_map:
            o, h  = _orig_map[key], _hon_map[key]
            d_ll  = h["log_loss"]  - o["log_loss"]
            d_bs  = h["brier"]     - o["brier"]
            d_auc = h["auc"]       - o["auc"]
            d_acc = (h["accuracy"] - o["accuracy"]) * 100
            sig   = "  *** SIGNIFICANT DEGRADATION" if d_ll > 0.05 else ""
            print(f"  {key:<42}  {'':>6}  {d_ll:>+8.5f}  {d_bs:>+7.5f}  "
                  f"{d_auc:>+7.5f}  {d_acc:>+6.2f}%{sig}")


def build_output(df_sub: pd.DataFrame,
                 p_raw: np.ndarray,
                 p_cal: np.ndarray) -> pd.DataFrame:
    """Assemble output sheet: info + win% + pred + outcome + all 32 features + probs."""
    df_sub = df_sub.reset_index(drop=True)
    pred    = (p_cal >= 0.5).astype(int)
    correct = (pred == df_sub["team1_won"].values).astype(int)
    out = pd.DataFrame({
        # Identity
        "Season"          : df_sub["Season"].values,
        "DayNum"          : df_sub["DayNum"].values,
        "game_type"       : df_sub["game_type"].values,
        "location"        : le_loc.inverse_transform(
                                df_sub["location"].values.astype(int)),
        "team1_name"      : df_sub["team1_name"].values,
        "team2_name"      : df_sub["team2_name"].values,
        # Win probabilities
        "team1_win_pct"   : np.round(p_cal * 100, 1),
        "team2_win_pct"   : np.round((1 - p_cal) * 100, 1),
        # Prediction & outcome
        "pred_team1_wins" : pred,
        "correct"         : correct,
        "team1_score"     : df_sub["team1_score"].values,
        "team2_score"     : df_sub["team2_score"].values,
        "score_diff"      : df_sub["score_diff"].values,
        "team1_won"       : df_sub["team1_won"].values,
    })
    # All 32 input features (location + DayNum already included above)
    for col in FEATURE_COLS:
        if col not in out.columns:
            out[col] = df_sub[col].values
    # Raw model outputs
    out["prob_raw"]        = np.round(p_raw, 4)
    out["prob_calibrated"] = np.round(p_cal, 4)
    return out


# Use honest (pre-tournament feature freeze) predictions for the output files.
# Non-NCAA rows are identical to originals; only NCAA rows differ.
df_val_out  = build_output(df_val_h,  p_raw_val_h,  p_cal_val_h)
df_test_out = build_output(df_test_h, p_raw_test_h, p_cal_test_h)

# Save as two sheets in a single predictions.xlsx
try:
    with pd.ExcelWriter(OUT_PATH, engine="openpyxl") as writer:
        df_val_out.to_excel(writer,  sheet_name="val_2024",  index=False)
        df_test_out.to_excel(writer, sheet_name="test_2025", index=False)
    print(f"\nSaved -> {OUT_PATH}")
    print(f"  Sheet 'val_2024'  : {len(df_val_out):,} rows")
    print(f"  Sheet 'test_2025' : {len(df_test_out):,} rows")
except PermissionError:
    fb = OUT_PATH.with_name("predictions_new.xlsx")
    with pd.ExcelWriter(fb, engine="openpyxl") as writer:
        df_val_out.to_excel(writer,  sheet_name="val_2024",  index=False)
        df_test_out.to_excel(writer, sheet_name="test_2025", index=False)
    print(f"\nSaved (fallback — close Excel if open): {fb}")

print("\nAll done!")

# Save model artifacts for use by bracket_sim.py (avoids retraining)
_artifact_path = BASE / "model_mm_artifacts.pkl"
joblib.dump({
    "final_model":  final_model,
    "iso":          iso,
    "le_loc":       le_loc,
    "n_trees":      n_trees,
    "best_params":  best_params,
    "feature_cols": FEATURE_COLS,
}, _artifact_path)
print(f"Model artifacts saved → {_artifact_path}")

# %%
# ---------------------------------------------------------------------------
# PHASE 8b: REBUILD OUTPUT FROM EXISTING PROBABILITIES
# Run this cell (after the imports/constants cell) to regenerate
# predictions.xlsx with all 32 input features without retraining.
# Reads prob_calibrated from current predictions.xlsx and joins with
# master_dataset.xlsx for all feature values.
# ---------------------------------------------------------------------------
with open(DATA_PATH, "rb") as _fh8b:
    _df8b = pd.read_excel(io.BytesIO(_fh8b.read()))

for _col8b, (_a8b, _b8b) in DERIVED_DIFFS.items():
    _df8b[_col8b] = _df8b[_a8b] - _df8b[_b8b]

_le8b = LabelEncoder()
_df8b["location"] = _le8b.fit_transform(_df8b["location"].astype(str))

_df_val8b  = _df8b[_df8b["Season"] == 2024].copy().reset_index(drop=True)
_df_test8b = _df8b[_df8b["Season"] == 2025].copy().reset_index(drop=True)

# Load existing probabilities from current predictions.xlsx
_xl8b   = pd.read_excel(OUT_PATH, sheet_name=None)
_KEYS8b = ["Season", "DayNum", "team1_name", "team2_name"]


def _get_cal8b(probs_sheet: pd.DataFrame, df_sub: pd.DataFrame) -> np.ndarray:
    merged = df_sub[_KEYS8b].merge(
        probs_sheet[_KEYS8b + ["prob_calibrated"]],
        on=_KEYS8b, how="left",
    )
    n_miss = merged["prob_calibrated"].isna().sum()
    if n_miss:
        print(f"  WARNING: {n_miss} rows had no probability match — defaulting to 0.5")
    return merged["prob_calibrated"].fillna(0.5).values


_p_val8b  = _get_cal8b(_xl8b["val_2024"],  _df_val8b)
_p_test8b = _get_cal8b(_xl8b["test_2025"], _df_test8b)


def _mk_out8b(df_sub: pd.DataFrame,
              p_cal: np.ndarray,
              le: LabelEncoder) -> pd.DataFrame:
    pred    = (p_cal >= 0.5).astype(int)
    correct = (pred == df_sub["team1_won"].values).astype(int)
    out = pd.DataFrame({
        "Season"          : df_sub["Season"].values,
        "DayNum"          : df_sub["DayNum"].values,
        "game_type"       : df_sub["game_type"].values,
        "location"        : le.inverse_transform(
                                df_sub["location"].values.astype(int)),
        "team1_name"      : df_sub["team1_name"].values,
        "team2_name"      : df_sub["team2_name"].values,
        "team1_win_pct"   : np.round(p_cal * 100, 1),
        "team2_win_pct"   : np.round((1 - p_cal) * 100, 1),
        "pred_team1_wins" : pred,
        "correct"         : correct,
        "team1_score"     : df_sub["team1_score"].values,
        "team2_score"     : df_sub["team2_score"].values,
        "score_diff"      : df_sub["score_diff"].values,
        "team1_won"       : df_sub["team1_won"].values,
    })
    for col in FEATURE_COLS:
        if col not in out.columns:
            out[col] = df_sub[col].values
    out["prob_calibrated"] = np.round(p_cal, 4)
    return out


_out_val8b  = _mk_out8b(_df_val8b,  _p_val8b,  _le8b)
_out_test8b = _mk_out8b(_df_test8b, _p_test8b, _le8b)

try:
    with pd.ExcelWriter(OUT_PATH, engine="openpyxl") as _w8b:
        _out_val8b.to_excel(_w8b,  sheet_name="val_2024",  index=False)
        _out_test8b.to_excel(_w8b, sheet_name="test_2025", index=False)
    print(f"Rebuilt → {OUT_PATH}")
    print(f"  val_2024  : {len(_out_val8b):,} rows × {_out_val8b.shape[1]} cols")
    print(f"  test_2025 : {len(_out_test8b):,} rows × {_out_test8b.shape[1]} cols")
except PermissionError:
    _fb8b = OUT_PATH.with_name("predictions_rebuilt.xlsx")
    with pd.ExcelWriter(_fb8b, engine="openpyxl") as _w8b:
        _out_val8b.to_excel(_w8b,  sheet_name="val_2024",  index=False)
        _out_test8b.to_excel(_w8b, sheet_name="test_2025", index=False)
    print(f"Rebuilt (fallback — close Excel if open): {_fb8b}")


# ── Game diagnostics ──────────────────────────────────────────────────────────
def _diag8b(df: pd.DataFrame, name1_re: str, name2_re: str, label: str) -> None:
    sub  = df[df["game_type"] == "NCAA"]
    mask = (
        sub["team1_name"].str.contains(name1_re, case=False, regex=True) |
        sub["team2_name"].str.contains(name1_re, case=False, regex=True)
    ) & (
        sub["team1_name"].str.contains(name2_re, case=False, regex=True) |
        sub["team2_name"].str.contains(name2_re, case=False, regex=True)
    )
    hits = sub[mask]
    if hits.empty:
        print(f"\n[{label}] NOT FOUND in NCAA games.")
        return
    row = hits.iloc[0]
    t1, t2 = row["team1_name"], row["team2_name"]
    score_str = (f"{t1} {int(row['team1_score'])} – {int(row['team2_score'])} {t2}"
                 if pd.notna(row.get("team1_score")) else "score N/A")
    won_name  = t1 if row["team1_won"] == 1 else t2
    print(f"\n{'='*65}")
    print(f"  {label}")
    print(f"  Matchup  : {t1}  vs  {t2}")
    print(f"  DayNum   : {row['DayNum']}  |  location: {row['location']}")
    print(f"  Result   : {score_str}  →  winner: {won_name}")
    print(f"{'='*65}")
    print(f"  {t1:<30} win% = {row['team1_win_pct']:5.1f}%")
    print(f"  {t2:<30} win% = {row['team2_win_pct']:5.1f}%")
    print(f"  Model correct: {'YES ✓' if row['correct'] == 1 else 'NO ✗'}")
    print(f"\n  ─── ELO ───────────────────────────────────────────────")
    print(f"  {'':30} {'team1':>10}  {'team2':>10}  {'diff':>10}")
    print(f"  {'elo_last':<30} {row['team1_elo_last']:>10.1f}  {row['team2_elo_last']:>10.1f}  {row['elo_diff']:>+10.1f}")
    print(f"  {'elo_trend':<30} {row['team1_elo_trend']:>10.1f}  {row['team2_elo_trend']:>10.1f}  {row['elo_trend_diff']:>+10.1f}")
    print(f"\n  ─── RANKINGS  (diff<0 = team1 ranked higher) ──────────")
    for rc in ["rankdiff_POM", "rankdiff_MAS", "rankdiff_MOR",
               "rankdiff_WLK", "rankdiff_BIH", "rankdiff_NET"]:
        s = rc.replace("rankdiff_", "")
        v = row[rc]
        note = f"team1 higher" if v < 0 else (f"team2 higher" if v > 0 else "tied")
        print(f"  {s:<30} {v:>+10.0f}  ({note})")
    print(f"\n  ─── EFFICIENCY ────────────────────────────────────────")
    print(f"  {'':30} {'team1':>10}  {'team2':>10}  {'diff':>10}")
    for metric, c1, c2, cd in [
        ("off_rtg",  "team1_avg_off_rtg",  "team2_avg_off_rtg",  "off_rtg_diff"),
        ("def_rtg",  "team1_avg_def_rtg",  "team2_avg_def_rtg",  "def_rtg_diff"),
        ("net_rtg",  "team1_avg_net_rtg",  "team2_avg_net_rtg",  "net_rtg_diff"),
        ("oreb_pct", "team1_avg_oreb_pct", "team2_avg_oreb_pct", "oreb_pct_diff"),
        ("tov_pct",  "team1_avg_tov_pct",  "team2_avg_tov_pct",  "tov_pct_diff"),
    ]:
        print(f"  {metric:<30} {row[c1]:>10.2f}  {row[c2]:>10.2f}  {row[cd]:>+10.2f}")
    print(f"\n  ─── FORM (last-5 avg margin) ───────────────────────────")
    print(f"  {'last5_Margin':<30} {row['team1_last5_Margin']:>10.2f}  {row['team2_last5_Margin']:>10.2f}  {row['last5_Margin_diff']:>+10.2f}")
    print(f"\n  NOTE: Tournament seedings are NOT a feature in this model.")


print(f"\n{'='*65}")
print("GAME DIAGNOSTICS")
print(f"{'='*65}")
_diag8b(_out_val8b,  r"\bTexas\b",  r"Colorado St",  "Val 2024 NCAA — Texas vs Colorado St")
_diag8b(_out_test8b, r"\bKansas\b", r"\bArkansas\b", "Test 2025 NCAA — Kansas vs Arkansas")
print(f"\n{'='*65}")
print("Phase 8b complete.")

# %%
