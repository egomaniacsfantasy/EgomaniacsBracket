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

# %%
# ---------------------------------------------------------------------------
# eval_2026.py
# Evaluates model_mm.py's trained model on 2026 season games (regular season
# and any other game types present in master_dataset.xlsx for Season=2026).
# Loads model_mm_artifacts.pkl — no retraining.
# Reports log loss, Brier, AUC, accuracy overall and per game type.
# ---------------------------------------------------------------------------
import warnings, sys, io
import numpy as np
import pandas as pd
import joblib
from pathlib import Path
from sklearn.metrics import (log_loss, brier_score_loss,
                              accuracy_score, roc_auc_score)
from sklearn.preprocessing import LabelEncoder

warnings.filterwarnings("ignore")
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE           = Path("c:/Users/franc/OneDrive/Jupyter/Business/MM")
DATA_PATH      = BASE / "master_dataset.xlsx"
ARTIFACT_PATH  = BASE / "model_mm_artifacts.pkl"
SEASON         = 2026

DERIVED_DIFFS = {
    "elo_trend_diff":    ("team1_elo_trend",    "team2_elo_trend"),
    "off_rtg_diff":      ("team1_avg_off_rtg",  "team2_avg_off_rtg"),
    "def_rtg_diff":      ("team1_avg_def_rtg",  "team2_avg_def_rtg"),
    "net_rtg_diff":      ("team1_avg_net_rtg",  "team2_avg_net_rtg"),
    "oreb_pct_diff":     ("team1_avg_oreb_pct", "team2_avg_oreb_pct"),
    "tov_pct_diff":      ("team1_avg_tov_pct",  "team2_avg_tov_pct"),
    "last5_Margin_diff": ("team1_last5_Margin", "team2_last5_Margin"),
}

print("=" * 65)
print(f"  2026 MODEL EVALUATION")
print("=" * 65)

# %%
# ---------------------------------------------------------------------------
# STEP 1: Load data
# ---------------------------------------------------------------------------
print("\nLoading master_dataset.xlsx ...")
with open(DATA_PATH, "rb") as fh:
    df = pd.read_excel(io.BytesIO(fh.read()))

df2026 = df[df["Season"] == SEASON].copy().reset_index(drop=True)
print(f"  2026 rows: {len(df2026):,}")
print(f"  DayNum range: {df2026['DayNum'].min()} - {df2026['DayNum'].max()}")
print(f"\n  game_type distribution:")
print("  " + df2026["game_type"].value_counts().to_string().replace("\n", "\n  "))

# %%
# ---------------------------------------------------------------------------
# STEP 2: Load model artifacts
# ---------------------------------------------------------------------------
print(f"\nLoading model artifacts from {ARTIFACT_PATH.name} ...")
arts         = joblib.load(ARTIFACT_PATH)
model        = arts["final_model"]
iso          = arts["iso"]
le_loc_saved = arts["le_loc"]
feature_cols = arts["feature_cols"]

print(f"  Features : {len(feature_cols)}")
print(f"  n_trees  : {arts['n_trees']}")

# %%
# ---------------------------------------------------------------------------
# STEP 3: Feature engineering
# ---------------------------------------------------------------------------
# Derive diff features
for col, (a, b) in DERIVED_DIFFS.items():
    df2026[col] = df2026[a] - df2026[b]

# Encode location — must match training encoding exactly
le_loc = LabelEncoder()
le_loc.fit(df2026["location"].astype(str))
current_enc = dict(zip(le_loc.classes_, le_loc.transform(le_loc.classes_)))
saved_enc   = dict(zip(le_loc_saved.classes_,
                       le_loc_saved.transform(le_loc_saved.classes_)))

if current_enc == saved_enc:
    df2026["location"] = le_loc.transform(df2026["location"].astype(str))
    print(f"\nLocation encoding verified: {current_enc}")
else:
    # Remap using the saved encoder's mapping (handles unseen categories safely)
    print(f"\n  WARNING: location encoding mismatch — remapping via saved encoder.")
    print(f"    current: {current_enc}")
    print(f"    saved  : {saved_enc}")
    df2026["location"] = df2026["location"].astype(str).map(saved_enc)

# Verify all features present
missing = [c for c in feature_cols if c not in df2026.columns]
if missing:
    raise ValueError(f"Missing feature columns: {missing}")

X2026 = df2026[feature_cols]
y2026 = df2026["team1_won"]

# %%
# ---------------------------------------------------------------------------
# STEP 4: Predict & calibrate
# ---------------------------------------------------------------------------
p_raw = model.predict_proba(X2026)[:, 1]
p_cal = iso.predict(p_raw).clip(1e-7, 1 - 1e-7)

df2026["p_raw"]       = np.round(p_raw, 4)
df2026["p_cal"]       = np.round(p_cal, 4)
df2026["pred_wins"]   = (p_cal >= 0.5).astype(int)
df2026["correct"]     = (df2026["pred_wins"] == df2026["team1_won"]).astype(int)

# %%
# ---------------------------------------------------------------------------
# STEP 5: Report metrics
# ---------------------------------------------------------------------------
def metrics(label, y_true, p_pred, indent="  "):
    y_true = np.asarray(y_true)
    p_pred = np.asarray(p_pred)
    n      = len(y_true)
    if n < 2 or len(np.unique(y_true)) < 2:
        print(f"{indent}{label}  (n={n}) — skipped (single class or too few rows)")
        return None
    pred   = (p_pred >= 0.5).astype(int)
    ll     = log_loss(y_true, p_pred)
    bs     = brier_score_loss(y_true, p_pred)
    auc    = roc_auc_score(y_true, p_pred)
    acc    = accuracy_score(y_true, pred)
    print(f"{indent}{label:<38}  n={n:>5,}  "
          f"LogLoss={ll:.5f}  Brier={bs:.5f}  AUC={auc:.5f}  Acc={acc*100:.2f}%")
    return {"label": label, "n": n, "log_loss": ll,
            "brier": bs, "auc": auc, "accuracy": acc}


