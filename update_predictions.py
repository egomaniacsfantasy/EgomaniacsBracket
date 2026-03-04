"""
update_predictions.py  — Phase 8b runner
Executes only the Phase 8b cell from model_mm.py (no model retraining).
Rebuilds predictions.xlsx with all 32 input features, then prints
game diagnostics for Texas/Colorado St (2024) and Kansas/Arkansas (2025).
"""
import warnings, sys, io
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.preprocessing import LabelEncoder

warnings.filterwarnings("ignore")
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE      = Path("c:/Users/franc/OneDrive/Jupyter/Business/MM")
DATA_PATH = BASE / "master_dataset.xlsx"
OUT_PATH  = BASE / "predictions.xlsx"

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
FORM_COLS    = ["team1_last5_Margin", "team2_last5_Margin", "last5_Margin_diff"]
CONTEXT_COLS = ["location", "DayNum"]
FEATURE_COLS = ELO_COLS + RANK_DIFF_COLS + EFF_COLS + FORM_COLS + CONTEXT_COLS  # 32

DERIVED_DIFFS = {
    "elo_trend_diff":    ("team1_elo_trend",    "team2_elo_trend"),
    "off_rtg_diff":      ("team1_avg_off_rtg",  "team2_avg_off_rtg"),
    "def_rtg_diff":      ("team1_avg_def_rtg",  "team2_avg_def_rtg"),
    "net_rtg_diff":      ("team1_avg_net_rtg",  "team2_avg_net_rtg"),
    "oreb_pct_diff":     ("team1_avg_oreb_pct", "team2_avg_oreb_pct"),
    "tov_pct_diff":      ("team1_avg_tov_pct",  "team2_avg_tov_pct"),
    "last5_Margin_diff": ("team1_last5_Margin", "team2_last5_Margin"),
}

MERGE_KEYS = ["Season", "DayNum", "team1_name", "team2_name"]

# ── Load master dataset ───────────────────────────────────────────────────────
print("Loading master_dataset.xlsx ...")
with open(DATA_PATH, "rb") as fh:
    df_all = pd.read_excel(io.BytesIO(fh.read()))

for col, (a, b) in DERIVED_DIFFS.items():
    df_all[col] = df_all[a] - df_all[b]

le = LabelEncoder()
df_all["location"] = le.fit_transform(df_all["location"].astype(str))

df_val  = df_all[df_all["Season"] == 2024].copy().reset_index(drop=True)
df_test = df_all[df_all["Season"] == 2025].copy().reset_index(drop=True)

# ── Load existing calibrated probabilities ────────────────────────────────────
print("Loading existing probabilities from predictions.xlsx ...")
xl_probs = pd.read_excel(OUT_PATH, sheet_name=None)


def get_cal(probs_sheet: pd.DataFrame, df_sub: pd.DataFrame) -> np.ndarray:
    merged = df_sub[MERGE_KEYS].merge(
        probs_sheet[MERGE_KEYS + ["prob_calibrated"]],
        on=MERGE_KEYS, how="left",
    )
    n_miss = merged["prob_calibrated"].isna().sum()
    if n_miss:
        print(f"  WARNING: {n_miss} rows had no match — defaulting to 0.5")
    return merged["prob_calibrated"].fillna(0.5).values


p_val  = get_cal(xl_probs["val_2024"],  df_val)
p_test = get_cal(xl_probs["test_2025"], df_test)

