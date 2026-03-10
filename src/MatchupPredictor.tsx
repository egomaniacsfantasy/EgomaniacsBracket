import { useEffect, useMemo, useRef, useState } from "react";
import { TEAM_STAT_IMPORTANCE, TEAM_STAT_ORDER, TEAM_STATS_2026, type TeamStatKey } from "./data/teamStats2026";
import { teams as bracketTeams } from "./data/teams";
import { fallbackLogo, teamLogoUrl } from "./lib/logo";
import { getMappedEspnLogoPath } from "./lib/logoMap";
import { formatAmerican, toAmericanOdds, toImpliedLabel } from "./lib/odds";
import type { OddsDisplayMode } from "./types";

let getMatchupProbFn: ((a: number, b: number, loc: "N" | "H" | "A") => number | null) | null = null;
let getTeamIdxFn: ((id: number) => number) | null = null;
let predictorTeamsCache: ReadonlyArray<{ id: number; name: string; conf: string }> | null = null;
let loadingPromise: Promise<void> | null = null;

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
  elo_last: "Odds Gods Elo",
  avg_net_rtg: "Net Rating",
  avg_off_rtg: "Offensive Rating",
  elo_trend: "Odds Gods Elo Trend",
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

type TeamOption = { id: number; name: string; conf: string };

const bracketTeamByName = new Map(bracketTeams.map((team) => [team.name, team]));

const formatStatValue = (value: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toFixed(1);
  if (Number.isInteger(value)) return `${value}`;
  if (Math.abs(value) < 1) return value.toFixed(4);
  return value.toFixed(2);
};

const conferenceLabel = (conf: string): string => conf.replace(/_/g, " ").toUpperCase();

const predictorTeamLogo = (name: string): string => {
  const bracketTeam = bracketTeamByName.get(name);
  if (bracketTeam) return teamLogoUrl(bracketTeam);
  return getMappedEspnLogoPath(name) ?? fallbackLogo(name);
};

const americanLabel = (prob: number): string => {
  const raw = toAmericanOdds(prob);
  return raw > 50000 ? "+50000+" : formatAmerican(raw);
};

