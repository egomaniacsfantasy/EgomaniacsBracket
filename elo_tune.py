"""
elo_tune.py
===========
Fast Elo hyperparameter search using logistic regression as a surrogate model.

Objective
---------
Tune Elo construction parameters by evaluating their downstream effect on
NCAA tournament prediction log loss.  Using logistic regression (not the full
LightGBM pipeline), each trial takes ~3-5 s instead of ~15 min — enabling
100 Optuna trials in ~10-15 minutes.

Elo formulation (v2 — quality-scaled, cross-conference boosted)
---------------------------------------------------------------
  Replaces MOV weighting with two improvements that directly address
  the conference-isolation / echo-chamber problem:

  1. Game-quality K scaling:
       q_mult = clip((avg_pre_elo - Q_FLOOR) / Q_SCALE, Q_MIN, Q_MAX)
       k_eff  = k_base * q_mult
     Games between two elite teams earn large rating updates.
     Games between two weak teams barely move ratings.
     This prevents mid-majors accumulating Elo by beating each other.

  2. Cross-conference boost:
       k_eff *= CROSS_CONF_BOOST  (if teams are from different conferences)
     Non-conference games (Nov/Dec) are the "bridge" between conference
     rating ecosystems.  Boosting them accelerates inter-conference
     calibration so Mountain West Elo and Big 12 Elo are on the same scale.

Validation strategy
-------------------
  Elo-tune train : seasons 2014-2021 (all game types)
  Elo-tune val   : seasons 2022-2023 NCAA games only  (n ≈ 134)
  Reported only  : val 2024 NCAA, test 2025 NCAA (not used in objective)

Parameters searched (10 total)
-------------------------------
  home_advantage   : Elo pts added to home team effective rating
  regress_alpha    : Fraction of prior-season Elo carried over (rest → 1505)
  k_early          : K-factor for first 5 games of season
  k_mid            : K-factor for games 6-20
  k_late           : K-factor for games 21+
  q_floor          : Avg-Elo below which quality multiplier = Q_MIN
  q_scale          : Range over which quality multiplier rises from Q_MIN → Q_MAX
  q_min            : Minimum quality multiplier (weak vs weak games)
  q_max            : Maximum quality multiplier (elite vs elite games)
  cross_conf_boost : K multiplier applied to cross-conference games
"""

import io
import sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import numpy as np
import pandas as pd
import optuna
optuna.logging.set_verbosity(optuna.logging.WARNING)

from pathlib import Path
from scipy.stats import linregress as _linreg
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.pipeline import Pipeline
from sklearn.metrics import log_loss

DATA_DIR = Path(__file__).resolve().parent

# ─────────────────────────────────────────────────────────────────────────────
# 1. Load raw regular-season data + conference affiliations
# ─────────────────────────────────────────────────────────────────────────────
print("Loading raw data...")
SEASON_MIN, SEASON_MAX = 2014, 2026

reg_raw = pd.read_csv(DATA_DIR / "MRegularSeasonCompactResults.csv")
ctag    = pd.read_csv(DATA_DIR / "MConferenceTourneyGames.csv")
conf_df = pd.read_csv(DATA_DIR / "MTeamConferences.csv")

reg_raw = reg_raw[reg_raw["Season"].between(SEASON_MIN, SEASON_MAX)].copy()
ctag_keys = ctag[["Season", "DayNum", "WTeamID", "LTeamID"]].copy()
ctag_keys["_is_conf"] = True
reg_raw = reg_raw.merge(ctag_keys, on=["Season", "DayNum", "WTeamID", "LTeamID"], how="left")
reg_raw["game_type"] = np.where(reg_raw["_is_conf"] == True, "ConfTourney", "Regular")
reg_raw = reg_raw.drop(columns=["_is_conf"])

# Build conference lookup: (season, teamid) -> ConfAbbrev
team_conf_map = {
    (int(r.Season), int(r.TeamID)): r.ConfAbbrev
    for _, r in conf_df.iterrows()
}
print(f"  Conference map entries: {len(team_conf_map):,}  "
      f"(seasons {conf_df.Season.min()}-{conf_df.Season.max()})")

# ─────────────────────────────────────────────────────────────────────────────
# 2. Load master_dataset.xlsx — strip existing Elo cols, keep everything else
# ─────────────────────────────────────────────────────────────────────────────
print("Loading master_dataset.xlsx ...")
with open(DATA_DIR / "master_dataset.xlsx", "rb") as f:
    raw_bytes = f.read()
