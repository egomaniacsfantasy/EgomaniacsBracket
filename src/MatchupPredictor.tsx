import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { TEAM_STAT_IMPORTANCE, TEAM_STAT_ORDER, TEAM_STATS_2026, type TeamStatKey } from "./data/teamStats2026";
import { teams as bracketTeams } from "./data/teams";
import { teamLogoUrl } from "./lib/logo";
import { getMappedEspnLogoPath } from "./lib/logoMap";
import { formatOddsDisplay } from "./lib/odds";
import type { OddsDisplayMode } from "./types";

let getMatchupProbFn: ((a: number, b: number, loc: "N" | "H" | "A") => number | null) | null = null;
let getTeamIdxFn: ((id: number) => number) | null = null;
let predictorTeamsCache: ReadonlyArray<{ id: number; name: string; conf: string }> | null = null;
let loadingPromise: Promise<void> | null = null;

type TeamOption = { id: number; name: string; conf: string };
type VenueCode = "N" | "H" | "A";

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

const TEAM_STAT_DOT_COUNTS: Record<TeamStatKey, number> = (() => {
  const ranked = [...TEAM_STAT_ORDER].sort(
    (a, b) => Number.parseFloat(TEAM_STAT_IMPORTANCE[b]) - Number.parseFloat(TEAM_STAT_IMPORTANCE[a])
  );
  return Object.fromEntries(
    ranked.map((key, index) => [key, 5 - Math.round((index / Math.max(1, ranked.length - 1)) * 4)])
  ) as Record<TeamStatKey, number>;
})();

const conferenceLabel = (conf: string): string => conf.replace(/_/g, " ").toUpperCase();

const predictorTeamLogo = (teamName: string): string | null => {
  const bracketTeam = bracketTeamByName.get(teamName);
  if (bracketTeam) return teamLogoUrl(bracketTeam);
  return getMappedEspnLogoPath(teamName);
};

const formatStatValue = (value: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toFixed(1);
  if (Number.isInteger(value)) return `${value}`;
  if (Math.abs(value) < 1) return value.toFixed(4);
  return value.toFixed(2);
};

function PredictorTeamMark({
  teamName,
  fallbackLabel,
  size,
}: {
  teamName: string | null;
  fallbackLabel: string;
  size: "hero" | "selector" | "mini";
}) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [teamName]);

  const src = teamName ? predictorTeamLogo(teamName) : null;
  const showImage = Boolean(src && !imageFailed && !src.includes("placehold.co"));

  if (showImage) {
    return (
      <img
        className={`pred-team-mark pred-team-mark--${size}`}
        src={src ?? ""}
        alt=""
        aria-hidden="true"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span className={`pred-team-mark pred-team-mark--${size} pred-team-mark--placeholder`} aria-hidden="true">
      {fallbackLabel}
    </span>
  );
}

