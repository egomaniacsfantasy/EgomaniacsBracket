# ---
# jupyter:
#   jupytext:
#     cell_metadata_filter: -all
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
"""
build_mm_dataset.py
===================
Builds one master training dataset for NCAA March Madness / college basketball prediction.

Covers:  seasons 2014-2026, all game types (Regular, ConfTourney, NCAA, Secondary)
         2026 = current season (regular season only, tournament not yet played)
Row key: team1_id always < team2_id  ->  matches Kaggle submission format SSSS_XXXX_YYYY
Output:  MM/master_dataset.xlsx

Feature groups produced
-----------------------
  Game context   : season, day_num, game_type, location, num_ot, city_id
  Identity       : team1/2 id, name, conference
  Elo ratings    : team1/2_elo_last, team1/2_elo_trend, elo_diff
                   Continuous Elo computed from all regular + conf tourney games.
                   Carries over across seasons (no reset). Joined at season level.
  Rankings       : team1_{SYS}, team2_{SYS}, rankdiff_{SYS}
                   Required (5, all seasons):  POM MAS MOR WLK BIH
                   Optional (NET, 2019+ only): included, tree models handle nulls
  Box scores     : team1/2 season-to-date averages (strictly prior games only)
                   Basic: Score, OppScore, FGM/FGA/FG3/FT, OR/DR/Ast/Stl/Blk/PF
                   Efficiency: off_rtg, def_rtg, net_rtg, oreb_pct, tov_pct
                   (Seeds removed: POM/rankings capture the same signal)
  Recent form    : last-5 and last-10 rolling averages for Margin, Score, OppScore

Row-level quality filter (STEP 10)
-----------------------------------
  Dropped if ANY required ranking system is null for either team (pre-season games,
  teams not covered by a system, etc.)
  Dropped if form stats are null (team played zero prior games this season).

Targets
-------
  score_diff   = team1_score - team2_score   (regression)
  team1_won    = 1 if team1 won             (classification)
"""

import io
import sys

# Jupyter-safe stdout wrapper (OutStream has no .buffer)
try:
    buf = getattr(sys.stdout, "buffer", None)
    if buf is not None:
        sys.stdout = io.TextIOWrapper(buf, encoding="utf-8", errors="replace")
except Exception:
    # If anything about stdout wrapping fails in Jupyter, just keep default stdout
    pass

import numpy as np
import pandas as pd
from pathlib import Path
from scipy.stats import linregress as _linreg

from pathlib import Path

# Notebook-safe DATA_DIR
try:
    DATA_DIR = Path(__file__).resolve().parent
except NameError:
    # In Jupyter, __file__ is not defined; use current working directory
    DATA_DIR = Path.cwd()

OUTPUT_PATH = DATA_DIR / "master_dataset.xlsx"

SEASON_MIN, SEASON_MAX = 2014, 2026

# 5 systems confirmed present in every season 2014-2025.
# Dropped: COL and DOL (very low SHAP, minimal signal).
# Excluded: SAG (stops at 2023), BPI (stops at 2013), RPI (discontinued 2019),
#           WOL/DUN/RTH (inconsistent coverage), NET kept separately as optional.
REQUIRED_SYSTEMS = ["POM", "MAS", "MOR", "WLK", "BIH"]

# NET added but NOT required: null for 2014-2018 (pre-adoption), ~5-25% null
# early-season in 2019-2025.  Tree models use it when available.
KEEP_SYSTEMS = REQUIRED_SYSTEMS + ["NET"]

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1  Load raw files
# ─────────────────────────────────────────────────────────────────────────────
print("=" * 65)
print("STEP 1: Loading raw data files...")

reg      = pd.read_csv(DATA_DIR / "MRegularSeasonCompactResults.csv")
ncaa     = pd.read_csv(DATA_DIR / "MNCAATourneyCompactResults.csv")
sec      = pd.read_csv(DATA_DIR / "MSecondaryTourneyCompactResults.csv")
ctag     = pd.read_csv(DATA_DIR / "MConferenceTourneyGames.csv")

teams     = pd.read_csv(DATA_DIR / "MTeams.csv")[["TeamID", "TeamName"]]
team_conf = pd.read_csv(DATA_DIR / "MTeamConferences.csv")
gcities   = pd.read_csv(DATA_DIR / "MGameCities.csv")[
                ["Season", "DayNum", "WTeamID", "LTeamID", "CityID"]]

reg_det  = pd.read_csv(DATA_DIR / "MRegularSeasonDetailedResults.csv")
ncaa_det = pd.read_csv(DATA_DIR / "MNCAATourneyDetailedResults.csv")

print("  Loading MMasseyOrdinals (large file -- may take ~30s)...")
massey = pd.read_csv(DATA_DIR / "MMasseyOrdinals.csv")
print(f"  Massey loaded: {len(massey):,} rows")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2  Combine game results & assign game_type
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 2: Combining game results...")

reg  = reg[reg["Season"].between(SEASON_MIN, SEASON_MAX)].copy()
ncaa = ncaa[ncaa["Season"].between(SEASON_MIN, SEASON_MAX)].copy()
sec  = sec[sec["Season"].between(SEASON_MIN, SEASON_MAX)].copy()

reg["game_type"]  = "Regular"
ncaa["game_type"] = "NCAA"
sec["game_type"]  = "Secondary"
sec = sec.rename(columns={"SecondaryTourney": "secondary_tourney"})

# Tag conference tourney games (they live inside the regular season file).
ctag_keys = ctag[["Season", "DayNum", "WTeamID", "LTeamID"]].copy()
ctag_keys["_is_conf"] = True
reg = reg.merge(ctag_keys, on=["Season", "DayNum", "WTeamID", "LTeamID"], how="left")
reg.loc[reg["_is_conf"] == True, "game_type"] = "ConfTourney"
reg = reg.drop(columns=["_is_conf"])

# Stack all game types
games = pd.concat([reg, ncaa, sec], ignore_index=True, sort=False)

print(f"  Raw game counts by type:\n{games['game_type'].value_counts().to_string()}")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3  Standardise to team1 (lower TeamID) / team2 (higher TeamID)
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 3: Standardising team order...")

t1_wins = games["WTeamID"] < games["LTeamID"]