const seedLabelForTeam = (name: string): string | null => bracketTeamByName.get(name)?.seedLabel ?? null;

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
  const containerRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    return teams
      .filter(
        (team) =>
          team.id !== excludeId &&
          (team.name.toLowerCase().includes(trimmed) || conferenceLabel(team.conf).toLowerCase().includes(trimmed))
      )
      .slice(0, 40);
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
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="mp-dropdown-list">
            {query.trim().length === 0 ? (
              <div className="mp-dropdown-empty">Start typing a team name...</div>
            ) : filtered.length === 0 ? (
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

function MatchupShowdownCard({
  teamA,
  teamB,
  probA,
  locationLabel,
}: {
  teamA: TeamOption;
  teamB: TeamOption;
  probA: number;
  locationLabel: string;
}) {
  const probB = 1 - probA;
  const aSeed = seedLabelForTeam(teamA.name);
  const bSeed = seedLabelForTeam(teamB.name);

  return (
    <div className="eg-showdown-card mp-showdown-card eg-showdown-card--entering">
      <div className="mp-showdown-head">
        <p className="eg-showdown-label">Matchup Predictor</p>
        <span className="mp-showdown-location">{locationLabel}</span>
      </div>
      <div className="eg-showdown-matchup">
        <div className="eg-showdown-team mp-showdown-team">
          {aSeed ? <span className="eg-showdown-seed">#{aSeed} seed</span> : <span className="mp-showdown-seed-spacer" />}
          <img className="mp-showdown-logo" src={predictorTeamLogo(teamA.name)} alt={`${teamA.name} logo`} />
          <span className="eg-showdown-name">{teamA.name}</span>
          <span className="eg-showdown-odds">{americanLabel(probA)}</span>
          <span className="mp-showdown-implied">{toImpliedLabel(probA)}</span>
        </div>
        <span className="eg-showdown-vs">VS</span>
        <div className="eg-showdown-team mp-showdown-team">
          {bSeed ? <span className="eg-showdown-seed">#{bSeed} seed</span> : <span className="mp-showdown-seed-spacer" />}
          <img className="mp-showdown-logo" src={predictorTeamLogo(teamB.name)} alt={`${teamB.name} logo`} />
          <span className="eg-showdown-name">{teamB.name}</span>
          <span className="eg-showdown-odds">{americanLabel(probB)}</span>
          <span className="mp-showdown-implied">{toImpliedLabel(probB)}</span>
        </div>
      </div>
      <div className="mp-showdown-bar-shell">
        <div className="mp-showdown-bar">
          <div className="mp-showdown-bar-fill" style={{ width: `${(probA * 100).toFixed(1)}%` }} />
        </div>
        <div className="mp-showdown-bar-labels">
          <span>{teamA.name}</span>
          <span>{toImpliedLabel(probA)}</span>
          <span>{toImpliedLabel(probB)}</span>
          <span>{teamB.name}</span>
        </div>
      </div>
    </div>
  );
}

function StatTable({ teamAName, teamBName }: { teamAName: string; teamBName: string }) {
  const statsA = TEAM_STATS_2026[teamAName] ?? null;
  const statsB = TEAM_STATS_2026[teamBName] ?? null;

  if (!statsA && !statsB) return null;

  return (
    <div className="mp-stat-card">
      <div className="mp-stat-card-head">
        <h3>Stat Comparison</h3>
        <p>Current-season signals that drive the model.</p>
      </div>
      <div className="mp-stat-table-wrap">
        <table className="matchup-stats-table mp-stat-table">
          <thead>
            <tr>
              <th>Stat</th>
              <th>{teamAName}</th>
              <th>{teamBName}</th>
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
                const teamAHasEdge = lowerIsBetter ? valueA < valueB : valueA > valueB;
                const delta = Math.abs(valueA - valueB);
                const deltaLabel =
                  delta >= 1000 ? delta.toFixed(1) : Number.isInteger(delta) ? `${delta}` : delta < 1 ? delta.toFixed(4) : delta.toFixed(2);
                edge = `${teamAHasEdge ? teamAName : teamBName} +${deltaLabel}`;
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
    </div>
  );
}

export function MatchupPredictor({ displayMode: _displayMode }: { displayMode?: OddsDisplayMode }) {
  const [teams, setTeams] = useState<ReadonlyArray<TeamOption> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamAId, setTeamAId] = useState<number | null>(null);
  const [teamBId, setTeamBId] = useState<number | null>(null);
  const [loc, setLoc] = useState<"N" | "H" | "A">("N");

  useEffect(() => {
    let cancelled = false;

    loadPredictorData()
      .then(() => {
        if (cancelled || !predictorTeamsCache) return;
        setTeams([...predictorTeamsCache].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("Prediction data is unavailable right now.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const teamA = teams?.find((team) => team.id === teamAId) ?? null;
  const teamB = teams?.find((team) => team.id === teamBId) ?? null;

  const probA = useMemo(() => {
    if (!teamA || !teamB || !getTeamIdxFn || !getMatchupProbFn) return null;
    const idxA = getTeamIdxFn(teamA.id);
    const idxB = getTeamIdxFn(teamB.id);
    if (idxA < 0 || idxB < 0) return null;
    return getMatchupProbFn(idxA, idxB, loc);
  }, [loc, teamA, teamB]);

  const locationLabel =
    loc === "N" ? "Neutral Court" : loc === "H" ? `Home: ${teamA?.name ?? "Team A"}` : `Home: ${teamB?.name ?? "Team B"}`;

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
      <div className="mp-controls">
        <TeamSelector label="Team A" teams={teams} selectedId={teamAId} excludeId={teamBId} onSelect={setTeamAId} />

        <div className="mp-location-wrap">
          <label className="mp-team-label">Game Site</label>
          <div className="mp-location-btns">
            <button className={`mp-loc-btn ${loc === "H" ? "mp-loc-btn--active" : ""}`} onClick={() => setLoc("H")} type="button">
              <span className="mp-loc-icon" aria-hidden="true">&#x1F3E0;</span>
              <span className="mp-loc-text">{teamA?.name ?? "Team A"}</span>
            </button>
            <button className={`mp-loc-btn ${loc === "N" ? "mp-loc-btn--active" : ""}`} onClick={() => setLoc("N")} type="button">
              <span className="mp-loc-icon" aria-hidden="true">&#x2696;</span>
              <span className="mp-loc-text">Neutral</span>
            </button>
            <button className={`mp-loc-btn ${loc === "A" ? "mp-loc-btn--active" : ""}`} onClick={() => setLoc("A")} type="button">
              <span className="mp-loc-icon" aria-hidden="true">&#x1F3E0;</span>
              <span className="mp-loc-text">{teamB?.name ?? "Team B"}</span>
            </button>
          </div>
        </div>

        <TeamSelector label="Team B" teams={teams} selectedId={teamBId} excludeId={teamAId} onSelect={setTeamBId} />
      </div>

      {probA !== null && teamA && teamB ? (
        <div className="mp-results-stack">
          <MatchupShowdownCard key={`${teamA.id}-${teamB.id}-${loc}`} teamA={teamA} teamB={teamB} probA={probA} locationLabel={locationLabel} />
          <StatTable teamAName={teamA.name} teamBName={teamB.name} />
        </div>
      ) : (
        <div className="mp-placeholder">
          {teamAId && teamBId ? (
            "Computing matchup..."
          ) : (
            <>
              <span className="mp-placeholder-icon">🏀</span>
              <span className="mp-placeholder-title">Head-to-head matchup simulator</span>
              <span className="mp-placeholder-body">Pick any two D1 teams to see win probabilities, stat comparisons, and key matchup factors — all powered by our model.</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
