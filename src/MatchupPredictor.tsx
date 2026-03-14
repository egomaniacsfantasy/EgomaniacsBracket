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
type PredictorBackgroundToken = {
  text: string;
  left: string;
  top: string;
  size: number;
  duration: number;
  delay: number;
};

const bracketTeamByName = new Map(bracketTeams.map((team) => [team.name, team]));

const PREDICTOR_BACKGROUND_TOKENS: ReadonlyArray<PredictorBackgroundToken> = [
  { text: "KP #4", left: "6%", top: "8%", size: 12, duration: 34, delay: -8 },
  { text: "AdjEM 28.4", left: "18%", top: "18%", size: 13, duration: 42, delay: -16 },
  { text: "NET #12", left: "31%", top: "10%", size: 12, duration: 29, delay: -4 },
  { text: "ELO 1842", left: "43%", top: "22%", size: 14, duration: 38, delay: -19 },
  { text: "+380", left: "57%", top: "12%", size: 12, duration: 31, delay: -6 },
  { text: "72.4%", left: "68%", top: "18%", size: 15, duration: 44, delay: -12 },
  { text: "BARTHAG .942", left: "79%", top: "9%", size: 11, duration: 36, delay: -22 },
  { text: "SOS +9.8", left: "88%", top: "20%", size: 12, duration: 39, delay: -14 },
  { text: "AdjD 91.3", left: "10%", top: "32%", size: 13, duration: 45, delay: -27 },
  { text: ".387 eFGA", left: "23%", top: "40%", size: 11, duration: 33, delay: -10 },
  { text: "3P 38.1%", left: "36%", top: "34%", size: 12, duration: 41, delay: -24 },
  { text: "TOV 14.7", left: "49%", top: "43%", size: 12, duration: 30, delay: -7 },
  { text: "ORB 31.2", left: "62%", top: "37%", size: 12, duration: 35, delay: -18 },
  { text: "-262", left: "75%", top: "45%", size: 15, duration: 43, delay: -30 },
  { text: "Q1 9-3", left: "86%", top: "34%", size: 11, duration: 32, delay: -5 },
  { text: "NET #28", left: "8%", top: "58%", size: 12, duration: 40, delay: -25 },
  { text: "AdjO 121.5", left: "18%", top: "68%", size: 13, duration: 27, delay: -9 },
  { text: "6.8 pace", left: "30%", top: "60%", size: 11, duration: 46, delay: -31 },
  { text: "ATS 18-11", left: "42%", top: "74%", size: 12, duration: 37, delay: -13 },
  { text: "Luck .046", left: "54%", top: "65%", size: 11, duration: 28, delay: -3 },
  { text: "ELO SOS 17", left: "66%", top: "77%", size: 12, duration: 34, delay: -20 },
  { text: "1.07 PPP", left: "78%", top: "63%", size: 13, duration: 41, delay: -15 },
  { text: "Bench 28%", left: "88%", top: "71%", size: 11, duration: 29, delay: -2 },
  { text: "Seed 5", left: "12%", top: "84%", size: 12, duration: 45, delay: -28 },
  { text: "NCSOS #21", left: "27%", top: "88%", size: 11, duration: 36, delay: -17 },
  { text: "FT Rate .302", left: "46%", top: "90%", size: 12, duration: 42, delay: -21 },
  { text: "Def Reb 74.1", left: "64%", top: "88%", size: 13, duration: 33, delay: -11 },
  { text: "WAB +6.4", left: "82%", top: "86%", size: 12, duration: 39, delay: -26 },
];

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

