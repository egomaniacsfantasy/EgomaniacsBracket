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
"""
update_info.py  — Extend Kaggle CSV files through March 5, 2026
==============================================================
Appends DayNum 121-122 (March 4-5, 2026) data to:
  • MRegularSeasonCompactResults.csv   (game results)
  • MRegularSeasonDetailedResults.csv  (box scores)
  • MMasseyOrdinals.csv                (weekly snapshots — no new snapshot this run)

Run in Jupyter cell-by-cell (# %% separators) or as a script:
    python update_info.py

Intermediate scratch files (_new_compact.csv, _new_detailed.csv,
_new_massey.csv) are written to DATA_DIR and removed after a successful
append so the script is safe to re-run if interrupted.
"""

# %%
# ---------------------------------------------------------------------------
# PHASE 0 — Imports, config, shared helpers
# ---------------------------------------------------------------------------
import sys, io, re, time, warnings
from pathlib import Path
from datetime import date, timedelta

import numpy as np
import pandas as pd
import requests
from bs4 import BeautifulSoup, Comment

# Jupyter-safe stdout wrapper
try:
    _buf = getattr(sys.stdout, "buffer", None)
    if _buf is not None:
        sys.stdout = io.TextIOWrapper(_buf, encoding="utf-8", errors="replace")
except Exception:
    pass

warnings.filterwarnings("ignore")

# ── Path resolution ────────────────────────────────────────────────────────
try:
    DATA_DIR = Path(__file__).resolve().parent
except NameError:
    DATA_DIR = Path.cwd()

# ── Constants ──────────────────────────────────────────────────────────────
SEASON    = 2026
DAY_ZERO  = date(2025, 11, 3)      # from MSeasons.csv DayZero 2026

DATE_START = date(2026, 3, 4)      # DayNum 121 (CSV already has through DayNum 120)
DATE_END   = date(2026, 3, 5)      # DayNum 122 (last day we want)

# Massey snapshots loaded from massey_raw/*.txt (see Phase 3).
# This list is informational only — the actual source of truth is MASSEY_WEEK_FILES in Phase 3.
# DayNum labeling: build_mm_dataset uses backward merge-asof, so a game at DayNum N
# automatically uses the most recent snapshot where RankingDayNum <= N.
MASSEY_TARGETS = [
    (date(2026, 2, 11), 100),      # DayNum 100 — already in CSV
    (date(2026, 2, 18), 107),      # DayNum 107 — already in CSV
    (date(2026, 2, 25), 114),      # DayNum 114 — already in CSV
    (date(2026, 3, 1),  118),      # DayNum 118 — already in CSV
    (date(2026, 3, 4),  121),      # DayNum 121 — NEW: March 4 Wednesday release
]

# ── File paths ─────────────────────────────────────────────────────────────
COMPACT_CSV      = DATA_DIR / "MRegularSeasonCompactResults.csv"
DETAILED_CSV     = DATA_DIR / "MRegularSeasonDetailedResults.csv"
MASSEY_CSV       = DATA_DIR / "MMasseyOrdinals.csv"
SPELLINGS_CSV    = DATA_DIR / "MTeamSpellings.csv"
CONF_TOURNEY_CSV = DATA_DIR / "MConferenceTourneyGames.csv"
NCAA_COMPACT_CSV = DATA_DIR / "MNCAATourneyCompactResults.csv"
TEAM_CONF_CSV    = DATA_DIR / "MTeamConferences.csv"

SCRATCH_COMPACT  = DATA_DIR / "_new_compact.csv"
SCRATCH_DETAILED = DATA_DIR / "_new_detailed.csv"
SCRATCH_MASSEY   = DATA_DIR / "_new_massey.csv"

MASSEY_URL = "https://masseyratings.com/cb/compare.htm"

SLEEP_SR     = 2.5    # seconds between Sports Reference requests
SLEEP_WBM    = 4.0    # seconds between Wayback Machine requests

# ── DayNum helper ──────────────────────────────────────────────────────────
def daynum(d: date) -> int:
    return (d - DAY_ZERO).days

print("=" * 65)
print("  update_info.py  —  Phase 0 complete")
print("=" * 65)
print(f"  DATA_DIR   : {DATA_DIR}")
print(f"  DATE range : {DATE_START} (DayNum {daynum(DATE_START)}) "
      f"→ {DATE_END} (DayNum {daynum(DATE_END)})")
for tgt_date, tgt_daynum in MASSEY_TARGETS:
    print(f"  Massey     : {tgt_date}  →  DayNum {tgt_daynum}")

# %%
# ---------------------------------------------------------------------------
# PHASE 0b — HTTP session & fetch helper
# ---------------------------------------------------------------------------
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
})


