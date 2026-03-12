import { useEffect, useMemo, useRef, useState } from "react";
import { TEAM_STAT_IMPORTANCE, TEAM_STAT_ORDER, TEAM_STATS_2026, type TeamStatKey } from "./data/teamStats2026";
import { teams as bracketTeams } from "./data/teams";
import { fallbackLogo, teamLogoUrl } from "./lib/logo";
import { getMappedEspnLogoPath } from "./lib/logoMap";
import { formatOddsDisplay } from "./lib/odds";
import type { OddsDisplayMode } from "./types";

let getMatchupProbFn: ((a: number, b: number, loc: "N" | "H" | "A") => number | null) | null = null;
let getTeamIdxFn: ((id: number) => number) | null = null;
let predictorTeamsCache: ReadonlyArray<{ id: number; name: string; conf: string }> | null = null;
let loadingPromise: Promise<void> | null = null;

type TeamOption = { id: number; name: string; conf: string };

const bracketTeamByName = new Map(bracketTeams.map((team) => [team.name, team]));

async function loadPredictorData(): Promise<void> {
  if (predictorTeamsCache) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = import("./data/matchupPredictor").then((mod) => {
    getMatchupProbFn = mod.getMatchupProb;
    getTeamIdxFn = mod.getTeamIdx;
    predictorTeamsCache = mod.PREDICTOR_TEAMS;
  });
  return loadingPromise;
}

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

const LOWER_IS_BETTER = new Set<TeamStatKey>([
  "rank_POM",
  "rank_MAS",
  "rank_WLK",
  "rank_MOR",
  "rank_BIH",
  "avg_def_rtg",
  "rank_NET",
]);

const conferenceLabel = (conf: string): string => conf.replace(/_/g, " ").toUpperCase();

const predictorTeamLogo = (teamName: string): string => {
  const bracketTeam = bracketTeamByName.get(teamName);
  if (bracketTeam) return teamLogoUrl(bracketTeam);
  return getMappedEspnLogoPath(teamName) ?? fallbackLogo(teamName);
};