df_base = pd.read_excel(io.BytesIO(raw_bytes))

ELO_COLS = ["team1_elo_last", "team2_elo_last", "elo_diff",
            "team1_elo_trend", "team2_elo_trend"]
df_base = df_base.drop(columns=[c for c in ELO_COLS if c in df_base.columns])

le_loc = LabelEncoder()
df_base["loc_enc"] = le_loc.fit_transform(df_base["location"].fillna("N"))
print(f"  Base df shape (no Elo): {df_base.shape}")

# ─────────────────────────────────────────────────────────────────────────────
# 3. Feature columns (excluding Elo; added per trial)
# ─────────────────────────────────────────────────────────────────────────────
NON_ELO_FEATS = [
    "rankdiff_POM", "rankdiff_MAS", "rankdiff_MOR", "rankdiff_WLK",
    "rankdiff_BIH", "rankdiff_NET",
    "team1_avg_off_rtg", "team2_avg_off_rtg",
    "team1_avg_def_rtg", "team2_avg_def_rtg",
    "team1_avg_net_rtg", "team2_avg_net_rtg",
    "team1_avg_oreb_pct", "team2_avg_oreb_pct",
    "team1_avg_tov_pct",  "team2_avg_tov_pct",
    "team1_last5_Margin", "team2_last5_Margin",
    "loc_enc", "DayNum",
]
# elo_trend excluded — O(n²) linregress is too slow for 100 trials.
# Low SHAP vs elo_diff; doesn't affect optimal core param choice.
ELO_FEATS = ["team1_elo_last", "team2_elo_last", "elo_diff"]
ALL_FEATS  = ELO_FEATS + NON_ELO_FEATS   # 23 features total

# ─────────────────────────────────────────────────────────────────────────────
# 4. Masks, weights
# ─────────────────────────────────────────────────────────────────────────────
elo_train_mask = df_base["Season"].between(2014, 2021)
elo_val_mask   = df_base["Season"].isin([2022, 2023]) & (df_base["game_type"] == "NCAA")

rep_train_mask  = df_base["Season"].between(2014, 2023)
rep_val24_mask  = (df_base["Season"] == 2024) & (df_base["game_type"] == "NCAA")
rep_test25_mask = (df_base["Season"] == 2025) & (df_base["game_type"] == "NCAA")

y_base = df_base["team1_won"].values


def _sample_weights(sub_df):
    w = np.ones(len(sub_df))
    w[sub_df["game_type"] == "NCAA"]        = 6.0
    w[sub_df["game_type"] == "Secondary"]   = 3.0
    w[sub_df["game_type"] == "ConfTourney"] = 2.0
    late = (sub_df["game_type"] == "Regular") & (sub_df["DayNum"] >= 100)
    w[late] = 2.0
    return w