def fetch(url: str, retries: int = 3, sleep_sec: float = SLEEP_SR,
          extra_headers: dict = None) -> requests.Response | None:
    """GET with retries, polite sleep, and rate-limit back-off."""
    hdrs = extra_headers or {}
    for attempt in range(retries):
        try:
            r = SESSION.get(url, timeout=25, headers=hdrs)
            if r.status_code == 200:
                return r
            if r.status_code == 429:
                wait = 45 * (attempt + 1)
                print(f"    [429] rate-limited — sleeping {wait}s …")
                time.sleep(wait)
                continue
            if r.status_code in (403, 503):
                wait = 15 * (attempt + 1)
                print(f"    [{r.status_code}] blocked — sleeping {wait}s …")
                time.sleep(wait)
                continue
            print(f"    [HTTP {r.status_code}] {url[:80]}")
            return None
        except Exception as exc:
            print(f"    [fetch error attempt {attempt + 1}] {exc}")
            time.sleep(8)
    return None


print("  HTTP session configured.")

# %%
# ---------------------------------------------------------------------------
# PHASE 0c — Team name → Kaggle TeamID lookup + team→conference mapping
# ---------------------------------------------------------------------------
spellings_df = pd.read_csv(SPELLINGS_CSV)

# Build TeamID → ConfAbbrev for current season (used for MConferenceTourneyGames)
_tc = pd.read_csv(TEAM_CONF_CSV)
_tc_season = _tc[_tc["Season"] == SEASON]
if _tc_season.empty:
    # Fall back to most recent season available
    _tc_season = _tc[_tc["Season"] == _tc["Season"].max()]
team_to_conf: dict[int, str] = dict(zip(_tc_season["TeamID"], _tc_season["ConfAbbrev"]))


def _norm(s: str) -> str:
    """Lowercase, keep only alphanumeric chars."""
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


name_to_id: dict[str, int] = {}
for _, row in spellings_df.iterrows():
    name_to_id[_norm(row["TeamNameSpelling"])] = int(row["TeamID"])

# Manual overrides: Sports Reference / Massey names not in MTeamSpellings.
# None = known non-D1 team → skip that game.
# Add entries here when the script reports "Unknown team" warnings.
MANUAL_OVERRIDES: dict[str, int | None] = {
    # ── UConn ──────────────────────────────────────────────────────────────
    "connecticut":         1163,
    "uconn":               1163,
    # ── Miami (ESPN uses "Miami" for FL and "Miami (OH)" for OH) ──────────
    "miami":               1274,   # Miami FL  (ESPN id=2390, abbrev=MIA)
    "miamifl":             1274,
    "miamiflorida":        1274,
    "miamioh":             1275,   # Miami OH  (ESPN id=193,  abbrev=M-OH)
    # ── Appalachian State (ESPN: "App State") ─────────────────────────────
    "appstate":            1111,
    # ── Queens University of Charlotte (ESPN: "Queens University") ─────────
    "queensuniversity":    1474,
    # ── Saint Francis PA (ESPN: "Saint Francis", abbrev=SFPA) ─────────────
    "saintfrancis":        1384,
    # ── San José State — é stripped by _norm → "sanjosstate" ──────────────
    "sanjosstate":         1363,
    # ── St. Thomas-Minnesota (ESPN: "St. Thomas-Minnesota") ───────────────
    "stthomasminnesota":   1472,
    # ── UAlbany (ESPN: "UAlbany") ──────────────────────────────────────────
    "ualbany":             1107,
    # ── UL Monroe → ULM (ESPN: "UL Monroe") ──────────────────────────────
    "ulmonroe":            1419,
    # ── UT Rio Grande Valley → UTRGV (ESPN: "UT Rio Grande Valley") ───────
    "utriograndevalley":   1410,
    # ── Loyola Chicago ────────────────────────────────────────────────────
    "loyolachicago":       1260,
    "loyolachi":           1260,
    # NOTE: "njit", "csunorthridge", "ucsandiego" were incorrectly listed here
    # with wrong TeamIDs (1332=Oregon, 1109=Alliant Intl, 1437=Villanova).
    # All three are already in MTeamSpellings.csv with correct IDs
    # (njit=1312, csunorthridge=1169, ucsandiego=1471) — no overrides needed.
    # ── Known non-D1 teams → skip (None) ──────────────────────────────────
    "midatlanticchristian": None,  # NCCAA, not NCAA D1
    "utahtechuniversity":  None,   # D2
    "lubbockchristian":    None,   # D2
}


def resolve_team(name: str) -> int | None:
    """Return Kaggle TeamID, or None if non-D1 / unknown."""
    key = _norm(name)
    if key in MANUAL_OVERRIDES:
        return MANUAL_OVERRIDES[key]
    if key in name_to_id:
        return name_to_id[key]
    # Try stripping common trailing words
    for suffix in ("university", "college", "univ"):
        if key.endswith(suffix):
            trimmed = key[: -len(suffix)]
            if trimmed in name_to_id:
                return name_to_id[trimmed]
    return None   # will be logged as "Unknown"


# Sanity check
assert resolve_team("Duke") == 1181,     "Duke lookup failed"
assert resolve_team("Connecticut") == 1163, "UConn lookup failed"
print(f"  Team lookup OK: Duke→{resolve_team('Duke')}, "
      f"Connecticut→{resolve_team('Connecticut')}")