print("\n" + "=" * 65)
print("  RESULTS — 2026 SEASON")
print("=" * 65)
print(f"\n  {'Slice':<38}  {'n':>5}  "
      f"{'LogLoss':>9}  {'Brier':>7}  {'AUC':>7}  {'Acc':>7}")
print("  " + "-" * 80)

results = []

# Overall 2026
r = metrics("2026 — ALL", y2026, p_cal)
if r: results.append(r)

# Per game type
for gtype in df2026["game_type"].value_counts().index:
    mask = df2026["game_type"] == gtype
    r = metrics(f"2026 — {gtype}", y2026[mask], p_cal[mask])
    if r: results.append(r)

# Late-season regular (DayNum >= 100, conference play)
late_mask = (df2026["game_type"] == "Regular") & (df2026["DayNum"] >= 100)
if late_mask.sum() >= 10:
    r = metrics("2026 — Regular (DayNum≥100)", y2026[late_mask], p_cal[late_mask])
    if r: results.append(r)

print()

# %%
# ---------------------------------------------------------------------------
# STEP 6: Calibration bins
# ---------------------------------------------------------------------------
print("=" * 65)
print("  CALIBRATION CHECK  (10 probability bins)")
print("=" * 65)
print(f"\n  {'Bin':>12}  {'n':>5}  {'mean_pred':>10}  {'actual_rate':>12}  {'delta':>8}")
print("  " + "-" * 55)

df2026["bin"] = pd.cut(df2026["p_cal"], bins=10, include_lowest=True)
cal_table = (
    df2026.groupby("bin", observed=True)
    .agg(n=("team1_won", "count"),
         mean_pred=("p_cal", "mean"),
         actual_rate=("team1_won", "mean"))
    .reset_index()
)
cal_table["delta"] = cal_table["actual_rate"] - cal_table["mean_pred"]
for _, row in cal_table.iterrows():
    bar = "+" * int(abs(row["delta"]) * 100) if abs(row["delta"]) >= 0.01 else ""
    sign = "▲" if row["delta"] > 0 else ("▼" if row["delta"] < 0 else " ")
    print(f"  {str(row['bin']):>12}  {int(row['n']):>5}  "
          f"{row['mean_pred']:>10.3f}  {row['actual_rate']:>12.3f}  "
          f"{row['delta']:>+8.3f}  {sign}{bar}")

print()

# %%
# ---------------------------------------------------------------------------
# STEP 7: DayNum breakdowns
# ---------------------------------------------------------------------------
print("=" * 65)
print("  ACCURACY BY MONTH  (DayNum → approx month)")
print("=" * 65)
# DayNum 1-30 ≈ Nov, 31-60 ≈ Dec, 61-90 ≈ Jan, 91-120 ≈ Feb, 121+ ≈ Mar
bins   = [0, 30, 60, 90, 120, 200]
labels = ["Nov (1-30)", "Dec (31-60)", "Jan (61-90)", "Feb (91-120)", "Mar (121+)"]
df2026["month_bin"] = pd.cut(df2026["DayNum"], bins=bins, labels=labels)
print(f"\n  {'Month':>15}  {'n':>5}  {'Accuracy':>9}  {'LogLoss':>9}")
print("  " + "-" * 45)
for lbl in labels:
    mask = df2026["month_bin"] == lbl
    if mask.sum() < 5:
        continue
    acc_ = accuracy_score(y2026[mask], df2026.loc[mask, "pred_wins"])
    if len(np.unique(y2026[mask])) < 2:
        continue
    ll_  = log_loss(y2026[mask], p_cal[mask])
    print(f"  {lbl:>15}  {mask.sum():>5,}  {acc_*100:>8.2f}%  {ll_:>9.5f}")

print()

# %%
# ---------------------------------------------------------------------------
# STEP 8: Comparison vs 2024 val season (from artifacts sanity check)
# ---------------------------------------------------------------------------
print("=" * 65)
print("  COMPARISON: 2026 vs 2024 (val season)")
print("=" * 65)

df2024 = df[df["Season"] == 2024].copy().reset_index(drop=True)
for col, (a, b) in DERIVED_DIFFS.items():
    df2024[col] = df2024[a] - df2024[b]
df2024["location"] = df2024["location"].astype(str).map(saved_enc)
X2024 = df2024[feature_cols]
y2024 = df2024["team1_won"]
p24_raw = model.predict_proba(X2024)[:, 1]
p24_cal = iso.predict(p24_raw).clip(1e-7, 1 - 1e-7)

print(f"\n  {'Season':<10}  {'n':>5}  {'LogLoss':>9}  {'Brier':>7}  {'AUC':>7}  {'Acc':>7}")
print("  " + "-" * 55)
for season_label, yt, pc in [("2024 (val)", y2024, p24_cal),
                               ("2026 (eval)", y2026, p_cal)]:
    ll_  = log_loss(yt, pc)
    bs_  = brier_score_loss(yt, pc)
    auc_ = roc_auc_score(yt, pc)
    acc_ = accuracy_score(yt, (pc >= 0.5).astype(int))
    print(f"  {season_label:<10}  {len(yt):>5,}  "
          f"{ll_:>9.5f}  {bs_:>7.5f}  {auc_:>7.5f}  {acc_*100:>6.2f}%")

print()
print("Done.")
