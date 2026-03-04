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
# # March Madness LightGBM Pipeline v2 — 19-Feature Lean Set
#
# **Architecture (identical to model_mm.py v3):**
# - Single LightGBM binary classifier predicting `team1_won`
# - No regression branch, no Stage 2 tournament specialist
# - Isotonic calibration fitted on OOF predictions
#
# **Features (19 total — reduced from 32):**
# - Elo (6): team1/2_elo_last, elo_diff, team1/2_elo_trend, elo_trend_diff
# - Rankings — diffs only (5): POM, MAS, MOR, WLK, BIH  (NET dropped)
# - Efficiency — diffs only (5): off_rtg_diff, def_rtg_diff, net_rtg_diff, oreb_pct_diff, tov_pct_diff
# - Form (1): last5_Margin_diff only
# - Context (2): location, DayNum
#
# **Removed vs model_mm.py:**
# - 10 raw individual efficiency stats (team1/2_avg_off/def/net_rtg, oreb_pct, tov_pct)
# - team1_last5_Margin, team2_last5_Margin (keeping only the diff)
# - rankdiff_NET (lowest SHAP in v1: 0.024)
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
import warnings, sys, io
import numpy as np
import pandas as pd
import lightgbm as lgb
import optuna
import shap
from pathlib import Path
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import (log_loss, brier_score_loss,
                              accuracy_score, roc_auc_score)
from sklearn.isotonic import IsotonicRegression
from sklearn.preprocessing import LabelEncoder

warnings.filterwarnings("ignore")
optuna.logging.set_verbosity(optuna.logging.WARNING)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE      = Path("c:/Users/franc/OneDrive/Jupyter/Business/MM")
DATA_PATH = BASE / "master_dataset.xlsx"
OUT_PATH  = BASE / "predictions2.xlsx"

RANDOM_STATE        = 42
N_TRIALS            = 100   # hard cap; convergence callback stops earlier in practice
N_SPLITS            = 5
EARLY_STOP_TRIALS   = 20    # stop Optuna if best hasn't improved in this many trials
EARLY_STOP_MIN_DELTA = 1e-5 # minimum improvement to count as progress

# ── Feature columns (19 total) ───────────────────────────────────────────────
ELO_COLS = [
    "team1_elo_last", "team2_elo_last", "elo_diff",
    "team1_elo_trend", "team2_elo_trend", "elo_trend_diff",
]

RANK_DIFF_COLS = [
    "rankdiff_POM", "rankdiff_MAS", "rankdiff_MOR",
    "rankdiff_WLK", "rankdiff_BIH",
    # rankdiff_NET dropped (lowest SHAP in v1: 0.024)
]

EFF_COLS = [
    # Diffs only — raw individual stats dropped (SHAP < 0.02 each)
    "off_rtg_diff",
    "def_rtg_diff",
    "net_rtg_diff",
    "oreb_pct_diff",
    "tov_pct_diff",
]

FORM_COLS = [
    # Diff only — team1/2_last5_Margin dropped
    "last5_Margin_diff",
]

CONTEXT_COLS = ["location", "DayNum"]

FEATURE_COLS = ELO_COLS + RANK_DIFF_COLS + EFF_COLS + FORM_COLS + CONTEXT_COLS
# 6 + 5 + 5 + 1 + 2 = 19 features

CAT_FEATURES = ["location"]   # encoded as integers; LightGBM treats natively

# 7 diff features computed at load time (not pre-built in master_dataset.xlsx)
# NOTE: all 7 are still computed; raw individual columns stay in df for this purpose
DERIVED_DIFFS = {
    "elo_trend_diff":     ("team1_elo_trend",    "team2_elo_trend"),
    "off_rtg_diff":       ("team1_avg_off_rtg",  "team2_avg_off_rtg"),
    "def_rtg_diff":       ("team1_avg_def_rtg",  "team2_avg_def_rtg"),
    "net_rtg_diff":       ("team1_avg_net_rtg",  "team2_avg_net_rtg"),
    "oreb_pct_diff":      ("team1_avg_oreb_pct", "team2_avg_oreb_pct"),
    "tov_pct_diff":       ("team1_avg_tov_pct",  "team2_avg_tov_pct"),
    "last5_Margin_diff":  ("team1_last5_Margin", "team2_last5_Margin"),
}