print(f"  Total spelling aliases loaded: {len(name_to_id):,}")

# %%
# ---------------------------------------------------------------------------
# PHASE 1 — ESPN scoreboard API → compact game list
# URL: site.api.espn.com  groups=50 → all D1 games, returns JSON (no HTML)
# ---------------------------------------------------------------------------
print("\n" + "=" * 65)
print("  PHASE 1 — ESPN API: game results (compact)")
print("=" * 65)

ESPN_SCOREBOARD = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball"
    "/mens-college-basketball/scoreboard"
    "?dates={date}&groups=50&limit=300"
)


def parse_espn_scoreboard(data: dict, target_date: date) -> list[dict]:
    """
    Parse one ESPN scoreboard JSON response.
    Returns list of game dicts with keys:
      date, daynum, w_name, w_score, l_name, l_score,
      wloc, num_ot, espn_event_id, espn_home_id, espn_away_id,
      w_id, l_id
    Skips incomplete games and games where either team is not D1.
    """
    games         = []
    unknown_teams = []

    for event in data.get("events", []):
        # Only completed games
        if not event.get("status", {}).get("type", {}).get("completed", False):
            continue

        comp        = event["competitions"][0]
        competitors = comp["competitors"]

        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if home is None or away is None:
            continue

        neutral    = comp.get("neutralSite", False)
        home_name  = home["team"].get("location", "")
        away_name  = away["team"].get("location", "")
        home_score = int(home.get("score", 0) or 0)
        away_score = int(away.get("score", 0) or 0)
        home_won   = bool(home.get("winner", home_score > away_score))

        # NumOT: period 2=regulation; each extra period = 1 OT
        period = event.get("status", {}).get("period", 2)
        num_ot = max(0, int(period) - 2)

        espn_event_id = str(event["id"])
        espn_home_id  = str(home["team"]["id"])
        espn_away_id  = str(away["team"]["id"])

        # Detect game type from ESPN event notes
        # Conference tournament: notes headline contains a conference name + "Tournament"
        # NCAA tournament: notes headline contains "NCAA"
        notes = comp.get("notes", [])
        note_headlines = [n.get("headline", "").upper() for n in notes]
        is_ncaa = any("NCAA" in h for h in note_headlines)
        is_conf_tourney = (
            not is_ncaa
            and any(
                "TOURNAMENT" in h or "TOURNEY" in h
                for h in note_headlines
            )
        )

        if home_won:
            w_name, w_score = home_name, home_score
            l_name, l_score = away_name, away_score
            wloc = "N" if neutral else "H"
        else:
            w_name, w_score = away_name, away_score
            l_name, l_score = home_name, home_score
            wloc = "N" if neutral else "A"

        w_id = resolve_team(w_name)
        l_id = resolve_team(l_name)
        if w_id is None:
            unknown_teams.append(w_name)
            continue
        if l_id is None:
            unknown_teams.append(l_name)
            continue

        games.append({
            "date":            target_date.isoformat(),
            "daynum":          daynum(target_date),
            "w_name":          w_name,        "w_score":       w_score,
            "l_name":          l_name,        "l_score":       l_score,
            "wloc":            wloc,          "num_ot":        num_ot,
            "espn_event_id":   espn_event_id,
            "espn_home_id":    espn_home_id,
            "espn_away_id":    espn_away_id,
            "w_id":            w_id,          "l_id":          l_id,
            "is_conf_tourney": is_conf_tourney,
            "is_ncaa":         is_ncaa,
        })

    if unknown_teams:
        print(f"    [unknown/non-D1 skipped]: {sorted(set(unknown_teams))}")
    return games


# ── Main date loop ─────────────────────────────────────────────────────────
total_days   = (DATE_END - DATE_START).days + 1
all_games    = []
failed_dates = []

print(f"\n  Fetching {total_days} dates from ESPN API ({DATE_START} → {DATE_END}) …\n")

for i in range(total_days):
    d   = DATE_START + timedelta(days=i)
    url = ESPN_SCOREBOARD.format(date=d.strftime("%Y%m%d"))
    r   = fetch(url, sleep_sec=0.5)   # ESPN JSON: lighter sleep OK
    if r is None:
        print(f"  [{d}] FAILED — will retry on next run")
        failed_dates.append(str(d))
        continue
    try:
        games = parse_espn_scoreboard(r.json(), d)
    except Exception as exc:
        print(f"  [{d}] parse error: {exc}")
        failed_dates.append(str(d))
        continue
    all_games.extend(games)
    print(f"  [{d}]  DayNum={daynum(d):3d}  games={len(games):3d}")
    time.sleep(0.5)

print(f"\n  Total D1 games found : {len(all_games)}")
if failed_dates:
    print(f"  FAILED dates (rerun) : {failed_dates}")