function PredictorBackground() {
  return (
    <div className="pred-bg-layer" aria-hidden="true">
      {PREDICTOR_BACKGROUND_TOKENS.map((token) => (
        <span
          className="pred-bg-number"
          key={`${token.text}-${token.left}-${token.top}`}
          style={{
            left: token.left,
            top: token.top,
            fontSize: `${token.size}px`,
            animationDuration: `${token.duration}s`,
            animationDelay: `${token.delay}s`,
          }}
        >
          {token.text}
        </span>
      ))}
    </div>
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
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const deferredQuery = useDeferredValue(query);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimeoutRef = useRef<number | null>(null);

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

  useEffect(() => {
    if (!open) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex((current) => {
      if (filtered.length === 0) return -1;
      if (current >= 0 && current < filtered.length) return current;
      return 0;
    });
  }, [filtered, open]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const revealSearch = () => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setEditing(true);
    setOpen(true);
    setHighlightedIndex(filtered.length > 0 ? 0 : -1);
    setQuery("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const closeSearch = (keepEditing = selectedId === null) => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setOpen(false);
    setHighlightedIndex(-1);
    setQuery("");
    setEditing(keepEditing);
  };

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (containerRef.current?.contains(event.relatedTarget as Node | null)) return;
    blurTimeoutRef.current = window.setTimeout(() => {
      closeSearch(selectedId === null);
    }, 120);
  };

  const handleFocus = () => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setOpen(true);
  };

  const handleSelect = (id: number) => {
    onSelect(id);
    closeSearch(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch(selectedId === null);
      inputRef.current?.blur();
      return;
    }

    if (filtered.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) => (current < 0 ? 0 : Math.min(current + 1, filtered.length - 1)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) => (current <= 0 ? 0 : current - 1));
      return;
    }

    if (event.key === "Enter" && open && highlightedIndex >= 0 && highlightedIndex < filtered.length) {
      event.preventDefault();
      handleSelect(filtered[highlightedIndex].id);
    }
  };

  return (
    <div
      className={`pred-selector-card pred-team-select ${selected ? "pred-team-select--filled" : ""} ${editing ? "pred-selector-card--editing" : ""}`}
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
            <div className="pred-selector-placeholder-mark pred-team-placeholder" aria-hidden="true">
              {slot}
            </div>
          )}
          <div className="pred-selector-search-wrap">
            <input
              ref={inputRef}
              className="pred-search-input pred-team-search"
              type="text"
              value={query}
              placeholder={slot === "A" ? "Who's your team?" : "Who are they facing?"}
              onFocus={handleFocus}
              onKeyDown={handleKeyDown}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
            />
            {open ? (
              <div className="pred-search-dropdown pred-team-dropdown">
                <div className="pred-search-results">
                  {filtered.length === 0 ? (
                    <div className="pred-search-empty">No teams found.</div>
                  ) : (
                    filtered.map((team, index) => (
                      <button
                        key={team.id}
                        className={`pred-search-option ${team.id === selectedId ? "is-selected" : ""} ${index === highlightedIndex ? "is-highlighted" : ""}`}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        onClick={() => handleSelect(team.id)}
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

const venueTeamLabel = (team: TeamOption | null, fallback: string): string => (team ? `@ ${team.name}` : fallback);

function VenueToggle({
  loc,
  teamA,
  teamB,
  onChange,
}: {
  loc: VenueCode;
  teamA: TeamOption | null;
  teamB: TeamOption | null;
  onChange: (next: VenueCode) => void;
}) {
  const venues: Array<{ code: VenueCode; label: string }> = [
    { code: "H", label: venueTeamLabel(teamA, "Home") },
    { code: "N", label: "Neutral" },
    { code: "A", label: venueTeamLabel(teamB, "Away") },
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
          <article className={`pred-odds-card ${favoriteIsA ? "is-favorite pred-odds-card--favorite" : ""}`}>
            <div className="pred-odds-card-header">
              <PredictorTeamMark teamName={teamA.name} fallbackLabel="A" size="mini" />
              <p className="pred-odds-label">{teamA.name}</p>
            </div>
            <div className="pred-odds-value">{oddsA}</div>
            <p className="pred-odds-meta">{pctA}% win probability</p>
          </article>

          <article className={`pred-odds-card ${!favoriteIsA ? "is-favorite pred-odds-card--favorite" : ""}`}>
            <div className="pred-odds-card-header">
              <PredictorTeamMark teamName={teamB.name} fallbackLabel="B" size="mini" />
              <p className="pred-odds-label">{teamB.name}</p>
            </div>
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

  let statWinsA = 0;
  let statWinsB = 0;

  const statRows = TEAM_STAT_ORDER.map((key) => {
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

    if (betterA) statWinsA += 1;
    if (betterB) statWinsB += 1;

    return { key, valueA, valueB, dotCount, betterA, betterB };
  });

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

      {statRows.map(({ key, valueA, valueB, dotCount, betterA, betterB }) => {
        return (
          <div
            className={`pred-stat-row ${betterA ? "pred-stat-row--a-better" : ""} ${betterB ? "pred-stat-row--b-better" : ""}`}
            key={key}
            role="row"
          >
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

      <div className="pred-stat-summary" role="presentation">
        <span className="pred-stat-summary-count">{statWinsA} stats</span>
        <span className="pred-stat-summary-label">Edge</span>
        <span className="pred-stat-summary-count">{statWinsB} stats</span>
      </div>
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
  const totalMatchups = useMemo(() => {
    if (!teams) return null;
    return (teams.length * (teams.length - 1)) / 2;
  }, [teams]);

  const probA = useMemo(() => {
    if (!teams || !teamA || !teamB) return null;
    const idxA = getTeamIdxFn?.(teamA.id) ?? -1;
    const idxB = getTeamIdxFn?.(teamB.id) ?? -1;
    if (idxA < 0 || idxB < 0) return null;
    return getMatchupProbFn?.(idxA, idxB, loc) ?? null;
  }, [loc, teamA, teamB, teams]);

  return (
    <section className="predictor-page">
      <PredictorBackground />
      <div className="pred-page pred-content">
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

            {teamA && teamB ? <VenueToggle loc={loc} teamA={teamA} teamB={teamB} onChange={setLoc} /> : null}

            {probA !== null && teamA && teamB ? (
              <PredictorResults teamA={teamA} teamB={teamB} probA={probA} />
            ) : (
              <div className="pred-empty-state">
                <div className="pred-empty-icon" aria-hidden="true">
                  ⚡
                </div>
                {teamAId && teamBId ? (
                  <p className="pred-empty-copy">Computing the line...</p>
                ) : (
                  <>
                    <p className="pred-empty-headline">61,000 matchups. Every one has a number.</p>
                    <p className="pred-empty-sub">Pick two teams and see where the model stands.</p>
                  </>
                )}
              </div>
            )}

            <footer className="pred-footer">
              <p className="pred-footer-text">
                {teams.length > 0 && totalMatchups !== null
                  ? `Probabilities from the Odds Gods model · ${teams.length} D1 teams · ${totalMatchups.toLocaleString()} matchups`
                  : "Probabilities from the Odds Gods model"}
              </p>
              <div className="pred-footer-links">
                <a href="/">Bracket Lab</a>
                <a href="/rankings">Rankings</a>
                <a href="mailto:feedback@oddsgods.net?subject=BracketLab%20Bug%20Report">Report a Bug</a>
              </div>
            </footer>
          </>
        )}
      </div>
    </section>
  );
}