# Columns in every output sheet
INFO_COLS = [
    "Season", "DayNum", "game_type", "location",
    "team1_name", "team2_name",
    "team1_score", "team2_score", "score_diff", "team1_won",
]
DIFF_OUTPUT_COLS = list(DERIVED_DIFFS.keys())

# %%
# ---------------------------------------------------------------------------
# PHASE 1: LOAD & PREP DATA
# ---------------------------------------------------------------------------
print("=" * 70)
print("PHASE 1: LOAD & PREP DATA")
print("=" * 70)

with open(DATA_PATH, "rb") as _fh:
    _raw = io.BytesIO(_fh.read())
df = pd.read_excel(_raw)
print(f"Loaded: {df.shape[0]:,} rows x {df.shape[1]} cols")
print(f"Seasons: {df['Season'].min()} - {df['Season'].max()}")
print(f"\ngame_type distribution:")
print(df["game_type"].value_counts().to_string())

# Compute 7 derived diff features (raw individual columns remain in df but are not features)
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

# Verify all 19 feature columns are present
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
# PHASE 3: OPTUNA HYPERPARAMETER SEARCH  (200 trials, 5-fold CV)
# ---------------------------------------------------------------------------
print("=" * 70)
print(f"PHASE 3: OPTUNA SEARCH  ({N_TRIALS} trials, {N_SPLITS}-fold CV)")
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


def objective(trial: optuna.Trial) -> float:
    params = _params(trial)
    skf    = StratifiedKFold(n_splits=N_SPLITS, shuffle=True,
                             random_state=RANDOM_STATE)
    scores = []
    for tr_idx, vl_idx in skf.split(X_train, strat_train):
        m = lgb.LGBMClassifier(**params, n_estimators=2000)
        m.fit(
            X_train.iloc[tr_idx], y_train.iloc[tr_idx],
            sample_weight=weights_train[tr_idx],
            eval_set=[(X_train.iloc[vl_idx], y_train.iloc[vl_idx])],
            callbacks=[lgb.early_stopping(50, verbose=False),
                       lgb.log_evaluation(-1)],
            categorical_feature=CAT_FEATURES,
        )
        scores.append(
            log_loss(y_train.iloc[vl_idx],
                     m.predict_proba(X_train.iloc[vl_idx])[:, 1])
        )
    return float(np.mean(scores))


def _convergence_callback(study: optuna.Study,
                          trial: optuna.trial.FrozenTrial) -> None:
    """Stop the study if best value hasn't improved in EARLY_STOP_TRIALS trials.
    Correct check: how many trials ago was the best trial found?
    If current_trial - best_trial_number >= EARLY_STOP_TRIALS, stop.
    """
    if trial.number < EARLY_STOP_TRIALS:
        return
    trials_since_best = trial.number - study.best_trial.number
    if trials_since_best >= EARLY_STOP_TRIALS:
        print(f"\n  [Early stop] No improvement in last {EARLY_STOP_TRIALS} trials "
              f"(best={study.best_value:.6f} at trial {study.best_trial.number}). "
              f"Stopping Optuna.")
        study.stop()


study = optuna.create_study(
    direction="minimize",
    sampler=optuna.samplers.TPESampler(seed=RANDOM_STATE),
)
study.optimize(objective, n_trials=N_TRIALS, show_progress_bar=True,
               callbacks=[_convergence_callback])

best_params = study.best_params
print(f"\nBest CV log loss: {study.best_value:.5f}")
print("Best hyperparameters:")
for k, v in best_params.items():
    print(f"  {k:<25}: {v}")

# %%
# ---------------------------------------------------------------------------
# PHASE 4: FINAL MODEL TRAINING + OOF PREDICTIONS
# ---------------------------------------------------------------------------
print("=" * 70)
print("PHASE 4: FINAL MODEL TRAINING + OOF PREDICTIONS")
print("=" * 70)