games["team1_id"]    = np.where(t1_wins, games["WTeamID"], games["LTeamID"])
games["team2_id"]    = np.where(t1_wins, games["LTeamID"], games["WTeamID"])
games["team1_score"] = np.where(t1_wins, games["WScore"],  games["LScore"])
games["team2_score"] = np.where(t1_wins, games["LScore"],  games["WScore"])
games["team1_won"]   = t1_wins.astype(int)
games["score_diff"]  = games["team1_score"] - games["team2_score"]

# Location from team1's perspective
_flip = {"H": "A", "A": "H", "N": "N"}
games["location"] = np.where(t1_wins, games["WLoc"], games["WLoc"].map(_flip))

games = games.rename(columns={"NumOT": "num_ot"})

# Keep only the columns we need going forward
keep = ["Season", "DayNum", "WTeamID", "LTeamID",
        "team1_id", "team2_id", "team1_score", "team2_score",
        "score_diff", "team1_won", "num_ot", "location", "game_type",
        "secondary_tourney"]
games = games[[c for c in keep if c in games.columns]]

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4  Team names
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 4: Adding team names...")

games = games.merge(
    teams.rename(columns={"TeamID": "team1_id", "TeamName": "team1_name"}),
    on="team1_id", how="left")
games = games.merge(
    teams.rename(columns={"TeamID": "team2_id", "TeamName": "team2_name"}),
    on="team2_id", how="left")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5  Conference affiliation
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 5: Adding conference affiliation...")

tc1 = team_conf.rename(columns={"TeamID": "team1_id", "ConfAbbrev": "team1_conf"})
tc2 = team_conf.rename(columns={"TeamID": "team2_id", "ConfAbbrev": "team2_conf"})

games = games.merge(tc1[["Season", "team1_id", "team1_conf"]], on=["Season", "team1_id"], how="left")
games = games.merge(tc2[["Season", "team2_id", "team2_conf"]], on=["Season", "team2_id"], how="left")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6  Elo Ratings  (continuous, from regular season + conf tourney games)
#
#  Four improvements over the baseline W/L-only Elo:
#    1. Game-quality K scaling.
#       Games between weak teams move ratings less; games between elite teams
#       move ratings more:
#         q_mult = clip((avg_pre_elo - Q_FLOOR) / Q_SCALE, Q_MIN, Q_MAX)
#         k_eff  = k_base * q_mult
#       This reduces conference echo-chamber inflation.
#    2. Cross-conference K boost.
#       If teams are from different conferences, multiply K by
#       CROSS_CONF_BOOST. These games are the bridge across conferences.
#    3. Home-court adjustment in expected-score.
#    4. Partial seasonal regression + variable K by games played.
#
#  elo_last  = PRE-game Elo for regular-season/conf-tourney rows (no leakage).
#              = season-end Elo for NCAA/Secondary tournament rows (correct:
#                tournament starts after all regular + conf-tourney games).
#  elo_trend = slope of post-game Elo history through all games BEFORE this one
#              (0.0 if fewer than 5 prior games).
#
#  Join strategy (two-pass, leakage-free):
#    1. Exact join on (Season, DayNum, TeamID) for regular/conf-tourney games.
#    2. Season-end fallback join on (Season, TeamID) for tournament/secondary
#       games not present in the regular-season Elo table.
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 6: Computing Elo ratings (quality-K + cross-conf boost + home-court + regression + variable-K)...")

# Tuned in elo_tune.py (v2 formulation)
HOME_ADVANTAGE   = 50
REGRESS_ALPHA    = 0.85
REGRESS_MEAN     = 1505
K_EARLY          = 50
K_MID            = 40
K_LATE           = 15
Q_FLOOR          = 1300
Q_SCALE          = 250
Q_MIN            = 0.35
Q_MAX            = 2.00
CROSS_CONF_BOOST = 1.75

team_conf_map = {
    (int(r.Season), int(r.TeamID)): r.ConfAbbrev
    for _, r in team_conf.iterrows()
}