# Save intermediate compact file
compact_scratch = pd.DataFrame(all_games)
if not compact_scratch.empty:
    compact_scratch.to_csv(SCRATCH_COMPACT, index=False)
    print(f"  Saved scratch: {SCRATCH_COMPACT.name}  ({len(compact_scratch)} rows)")

# %%
# ---------------------------------------------------------------------------
# PHASE 2 — ESPN game summary API → detailed box score stats
# ---------------------------------------------------------------------------
print("\n" + "=" * 65)
print("  PHASE 2 — ESPN API: box scores (detailed)")
print("=" * 65)

ESPN_SUMMARY = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball"
    "/mens-college-basketball/summary?event={event_id}"
)

# ESPN combined stat key → (Kaggle_made_col, Kaggle_att_col)
# displayValue is "made-attempted" e.g. "23-62"
ESPN_COMBINED = {
    "fieldGoalsMade-fieldGoalsAttempted":                     ("FGM",  "FGA"),
    "threePointFieldGoalsMade-threePointFieldGoalsAttempted": ("FGM3", "FGA3"),
    "freeThrowsMade-freeThrowsAttempted":                     ("FTM",  "FTA"),
}
# ESPN single stat key → Kaggle suffix
ESPN_SINGLE = {
    "offensiveRebounds": "OR",
    "defensiveRebounds": "DR",
    "assists":           "Ast",
    "turnovers":         "TO",
    "steals":            "Stl",
    "blocks":            "Blk",
    "fouls":             "PF",
}
ZERO_STATS = {k: 0 for k in
              ["FGM","FGA","FGM3","FGA3","FTM","FTA",
               "OR","DR","Ast","TO","Stl","Blk","PF"]}


def parse_espn_team_stats(statistics: list) -> dict:
    """Parse ESPN statistics array → dict of Kaggle suffix → int."""
    stats = dict(ZERO_STATS)
    for s in statistics:
        name = s.get("name", "")
        val  = s.get("displayValue", "0")
        if name in ESPN_COMBINED:
            made_col, att_col = ESPN_COMBINED[name]
            try:
                made, att = val.split("-")
                stats[made_col] = int(made)
                stats[att_col]  = int(att)
            except (ValueError, AttributeError):
                pass
        elif name in ESPN_SINGLE:
            try:
                stats[ESPN_SINGLE[name]] = int(val)
            except ValueError:
                pass
    return stats


def fetch_espn_box_stats(event_id: str,
                          espn_home_id: str,
                          espn_away_id: str) -> tuple[dict, dict] | None:
    """
    Fetch ESPN game summary and return (away_stats, home_stats).
    Stats are dicts keyed by Kaggle suffix.
    Uses ESPN team IDs to reliably identify home vs away stats,
    regardless of order in the API response.
    """
    url = ESPN_SUMMARY.format(event_id=event_id)
    r   = fetch(url, sleep_sec=0.5)
    if r is None:
        return None
    try:
        data      = r.json()
        teams_box = data.get("boxscore", {}).get("teams", [])
    except Exception as exc:
        print(f"    [JSON parse error] {exc}")
        return None

    away_stats = dict(ZERO_STATS)
    home_stats = dict(ZERO_STATS)

    for tb in teams_box:
        tid = str(tb.get("team", {}).get("id", ""))
        parsed = parse_espn_team_stats(tb.get("statistics", []))
        if tid == espn_away_id:
            away_stats = parsed
        elif tid == espn_home_id:
            home_stats = parsed
        # If IDs don't match (rare), fall through with zeros

    return away_stats, home_stats


# ── Load compact scratch ───────────────────────────────────────────────────
if SCRATCH_COMPACT.exists():
    compact_scratch = pd.read_csv(SCRATCH_COMPACT)
else:
    print("  No scratch compact file found — run Phase 1 first.")
    compact_scratch = pd.DataFrame()

detailed_rows    = []
failed_boxscores = []
total_games      = len(compact_scratch)
SLEEP_ESPN       = 0.6   # ESPN JSON API: polite but not as slow as HTML scraping

print(f"\n  Fetching box scores for {total_games} games …\n"
      f"  (approx {total_games * SLEEP_ESPN / 60:.0f} min "
      f"at {SLEEP_ESPN}s/game)\n")