# ─────────────────────────────────────────────────────────────────────────────
# 5. Parameterised Elo function  (v2: quality-scaled + cross-conf boost)
# ─────────────────────────────────────────────────────────────────────────────
def compute_elo(reg_df, conf_map,
                home_adv, regress_alpha,
                k_early, k_mid, k_late,
                q_floor, q_scale, q_min, q_max,
                cross_conf_boost,
                initial=1500, scale=400, regress_mean=1505):
    """
    Leakage-free continuous Elo with:
      - Home-court adjustment
      - Partial seasonal regression
      - Variable K-factor by games played
      - Game-quality K scaling (replaces MOV)
      - Cross-conference K boost

    Returns (game_elo_df, season_elo_df).
    elo_trend omitted for speed (low SHAP, doesn't affect core param tuning).
    """
    data = reg_df.sort_values(["Season", "DayNum"]).reset_index(drop=True)

    team_ratings     = {}
    team_last_season = {}
    season_game_cnt  = {}
    pre_game_hist    = {}   # (season, team) -> list of (daynum, pre_elo)

    for season, day, w, l, wscore, lscore, wloc in zip(
        data["Season"], data["DayNum"],
        data["WTeamID"], data["LTeamID"],
        data["WScore"],  data["LScore"],
        data["WLoc"]
    ):
        season, day = int(season), int(day)
        w, l = int(w), int(l)

        # ── Partial seasonal regression ───────────────────────────────────────
        for team in (w, l):
            if team in team_last_season and team_last_season[team] != season:
                team_ratings[team] = (regress_alpha * team_ratings[team]
                                      + (1 - regress_alpha) * regress_mean)
            team_last_season[team] = season

        rw = team_ratings.get(w, initial)
        rl = team_ratings.get(l, initial)

        pre_game_hist.setdefault((season, w), []).append((day, rw))
        pre_game_hist.setdefault((season, l), []).append((day, rl))

        # ── Home-court adjustment ─────────────────────────────────────────────
        if wloc == "H":
            adj_rl = rl - home_adv
        elif wloc == "A":
            adj_rl = rl + home_adv
        else:
            adj_rl = rl
        e_w = 1.0 / (1.0 + 10.0 ** ((adj_rl - rw) / scale))

        # ── Variable K by games played ────────────────────────────────────────
        gw    = season_game_cnt.get((season, w), 0)
        gl    = season_game_cnt.get((season, l), 0)
        avg_g = (gw + gl) / 2.0
        k_base = k_early if avg_g < 5 else (k_mid if avg_g < 20 else k_late)

        # ── Game-quality K scaling (replaces MOV) ─────────────────────────────
        avg_elo_val = (rw + rl) / 2.0
        q_mult = float(np.clip((avg_elo_val - q_floor) / q_scale, q_min, q_max))

        # ── Cross-conference boost ────────────────────────────────────────────
        conf_w = conf_map.get((season, w))
        conf_l = conf_map.get((season, l))
        cc_mult = (cross_conf_boost
                   if (conf_w is not None and conf_l is not None and conf_w != conf_l)
                   else 1.0)

        k_eff = k_base * q_mult * cc_mult

        team_ratings[w] = rw + k_eff * (1.0 - e_w)
        team_ratings[l] = rl + k_eff * (0.0 - (1.0 - e_w))

        season_game_cnt[(season, w)] = gw + 1
        season_game_cnt[(season, l)] = gl + 1

    game_rows, season_rows = [], []
    for (season, team), game_list in pre_game_hist.items():
        for day, pre_elo in game_list:
            game_rows.append({"Season": season, "DayNum": day, "TeamID": team,
                               "elo_last": round(pre_elo, 3)})
        final_elo = team_ratings.get(team, initial)
        season_rows.append({"Season": season, "TeamID": team,
                             "elo_last": round(final_elo, 3)})

    return pd.DataFrame(game_rows), pd.DataFrame(season_rows)


# ─────────────────────────────────────────────────────────────────────────────
# 6. Join Elo back onto df_base
# ─────────────────────────────────────────────────────────────────────────────
def join_elo(df, game_elo, season_elo):
    """Join elo_last only (no trend) into df."""
    df = df.copy()
    for team_col, pfx in [("team1_id", "team1_"), ("team2_id", "team2_")]:
        lc = f"{pfx}elo_last"
        g = game_elo.rename(columns={"TeamID": team_col, "elo_last": lc})
        df = df.merge(g[["Season", "DayNum", team_col, lc]],
                      on=["Season", "DayNum", team_col], how="left")
        null_mask = df[lc].isna()
        if null_mask.any():
            s = season_elo.rename(columns={"TeamID": team_col, "elo_last": "_el"})
            df = df.merge(s[["Season", team_col, "_el"]],
                          on=["Season", team_col], how="left")
            df.loc[null_mask, lc] = df.loc[null_mask, "_el"]
            df = df.drop(columns=["_el"])
    df["elo_diff"] = df["team1_elo_last"] - df["team2_elo_last"]
    return df


# ─────────────────────────────────────────────────────────────────────────────
# 7. Logistic regression helper
# ─────────────────────────────────────────────────────────────────────────────
def fit_lr(X, y, w):
    pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("lr",     LogisticRegression(max_iter=2000, C=1.0, solver="lbfgs")),
    ])
    pipe.fit(X, y, lr__sample_weight=w)
    return pipe


def eval_ll(pipe, X, y):
    prob = pipe.predict_proba(X)[:, 1]
    prob = np.clip(prob, 1e-7, 1 - 1e-7)
    return log_loss(y, prob)


# ─────────────────────────────────────────────────────────────────────────────
# 8. Optuna objective  (10 parameters)
# ─────────────────────────────────────────────────────────────────────────────
N_TRIALS      = 100
EARLY_STOP    = 20
best_val_so_far   = [np.inf]
trials_no_improve = [0]