def _compute_elo(reg_df, conf_map, initial=1500, scale=400):
    """
    Improved leakage-free continuous Elo with game-quality scaling,
    cross-conference boost, home-court, seasonal regression,
    and variable K-factor.

    reg_df must have columns:
        Season, DayNum, WTeamID, LTeamID, WScore, LScore, WLoc

    Returns (game_elo_df, season_elo_df):
      game_elo_df   : (Season, DayNum, TeamID, elo_last, elo_trend)
                      One row per team per game; elo_last = PRE-game Elo.
                      elo_trend = slope of post-game history through prior games.
      season_elo_df : (Season, TeamID, elo_last, elo_trend)
                      One row per (Season, TeamID); elo_last = season-end Elo.
                      Used as fallback for tournament/secondary game rows.
    """
    data = reg_df.sort_values(["Season", "DayNum"]).reset_index(drop=True)

    team_ratings     = {}   # TeamID -> current float (persists across seasons)
    team_last_season = {}   # TeamID -> last season seen (for seasonal regression)
    season_game_cnt  = {}   # (season, TeamID) -> games played this season
    pre_game_hist    = {}   # (season, team) -> list of (daynum, pre_game_elo)
    post_game_hist   = {}   # (season, team) -> list of post_game_elo (for trend)

    for season, day, w, l, wloc in zip(
        data["Season"], data["DayNum"],
        data["WTeamID"], data["LTeamID"],
        data["WLoc"]
    ):
        season, day = int(season), int(day)
        w, l = int(w), int(l)

        # ── Improvement 3: Partial seasonal regression at season boundary ──────
        # Applied once per team, the first time we see them in a new season.
        for team in (w, l):
            if team in team_last_season and team_last_season[team] != season:
                team_ratings[team] = (
                    REGRESS_ALPHA * team_ratings[team]
                    + (1 - REGRESS_ALPHA) * REGRESS_MEAN
                )
            team_last_season[team] = season

        rw = team_ratings.get(w, initial)
        rl = team_ratings.get(l, initial)

        # Record PRE-game Elo (after regression, before this game's update)
        pre_game_hist.setdefault((season, w), []).append((day, rw))
        pre_game_hist.setdefault((season, l), []).append((day, rl))

        # ── Improvement 2: Home-court adjustment in expected score ─────────────
        # WLoc='H' → winner played at home; 'A' → winner played away; 'N' → neutral
        if wloc == "H":
            adjusted_rl = rl - HOME_ADVANTAGE   # home winner: reduce effective gap
        elif wloc == "A":
            adjusted_rl = rl + HOME_ADVANTAGE   # away winner: increase effective gap
        else:
            adjusted_rl = rl                    # neutral court: no adjustment
        e_w = 1.0 / (1.0 + 10.0 ** ((adjusted_rl - rw) / scale))

        # ── Improvement 4: Variable K by games played in season ───────────────
        gw = season_game_cnt.get((season, w), 0)
        gl = season_game_cnt.get((season, l), 0)
        avg_g = (gw + gl) / 2.0
        if avg_g < 5:
            k_base = K_EARLY
        elif avg_g < 20:
            k_base = K_MID
        else:
            k_base = K_LATE

        # ── Improvement 1: Game-quality K scaling ─────────────────────────────
        avg_elo_val = (rw + rl) / 2.0
        q_mult = float(np.clip((avg_elo_val - Q_FLOOR) / Q_SCALE, Q_MIN, Q_MAX))

        # ── Improvement 2: Cross-conference K boost ───────────────────────────
        conf_w = conf_map.get((season, w))
        conf_l = conf_map.get((season, l))
        cc_mult = (CROSS_CONF_BOOST
                   if (conf_w is not None and conf_l is not None and conf_w != conf_l)
                   else 1.0)

        k_eff = k_base * q_mult * cc_mult

        # Update ratings
        team_ratings[w] = rw + k_eff * (1.0 - e_w)
        team_ratings[l] = rl + k_eff * (0.0 - (1.0 - e_w))

        # Update game counts
        season_game_cnt[(season, w)] = gw + 1
        season_game_cnt[(season, l)] = gl + 1

        # Record post-game Elo for trend computation
        post_game_hist.setdefault((season, w), []).append(team_ratings[w])
        post_game_hist.setdefault((season, l), []).append(team_ratings[l])

    game_rows   = []
    season_rows = []

    for (season, team), game_list in pre_game_hist.items():
        pg = post_game_hist[(season, team)]   # post-game Elo history

        for i, (day, pre_elo) in enumerate(game_list):
            # elo_trend at game i = slope of post-game Elos from games 0..i-1
            trend = 0.0
            if i >= 5:
                slope, *_ = _linreg(range(i), pg[:i])
                trend = float(slope)
            game_rows.append({
                "Season":    season,
                "DayNum":    day,
                "TeamID":    team,
                "elo_last":  round(pre_elo, 3),
                "elo_trend": round(trend, 4),
            })

        # Season-end row: post-final-game Elo, full-season trend
        final_elo   = pg[-1]
        final_trend = 0.0
        if len(pg) >= 5:
            slope, *_ = _linreg(range(len(pg)), pg)
            final_trend = float(slope)
        season_rows.append({
            "Season":    season,
            "TeamID":    team,
            "elo_last":  round(final_elo,   3),
            "elo_trend": round(final_trend, 4),
        })

    return pd.DataFrame(game_rows), pd.DataFrame(season_rows)


def _join_elo(games_df, game_elo, season_elo, team_col):
    """
    Join Elo to games leakage-free:
      - Regular/conf-tourney games: exact join on (Season, DayNum, team_col).
      - Remaining nulls (NCAA/Secondary games not in game_elo): season-end fallback.
    """
    pfx = "team1_" if team_col == "team1_id" else "team2_"
    last_col  = f"{pfx}elo_last"
    trend_col = f"{pfx}elo_trend"

    g = game_elo.rename(columns={"TeamID": team_col,
                                  "elo_last":  last_col,
                                  "elo_trend": trend_col})
    out = games_df.merge(
        g[["Season", "DayNum", team_col, last_col, trend_col]],
        on=["Season", "DayNum", team_col], how="left",
    )

    null_mask = out[last_col].isna()
    if null_mask.any():
        s = season_elo.rename(columns={"TeamID": team_col,
                                        "elo_last":  "_elo_end",
                                        "elo_trend": "_trend_end"})
        out = out.merge(s[["Season", team_col, "_elo_end", "_trend_end"]],
                        on=["Season", team_col], how="left")
        out.loc[null_mask, last_col]  = out.loc[null_mask, "_elo_end"]
        out.loc[null_mask, trend_col] = out.loc[null_mask, "_trend_end"]
        out = out.drop(columns=["_elo_end", "_trend_end"])

    return out


game_elo_df, season_elo_df = _compute_elo(reg, team_conf_map)
print(f"  Game-level Elo rows : {len(game_elo_df):,}  (one per team per reg/conf-tourney game)")
print(f"  Season-end Elo rows : {len(season_elo_df):,}  (fallback for tournament games)")
print(f"  elo_last range (game-level) : [{game_elo_df['elo_last'].min():.1f}, {game_elo_df['elo_last'].max():.1f}]")

games = _join_elo(games, game_elo_df, season_elo_df, "team1_id")
games = _join_elo(games, game_elo_df, season_elo_df, "team2_id")
games["elo_diff"] = games["team1_elo_last"] - games["team2_elo_last"]

_null_elo = games["team1_elo_last"].isna().sum()
print(f"  Null elo rows  : {_null_elo} ({_null_elo / len(games) * 100:.1f}%)")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6b  Elo-based Strength of Schedule (elo_sos)
#
#  For each team-season, compute an expanding mean of opponents' pre-game Elo
#  across all regular season + conf tourney games played so far.  Joined at
#  DayNum-1 so there is no leakage into tournament games.
#
#  This captures how tough a team's schedule has been in terms of opponent
#  quality, independent of how well the team itself performed in those games.
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 6b: Computing Elo-based SOS...")

_gef = game_elo_df[["Season", "DayNum", "TeamID", "elo_last"]].copy()
_gef = _gef.astype({"Season": "int64", "DayNum": "int64", "TeamID": "int64"})

_reg_sos = reg[["Season", "DayNum", "WTeamID", "LTeamID"]].copy()
_reg_sos = _reg_sos.astype({"Season": "int64", "DayNum": "int64",
                             "WTeamID": "int64", "LTeamID": "int64"})
_reg_sos = _reg_sos[_reg_sos["Season"].between(SEASON_MIN, SEASON_MAX)]

# For winners: opponent is the loser → look up loser's pre-game Elo
_opp_w = _reg_sos.merge(
    _gef.rename(columns={"TeamID": "LTeamID", "elo_last": "opp_elo"}),
    on=["Season", "DayNum", "LTeamID"], how="left"
)[["Season", "DayNum", "WTeamID", "opp_elo"]].rename(columns={"WTeamID": "TeamID"})