for idx, row in compact_scratch.iterrows():
    event_id    = str(row.get("espn_event_id", ""))
    espn_home_id = str(row.get("espn_home_id", ""))
    espn_away_id = str(row.get("espn_away_id", ""))

    if not event_id:
        print(f"  [{idx+1}/{total_games}] no ESPN event ID — skipping")
        failed_boxscores.append(idx)
        continue

    result = fetch_espn_box_stats(event_id, espn_home_id, espn_away_id)
    if result is None:
        print(f"  [{idx+1}/{total_games}] FAILED event={event_id}")
        failed_boxscores.append(idx)
        result = (dict(ZERO_STATS), dict(ZERO_STATS))

    away_stats, home_stats = result

    # Map W/L stats: WLoc='A' → winner was away; else winner was home
    wloc = row["wloc"]
    if wloc == "A":
        w_stats, l_stats = away_stats, home_stats
    else:
        w_stats, l_stats = home_stats, away_stats

    det = {
        "Season":  SEASON,
        "DayNum":  int(row["daynum"]),
        "WTeamID": int(row["w_id"]),
        "WScore":  int(row["w_score"]),
        "LTeamID": int(row["l_id"]),
        "LScore":  int(row["l_score"]),
        "WLoc":    wloc,
        "NumOT":   int(row["num_ot"]),
    }
    for suf in ["FGM","FGA","FGM3","FGA3","FTM","FTA",
                "OR","DR","Ast","TO","Stl","Blk","PF"]:
        det[f"W{suf}"] = w_stats.get(suf, 0)
        det[f"L{suf}"] = l_stats.get(suf, 0)

    detailed_rows.append(det)

    if (idx + 1) % 50 == 0 or (idx + 1) == total_games:
        print(f"  [{idx+1}/{total_games}]  date={row['date']}  "
              f"W={str(row['w_name'])[:18]}  L={str(row['l_name'])[:18]}")
        pd.DataFrame(detailed_rows).to_csv(SCRATCH_DETAILED, index=False)

    time.sleep(SLEEP_ESPN)

detailed_scratch = pd.DataFrame(detailed_rows)
if not detailed_scratch.empty:
    detailed_scratch.to_csv(SCRATCH_DETAILED, index=False)
    print(f"\n  Saved scratch: {SCRATCH_DETAILED.name}  "
          f"({len(detailed_scratch)} rows, {len(failed_boxscores)} failed)")
else:
    print("  No detailed rows collected.")

# %%
# ---------------------------------------------------------------------------
# PHASE 3 — Massey rankings from manually saved text files
#
# masseyratings.com blocks automated scraping (Cloudflare 403).
# Rankings are manually copied from the site each week and saved as
# plain-text tab-separated files in massey_raw/.
#
# To add a new week: visit masseyratings.com/cb/compare.htm,
# select-all / copy, paste into Notepad, save as UTF-8 to:
#   massey_raw/massey_week_NNN.txt   (NNN = RankingDayNum)
# Then re-run this script — Phase 3 skips weeks already in the CSV.
#
# Current files:
#   massey_raw/massey_week_100.txt  ->  DayNum 100  (covers games DayNum 100-106)
#   massey_raw/massey_week_107.txt  ->  DayNum 107  (covers games DayNum 107-113)
#   massey_raw/massey_week_114.txt  ->  DayNum 114  (covers games DayNum 114-117)
#   massey_raw/massey_week_118.txt  ->  DayNum 118  (covers games DayNum 118+)
#
# To add a future week: save as massey_raw/massey_week_NNN.txt, add entry below.
# ---------------------------------------------------------------------------
print("\n" + "=" * 65)
print("  PHASE 3 — Massey rankings (from saved text files)")
print("=" * 65)

MASSEY_RAW_DIR = DATA_DIR / "massey_raw"
MASSEY_WEEK_FILES = {
    MASSEY_RAW_DIR / "massey_week_100.txt": 100,
    MASSEY_RAW_DIR / "massey_week_107.txt": 107,
    MASSEY_RAW_DIR / "massey_week_114.txt": 114,
    MASSEY_RAW_DIR / "massey_week_118.txt": 118,
    MASSEY_RAW_DIR / "massey_week_121.txt": 121,
}

# Massey-specific overrides — ONLY for names genuinely absent from
# MTeamSpellings.csv.  DO NOT add names already in MTeamSpellings;
# that creates duplicate TeamID rows in MMasseyOrdinals.
MASSEY_OVERRIDES: dict[str, int | None] = {
    "stthomasmn":          1472,   # St Thomas MN — new 2022 D1 program
    "stthomasminnesota":   1472,
    "queensnc":            1474,   # Queens NC — new D1 program
    "sanjosstate":         1363,   # San Jose State — e accent stripped by _norm
    "midatlanticchristian": None,  # NCCAA, skip
    "utahtechuniversity":  None,   # D2, skip
    "lubbockchristian":    None,   # D2, skip
}


def resolve_massey_team(name: str) -> int | None:
    """Resolve a Massey team name to a Kaggle TeamID.
    Checks MASSEY_OVERRIDES then MTeamSpellings (name_to_id).
    Does NOT use MANUAL_OVERRIDES (those are ESPN-specific and may
    contain wrong IDs for Massey names)."""
    key = _norm(name)
    if key in MASSEY_OVERRIDES:
        return MASSEY_OVERRIDES[key]
    return name_to_id.get(key)