def objective(trial):
    home_adv         = trial.suggest_float("home_advantage",   0,    200,   step=25)
    regress_alpha    = trial.suggest_float("regress_alpha",    0.40, 0.95,  step=0.05)
    k_early          = trial.suggest_int  ("k_early",          10,   50,    step=5)
    k_mid            = trial.suggest_int  ("k_mid",            20,   60,    step=5)
    k_late           = trial.suggest_int  ("k_late",           15,   50,    step=5)
    q_floor          = trial.suggest_float("q_floor",          1200, 1600,  step=50)
    q_scale_p        = trial.suggest_float("q_scale",          200,  800,   step=50)
    q_min_p          = trial.suggest_float("q_min",            0.05, 0.50,  step=0.05)
    q_max_p          = trial.suggest_float("q_max",            1.50, 3.00,  step=0.25)
    cross_conf_boost = trial.suggest_float("cross_conf_boost", 1.00, 2.50,  step=0.25)

    game_elo, season_elo = compute_elo(
        reg_raw, team_conf_map,
        home_adv, regress_alpha,
        k_early, k_mid, k_late,
        q_floor, q_scale_p, q_min_p, q_max_p,
        cross_conf_boost,
    )

    df = join_elo(df_base, game_elo, season_elo)

    feat_mask = df[ALL_FEATS].notna().all(axis=1)
    df = df[feat_mask].reset_index(drop=True)
    y  = df["team1_won"].values

    tr_mask  = df["Season"].between(2014, 2021)
    val_mask = df["Season"].isin([2022, 2023]) & (df["game_type"] == "NCAA")

    X_tr  = df.loc[tr_mask,  ALL_FEATS].values
    y_tr  = y[tr_mask]
    w_tr  = _sample_weights(df[tr_mask])

    X_val = df.loc[val_mask, ALL_FEATS].values
    y_val = y[val_mask]

    if len(y_val) == 0:
        return 1.0

    pipe = fit_lr(X_tr, y_tr, w_tr)
    ll   = eval_ll(pipe, X_val, y_val)

    if ll < best_val_so_far[0]:
        best_val_so_far[0] = ll
        trials_no_improve[0] = 0
    else:
        trials_no_improve[0] += 1

    return ll


class EarlyStop:
    def __call__(self, study, trial):
        if trials_no_improve[0] >= EARLY_STOP:
            study.stop()


# ─────────────────────────────────────────────────────────────────────────────
# 9. Run Optuna
# ─────────────────────────────────────────────────────────────────────────────
print(f"\nRunning Optuna ({N_TRIALS} trials, early-stop after {EARLY_STOP} no-improve)...")
print("Parameters: home_advantage, regress_alpha, k_early/mid/late, "
      "q_floor, q_scale, q_min, q_max, cross_conf_boost")
study = optuna.create_study(direction="minimize",
                             sampler=optuna.samplers.TPESampler(seed=42))
study.optimize(objective, n_trials=N_TRIALS, callbacks=[EarlyStop()],
               show_progress_bar=True)

best = study.best_trial
bp   = best.params
print(f"\n{'='*65}")
print(f"Best elo-tune val (2022-2023 NCAA) log loss: {best.value:.5f}")
print(f"  home_advantage   : {bp['home_advantage']:.0f}")
print(f"  regress_alpha    : {bp['regress_alpha']:.2f}")
print(f"  k_early          : {bp['k_early']}    (games 1-5)")
print(f"  k_mid            : {bp['k_mid']}    (games 6-20)")
print(f"  k_late           : {bp['k_late']}    (games 21+)")
print(f"  q_floor          : {bp['q_floor']:.0f}   (avg Elo quality floor)")
print(f"  q_scale          : {bp['q_scale']:.0f}   (quality normalization range)")
print(f"  q_min            : {bp['q_min']:.2f}   (min quality multiplier)")
print(f"  q_max            : {bp['q_max']:.2f}   (max quality multiplier)")
print(f"  cross_conf_boost : {bp['cross_conf_boost']:.2f}   (cross-conference K multiplier)")
print(f"{'='*65}\n")