# For losers: opponent is the winner → look up winner's pre-game Elo
_opp_l = _reg_sos.merge(
    _gef.rename(columns={"TeamID": "WTeamID", "elo_last": "opp_elo"}),
    on=["Season", "DayNum", "WTeamID"], how="left"
)[["Season", "DayNum", "LTeamID", "opp_elo"]].rename(columns={"LTeamID": "TeamID"})

_opp_all = pd.concat([_opp_w, _opp_l], ignore_index=True)
_opp_all = _opp_all.sort_values(["Season", "TeamID", "DayNum"]).reset_index(drop=True)

# Expanding mean of opponents' Elo → SOS after each game
_opp_all["elo_sos"] = (
    _opp_all.groupby(["Season", "TeamID"])["opp_elo"]
    .expanding().mean()
    .reset_index(level=[0, 1], drop=True)
)
sos_df = _opp_all[["Season", "DayNum", "TeamID", "elo_sos"]].copy()


def join_sos(games_df, sos_df_, team_col, prefix):
    """Backward-asof join: attach elo_sos as of DayNum-1 for each game."""
    g = games_df[["Season", "DayNum", team_col]].copy()
    g = g.astype({"Season": "int64", "DayNum": "int64", team_col: "int64"})
    right = (sos_df_.rename(columns={"TeamID": team_col, "DayNum": "_SosDay",
                                      "elo_sos": f"{prefix}elo_sos"})
             .astype({team_col: "int64", "_SosDay": "int64"})
             .sort_values(["_SosDay", "Season", team_col], kind="mergesort")
             .reset_index(drop=True))
    left = (g.assign(_GameDayMinus=lambda d: d["DayNum"] - 1)
            .astype({"_GameDayMinus": "int64"})
            .sort_values(["_GameDayMinus", "Season", team_col], kind="mergesort")
            .reset_index(drop=True))
    merged = pd.merge_asof(left, right, left_on="_GameDayMinus", right_on="_SosDay",
                           by=["Season", team_col], direction="backward",
                           allow_exact_matches=True)
    return merged[["Season", "DayNum", team_col, f"{prefix}elo_sos"]]


s1 = join_sos(games, sos_df, "team1_id", "team1_")
s2 = join_sos(games, sos_df, "team2_id", "team2_")
games = games.merge(s1, on=["Season", "DayNum", "team1_id"], how="left")
games = games.merge(s2, on=["Season", "DayNum", "team2_id"], how="left")
games["elo_sos_diff"] = games["team1_elo_sos"] - games["team2_elo_sos"]

_null_sos = games["team1_elo_sos"].isna().sum()
print(f"  Null elo_sos rows: {_null_sos} ({_null_sos / len(games) * 100:.1f}%)")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 7  City  (available 2010+)
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 7: Adding game city...")

games = games.merge(gcities, on=["Season", "DayNum", "WTeamID", "LTeamID"], how="left")

# WTeamID/LTeamID no longer needed
games = games.drop(columns=["WTeamID", "LTeamID"])

# ─────────────────────────────────────────────────────────────────────────────
# STEP 8  Massey Rankings
#         Most recent snapshot with RankingDayNum <= game DayNum.
#         For NCAA/Secondary tourney games (DayNum >= 133) this is always
#         the final pre-tournament snapshot (RankingDayNum=133).
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 8: Processing Massey rankings...")

massey = massey[massey["Season"].between(SEASON_MIN, SEASON_MAX)]

print(f"  Pivoting wide ({len(KEEP_SYSTEMS)} systems: {KEEP_SYSTEMS})...")
mw = (massey[massey["SystemName"].isin(KEEP_SYSTEMS)]
      .pivot_table(index=["Season", "RankingDayNum", "TeamID"],
                   columns="SystemName",
                   values="OrdinalRank",
                   aggfunc="first")
      .reset_index())
mw.columns.name = None
sys_cols = [c for c in mw.columns if c not in ("Season", "RankingDayNum", "TeamID")]
print(f"  Wide shape: {mw.shape}  |  systems found: {sys_cols}")


def join_rankings(games_df, mw_df, team_col, prefix):
    """
    For each game row, attach the most recent Massey snapshot where
    RankingDayNum <= game DayNum.

    IMPORTANT (fixes 'left keys must be sorted'):
      pandas merge_asof often requires the *global* left_on key to be sorted
      (not just sorted within by-groups). So we sort by DayNum first.
    """

    # ---- dtype enforcement (merge_asof is strict) ----
    g = games_df.copy()
    g["Season"] = g["Season"].astype("int64")
    g["DayNum"] = g["DayNum"].astype("int64")
    g[team_col] = g[team_col].astype("int64")

    m = mw_df.copy()
    m["Season"] = m["Season"].astype("int64")
    m["RankingDayNum"] = m["RankingDayNum"].astype("int64")
    m["TeamID"] = m["TeamID"].astype("int64")

    # ---- build right table ----
    right = (
        m.rename(columns={"TeamID": team_col, "RankingDayNum": "_RankDay"})
         .rename(columns={c: f"{prefix}{c}" for c in sys_cols})
         # CRITICAL: sort by the ASOF key FIRST to satisfy global monotonic requirement
         .sort_values(["_RankDay", "Season", team_col], kind="mergesort")
         .reset_index(drop=True)
    )

    # ---- build left table ----
    left = (
        g[["Season", "DayNum", team_col]]
         # CRITICAL: sort by DayNum FIRST to satisfy merge_asof requirement
         .sort_values(["DayNum", "Season", team_col], kind="mergesort")
         .reset_index(drop=True)
    )

    merged = pd.merge_asof(
        left,
        right,
        left_on="DayNum",
        right_on="_RankDay",
        by=["Season", team_col],
        direction="backward",
        allow_exact_matches=True,
    ).drop(columns=["_RankDay"])

    rank_cols = [f"{prefix}{c}" for c in sys_cols]
    return merged[["Season", "DayNum", team_col] + rank_cols]

print("  Joining team1 rankings...")
r1 = join_rankings(games, mw, "team1_id", "team1_")
print("  Joining team2 rankings...")
r2 = join_rankings(games, mw, "team2_id", "team2_")

games = games.merge(r1, on=["Season", "DayNum", "team1_id"], how="left")
games = games.merge(r2, on=["Season", "DayNum", "team2_id"], how="left")