def parse_massey_txt(filepath: Path, ranking_daynum: int) -> pd.DataFrame:
    """
    Parse one Massey ratings text file (tab-separated copy from browser).

    Table structure:
        Team  Conf  W-L  Delta  CMP  Sort(>>)  <system cols...>

    Returns DataFrame with columns matching MMasseyOrdinals.csv:
        Season, RankingDayNum, SystemName, TeamID, OrdinalRank
    """
    print(f"\n  Parsing {filepath.name}  ->  DayNum {ranking_daynum}")
    text  = filepath.read_text(encoding="utf-8", errors="replace")
    lines = [ln for ln in text.splitlines() if ln.strip()]

    # Find header row (the one containing a 'Team' column)
    header_idx   = None
    system_names = []
    for i, line in enumerate(lines):
        cols = [c.strip() for c in line.split("\t")]
        if any(_norm(c) == "team" for c in cols):
            team_col    = next(j for j, c in enumerate(cols) if _norm(c) == "team")
            data_start  = team_col + 6   # skip: Team Conf W-L Delta CMP Sort
            system_names = [c for c in cols[data_start:] if c and c != ">>"]
            header_idx   = i
            break

    if header_idx is None:
        print("    ERROR: no 'Team' column found in header — check file format")
        return pd.DataFrame()

    print(f"    Header at line {header_idx} | {len(system_names)} system columns")

    records       = []
    unknown_teams = []

    for line in lines[header_idx + 1:]:
        cols = [c.strip() for c in line.split("\t")]
        if len(cols) < 7:
            continue
        team_name = cols[0]
        if not team_name or _norm(team_name) == "team":
            continue

        team_id = resolve_massey_team(team_name)
        if team_id is None:
            unknown_teams.append(team_name)
            continue

        for j, sys_name in enumerate(system_names):
            col_idx = 6 + j
            if col_idx >= len(cols):
                break
            val = cols[col_idx]
            if val in ("--", ""):
                continue
            try:
                records.append({
                    "Season":        SEASON,
                    "RankingDayNum": ranking_daynum,
                    "SystemName":    sys_name,
                    "TeamID":        team_id,
                    "OrdinalRank":   int(val),
                })
            except ValueError:
                continue

    if unknown_teams:
        uniq = sorted(set(unknown_teams))
        print(f"    Unknown teams ({len(uniq)}) — add to MASSEY_OVERRIDES if D1: {uniq}")

    df = pd.DataFrame(records)
    if df.empty:
        print("    WARNING: no rows parsed — check file format")
        return df

    n_teams   = df["TeamID"].nunique()
    n_systems = df["SystemName"].nunique()
    dups      = df.duplicated(subset=["TeamID", "SystemName"]).sum()
    print(f"    Parsed: {len(df):,} rows  ({n_teams} teams x {n_systems} systems)"
          f"  | duplicates={dups}")

    required = {"POM", "MAS", "MOR", "WLK", "BIH", "NET"}
    missing  = required - set(df["SystemName"].unique())
    if missing:
        print(f"    WARNING — required systems missing: {missing}")
    else:
        print(f"    All 6 required systems present (POM/MAS/MOR/WLK/BIH/NET)")

    return df


# ── Load existing Massey data once (used for skip-check and Phase 4c) ────────
massey_existing = pd.read_csv(MASSEY_CSV)
print(f"  MMasseyOrdinals.csv: {len(massey_existing):,} existing rows")

massey_rows = []
for filepath, daynum in sorted(MASSEY_WEEK_FILES.items(), key=lambda x: x[1]):
    if not filepath.exists():
        print(f"  [SKIP] {filepath.name} not found in massey_raw/")
        continue
    already = massey_existing[
        (massey_existing["Season"] == SEASON) &
        (massey_existing["RankingDayNum"] == daynum)
    ]
    if not already.empty:
        print(f"  [SKIP] DayNum {daynum} already in MMasseyOrdinals.csv "
              f"({len(already):,} rows)")
        continue
    df = parse_massey_txt(filepath, daynum)
    if not df.empty:
        massey_rows.append(df)

if massey_rows:
    massey_scratch = pd.concat(massey_rows, ignore_index=True)
    print(f"\n  Total new Massey rows parsed: {len(massey_scratch):,}")
else:
    massey_scratch = pd.DataFrame()
    print("\n  No new Massey data (all weeks already imported or files missing).")

# %%
# ---------------------------------------------------------------------------
# PHASE 4 — Idempotent append to the three Kaggle CSVs
# ---------------------------------------------------------------------------
print("\n" + "=" * 65)
print("  PHASE 4 — Append to Kaggle CSVs")
print("=" * 65)