# Train final model on all training data; early-stop on val to find n_trees
final_model = lgb.LGBMClassifier(
    objective="binary", metric="binary_logloss",
    verbosity=-1, boosting_type="gbdt", subsample_freq=1,
    n_jobs=-1, random_state=RANDOM_STATE,
    n_estimators=2000, **best_params,
)
final_model.fit(
    X_train, y_train,
    sample_weight=weights_train,
    eval_set=[(X_val, y_val)],
    callbacks=[lgb.early_stopping(100, verbose=False),
               lgb.log_evaluation(-1)],
    categorical_feature=CAT_FEATURES,
)
n_trees = final_model.best_iteration_ or 500
print(f"Final model n_estimators (early stop on val): {n_trees}")

# Generate OOF predictions using fixed n_trees (consistent with final model depth)
oof_prob = np.zeros(len(X_train))
skf_oof  = StratifiedKFold(n_splits=N_SPLITS, shuffle=True,
                            random_state=RANDOM_STATE)
for fold, (tr_idx, vl_idx) in enumerate(skf_oof.split(X_train, strat_train), 1):
    m = lgb.LGBMClassifier(
        objective="binary", metric="binary_logloss",
        verbosity=-1, boosting_type="gbdt", subsample_freq=1,
        n_jobs=-1, random_state=RANDOM_STATE,
        n_estimators=n_trees, **best_params,
    )
    m.fit(
        X_train.iloc[tr_idx], y_train.iloc[tr_idx],
        sample_weight=weights_train[tr_idx],
        categorical_feature=CAT_FEATURES,
    )
    oof_prob[vl_idx] = m.predict_proba(X_train.iloc[vl_idx])[:, 1]
    print(f"  OOF fold {fold} done.")

print(f"\nOOF log loss (raw, pre-calibration): {log_loss(y_train, oof_prob):.5f}")

# %%
# ---------------------------------------------------------------------------
# PHASE 5: ISOTONIC CALIBRATION
# ---------------------------------------------------------------------------
print("=" * 70)
print("PHASE 5: ISOTONIC CALIBRATION")
print("=" * 70)

iso = IsotonicRegression(out_of_bounds="clip")
iso.fit(oof_prob, y_train.values)

oof_cal    = iso.predict(oof_prob).clip(1e-7, 1 - 1e-7)
p_raw_val  = final_model.predict_proba(X_val)[:, 1]
p_raw_test = final_model.predict_proba(X_test)[:, 1]
p_cal_val  = iso.predict(p_raw_val).clip(1e-7, 1 - 1e-7)
p_cal_test = iso.predict(p_raw_test).clip(1e-7, 1 - 1e-7)

print(f"OOF log loss  pre-calibration : {log_loss(y_train, oof_prob):.5f}")
print(f"OOF log loss post-calibration : {log_loss(y_train, oof_cal):.5f}")
print(f"\nVal raw log loss  : {log_loss(y_val, p_raw_val):.5f}")
print(f"Val cal log loss  : {log_loss(y_val, p_cal_val):.5f}")

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
    return {"label": label, "n": len(y_true),
            "log_loss": ll, "brier": bs, "auc": auc, "accuracy": acc}


results = []

# 1. Train OOF
r = report_metrics("Train OOF (2014-2023, all)", y_train.values, oof_cal)
if r: results.append(r)

# 2. Val 2024 — all game types
r = report_metrics("Val 2024 — all game types", y_val.values, p_cal_val)
if r: results.append(r)

# 3. Val 2024 — NCAA tournament only
if ncaa_val_mask.sum() >= 2:
    r = report_metrics(
        f"Val 2024 — NCAA only",
        y_val.values[ncaa_val_mask],
        p_cal_val[ncaa_val_mask],
    )
    if r: results.append(r)
else:
    print("  (No 2024 NCAA games in dataset.)")

# 4. Test 2025 — all game types
r = report_metrics("Test 2025 — all game types", y_test.values, p_cal_test)
if r: results.append(r)

# 5. Test 2025 — NCAA tournament only
if ncaa_test_mask.sum() >= 2:
    r = report_metrics(
        f"Test 2025 — NCAA only",
        y_test.values[ncaa_test_mask],
        p_cal_test[ncaa_test_mask],
    )
    if r: results.append(r)
