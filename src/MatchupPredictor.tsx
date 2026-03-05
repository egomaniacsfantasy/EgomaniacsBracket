import { useMemo, useRef, useState } from "react";
import { TEAM_STAT_IMPORTANCE, TEAM_STAT_ORDER, TEAM_STATS_2026, type TeamStatKey } from "./data/teamStats2026";
import { formatOddsDisplay } from "./lib/odds";
import type { OddsDisplayMode } from "./types";

// Lazy import — predictor data is large; only loaded if this component mounts
// (Vite code-splits dynamic imports automatically)
let _getMatchupProb: ((a: number, b: number, loc: "N" | "H" | "A") => number | null) | null = null;
let _getTeamIdx: ((id: number) => number) | null = null;
let _teams: ReadonlyArray<{ id: number; name: string; conf: string }> | null = null;
let _loadingPromise: Promise<void> | null = null;

async function loadPredictorData(): Promise<void> {
  if (_teams) return;
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = import("./data/matchupPredictor").then((mod) => {
    _getMatchupProb = mod.getMatchupProb;
    _getTeamIdx = mod.getTeamIdx;
    _teams = mod.PREDICTOR_TEAMS;
  });
  return _loadingPromise;
}

// ── Stat display helpers (shared with conf tournament modal) ─────────────────

const TEAM_STAT_LABELS: Record<TeamStatKey, string> = {
  rank_POM: "KenPom Rank",
  rank_MAS: "Massey Rank",
  rank_WLK: "Whitlock Rank",
  rank_MOR: "Moore Rank",
  elo_sos: "Odds Gods Elo SOS",
  elo_last: "OddsGods Elo",
  avg_net_rtg: "Net Rating",
  avg_off_rtg: "Offensive Rating",
  elo_trend: "OddsGods Elo Trend",
  avg_def_rtg: "Defensive Rating",
  last5_Margin: "Last 5 Margin",
  rank_BIH: "Bihl Rank",
  rank_NET: "NET Rank",
};

const LOWER_IS_BETTER = new Set<TeamStatKey>(["rank_POM", "rank_MAS", "rank_WLK", "rank_MOR", "rank_BIH", "avg_def_rtg", "rank_NET"]);

const formatStatValue = (v: number | null): string => {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  if (Math.abs(v) >= 1000) return v.toFixed(1);
  if (Number.isInteger(v)) return `${v}`;
  if (Math.abs(v) < 1) return v.toFixed(4);
  return v.toFixed(2);
};

type TeamOption = { id: number; name: string; conf: string };

// ── Searchable dropdown ───────────────────────────────────────────────────────