# ── 4a. Compact results (regular season + conf tourney only — NOT NCAA) ────
if SCRATCH_COMPACT.exists():
    sc = pd.read_csv(SCRATCH_COMPACT)

    # Regular + conf tourney go to MRegularSeasonCompactResults; NCAA goes elsewhere
    sc_reg = sc[sc.get("is_ncaa", pd.Series(False, index=sc.index)) != True].copy()

    compact_new = pd.DataFrame({
        "Season":  SEASON,
        "DayNum":  sc_reg["daynum"].astype(int),
        "WTeamID": sc_reg["w_id"].astype(int),
        "WScore":  sc_reg["w_score"].astype(int),
        "LTeamID": sc_reg["l_id"].astype(int),
        "LScore":  sc_reg["l_score"].astype(int),
        "WLoc":    sc_reg["wloc"],
        "NumOT":   sc_reg["num_ot"].astype(int),
    })

    compact_existing = pd.read_csv(COMPACT_CSV)
    # De-duplicate: drop any rows already present (Season+DayNum+WTeamID+LTeamID)
    merge_keys = ["Season", "DayNum", "WTeamID", "LTeamID"]
    already    = compact_existing[compact_existing["Season"] == SEASON]
    new_only   = compact_new[
        ~compact_new.set_index(merge_keys).index.isin(
            already.set_index(merge_keys).index
        )
    ]
    combined = pd.concat([compact_existing, new_only], ignore_index=True)
    combined.to_csv(COMPACT_CSV, index=False)
    print(f"  MRegularSeasonCompactResults.csv")
    print(f"    existing rows : {len(compact_existing):,}")
    print(f"    new rows added: {len(new_only):,}")
    print(f"    total rows    : {len(combined):,}")

# ── 4b. Detailed results ───────────────────────────────────────────────────
if SCRATCH_DETAILED.exists():
    sd = pd.read_csv(SCRATCH_DETAILED)

    detailed_existing = pd.read_csv(DETAILED_CSV)
    merge_keys = ["Season", "DayNum", "WTeamID", "LTeamID"]
    already    = detailed_existing[detailed_existing["Season"] == SEASON]
    new_only   = sd[
        ~sd.set_index(merge_keys).index.isin(
            already.set_index(merge_keys).index
        )
    ]
    # Ensure column order matches existing file
    new_only = new_only[detailed_existing.columns]
    combined = pd.concat([detailed_existing, new_only], ignore_index=True)
    combined.to_csv(DETAILED_CSV, index=False)
    print(f"\n  MRegularSeasonDetailedResults.csv")
    print(f"    existing rows : {len(detailed_existing):,}")
    print(f"    new rows added: {len(new_only):,}")
    print(f"    total rows    : {len(combined):,}")
    SCRATCH_DETAILED.unlink()

# ── 4c. Massey Ordinals ────────────────────────────────────────────────────
# massey_scratch is built in Phase 3 from the massey_raw/*.txt files.
# massey_existing is also loaded there, so no re-read needed here.
if not massey_scratch.empty:
    merge_keys = ["Season", "RankingDayNum", "SystemName", "TeamID"]
    already    = massey_existing[massey_existing["Season"] == SEASON]
    new_only   = massey_scratch[
        ~massey_scratch.set_index(merge_keys).index.isin(
            already.set_index(merge_keys).index
        )
    ]
    combined = pd.concat([massey_existing, new_only], ignore_index=True)
    combined.to_csv(MASSEY_CSV, index=False)
    print(f"\n  MMasseyOrdinals.csv")
    print(f"    existing rows : {len(massey_existing):,}")
    print(f"    new rows added: {len(new_only):,}")
    print(f"    total rows    : {len(combined):,}")
else:
    print("\n  MMasseyOrdinals.csv — no new Massey data to append.")

# ── 4d. Conference tourney game keys → MConferenceTourneyGames.csv ─────────
# Scratch was NOT unlinked in 4a so it's still available here
_sc_for_tourney = pd.read_csv(SCRATCH_COMPACT) if SCRATCH_COMPACT.exists() else None

if _sc_for_tourney is not None and "is_conf_tourney" in _sc_for_tourney.columns:
    sc_ct = _sc_for_tourney[_sc_for_tourney["is_conf_tourney"] == True].copy()
    if not sc_ct.empty:
        # Look up ConfAbbrev from winner's team ID
        sc_ct = sc_ct.copy()
        sc_ct["ConfAbbrev"] = sc_ct["w_id"].astype(int).map(team_to_conf).fillna("unk")
        ctag_new = pd.DataFrame({
            "Season":     SEASON,
            "ConfAbbrev": sc_ct["ConfAbbrev"],
            "DayNum":     sc_ct["daynum"].astype(int),
            "WTeamID":    sc_ct["w_id"].astype(int),
            "LTeamID":    sc_ct["l_id"].astype(int),
        })
        ctag_existing = pd.read_csv(CONF_TOURNEY_CSV)
        merge_keys = ["Season", "DayNum", "WTeamID", "LTeamID"]
        already_ct = ctag_existing[ctag_existing["Season"] == SEASON]
        new_ct = ctag_new[
            ~ctag_new.set_index(merge_keys).index.isin(
                already_ct.set_index(merge_keys).index
            )
        ]
        combined_ct = pd.concat([ctag_existing, new_ct], ignore_index=True)
        combined_ct.to_csv(CONF_TOURNEY_CSV, index=False)
        print(f"\n  MConferenceTourneyGames.csv")
        print(f"    existing rows : {len(ctag_existing):,}")
        print(f"    new rows added: {len(new_ct):,}")
        print(f"    total rows    : {len(combined_ct):,}")
        if not new_ct.empty:
            print(f"    conferences   : {sorted(new_ct['ConfAbbrev'].unique())}")
    else:
        print("\n  MConferenceTourneyGames.csv — no conference tournament games detected.")