print("  Computing rank differentials (team1 - team2; negative = team1 is better)...")
diff_df = pd.DataFrame({
    f"rankdiff_{s}": games[f"team1_{s}"] - games[f"team2_{s}"]
    for s in sys_cols
    if f"team1_{s}" in games.columns and f"team2_{s}" in games.columns
}, index=games.index)
games = pd.concat([games, diff_df], axis=1)

# ─────────────────────────────────────────────────────────────────────────────
# STEP 9  Season-to-date box score averages + recent form + efficiency stats
#          Stats are cumulative averages of ALL prior games in that season for
#          each team.  The current game is excluded (no data leakage).
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 9: Computing season-to-date box score averages and efficiency stats...")

reg_det  = reg_det[reg_det["Season"].between(SEASON_MIN, SEASON_MAX)]
ncaa_det = ncaa_det[ncaa_det["Season"].between(SEASON_MIN, SEASON_MAX)]
all_det  = pd.concat([reg_det, ncaa_det], ignore_index=True)

BOX = ["FGM", "FGA", "FGM3", "FGA3", "FTM", "FTA",
       "OR", "DR", "Ast", "Stl", "Blk", "PF"]


def reshape_to_team_rows(det_df):
    """Stack winner and loser rows so each game produces two per-team rows.
    TO is pulled as a helper column (needed for efficiency calculations) but
    is NOT in BOX so it won't appear in avg_cols / the final averaged features.
    """
    _all_cols = BOX + ["TO"]   # TO needed for poss / tov_pct, not averaged

    w = det_df[["Season", "DayNum", "WTeamID"]
               + [f"W{s}" for s in _all_cols] + ["WScore", "LScore"]].copy()
    w = w.rename(columns={f"W{s}": s for s in _all_cols})
    w = w.rename(columns={"WTeamID": "TeamID", "WScore": "Score", "LScore": "OppScore"})
    w["Won"] = 1

    l = det_df[["Season", "DayNum", "LTeamID"]
               + [f"L{s}" for s in _all_cols] + ["LScore", "WScore"]].copy()
    l = l.rename(columns={f"L{s}": s for s in _all_cols})
    l = l.rename(columns={"LTeamID": "TeamID", "LScore": "Score", "WScore": "OppScore"})
    l["Won"] = 0

    return pd.concat([w, l], ignore_index=True)


tgs = reshape_to_team_rows(all_det)

# Derived per-game stats
tgs["FG_pct"]   = tgs["FGM"]  / tgs["FGA"].replace(0, np.nan)
tgs["FG3_pct"]  = tgs["FGM3"] / tgs["FGA3"].replace(0, np.nan)
tgs["FT_pct"]   = tgs["FTM"]  / tgs["FTA"].replace(0, np.nan)
tgs["TotalReb"] = tgs["OR"] + tgs["DR"]
tgs["Margin"]   = tgs["Score"] - tgs["OppScore"]

# ── Efficiency stats ─────────────────────────────────────────────────────────
# Possessions estimate (Oliver formula).  TO is still available in tgs even
# though it was removed from BOX (it comes from the raw detailed results file).
tgs["_poss"]    = tgs["FGA"] - tgs["OR"] + 0.44 * tgs["FTA"] + tgs["TO"]
_poss_safe      = tgs["_poss"].replace(0, np.nan)

# Offensive / Defensive / Net rating (per-100-possession pts scored / allowed)
tgs["off_rtg"]  = 100 * tgs["Score"]    / _poss_safe
tgs["def_rtg"]  = 100 * tgs["OppScore"] / _poss_safe
tgs["net_rtg"]  = tgs["off_rtg"] - tgs["def_rtg"]

# Offensive rebounding % (approx; uses own DR as complement)
tgs["oreb_pct"] = tgs["OR"] / (tgs["OR"] + tgs["DR"]).replace(0, np.nan)

# Turnover rate: TOs per possession (replaces raw avg_TO)
tgs["tov_pct"]  = tgs["TO"] / _poss_safe

EFF_COLS = ["off_rtg", "def_rtg", "net_rtg", "oreb_pct", "tov_pct"]

avg_cols = BOX + ["Score", "OppScore", "Won", "FG_pct", "FG3_pct", "FT_pct",
                  "TotalReb"] + EFF_COLS

# Sort then compute rolling stats BEFORE expanding means overwrite original cols
tgs = tgs.sort_values(["Season", "TeamID", "DayNum"]).reset_index(drop=True)

# Recent form: rolling window averages (last 5 and last 10 games).
# Won removed from form stats — season win % (avg_Won) is sufficient signal;
# last5_Won had near-zero SHAP and Margin already captures short-term quality.
# Computed WITHOUT shift — value at DayNum=X = "form through game X".
# The join_box_scores function uses DayNum-1 as the lookup key, so the
# current game is always excluded (no leakage).
print("  Computing recent form (last-5 and last-10 rolling averages)...")
FORM_COLS = ["Margin", "Score", "OppScore"]
for window in [5, 10]:
    for col in FORM_COLS:
        tgs[f"last{window}_{col}"] = (
            tgs.groupby(["Season", "TeamID"])[col]
               .transform(lambda x, w=window: x.rolling(w, min_periods=1).mean())
        )
form_stat_cols = [f"last{w}_{c}" for w in [5, 10] for c in FORM_COLS]

print("  Computing expanding means (this takes ~30-60s)...")
tgs[avg_cols] = (
    tgs.groupby(["Season", "TeamID"])[avg_cols]
       .expanding()
       .mean()
       .reset_index(level=[0, 1], drop=True)
)
tgs = tgs.rename(columns={c: f"avg_{c}" for c in avg_cols})
avg_stat_cols = [f"avg_{c}" for c in avg_cols] + form_stat_cols