# ─────────────────────────────────────────────────────────────────────────────
# 10. Evaluate best params on all splits using full 2014-2023 training
# ─────────────────────────────────────────────────────────────────────────────
print("Evaluating best params on all splits (LR trained on 2014-2023 all games)...")
game_elo_best, season_elo_best = compute_elo(
    reg_raw, team_conf_map,
    bp["home_advantage"], bp["regress_alpha"],
    bp["k_early"], bp["k_mid"], bp["k_late"],
    bp["q_floor"], bp["q_scale"], bp["q_min"], bp["q_max"],
    bp["cross_conf_boost"],
)
df_best = join_elo(df_base, game_elo_best, season_elo_best)
feat_mask = df_best[ALL_FEATS].notna().all(axis=1)
df_best = df_best[feat_mask].reset_index(drop=True)
y_best  = df_best["team1_won"].values

tr_m   = df_best["Season"].between(2014, 2023)
v22_m  = df_best["Season"].isin([2022, 2023]) & (df_best["game_type"] == "NCAA")
v24_m  = (df_best["Season"] == 2024) & (df_best["game_type"] == "NCAA")
t25_m  = (df_best["Season"] == 2025) & (df_best["game_type"] == "NCAA")

pipe_best = fit_lr(df_best.loc[tr_m, ALL_FEATS].values,
                   y_best[tr_m],
                   _sample_weights(df_best[tr_m]))


def report(label, m):
    X = df_best.loc[m, ALL_FEATS].values
    y = y_best[m]
    p = np.clip(pipe_best.predict_proba(X)[:, 1], 1e-7, 1 - 1e-7)
    ll  = log_loss(y, p)
    acc = ((p > 0.5).astype(int) == y).mean() * 100
    print(f"  {label:<45} n={m.sum():4d}  LogLoss={ll:.5f}  Acc={acc:.1f}%")


print()
print("── BEST PARAMS (v2: quality-K + cross-conf boost) ───────────────────")
report("Elo-tune val  2022+2023 NCAA", v22_m)
report("Val  2024 — NCAA             ", v24_m)
report("Test 2025 — NCAA             ", t25_m)

# ─────────────────────────────────────────────────────────────────────────────
# 11. Compare to previous best (MOV version: HOME=125, ALPHA=0.90,
#     MOV_K=1.0, K=35/45/25)
# ─────────────────────────────────────────────────────────────────────────────
print("\nComputing previous-best (MOV) Elo for comparison...")


def compute_elo_mov(reg_df, home_adv=125, regress_alpha=0.90,
                    k_early=35, k_mid=45, k_late=25, mov_k=1.0,
                    initial=1500, scale=400, regress_mean=1505):
    """Previous MOV-based Elo for comparison only."""
    data = reg_df.sort_values(["Season", "DayNum"]).reset_index(drop=True)
    team_ratings, team_last_season, season_game_cnt = {}, {}, {}
    pre_game_hist = {}

    for season, day, w, l, wscore, lscore, wloc in zip(
        data["Season"], data["DayNum"], data["WTeamID"], data["LTeamID"],
        data["WScore"], data["LScore"], data["WLoc"]
    ):
        season, day = int(season), int(day)
        w, l = int(w), int(l)
        wscore, lscore = int(wscore), int(lscore)

        for team in (w, l):
            if team in team_last_season and team_last_season[team] != season:
                team_ratings[team] = (regress_alpha * team_ratings[team]
                                      + (1 - regress_alpha) * regress_mean)
            team_last_season[team] = season

        rw = team_ratings.get(w, initial)
        rl = team_ratings.get(l, initial)
        pre_game_hist.setdefault((season, w), []).append((day, rw))
        pre_game_hist.setdefault((season, l), []).append((day, rl))

        adj_rl = (rl - home_adv if wloc == "H" else
                  rl + home_adv if wloc == "A" else rl)
        e_w = 1.0 / (1.0 + 10.0 ** ((adj_rl - rw) / scale))

        gw    = season_game_cnt.get((season, w), 0)
        gl    = season_game_cnt.get((season, l), 0)
        avg_g = (gw + gl) / 2.0
        k_base = k_early if avg_g < 5 else (k_mid if avg_g < 20 else k_late)

        margin  = wscore - lscore
        elo_adv = rw - rl
        denom   = max(elo_adv * 0.001 + mov_k, 0.5)
        k_eff   = k_base * np.log(margin + 1) * mov_k / denom

        team_ratings[w] = rw + k_eff * (1.0 - e_w)
        team_ratings[l] = rl + k_eff * (0.0 - (1.0 - e_w))
        season_game_cnt[(season, w)] = gw + 1
        season_game_cnt[(season, l)] = gl + 1

    game_rows, season_rows = [], []
    for (season, team), game_list in pre_game_hist.items():
        for day, pre_elo in game_list:
            game_rows.append({"Season": season, "DayNum": day, "TeamID": team,
                               "elo_last": round(pre_elo, 3)})
        season_rows.append({"Season": season, "TeamID": team,
                             "elo_last": round(team_ratings.get(team, initial), 3)})
    return pd.DataFrame(game_rows), pd.DataFrame(season_rows)