else:
    print("\n  MConferenceTourneyGames.csv — skipped (no scratch data or old-format scratch).")

# ── 4e. NCAA tournament games → MNCAATourneyCompactResults.csv ────────────
if _sc_for_tourney is not None and "is_ncaa" in _sc_for_tourney.columns:
    sc_ncaa = _sc_for_tourney[_sc_for_tourney["is_ncaa"] == True].copy()
    if not sc_ncaa.empty:
        ncaa_new = pd.DataFrame({
            "Season":  SEASON,
            "DayNum":  sc_ncaa["daynum"].astype(int),
            "WTeamID": sc_ncaa["w_id"].astype(int),
            "WScore":  sc_ncaa["w_score"].astype(int),
            "LTeamID": sc_ncaa["l_id"].astype(int),
            "LScore":  sc_ncaa["l_score"].astype(int),
            "WLoc":    sc_ncaa["wloc"],
            "NumOT":   sc_ncaa["num_ot"].astype(int),
        })
        ncaa_existing = pd.read_csv(NCAA_COMPACT_CSV)
        merge_keys = ["Season", "DayNum", "WTeamID", "LTeamID"]
        already_ncaa = ncaa_existing[ncaa_existing["Season"] == SEASON]
        new_ncaa = ncaa_new[
            ~ncaa_new.set_index(merge_keys).index.isin(
                already_ncaa.set_index(merge_keys).index
            )
        ]
        combined_ncaa = pd.concat([ncaa_existing, new_ncaa], ignore_index=True)
        combined_ncaa.to_csv(NCAA_COMPACT_CSV, index=False)
        print(f"\n  MNCAATourneyCompactResults.csv")
        print(f"    existing rows : {len(ncaa_existing):,}")
        print(f"    new rows added: {len(new_ncaa):,}")
        print(f"    total rows    : {len(combined_ncaa):,}")
    else:
        print("\n  MNCAATourneyCompactResults.csv — no NCAA tournament games detected.")

# ── Clean up compact scratch after all Phase 4 sections ───────────────────
if SCRATCH_COMPACT.exists():
    SCRATCH_COMPACT.unlink()

# %%
# ---------------------------------------------------------------------------
# PHASE 5 — Validation summary
# ---------------------------------------------------------------------------
print("\n" + "=" * 65)
print("  PHASE 5 — Validation")
print("=" * 65)

compact_check  = pd.read_csv(COMPACT_CSV)
detailed_check = pd.read_csv(DETAILED_CSV)
massey_check   = pd.read_csv(MASSEY_CSV)

c26 = compact_check[compact_check["Season"] == SEASON]
d26 = detailed_check[detailed_check["Season"] == SEASON]
m26 = massey_check[massey_check["Season"] == SEASON]

print(f"\n  MRegularSeasonCompactResults  (2026)")
print(f"    rows         : {len(c26):,}")
print(f"    DayNum range : {c26['DayNum'].min()} – {c26['DayNum'].max()}")

print(f"\n  MRegularSeasonDetailedResults (2026)")
print(f"    rows         : {len(d26):,}")
print(f"    DayNum range : {d26['DayNum'].min()} – {d26['DayNum'].max()}")

print(f"\n  MMasseyOrdinals (2026)")
print(f"    rows            : {len(m26):,}")
print(f"    RankingDayNums  : {sorted(m26['RankingDayNum'].unique())}")
req_systems = ["POM", "MAS", "MOR", "WLK", "BIH", "NET"]
for dn in sorted(m26["RankingDayNum"].unique()):
    snap     = m26[m26["RankingDayNum"] == dn]
    n_teams  = snap["TeamID"].nunique()
    req_ok   = all(s in snap["SystemName"].values for s in req_systems)
    req_str  = "OK all 6 required" if req_ok else (
        "MISSING: " + str([s for s in req_systems
                           if s not in snap["SystemName"].values]))
    print(f"    DayNum {dn:3d}: {n_teams:3d} teams  {req_str}")

ctag_check = pd.read_csv(CONF_TOURNEY_CSV)
ct26 = ctag_check[ctag_check["Season"] == SEASON]
print(f"\n  MConferenceTourneyGames (2026)")
print(f"    rows         : {len(ct26):,}")
if not ct26.empty:
    print(f"    DayNum range : {ct26['DayNum'].min()} – {ct26['DayNum'].max()}")
    print(f"    conferences  : {sorted(ct26['ConfAbbrev'].unique())}")

# Check compact / detailed row counts match
if len(c26) != len(d26):
    print(f"\n  WARNING: compact ({len(c26)}) ≠ detailed ({len(d26)}) row counts")
    print("  This is expected if some boxscores failed — review _new_detailed.csv"
          " if it still exists.")
else:
    print(f"\n  Row counts match (compact = detailed = {len(c26):,}) OK")

print("\n  Done. Run build_mm_dataset.ipynb to rebuild master_dataset.xlsx.")

# %%