function TeamSelector({
  slot,
  teams,
  selectedId,
  excludeId,
  onSelect,
}: {
  slot: "A" | "B";
  teams: ReadonlyArray<TeamOption>;
  selectedId: number | null;
  excludeId: number | null;
  onSelect: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(selectedId === null);
  const [open, setOpen] = useState(selectedId === null);
  const deferredQuery = useDeferredValue(query);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => teams.find((team) => team.id === selectedId) ?? null,
    [selectedId, teams]
  );

  useEffect(() => {
    if (selectedId === null) {
      setEditing(true);
    }
  }, [selectedId]);

  const filtered = useMemo(() => {
    const trimmed = deferredQuery.trim().toLowerCase();
    const allowed = teams.filter((team) => team.id !== excludeId);
    if (!trimmed) return allowed.slice(0, 50);
    return allowed
      .filter(
        (team) =>
          team.name.toLowerCase().includes(trimmed) ||
          conferenceLabel(team.conf).toLowerCase().includes(trimmed)
      )
      .slice(0, 50);
  }, [deferredQuery, excludeId, teams]);

  const revealSearch = () => {
    setEditing(true);
    setOpen(true);
    setQuery("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (containerRef.current?.contains(event.relatedTarget as Node | null)) return;
    setOpen(false);
    setQuery("");
    if (selectedId !== null) {
      setEditing(false);
    }
  };

  return (
    <div
      className={`pred-selector-card ${editing ? "pred-selector-card--editing" : ""}`}
      ref={containerRef}
      onBlur={handleBlur}
    >
      <div className="pred-selector-head">
        <span className="pred-selector-kicker">Team {slot}</span>
        {selected && !editing ? (
          <button className="pred-selector-change" type="button" onClick={revealSearch}>
            Change
          </button>
        ) : null}
      </div>

      {selected && !editing ? (
        <div className="pred-selector-body pred-selector-body--selected">
          <PredictorTeamMark teamName={selected.name} fallbackLabel={slot} size="hero" />
          <div className="pred-selector-selected-copy">
            <h3>{selected.name}</h3>
            <p>{conferenceLabel(selected.conf)}</p>
          </div>
        </div>
      ) : (
        <div className="pred-selector-body">
          {selected ? (
            <PredictorTeamMark teamName={selected.name} fallbackLabel={slot} size="selector" />
          ) : (
            <div className="pred-selector-placeholder-mark" aria-hidden="true">
              {slot}
            </div>
          )}
          <div className="pred-selector-search-wrap">
            <input
              ref={inputRef}
              className="pred-search-input"
              type="text"
              value={query}
              placeholder="Search teams..."
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
            />
            {open ? (
              <div className="pred-search-dropdown">
                <div className="pred-search-results">
                  {filtered.length === 0 ? (
                    <div className="pred-search-empty">No teams found.</div>
                  ) : (
                    filtered.map((team) => (
                      <button
                        key={team.id}
                        className={`pred-search-option ${team.id === selectedId ? "is-selected" : ""}`}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          onSelect(team.id);
                          setEditing(false);
                          setOpen(false);
                          setQuery("");
                        }}
                      >
                        <PredictorTeamMark teamName={team.name} fallbackLabel={team.name[0] ?? slot} size="mini" />
                        <span className="pred-search-option-name">{team.name}</span>
                        <span className="pred-search-option-conf">{conferenceLabel(team.conf)}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function VenueToggle({ loc, onChange }: { loc: VenueCode; onChange: (next: VenueCode) => void }) {
  const venues: Array<{ code: VenueCode; label: string }> = [
    { code: "N", label: "Neutral" },
    { code: "H", label: "A Home" },
    { code: "A", label: "B Home" },
  ];

  return (
    <div className="pred-venue-wrap">
      <div className="pred-venue-toggle" role="tablist" aria-label="Venue">
        {venues.map((venue) => (
          <button
            key={venue.code}
            className={`pred-venue-btn ${loc === venue.code ? "is-active" : ""}`}
            type="button"
            onClick={() => onChange(venue.code)}
          >
            {venue.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PredictorResults({ teamA, teamB, probA }: { teamA: TeamOption; teamB: TeamOption; probA: number }) {
  const probB = 1 - probA;
  const pctA = (probA * 100).toFixed(1);
  const pctB = (probB * 100).toFixed(1);
  const oddsA = formatOddsDisplay(probA, "american").primary;
  const oddsB = formatOddsDisplay(probB, "american").primary;
  const favoriteIsA = probA >= probB;

  return (
    <section className="pred-results" aria-live="polite">
      <div className="pred-result-card">
        <div className="pred-prob-row">
          <div className="pred-prob-side pred-prob-side--left">
            <PredictorTeamMark teamName={teamA.name} fallbackLabel="A" size="mini" />
            <span className="pred-prob-pct">{pctA}%</span>
          </div>
          <div className="pred-prob-bar" aria-hidden="true">
            <div className="pred-prob-fill" style={{ width: `${probA * 100}%` }} />
          </div>
          <div className="pred-prob-side pred-prob-side--right">
            <span className="pred-prob-pct">{pctB}%</span>
            <PredictorTeamMark teamName={teamB.name} fallbackLabel="B" size="mini" />
          </div>
        </div>

        <div className="pred-odds-grid">
          <article className={`pred-odds-card ${favoriteIsA ? "is-favorite" : ""}`}>
            <p className="pred-odds-label">{teamA.name}</p>
            <div className="pred-odds-value">{oddsA}</div>
            <p className="pred-odds-meta">{pctA}% win probability</p>
          </article>

          <article className={`pred-odds-card ${!favoriteIsA ? "is-favorite" : ""}`}>
            <p className="pred-odds-label">{teamB.name}</p>
            <div className="pred-odds-value">{oddsB}</div>
            <p className="pred-odds-meta">{pctB}% win probability</p>
          </article>
        </div>
      </div>

      <div className="pred-stats-card">
        <div className="pred-section-head">
          <p className="pred-section-kicker">Why the model leans this way</p>
          <h2 className="pred-section-title">13-stat comparison</h2>
        </div>
        <StatComparison nameA={teamA.name} nameB={teamB.name} />
      </div>
    </section>
  );
}

function StatComparison({ nameA, nameB }: { nameA: string; nameB: string }) {
  const statsA = TEAM_STATS_2026[nameA] ?? null;
  const statsB = TEAM_STATS_2026[nameB] ?? null;

  if (!statsA && !statsB) return null;

  return (
    <div className="pred-stats-table" role="table" aria-label={`${nameA} versus ${nameB} stat comparison`}>
      <div className="pred-stats-head" role="row">
        <div className="pred-stats-team pred-stats-team--left" role="columnheader">
          {nameA}
        </div>
        <div className="pred-stats-label" role="columnheader">
          Stat
        </div>
        <div className="pred-stats-team pred-stats-team--right" role="columnheader">
          {nameB}
        </div>
      </div>

      {TEAM_STAT_ORDER.map((key) => {
        const valueA = statsA?.[key] ?? null;
        const valueB = statsB?.[key] ?? null;
        const lowerIsBetter = LOWER_IS_BETTER.has(key);
        const dotCount = TEAM_STAT_DOT_COUNTS[key];

        const betterA =
          valueA !== null &&
          valueB !== null &&
          valueA !== valueB &&
          (lowerIsBetter ? valueA < valueB : valueA > valueB);
        const betterB =
          valueA !== null &&
          valueB !== null &&
          valueA !== valueB &&
          (lowerIsBetter ? valueB < valueA : valueB > valueA);

        return (
          <div className="pred-stat-row" key={key} role="row">
            <div className={`pred-stat-value pred-stat-value--left ${betterA ? "is-better" : ""}`} role="cell">
              {formatStatValue(valueA)}
            </div>
            <div className="pred-stat-center" role="cell" title={`${TEAM_STAT_IMPORTANCE[key]} model weight`}>
              <div className="pred-stat-name">{TEAM_STAT_LABELS[key]}</div>
              <div className="pred-stat-dots" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => (
                  <span className={`pred-stat-dot ${index < dotCount ? "is-active" : ""}`} key={index} />
                ))}
              </div>
            </div>
            <div className={`pred-stat-value pred-stat-value--right ${betterB ? "is-better" : ""}`} role="cell">
              {formatStatValue(valueB)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MatchupPredictor({ displayMode: _displayMode }: { displayMode: OddsDisplayMode }) {
  const [teams, setTeams] = useState<ReadonlyArray<TeamOption> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamAId, setTeamAId] = useState<number | null>(null);
  const [teamBId, setTeamBId] = useState<number | null>(null);
  const [loc, setLoc] = useState<VenueCode>("N");

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

  const teamA = useMemo(() => teams?.find((team) => team.id === teamAId) ?? null, [teamAId, teams]);
  const teamB = useMemo(() => teams?.find((team) => team.id === teamBId) ?? null, [teamBId, teams]);

  const probA = useMemo(() => {
    if (!teams || !teamA || !teamB) return null;
    const idxA = getTeamIdxFn?.(teamA.id) ?? -1;
    const idxB = getTeamIdxFn?.(teamB.id) ?? -1;
    if (idxA < 0 || idxB < 0) return null;
    return getMatchupProbFn?.(idxA, idxB, loc) ?? null;
  }, [loc, teamA, teamB, teams]);

  return (
    <section className="pred-page predictor-page">
      <header className="pred-header">
        <p className="pred-kicker">College Basketball</p>
        <h1 className="pred-title">Matchup Predictor</h1>
        <p className="pred-subtitle">Pick any two D1 teams. See who the model likes and why.</p>
      </header>

      {loadError ? (
        <div className="pred-status pred-status--error">{loadError}</div>
      ) : !teams ? (
        <div className="pred-status">Loading prediction data...</div>
      ) : (
        <>
          <div className="pred-arena">
            <TeamSelector slot="A" teams={teams} selectedId={teamAId} excludeId={teamBId} onSelect={setTeamAId} />
            <div className="pred-vs" aria-hidden="true">
              VS
            </div>
            <TeamSelector slot="B" teams={teams} selectedId={teamBId} excludeId={teamAId} onSelect={setTeamBId} />
          </div>

          <VenueToggle loc={loc} onChange={setLoc} />

          {probA !== null && teamA && teamB ? (
            <PredictorResults teamA={teamA} teamB={teamB} probA={probA} />
          ) : (
            <div className="pred-empty-state">
              <div className="pred-empty-icon" aria-hidden="true">
                ⚡
              </div>
              <p className="pred-empty-copy">
                {teamAId && teamBId ? "Computing the line..." : "Pick two teams above and let the model call it."}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