else:
    print("  (No 2025 NCAA games in dataset yet.)")

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
print(f"\n  {'Split':<35}  {'n':>6}  {'LogLoss':>8}  {'Brier':>7}  {'AUC':>7}  {'Acc':>7}")
print(f"  {'-'*35}  {'-'*6}  {'-'*8}  {'-'*7}  {'-'*7}  {'-'*7}")
for r in results:
    print(f"  {r['label']:<35}  {r['n']:>6,}  "
          f"{r['log_loss']:>8.5f}  {r['brier']:>7.5f}  "
          f"{r['auc']:>7.5f}  {r['accuracy']*100:>6.2f}%")


def build_output(df_sub: pd.DataFrame,
                 p_raw: np.ndarray,
                 p_cal: np.ndarray) -> pd.DataFrame:
    """Assemble output sheet: info + win% + pred + outcome + all 19 features + probs."""
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
    # All 19 input features (location + DayNum already included above)
    for col in FEATURE_COLS:
        if col not in out.columns:
            out[col] = df_sub[col].values
    # Raw model outputs
    out["prob_raw"]        = np.round(p_raw, 4)
    out["prob_calibrated"] = np.round(p_cal, 4)
    return out


df_val_out  = build_output(df_val,  p_raw_val,  p_cal_val)
df_test_out = build_output(df_test, p_raw_test, p_cal_test)

# Save as two sheets in a single predictions2.xlsx
try:
    with pd.ExcelWriter(OUT_PATH, engine="openpyxl") as writer:
        df_val_out.to_excel(writer,  sheet_name="val_2024",  index=False)
        df_test_out.to_excel(writer, sheet_name="test_2025", index=False)
    print(f"\nSaved -> {OUT_PATH}")
    print(f"  Sheet 'val_2024'  : {len(df_val_out):,} rows")
    print(f"  Sheet 'test_2025' : {len(df_test_out):,} rows")
except PermissionError:
    fb = OUT_PATH.with_name("predictions2_new.xlsx")
    with pd.ExcelWriter(fb, engine="openpyxl") as writer:
        df_val_out.to_excel(writer,  sheet_name="val_2024",  index=False)
        df_test_out.to_excel(writer, sheet_name="test_2025", index=False)
    print(f"\nSaved (fallback — close Excel if open): {fb}")

print("\nAll done!")

# %%
# ---------------------------------------------------------------------------
# PHASE 8b: REBUILD OUTPUT FROM EXISTING PROBABILITIES
# Run this cell (after the imports/constants cell) to regenerate
# predictions2.xlsx with all 19 input features without retraining.
# Reads prob_calibrated from current predictions2.xlsx and joins with
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

# Load existing probabilities from current predictions2.xlsx
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
    _fb8b = OUT_PATH.with_name("predictions2_rebuilt.xlsx")
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
               "rankdiff_WLK", "rankdiff_BIH"]:
        s = rc.replace("rankdiff_", "")
        v = row[rc]
        note = "team1 higher" if v < 0 else ("team2 higher" if v > 0 else "tied")
        print(f"  {s:<30} {v:>+10.0f}  ({note})")
    print(f"\n  ─── EFFICIENCY DIFFS ──────────────────────────────────")
    for cd in ["off_rtg_diff", "def_rtg_diff", "net_rtg_diff",
               "oreb_pct_diff", "tov_pct_diff"]:
        print(f"  {cd:<30} {row[cd]:>+10.2f}")
    print(f"\n  ─── FORM (last-5 avg margin diff) ─────────────────────")
    print(f"  {'last5_Margin_diff':<30} {row['last5_Margin_diff']:>+10.2f}")
    print(f"\n  NOTE: Tournament seedings are NOT a feature in this model.")


print(f"\n{'='*65}")
print("GAME DIAGNOSTICS")
print(f"{'='*65}")
_diag8b(_out_val8b,  r"\bTexas\b",  r"Colorado St",  "Val 2024 NCAA — Texas vs Colorado St")
_diag8b(_out_test8b, r"\bKansas\b", r"\bArkansas\b", "Test 2025 NCAA — Kansas vs Arkansas")
print(f"\n{'='*65}")
print("Phase 8b complete.")