const formatStatValue = (value: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toFixed(1);
  if (Number.isInteger(value)) return `${value}`;
  if (Math.abs(value) < 1) return value.toFixed(4);
  return value.toFixed(2);
};

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
    const trimmed = query.trim().toLowerCase();
    const allowed = teams.filter((team) => team.id !== excludeId);
    if (!trimmed) return allowed.slice(0, 50);
    return allowed
      .filter(
        (team) =>
          team.name.toLowerCase().includes(trimmed) ||
          conferenceLabel(team.conf).toLowerCase().includes(trimmed)
      )
      .slice(0, 50);
  }, [excludeId, query, teams]);

  const selected = teams.find((team) => team.id === selectedId) ?? null;

  const handleBlur = (event: React.FocusEvent) => {
    if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className="mp-team-selector" ref={containerRef} onBlur={handleBlur}>
      <label className="mp-team-label">{label}</label>
      <button
        className={`mp-selector-btn ${open ? "mp-selector-btn--open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {selected ? (
          <>
            <img className="mp-selector-logo" src={predictorTeamLogo(selected.name)} alt="" aria-hidden="true" />
            <span className="mp-selector-copy">
              <span className="mp-selector-name">{selected.name}</span>
              <span className="mp-selector-conf">{conferenceLabel(selected.conf)}</span>
            </span>
          </>
        ) : (
          <span className="mp-selector-placeholder">Select a team...</span>
        )}
        <span className="mp-selector-caret">{open ? "^" : "v"}</span>
      </button>

      {open ? (
        <div className="mp-dropdown">
          <input
            autoFocus
            type="text"
            className="mp-dropdown-search"
            placeholder="Search teams..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="mp-dropdown-list">
            {filtered.length === 0 ? (
              <div className="mp-dropdown-empty">No teams found</div>
            ) : (
              filtered.map((team) => (
                <button
                  key={team.id}
                  className={`mp-dropdown-item ${team.id === selectedId ? "mp-dropdown-item--selected" : ""}`}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSelect(team.id);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <img className="mp-dropdown-logo" src={predictorTeamLogo(team.name)} alt="" aria-hidden="true" />
                  <span className="mp-dropdown-item-copy">
                    <span className="mp-dropdown-item-name">{team.name}</span>
                    <span className="mp-dropdown-item-conf">{conferenceLabel(team.conf)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProbSummary({
  teamA,
  teamB,
  probA,
  displayMode,
}: {
  teamA: TeamOption;
  teamB: TeamOption;
  probA: number;
  displayMode: OddsDisplayMode;
}) {
  const probB = 1 - probA;
  const oddsA = formatOddsDisplay(probA, displayMode);
  const oddsB = formatOddsDisplay(probB, displayMode);
  const pctA = (probA * 100).toFixed(1);
  const pctB = (probB * 100).toFixed(1);
  const teamAFavorite = probA >= probB;

  return (
    <div className="mp-prob-summary">
      <div className={`mp-prob-team ${teamAFavorite ? "mp-prob-team--fav" : ""}`}>
        <div className="mp-prob-team-main">
          <img className="mp-prob-logo" src={predictorTeamLogo(teamA.name)} alt="" aria-hidden="true" />
          <div className="mp-prob-copy">
            <div className="mp-prob-team-name">{teamA.name}</div>
            <div className="mp-prob-team-conf">{conferenceLabel(teamA.conf)}</div>
          </div>
        </div>
        <div className="mp-prob-team-odds">
          <span>{oddsA.primary}</span>
          <span className="mp-prob-team-pct">{pctA}%</span>
        </div>
      </div>

      <div className="mp-prob-track">
        <div className="mp-prob-fill" style={{ width: `${pctA}%` }} />
      </div>

      <div className={`mp-prob-team ${!teamAFavorite ? "mp-prob-team--fav" : ""}`}>
        <div className="mp-prob-team-main">
          <img className="mp-prob-logo" src={predictorTeamLogo(teamB.name)} alt="" aria-hidden="true" />
          <div className="mp-prob-copy">
            <div className="mp-prob-team-name">{teamB.name}</div>
            <div className="mp-prob-team-conf">{conferenceLabel(teamB.conf)}</div>
          </div>
        </div>
        <div className="mp-prob-team-odds">
          <span>{oddsB.primary}</span>
          <span className="mp-prob-team-pct">{pctB}%</span>
        </div>
      </div>
    </div>
  );
}

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
            const valueA = statsA?.[key] ?? null;
            const valueB = statsB?.[key] ?? null;
            const lowerIsBetter = LOWER_IS_BETTER.has(key);
            let edge = "-";

            if (valueA !== null && valueB !== null && valueA !== valueB) {
              const aIsBetter = lowerIsBetter ? valueA < valueB : valueA > valueB;
              const delta = Math.abs(valueA - valueB);
              const deltaStr =
                delta >= 1000
                  ? delta.toFixed(1)
                  : Number.isInteger(delta)
                    ? `${delta}`
                    : delta < 1
                      ? delta.toFixed(4)
                      : delta.toFixed(2);
              edge = `${aIsBetter ? nameA : nameB} +${deltaStr}`;
            } else if (valueA !== null && valueB !== null) {
              edge = "Even";
            }

            return (
              <tr key={key}>
                <td className="matchup-stat-name-cell">{TEAM_STAT_LABELS[key]}</td>
                <td>{formatStatValue(valueA)}</td>
                <td>{formatStatValue(valueB)}</td>
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

export function MatchupPredictor({ displayMode }: { displayMode: OddsDisplayMode }) {
  const [teams, setTeams] = useState<ReadonlyArray<TeamOption> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamAId, setTeamAId] = useState<number | null>(null);
  const [teamBId, setTeamBId] = useState<number | null>(null);
  const [loc, setLoc] = useState<"N" | "H" | "A">("N");

  useEffect(() => {
    let cancelled = false;
    loadPredictorData()
      .then(() => {
        if (!cancelled) setTeams(predictorTeamsCache);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("Prediction data not available. Run scripts/generate_matchup_predictor.py first.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const teamA = useMemo(
    () => teams?.find((team) => team.id === teamAId) ?? null,
    [teamAId, teams]
  );
  const teamB = useMemo(
    () => teams?.find((team) => team.id === teamBId) ?? null,
    [teamBId, teams]
  );

  const probA = useMemo(() => {
    if (!teams || !teamA || !teamB) return null;
    const idxA = getTeamIdxFn?.(teamA.id) ?? -1;
    const idxB = getTeamIdxFn?.(teamB.id) ?? -1;
    if (idxA < 0 || idxB < 0) return null;
    return getMatchupProbFn?.(idxA, idxB, loc) ?? null;
  }, [loc, teamA, teamB, teams]);

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
        <div className="mp-loading">Loading prediction data...</div>
      </div>
    );
  }

  return (
    <div className="mp-page">
      <h2 className="mp-title">Team Matchup Predictor</h2>
      <p className="mp-subtitle">
        Select two teams and game site to view model odds and win probability.
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
              type="button"
            >
              A Home
            </button>
            <button
              className={`mp-loc-btn ${loc === "N" ? "mp-loc-btn--active" : ""}`}
              onClick={() => setLoc("N")}
              type="button"
            >
              Neutral
            </button>
            <button
              className={`mp-loc-btn ${loc === "A" ? "mp-loc-btn--active" : ""}`}
              onClick={() => setLoc("A")}
              type="button"
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

      {probA !== null && teamA && teamB ? (
        <>
          <ProbSummary teamA={teamA} teamB={teamB} probA={probA} displayMode={displayMode} />
          <StatTable nameA={teamA.name} nameB={teamB.name} />
        </>
      ) : (
        <div className="mp-placeholder">
          {teamAId && teamBId ? "Computing..." : "Select two teams above to see the prediction."}
        </div>
      )}
    </div>
  );
}