game_elo_mov, season_elo_mov = compute_elo_mov(reg_raw)
df_mov = join_elo(df_base, game_elo_mov, season_elo_mov)
feat_mask_mov = df_mov[ALL_FEATS].notna().all(axis=1)
df_mov  = df_mov[feat_mask_mov].reset_index(drop=True)
y_mov   = df_mov["team1_won"].values

tr_m2  = df_mov["Season"].between(2014, 2023)
v22_m2 = df_mov["Season"].isin([2022, 2023]) & (df_mov["game_type"] == "NCAA")
v24_m2 = (df_mov["Season"] == 2024) & (df_mov["game_type"] == "NCAA")
t25_m2 = (df_mov["Season"] == 2025) & (df_mov["game_type"] == "NCAA")

pipe_mov = fit_lr(df_mov.loc[tr_m2, ALL_FEATS].values,
                  y_mov[tr_m2], _sample_weights(df_mov[tr_m2]))


def report_mov(label, m):
    X = df_mov.loc[m, ALL_FEATS].values
    y = y_mov[m]
    p = np.clip(pipe_mov.predict_proba(X)[:, 1], 1e-7, 1 - 1e-7)
    ll  = log_loss(y, p)
    acc = ((p > 0.5).astype(int) == y).mean() * 100
    print(f"  {label:<45} n={m.sum():4d}  LogLoss={ll:.5f}  Acc={acc:.1f}%")


print()
print("── PREVIOUS BEST  (MOV: home=125, alpha=0.90, mov_k=1.0, K=35/45/25) ─")
report_mov("Elo-tune val  2022+2023 NCAA", v22_m2)
report_mov("Val  2024 — NCAA             ", v24_m2)
report_mov("Test 2025 — NCAA             ", t25_m2)

print()
print("── NEW BEST (quality-K + cross-conf) ────────────────────────────────")
report("Elo-tune val  2022+2023 NCAA", v22_m)
report("Val  2024 — NCAA             ", v24_m)
report("Test 2025 — NCAA             ", t25_m)

# ─────────────────────────────────────────────────────────────────────────────
# 12. Print Elo range and cross-conference game stats
# ─────────────────────────────────────────────────────────────────────────────
df_best_2025 = df_best[df_best["Season"] == 2025]
print(f"\nElo stats (best params, 2025 season rows):")
print(f"  team1_elo_last range: [{df_best_2025['team1_elo_last'].min():.0f}, "
      f"{df_best_2025['team1_elo_last'].max():.0f}]")
print(f"  team1_elo_last mean:  {df_best_2025['team1_elo_last'].mean():.0f}")
print(f"  team1_elo_last std:   {df_best_2025['team1_elo_last'].std():.0f}")

# ─────────────────────────────────────────────────────────────────────────────
# 13. Print constants for copy-paste into build_mm_dataset.py
# ─────────────────────────────────────────────────────────────────────────────
print(f"""
{'='*65}
COPY-PASTE INTO build_mm_dataset.py (STEP 6 constants):

HOME_ADVANTAGE   = {bp['home_advantage']:.0f}
REGRESS_ALPHA    = {bp['regress_alpha']:.2f}
REGRESS_MEAN     = 1505
K_EARLY          = {bp['k_early']}
K_MID            = {bp['k_mid']}
K_LATE           = {bp['k_late']}
Q_FLOOR          = {bp['q_floor']:.0f}
Q_SCALE          = {bp['q_scale']:.0f}
Q_MIN            = {bp['q_min']:.2f}
Q_MAX            = {bp['q_max']:.2f}
CROSS_CONF_BOOST = {bp['cross_conf_boost']:.2f}
{'='*65}
""")