def join_box_scores(games_df, tgs_df, team_col, prefix):
    """
    FIXED VERSION — guarantees merge_asof global monotonic order.
    """

    # ---- dtype enforcement ----
    g = games_df.copy()
    g["Season"] = g["Season"].astype("int64")
    g["DayNum"] = g["DayNum"].astype("int64")
    g[team_col] = g[team_col].astype("int64")

    t = tgs_df.copy()
    t["Season"] = t["Season"].astype("int64")
    t["DayNum"] = t["DayNum"].astype("int64")
    t["TeamID"] = t["TeamID"].astype("int64")

    # ---- RIGHT TABLE ----
    right = (
        t[["Season", "DayNum", "TeamID"] + avg_stat_cols]
        .rename(columns={"TeamID": team_col, "DayNum": "_BoxDay"})
        .rename(columns={c: f"{prefix}{c}" for c in avg_stat_cols})
        # CRITICAL: sort by asof key FIRST
        .sort_values(["_BoxDay", "Season", team_col], kind="mergesort")
        .reset_index(drop=True)
    )

    # ---- LEFT TABLE ----
    left = (
        g[["Season", "DayNum", team_col]]
        .assign(_GameDayMinus=lambda d: d["DayNum"] - 1)
        # CRITICAL: sort by ASOF KEY FIRST
        .sort_values(["_GameDayMinus", "Season", team_col], kind="mergesort")
        .reset_index(drop=True)
    )

    merged = pd.merge_asof(
        left,
        right,
        left_on="_GameDayMinus",
        right_on="_BoxDay",
        by=["Season", team_col],
        direction="backward",
        allow_exact_matches=True,
    )

    merged = merged.drop(columns=["_GameDayMinus", "_BoxDay"])

    box_cols = [f"{prefix}{c}" for c in avg_stat_cols]
    return merged[["Season", "DayNum", team_col] + box_cols]

print("  Joining team1 box scores...")
b1 = join_box_scores(games, tgs, "team1_id", "team1_")
print("  Joining team2 box scores...")
b2 = join_box_scores(games, tgs, "team2_id", "team2_")

games = games.merge(b1, on=["Season", "DayNum", "team1_id"], how="left")
games = games.merge(b2, on=["Season", "DayNum", "team2_id"], how="left")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 10  Quality filter
#          Drop rows missing any required ranking or any form stat.
#          These are pre-season games (before first ranking snapshot) or
#          season-openers (team has played zero prior games).
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 10: Applying quality filter...")

n_before = len(games)

# All 5 required systems must be non-null for BOTH teams
required_rank_cols = (
    [f"team1_{s}" for s in REQUIRED_SYSTEMS] +
    [f"team2_{s}" for s in REQUIRED_SYSTEMS]
)
rank_ok = games[required_rank_cols].notna().all(axis=1)

# Form stats must be non-null for both teams (removes first-game-of-season rows)
form_ok = (
    games["team1_last5_Margin"].notna() &
    games["team2_last5_Margin"].notna()
)

games = games[rank_ok & form_ok].reset_index(drop=True)

n_dropped = n_before - len(games)
print(f"  Rows before filter : {n_before:,}")
print(f"  Rows dropped       : {n_dropped:,} ({n_dropped / n_before * 100:.1f}%)")
print(f"  Rows retained      : {len(games):,}")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 11  Final sort and save
# ─────────────────────────────────────────────────────────────────────────────
print("STEP 11: Finalising and saving...")

games = games.sort_values(["Season", "DayNum", "team1_id"]).reset_index(drop=True)

# Summary
print(f"\n{'=' * 65}")
print(f"  Final shape   : {games.shape[0]:,} rows x {games.shape[1]:,} columns")
print(f"  Seasons       : {games['Season'].min()} - {games['Season'].max()}")
print(f"  Game types    :\n{games['game_type'].value_counts().to_string()}")
print(f"\n  Null rates for ranking columns (team1 side):")
for s in KEEP_SYSTEMS:
    col = f"team1_{s}"
    if col in games.columns:
        pct = games[col].isna().mean() * 100
        tag = " [required]" if s in REQUIRED_SYSTEMS else " [optional]"
        print(f"    {s:4s}: {pct:5.1f}%{tag}")
print(f"\n  Elo null rates:")
for ec in ["elo_last", "elo_diff"]:
    col = f"team1_{ec}" if ec != "elo_diff" else "elo_diff"
    if col in games.columns:
        pct = games[col].isna().mean() * 100
        print(f"    {ec}: {pct:.1f}%")

print(f"\n  Efficiency stat null rates (team1 side, sample):")
for ec in ["avg_off_rtg", "avg_def_rtg", "avg_net_rtg", "avg_oreb_pct", "avg_tov_pct"]:
    col = f"team1_{ec}"
    if col in games.columns:
        pct = games[col].isna().mean() * 100
        print(f"    {ec}: {pct:.1f}%")
print(f"{'=' * 65}")

PARQUET_PATH = OUTPUT_PATH.with_suffix(".parquet")
games.to_parquet(PARQUET_PATH, index=False)
print(f"  Saved -> {PARQUET_PATH}")

print("  Writing Excel file (this may take a minute)...")
try:
    games.to_excel(OUTPUT_PATH, index=False, engine="openpyxl")
    print(f"\n  Saved -> {OUTPUT_PATH}")
except PermissionError:
    fallback = OUTPUT_PATH.with_name("master_dataset_new.xlsx")
    games.to_excel(fallback, index=False, engine="openpyxl")
    print(f"\n  Primary path locked (Excel open?). Saved -> {fallback}")
    print(f"  Close Excel, then rename '{fallback.name}' to '{OUTPUT_PATH.name}'.")

# %%

# =========================================================================
# STEP 12: TEAM SNAPSHOT — post-last-game features for Season 2026
# =========================================================================
# Computes every team's model input features AFTER their most recent known
# game, fixing the "one-game stale" issue in prediction code.
#
# Key updates vs. the max-DayNum row approach:
#   Elo       — applies the game-result Elo delta to get post-game rating
#   Efficiency — expands rolling averages to include the last game's box score
#   Form       — rolls last5/last10 margin windows forward by one game
#   Rankings   — unchanged (external snapshots, already latest available)
#   elo_trend  — unchanged (one extra point barely moves the slope; exact
#                update requires full Elo history not stored in master_dataset)
#
# Outputs:
#   team_snapshot_2026.parquet  ← loaded by bracket_sim / prediction tools
#   team_snapshot_2026.xlsx     ← for manual inspection
# =========================================================================
print("\n" + "=" * 70)
print("STEP 12: TEAM SNAPSHOT (post-last-game, Season 2026)")
print("=" * 70)

_SNAP_SEASON = SEASON_MAX          # 2026
_ELO_SCALE   = 400
_SNAP_PAR    = OUTPUT_PATH.with_name("team_snapshot_2026.parquet")
_SNAP_XLS    = OUTPUT_PATH.with_name("team_snapshot_2026.xlsx")

# ── Filter master dataset to snapshot season ──────────────────────────────
_sg = games[games["Season"] == _SNAP_SEASON].copy()