# ── Build output with all features ───────────────────────────────────────────
def mk_out(df_sub: pd.DataFrame, p_cal: np.ndarray) -> pd.DataFrame:
    pred    = (p_cal >= 0.5).astype(int)
    correct = (pred == df_sub["team1_won"].values).astype(int)
    out = pd.DataFrame({
        "Season"          : df_sub["Season"].values,
        "DayNum"          : df_sub["DayNum"].values,
        "game_type"       : df_sub["game_type"].values,
        "location"        : le.inverse_transform(df_sub["location"].values.astype(int)),
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


out_val  = mk_out(df_val,  p_val)
out_test = mk_out(df_test, p_test)

# ── Save ──────────────────────────────────────────────────────────────────────
print("\nSaving ...")
try:
    with pd.ExcelWriter(OUT_PATH, engine="openpyxl") as writer:
        out_val.to_excel(writer,  sheet_name="val_2024",  index=False)
        out_test.to_excel(writer, sheet_name="test_2025", index=False)
    print(f"Saved -> {OUT_PATH}")
    print(f"  val_2024  : {len(out_val):,} rows x {out_val.shape[1]} cols")
    print(f"  test_2025 : {len(out_test):,} rows x {out_test.shape[1]} cols")
    print(f"  Columns   : {list(out_val.columns)}")
except PermissionError:
    fb = OUT_PATH.with_name("predictions_rebuilt.xlsx")
    with pd.ExcelWriter(fb, engine="openpyxl") as writer:
        out_val.to_excel(writer,  sheet_name="val_2024",  index=False)
        out_test.to_excel(writer, sheet_name="test_2025", index=False)
    print(f"Saved (fallback — close Excel): {fb}")

# ── Game diagnostics ──────────────────────────────────────────────────────────
def diag(df: pd.DataFrame, re1: str, re2: str, label: str) -> None:
    sub  = df[df["game_type"] == "NCAA"]
    mask = (
        sub["team1_name"].str.contains(re1, case=False, regex=True) |
        sub["team2_name"].str.contains(re1, case=False, regex=True)
    ) & (
        sub["team1_name"].str.contains(re2, case=False, regex=True) |
        sub["team2_name"].str.contains(re2, case=False, regex=True)
    )
    hits = sub[mask]
    if hits.empty:
        # show candidates
        cands = sub[
            sub["team1_name"].str.contains(re1, case=False, regex=True) |
            sub["team2_name"].str.contains(re1, case=False, regex=True)
        ][["team1_name", "team2_name", "DayNum"]].to_string()
        print(f"\n[{label}] NOT FOUND. Teams matching '{re1}':\n{cands}")
        return
    row = hits.iloc[0]
    t1, t2 = row["team1_name"], row["team2_name"]
    score_str = (f"{t1} {int(row['team1_score'])} - {int(row['team2_score'])} {t2}"
                 if pd.notna(row.get("team1_score")) else "score N/A")
    won = t1 if row["team1_won"] == 1 else t2
    sep = "=" * 65
    print(f"\n{sep}")
    print(f"  {label}")
    print(f"  {t1}  vs  {t2}")
    print(f"  DayNum: {row['DayNum']}  |  location: {row['location']}")
    print(f"  Result: {score_str}  ->  winner: {won}")
    print(sep)
    print(f"  {t1:<32} win% = {row['team1_win_pct']:5.1f}%")
    print(f"  {t2:<32} win% = {row['team2_win_pct']:5.1f}%")
    print(f"  Model correct: {'YES' if row['correct'] == 1 else 'NO'}")

    print(f"\n  --- ELO ---")
    print(f"  {'':30} {'team1':>10}  {'team2':>10}  {'diff':>10}")
    print(f"  {'elo_last':<30} {row['team1_elo_last']:>10.1f}  {row['team2_elo_last']:>10.1f}  {row['elo_diff']:>+10.1f}")
    print(f"  {'elo_trend':<30} {row['team1_elo_trend']:>10.1f}  {row['team2_elo_trend']:>10.1f}  {row['elo_trend_diff']:>+10.1f}")

    print(f"\n  --- RANKINGS (diff = team1_rank - team2_rank; negative = team1 ranked higher) ---")
    for rc in ["rankdiff_POM", "rankdiff_MAS", "rankdiff_MOR",
               "rankdiff_WLK", "rankdiff_BIH", "rankdiff_NET"]:
        s = rc.replace("rankdiff_", "")
        v = row[rc]
        note = "team1 higher" if v < 0 else ("team2 higher" if v > 0 else "tied")
        print(f"  {s:<30} {v:>+10.0f}  ({note})")

    print(f"\n  --- EFFICIENCY ---")
    print(f"  {'':30} {'team1':>10}  {'team2':>10}  {'diff':>10}")
    for metric, c1, c2, cd in [
        ("off_rtg",  "team1_avg_off_rtg",  "team2_avg_off_rtg",  "off_rtg_diff"),
        ("def_rtg",  "team1_avg_def_rtg",  "team2_avg_def_rtg",  "def_rtg_diff"),
        ("net_rtg",  "team1_avg_net_rtg",  "team2_avg_net_rtg",  "net_rtg_diff"),
        ("oreb_pct", "team1_avg_oreb_pct", "team2_avg_oreb_pct", "oreb_pct_diff"),
        ("tov_pct",  "team1_avg_tov_pct",  "team2_avg_tov_pct",  "tov_pct_diff"),
    ]:
        print(f"  {metric:<30} {row[c1]:>10.2f}  {row[c2]:>10.2f}  {row[cd]:>+10.2f}")

    print(f"\n  --- FORM (last-5 avg margin) ---")
    print(f"  {'':30} {'team1':>10}  {'team2':>10}  {'diff':>10}")
    print(f"  {'last5_Margin':<30} {row['team1_last5_Margin']:>10.2f}  {row['team2_last5_Margin']:>10.2f}  {row['last5_Margin_diff']:>+10.2f}")
    print(f"\n  NOTE: Tournament seedings are NOT a feature in this model.")


print(f"\n{'='*65}")
print("GAME DIAGNOSTICS")
print(f"{'='*65}")
diag(out_val,  r"\bTexas\b",  r"Colorado St",  "Val 2024 NCAA — Texas vs Colorado St")
diag(out_test, r"\bKansas\b", r"\bArkansas\b", "Test 2025 NCAA — Kansas vs Arkansas")

print("\nDone. (Logic for Phase 8b now lives in model_mm.py — this file is a runner only.)")