function TeamSelector({
  label,
  teams,
  selectedId,
  excludeId,
  onSelect,
}: {
  label: string;
  teams: ReadonlyArray<TeamOption>;
  selectedId: number | null;
  excludeId: number | null;
  onSelect: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return teams
      .filter((t) => t.id !== excludeId && (q === "" || t.name.toLowerCase().includes(q) || t.conf.toLowerCase().includes(q)))
      .slice(0, 40);
  }, [teams, query, excludeId]);

  const selected = teams.find((t) => t.id === selectedId) ?? null;

  const handleBlur = (e: React.FocusEvent) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className="mp-team-selector" ref={containerRef} onBlur={handleBlur}>
      <label className="mp-team-label">{label}</label>
      <button
        className={`mp-selector-btn ${open ? "mp-selector-btn--open" : ""}`}
        onClick={() => setOpen((p) => !p)}
        type="button"
      >
        {selected ? (
          <>
            <span className="mp-selector-name">{selected.name}</span>
            <span className="mp-selector-conf">{selected.conf}</span>
          </>
        ) : (
          <span className="mp-selector-placeholder">Select a team…</span>
        )}
        <span className="mp-selector-caret">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="mp-dropdown">
          <input
            autoFocus
            type="text"
            className="mp-dropdown-search"
            placeholder="Search teams…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="mp-dropdown-list">
            {filtered.length === 0 ? (
              <div className="mp-dropdown-empty">No teams found</div>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.id}
                  className={`mp-dropdown-item ${t.id === selectedId ? "mp-dropdown-item--selected" : ""}`}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(t.id);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="mp-dropdown-item-name">{t.name}</span>
                  <span className="mp-dropdown-item-conf">{t.conf}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Probability bar ───────────────────────────────────────────────────────────

function ProbBar({
  nameA,
  nameB,
  probA,
  displayMode,
}: {
  nameA: string;
  nameB: string;
  probA: number;
  displayMode: OddsDisplayMode;
}) {
  const probB = 1 - probA;
  const oddsA = formatOddsDisplay(probA, displayMode);
  const oddsB = formatOddsDisplay(probB, displayMode);
  const pctA = (probA * 100).toFixed(1);
  const pctB = (probB * 100).toFixed(1);
  const aWins = probA >= 0.5;

  return (
    <div className="mp-prob-bar-wrap">
      <div className="mp-prob-names">
        <span className={`mp-prob-name ${aWins ? "mp-prob-name--fav" : ""}`}>{nameA}</span>
        <span className="mp-prob-vs">vs</span>
        <span className={`mp-prob-name ${!aWins ? "mp-prob-name--fav" : ""}`}>{nameB}</span>
      </div>
      <div className="mp-prob-bar">
        <div className="mp-prob-bar-a" style={{ width: `${pctA}%` }} />
      </div>
      <div className="mp-prob-values">
        <span className="mp-prob-val">
          {oddsA.primary}
          <span className="mp-prob-pct"> ({pctA}%)</span>
        </span>
        <span className="mp-prob-val mp-prob-val--right">
          {oddsB.primary}
          <span className="mp-prob-pct"> ({pctB}%)</span>
        </span>
      </div>
    </div>
  );
}

// ── Stat comparison table ─────────────────────────────────────────────────────

function StatTable({ nameA, nameB }: { nameA: string; nameB: string }) {
  const statsA = TEAM_STATS_2026[nameA] ?? null;
  const statsB = TEAM_STATS_2026[nameB] ?? null;

  if (!statsA && !statsB) return null;

  return (
    <div className="mp-stat-table-wrap">
      <table className="matchup-stats-table mp-stat-table">
        <thead>
          <tr>
            <th>Stat</th>
            <th>{nameA}</th>
            <th>{nameB}</th>
            <th>Edge</th>
            <th>Importance</th>
          </tr>
        </thead>
        <tbody>
          {TEAM_STAT_ORDER.map((key) => {
            const aVal = statsA?.[key] ?? null;
            const bVal = statsB?.[key] ?? null;
            const lower = LOWER_IS_BETTER.has(key);
            let edge = "-";
            if (aVal !== null && bVal !== null && aVal !== bVal) {
              const aBetter = lower ? aVal < bVal : aVal > bVal;
              const delta = Math.abs(aVal - bVal);
              const deltaStr = delta >= 1000 ? delta.toFixed(1) : Number.isInteger(delta) ? `${delta}` : delta < 1 ? delta.toFixed(4) : delta.toFixed(2);
              edge = `${aBetter ? nameA : nameB} +${deltaStr}`;
            } else if (aVal !== null && bVal !== null) {
              edge = "Even";
            }
            return (
              <tr key={key}>
                <td className="matchup-stat-name-cell">{TEAM_STAT_LABELS[key]}</td>
                <td>{formatStatValue(aVal)}</td>
                <td>{formatStatValue(bVal)}</td>
                <td>{edge}</td>
                <td>{TEAM_STAT_IMPORTANCE[key]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MatchupPredictor({ displayMode }: { displayMode: OddsDisplayMode }) {
  const [teams, setTeams] = useState<ReadonlyArray<TeamOption> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamAId, setTeamAId] = useState<number | null>(null);
  const [teamBId, setTeamBId] = useState<number | null>(null);
  const [loc, setLoc] = useState<"N" | "H" | "A">("N");

  // Lazy-load predictor data on first render
  useState(() => {
    loadPredictorData()
      .then(() => {
        setTeams(_teams);
      })
      .catch(() => {
        setLoadError("Prediction data not available. Run scripts/generate_matchup_predictor.py first.");
      });
  });

  const probA = useMemo(() => {
    if (!teams || teamAId === null || teamBId === null) return null;
    const idxA = _getTeamIdx?.(teamAId) ?? -1;
    const idxB = _getTeamIdx?.(teamBId) ?? -1;
    if (idxA < 0 || idxB < 0) return null;
    return _getMatchupProb?.(idxA, idxB, loc) ?? null;
  }, [teams, teamAId, teamBId, loc]);

  const teamAName = teams?.find((t) => t.id === teamAId)?.name ?? null;
  const teamBName = teams?.find((t) => t.id === teamBId)?.name ?? null;

  if (loadError) {
    return (
      <div className="mp-page">
        <div className="mp-load-error">{loadError}</div>
      </div>
    );
  }

  if (!teams) {
    return (
      <div className="mp-page">
        <div className="mp-loading">Loading prediction data…</div>
      </div>
    );
  }

  return (
    <div className="mp-page">
      <h2 className="mp-title">Team Matchup Predictor</h2>
      <p className="mp-subtitle">
        Select any two D1 teams and a game site to get a model win probability based on current season stats.
      </p>

      <div className="mp-controls">
        <TeamSelector
          label="Team A"
          teams={teams}
          selectedId={teamAId}
          excludeId={teamBId}
          onSelect={setTeamAId}
        />

        <div className="mp-location-wrap">
          <label className="mp-team-label">Game Site</label>
          <div className="mp-location-btns">
            <button
              className={`mp-loc-btn ${loc === "H" ? "mp-loc-btn--active" : ""}`}
              onClick={() => setLoc("H")}
            >
              A Home
            </button>
            <button
              className={`mp-loc-btn ${loc === "N" ? "mp-loc-btn--active" : ""}`}
              onClick={() => setLoc("N")}
            >
              Neutral
            </button>
            <button
              className={`mp-loc-btn ${loc === "A" ? "mp-loc-btn--active" : ""}`}
              onClick={() => setLoc("A")}
            >
              B Home
            </button>
          </div>
        </div>

        <TeamSelector
          label="Team B"
          teams={teams}
          selectedId={teamBId}
          excludeId={teamAId}
          onSelect={setTeamBId}
        />
      </div>

      {probA !== null && teamAName && teamBName ? (
        <>
          <ProbBar nameA={teamAName} nameB={teamBName} probA={probA} displayMode={displayMode} />
          <StatTable nameA={teamAName} nameB={teamBName} />
        </>
      ) : (
        <div className="mp-placeholder">
          {teamAId && teamBId ? "Computing…" : "Select two teams above to see the prediction."}
        </div>
      )}

      <p className="mp-footnote">
        Model: LightGBM + isotonic calibration, 33 features, DayNum 136 (NCAA R64 context).
        Home advantage (~50 Elo pts) is baked into the model.
      </p>
    </div>
  );
}