# ── Flat team-game view: one row per (team, game) with team-centric margin ─
_t1v = _sg[["DayNum","team1_id","team2_id","score_diff",
            "team1_won","location","team1_conf","team2_conf",
            "team1_score","team2_score"]].copy()
_t1v = _t1v.rename(columns={
    "team1_id":"TeamID","team2_id":"OppID",
    "team1_conf":"Conf","team2_conf":"OppConf",
    "team1_score":"Score","team2_score":"OppScore"})
_t1v["Margin"] = _t1v["score_diff"]
_t1v["Won"]    = _t1v["team1_won"]
_t1v["Side"]   = "team1"

_t2v = _sg[["DayNum","team2_id","team1_id","score_diff",
            "team1_won","location","team2_conf","team1_conf",
            "team2_score","team1_score"]].copy()
_t2v = _t2v.rename(columns={
    "team2_id":"TeamID","team1_id":"OppID",
    "team2_conf":"Conf","team1_conf":"OppConf",
    "team2_score":"Score","team1_score":"OppScore"})
_t2v["Margin"] = -_t2v["score_diff"]
_t2v["Won"]    = 1 - _t2v["team1_won"]
_t2v["Side"]   = "team2"

_tgs_flat = (pd.concat([_t1v, _t2v], ignore_index=True)
               .sort_values(["TeamID","DayNum"])
               .reset_index(drop=True))
_ngames_snap = _tgs_flat.groupby("TeamID").size().to_dict()   # tid → total games

# ── Detailed results index for box score lookup ───────────────────────────
# reg_det loaded in STEP 1; conference-tourney games may not appear here
_det26    = reg_det[reg_det["Season"] == _SNAP_SEASON]
_det_keys = {(int(r.DayNum), int(r.WTeamID), int(r.LTeamID)): r
             for r in _det26.itertuples(index=False)}

def _snap_get_box(dn, wteam, lteam, side):
    """Box score dict for winner ('W') or loser ('L'); None if not in CSV."""
    r = _det_keys.get((int(dn), int(wteam), int(lteam)))
    if r is None:
        return None
    p, o = side, ("L" if side == "W" else "W")
    return dict(
        Score    = float(getattr(r, f"{p}Score")),
        OppScore = float(getattr(r, f"{o}Score")),
        FGM  = float(getattr(r, f"{p}FGM")),  FGA  = float(getattr(r, f"{p}FGA")),
        FGM3 = float(getattr(r, f"{p}FGM3")), FGA3 = float(getattr(r, f"{p}FGA3")),
        FTM  = float(getattr(r, f"{p}FTM")),  FTA  = float(getattr(r, f"{p}FTA")),
        OR   = float(getattr(r, f"{p}OR")),   DR   = float(getattr(r, f"{p}DR")),
        Ast  = float(getattr(r, f"{p}Ast")),  Stl  = float(getattr(r, f"{p}Stl")),
        Blk  = float(getattr(r, f"{p}Blk")),  PF   = float(getattr(r, f"{p}PF")),
        TO   = float(getattr(r, f"{p}TO")),
    )

def _snap_box_eff(b):
    """Per-game efficiency stats from box score dict; None if zero possessions."""
    poss = b["FGA"] - b["OR"] + 0.44 * b["FTA"] + b["TO"]
    if poss <= 0:
        return None
    return dict(
        off_rtg  = 100.0 * b["Score"]    / poss,
        def_rtg  = 100.0 * b["OppScore"] / poss,
        net_rtg  = 100.0 * (b["Score"] - b["OppScore"]) / poss,
        oreb_pct = b["OR"] / (b["OR"] + b["DR"]) if (b["OR"] + b["DR"]) > 0 else 0.0,
        tov_pct  = b["TO"] / poss,
        **{k: b[k] for k in ("Score","OppScore","FGM","FGA","FGM3","FGA3",
                              "FTM","FTA","OR","DR","Ast","Stl","Blk","PF")},
    )

def _snap_upd_exp(old, n_before, new_val):
    """Expanding-mean update: include one more game."""
    if n_before == 0 or new_val is None:
        return old if new_val is None else new_val
    return (old * n_before + new_val) / (n_before + 1)

def _snap_wloc(loc_str, won_t1):
    """Winner's location string from team1-perspective string (A/H/N)."""
    if loc_str == "N":
        return "N"
    if loc_str == "H":
        return "H" if won_t1 else "A"
    return "A" if won_t1 else "H"

def _snap_elo_post(pre_elo, pre_elo_opp, won, wloc, avg_g, conf_ours, conf_opp):
    """Post-game Elo for our team using the same formula as STEP 6."""
    rw, rl = (pre_elo, pre_elo_opp) if won else (pre_elo_opp, pre_elo)
    adj_rl = (rl - HOME_ADVANTAGE if wloc == "H"
              else rl + HOME_ADVANTAGE if wloc == "A" else rl)
    e_w    = 1.0 / (1.0 + 10.0 ** ((adj_rl - rw) / _ELO_SCALE))
    k_base = K_EARLY if avg_g < 5 else (K_MID if avg_g < 20 else K_LATE)
    q_mult = float(np.clip(((rw + rl) / 2.0 - Q_FLOOR) / Q_SCALE, Q_MIN, Q_MAX))
    cc     = CROSS_CONF_BOOST if (conf_ours and conf_opp and conf_ours != conf_opp) else 1.0
    delta  = k_base * q_mult * cc * (1.0 - e_w)
    return (pre_elo + delta) if won else (pre_elo - delta)

# ── Main snapshot loop ────────────────────────────────────────────────────
_snap_rows   = []
_missing_box = 0

for tid, grp in _tgs_flat.groupby("TeamID"):
    grp   = grp.sort_values("DayNum")
    ltg   = grp.iloc[-1]              # last team-game entry for this team
    N     = int(_ngames_snap[tid])    # total games played this season
    N_pre = N - 1                     # games played before the last game
    dn    = int(ltg["DayNum"])
    opp   = int(ltg["OppID"])
    won   = int(ltg["Won"])

    # Locate the corresponding master_dataset row
    mask = (_sg["DayNum"] == dn) & (
        ((_sg["team1_id"] == tid) & (_sg["team2_id"] == opp)) |
        ((_sg["team2_id"] == tid) & (_sg["team1_id"] == opp)))
    if not mask.any():
        continue
    row  = _sg[mask].iloc[0]
    side = "team1" if int(row["team1_id"]) == tid else "team2"
    pfx  = side + "_"
    opfx = ("team2_" if side == "team1" else "team1_") + ""

    pre_elo     = float(row[pfx  + "elo_last"])
    pre_elo_opp = float(row[opfx + "elo_last"])
    pre_elo_sos = float(row[pfx  + "elo_sos"])
    conf_ours   = str(row[pfx  + "conf"])
    conf_opp    = str(row[opfx + "conf"])
    loc_str     = str(row["location"])
    won_t1      = int(row["team1_won"])
    wloc        = _snap_wloc(loc_str, won_t1)

    N_pre_opp  = max(_ngames_snap.get(opp, N_pre + 1) - 1, 0)
    avg_g_both = (N_pre + N_pre_opp) / 2.0

    # Post-game Elo
    post_elo = _snap_elo_post(pre_elo, pre_elo_opp, won, wloc,
                               avg_g_both, conf_ours, conf_opp)

    # Updated Elo SOS (add opponent's pre-game Elo to expanding mean)
    new_elo_sos = _snap_upd_exp(pre_elo_sos, N_pre, pre_elo_opp)

    # Box score for last game → updated efficiency stats
    w_tid, l_tid = (tid, opp) if won else (opp, tid)
    box = _snap_get_box(dn, w_tid, l_tid, "W" if won else "L")
    eff = _snap_box_eff(box) if box else None
    if eff is None:
        _missing_box += 1

    def _u(col, eff_key=None):
        old = float(row[pfx + "avg_" + col])
        nv  = eff.get(eff_key or col) if eff else None
        return _snap_upd_exp(old, N_pre, nv)

    # Form: exact rolling window over all known game margins
    margins  = grp["Margin"].values
    last5_m  = float(np.mean(margins[-5:]))
    last10_m = float(np.mean(margins[-10:]))

    # Won% update (no box score needed)
    new_won = _snap_upd_exp(float(row[pfx + "avg_Won"]), N_pre, float(won))

    _snap_rows.append(dict(
        Season        = _SNAP_SEASON,
        TeamID        = tid,
        TeamName      = row["team1_name" if side == "team1" else "team2_name"],
        Conf          = conf_ours,
        Last_DayNum   = dn,
        N_games       = N,
        has_box_score = eff is not None,
        # Elo (post-game)
        elo_last      = round(post_elo,       3),
        elo_trend     = round(float(row[pfx + "elo_trend"]), 4),  # approx unchanged
        elo_sos       = round(new_elo_sos,    1),
        # Rankings (latest available snapshot — no intra-game update)
        POM = int(row[pfx + "POM"]), MAS = int(row[pfx + "MAS"]),
        MOR = int(row[pfx + "MOR"]), WLK = int(row[pfx + "WLK"]),
        BIH = int(row[pfx + "BIH"]), NET = int(row[pfx + "NET"]),
        # Efficiency stats (post-game via expanding-mean update)
        avg_off_rtg   = round(_u("off_rtg"),  3),
        avg_def_rtg   = round(_u("def_rtg"),  3),
        avg_net_rtg   = round(_u("net_rtg"),  3),
        avg_oreb_pct  = round(_u("oreb_pct"), 5),
        avg_tov_pct   = round(_u("tov_pct"),  5),
        # Box score averages (post-game)
        avg_Score     = round(_u("Score"),    2),
        avg_OppScore  = round(_u("OppScore"), 2),
        avg_Won       = round(new_won,        4),
        avg_FGM       = round(_u("FGM"),      3),
        avg_FGA       = round(_u("FGA"),      3),
        avg_FGM3      = round(_u("FGM3"),     3),
        avg_FGA3      = round(_u("FGA3"),     3),
        avg_FTM       = round(_u("FTM"),      3),
        avg_FTA       = round(_u("FTA"),      3),
        avg_OR        = round(_u("OR"),       3),
        avg_DR        = round(_u("DR"),       3),
        avg_Ast       = round(_u("Ast"),      3),
        avg_Stl       = round(_u("Stl"),      3),
        avg_Blk       = round(_u("Blk"),      3),
        avg_PF        = round(_u("PF"),       3),
        # Form (exact rolling window, post-game)
        last5_Margin  = round(last5_m,        3),
        last10_Margin = round(last10_m,       3),
    ))

df_snap = pd.DataFrame(_snap_rows)
print(f"  {len(df_snap):,} teams | "
      f"DayNum range {df_snap['Last_DayNum'].min()}–{df_snap['Last_DayNum'].max()}")
print(f"  Box score found: {df_snap['has_box_score'].sum():,}/{len(df_snap):,} "
      f"({_missing_box} last games missing box score — efficiency stats unchanged for those)")

# ── Override rankings with the single latest Massey snapshot ─────────────
# Teams' last game rows carry whichever snapshot was current for that DayNum
# (e.g. a team whose last game was DayNum 117 still has DayNum 114 rankings).
# Fix: apply the latest available snapshot uniformly to all teams.
_massey_26 = massey[(massey["Season"] == _SNAP_SEASON) &
                    (massey["SystemName"].isin(KEEP_SYSTEMS))].copy()
if not _massey_26.empty:
    _latest_dn = int(_massey_26["RankingDayNum"].max())
    _latest_m  = (
        _massey_26[_massey_26["RankingDayNum"] == _latest_dn]
        .pivot(index="TeamID", columns="SystemName", values="OrdinalRank")
    )
    updated_sys = []
    for sys in KEEP_SYSTEMS:
        if sys in _latest_m.columns:
            updated = df_snap["TeamID"].map(_latest_m[sys])
            mask = updated.notna()
            df_snap.loc[mask, sys] = updated[mask].astype(int)
            updated_sys.append(sys)
    print(f"  Rankings updated to DayNum {_latest_dn} Massey snapshot "
          f"({updated_sys})")
else:
    print("  WARNING: no Massey data found for season — rankings unchanged")

df_snap.to_parquet(_SNAP_PAR, index=False)
print(f"  Saved -> {_SNAP_PAR}")

try:
    df_snap.to_excel(_SNAP_XLS, index=False)
    print(f"  Saved -> {_SNAP_XLS}")
except PermissionError:
    fb = _SNAP_XLS.with_name("team_snapshot_2026_new.xlsx")
    df_snap.to_excel(fb, index=False)
    print(f"  Saved (fallback — close Excel): {fb}")

print("Done.")

# %%
