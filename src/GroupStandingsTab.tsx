import { useEffect, useMemo, useRef, useState } from "react";
import { computeChaosScoreForPicks } from "./bracketStorage";
import { teamsById } from "./data/teams";
import type { LockedPicks } from "./lib/bracket";
import { resolveBracketWithKnownResults } from "./lib/bracketCompletion";
import { abbreviationForTeam } from "./lib/abbreviation";
import {
  formatForecastProbability,
  type ForecastOddsFormat,
} from "./lib/forecastDisplay";
import { teamLogoUrl } from "./lib/logo";
import { canSeeDetails } from "./groupVisibility";
import type { GroupStanding } from "./groupStorage";
import { StandingsForecastHistogram } from "./StandingsForecastHistogram";
import type { StandingsForecastResult } from "./lib/standingsForecast";

type RankedStanding = GroupStanding & { groupRank: number };
type GroupSortMode = "score" | "winPct";
type WinTone = "top" | "middle" | "bottom";

const CHAOS_TIERS = [
  { min: 80, label: "Chaos Agent", emoji: "🌪️" },
  { min: 60, label: "Upset Heavy", emoji: "🔥" },
  { min: 40, label: "Balanced", emoji: "⚖️" },
  { min: 20, label: "Mild Chalk", emoji: "📊" },
  { min: 0, label: "Chalk City", emoji: "🏛️" },
] as const;

const SORT_FADE_OUT_MS = 100;

function getChaosTier(score: number | null) {
  if (score === null || score === undefined) return CHAOS_TIERS[CHAOS_TIERS.length - 1];
  return CHAOS_TIERS.find((tier) => score >= tier.min) || CHAOS_TIERS[CHAOS_TIERS.length - 1];
}

function getChampionPick(picks: LockedPicks | null): string | null {
  if (!picks || typeof picks !== "object") return null;
  if (typeof picks["CHAMP-0"] === "string") return picks["CHAMP-0"];
  const { games } = resolveBracketWithKnownResults(picks);
  const champGame = games.find((game) => game.round === "CHAMP");
  return champGame?.winnerId ?? null;
}

function getTeamInfo(teamId: string) {
  const team = teamsById.get(teamId);
  if (!team) return null;
  return {
    name: team.name,
    shortName: abbreviationForTeam(team.name),
    seed: team.seed,
    logoUrl: teamLogoUrl(team),
  };
}

function formatExpectedPoints(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

function formatExpectedRank(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `#${value.toFixed(1)}`;
}

function formatChaosScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}`;
}

function compareByScore(left: RankedStanding, right: RankedStanding) {
  if ((right.total_score || 0) !== (left.total_score || 0)) return (right.total_score || 0) - (left.total_score || 0);
  if ((right.correct_picks || 0) !== (left.correct_picks || 0)) return (right.correct_picks || 0) - (left.correct_picks || 0);
  return (left.groupRank || Number.MAX_SAFE_INTEGER) - (right.groupRank || Number.MAX_SAFE_INTEGER);
}

function getWinTone(index: number, count: number): WinTone {
  if (count <= 1) return "top";
  const topCutoff = Math.max(1, Math.ceil(count * 0.25));
  const bottomStart = Math.max(topCutoff + 1, Math.ceil(count * 0.75));
  if (index < topCutoff) return "top";
  if (index >= bottomStart) return "bottom";
  return "middle";
}

export function GroupStandingsTab({
  groupId,
  standings,
  groupMemberCount,
  currentUserId,
  submissionsLocked = false,
  canPreviewHidden = false,
  onViewBracket,
  onRefresh,
  onSelectBracket,
  onInvite,
  forecast,
  forecastLoading = false,
  forecastProgress = 0,
  forecastError = "",
}: {
  groupId: string;
  standings: RankedStanding[];
  groupMemberCount: number;
  soleLeader: string | null;
  currentUserId: string | undefined;
  tournamentStarted: boolean;
  submissionsLocked?: boolean;
  canPreviewHidden?: boolean;
  onViewBracket: (info: { bracketId: string; displayName: string; bracketName: string }) => void;
  onRefresh: () => void;
  onSelectBracket?: () => void;
  onInvite: () => void;
  forecast?: StandingsForecastResult | null;
  forecastLoading?: boolean;
  forecastProgress?: number;
  forecastError?: string;
}) {
  const [sortMode, setSortMode] = useState<GroupSortMode>("winPct");
  const [oddsFormat, setOddsFormat] = useState<ForecastOddsFormat>("percent");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [listFading, setListFading] = useState(false);
  const sortTimersRef = useRef<number[]>([]);
  const canSortByWin = submissionsLocked && standings.some((entry) => entry.bracket_id && entry.picks);

  useEffect(() => {
    return () => {
      sortTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      sortTimersRef.current = [];
    };
  }, []);

  const orderedStandings = useMemo(() => {
    const base = [...standings];
    if (sortMode === "score" || !canSortByWin) {
      return base.sort(compareByScore);
    }

    return base.sort((left, right) => {
      const leftProb = forecast?.rows[left.user_id]?.finish1Prob ?? -1;
      const rightProb = forecast?.rows[right.user_id]?.finish1Prob ?? -1;
      if (rightProb !== leftProb) return rightProb - leftProb;
      return compareByScore(left, right);
    });
  }, [canSortByWin, forecast, sortMode, standings]);

  const leaderboardWinOrder = useMemo(
    () =>
      [...orderedStandings].sort((left, right) => {
        const leftProb = forecast?.rows[left.user_id]?.finish1Prob ?? -1;
        const rightProb = forecast?.rows[right.user_id]?.finish1Prob ?? -1;
        if (rightProb !== leftProb) return rightProb - leftProb;
        return compareByScore(left, right);
      }),
    [forecast, orderedStandings],
  );

  const winToneByUserId = useMemo(() => {
    const map = new Map<string, WinTone>();
    leaderboardWinOrder.forEach((entry, index) => {
      map.set(entry.user_id, getWinTone(index, leaderboardWinOrder.length));
    });
    return map;
  }, [leaderboardWinOrder]);

  const activeExpandedUserId = useMemo(
    () => (expandedUserId && standings.some((entry) => entry.user_id === expandedUserId) ? expandedUserId : null),
    [expandedUserId, standings],
  );

  const handleSortModeChange = (nextMode: GroupSortMode) => {
    if (nextMode === sortMode) return;
    sortTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    sortTimersRef.current = [];
    setListFading(true);

    const swapTimer = window.setTimeout(() => {
      setSortMode(nextMode);
      const revealTimer = window.setTimeout(() => setListFading(false), 16);
      sortTimersRef.current = [revealTimer];
    }, SORT_FADE_OUT_MS);

    sortTimersRef.current = [swapTimer];
  };

  const standingsCount = orderedStandings.length;
  const showForecast = canSortByWin;

  return (
    <div className="gd-standings">
      {showForecast ? (
        <div className="gd-forecast-banner">
          <div className="gd-forecast-banner-main">
            <div className="gd-forecast-banner-copy">
              <span className="gd-forecast-banner-label">Win Odds</span>
              {forecastLoading ? (
                <span className="gd-forecast-banner-value">
                  Simulating 10,000 seeded futures... {Math.round(Math.max(0, Math.min(1, forecastProgress)) * 100)}%
                </span>
              ) : forecast ? (
                <span className="gd-forecast-banner-value">
                  Updated from {forecast.simCount.toLocaleString()} seeded simulations
                </span>
              ) : forecastError ? (
                <span className="gd-forecast-banner-value gd-forecast-banner-value--error">{forecastError}</span>
              ) : null}
            </div>
            <div className="gd-forecast-controls">
              <div className="gd-segmented-toggle" role="group" aria-label="Group standings sort">
                <button
                  type="button"
                  className={`gd-segmented-toggle-btn ${sortMode === "winPct" ? "gd-segmented-toggle-btn--active" : ""}`}
                  onClick={() => handleSortModeChange("winPct")}
                >
                  By Odds
                </button>
                <button
                  type="button"
                  className={`gd-segmented-toggle-btn ${sortMode === "score" ? "gd-segmented-toggle-btn--active" : ""}`}
                  onClick={() => handleSortModeChange("score")}
                >
                  By Score
                </button>
              </div>
              <button
                type="button"
                className="gd-format-toggle"
                onClick={() => setOddsFormat((current) => (current === "percent" ? "american" : "percent"))}
                aria-label={oddsFormat === "percent" ? "Show American win odds" : "Show implied win percentage"}
              >
                {oddsFormat === "percent" ? "US" : "%"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {groupMemberCount <= 3 && (
        <div className="gd-invite-prompt">
          <div className="gd-invite-prompt-left">
            <span className="gd-invite-prompt-emoji">👥</span>
            <div>
              <p className="gd-invite-prompt-title">
                {groupMemberCount === 1 ? "1 member in this group." : `${groupMemberCount} members in this group.`}
              </p>
              <p className="gd-invite-prompt-sub">
                {standingsCount === 0
                  ? "No brackets are showing in the standings yet."
                  : standingsCount === 1
                    ? "1 bracket is showing in the standings so far."
                    : `${standingsCount} brackets are showing in the standings so far.`}
              </p>
            </div>
          </div>
          <button className="gd-invite-prompt-btn" onClick={onInvite}>
            Share Invite
          </button>
        </div>
      )}

      {orderedStandings.length === 0 ? (
        <div className="gd-empty-state">
          <span className="gd-empty-state-icon">📋</span>
          <h3>No brackets in the standings yet</h3>
          <p>Members can still be in the group before their brackets show up here. Once they attach a bracket, they&apos;ll land in the standings automatically.</p>
        </div>
      ) : null}

      <div className={`gd-standings-list ${listFading ? "gd-standings-list--fading" : ""}`}>
        {orderedStandings.map((entry, index) => {
          const isCurrentUser = entry.user_id === currentUserId;
          const hasBracket = entry.bracket_id != null;
          const canSee = canSeeDetails(entry, currentUserId, canPreviewHidden);
          const championId = hasBracket && canSee ? getChampionPick(entry.picks) : null;
          const championInfo = championId ? getTeamInfo(championId) : null;
          const championLogoUrl = championInfo?.logoUrl ?? entry.champion_logo_url ?? null;
          const championName = championInfo?.shortName ?? championInfo?.name ?? entry.champion_name ?? championId ?? "Champion pending";
          const championSeed = championInfo?.seed ?? entry.champion_seed ?? null;
          const chaosScore =
            hasBracket && canSee && entry.picks && Object.keys(entry.picks).length > 0
              ? computeChaosScoreForPicks(entry.picks as LockedPicks)
              : null;
          const chaosTier = getChaosTier(chaosScore);
          const canOpenBracket = Boolean(hasBracket && canSee);
          const forecastEntry = forecast?.rows[entry.user_id] ?? null;
          const isExpanded = activeExpandedUserId === entry.user_id;
          const winTone = winToneByUserId.get(entry.user_id) ?? "middle";
          const scoreValue = entry.total_score ?? 0;
          const correctLabel = `${entry.correct_picks ?? 0}/${entry.possible_picks ?? 0}`;
          const winDisplay =
            forecastLoading && !forecastEntry ? "..." : formatForecastProbability(forecastEntry?.finish1Prob ?? null, oddsFormat);

          return (
            <div
              key={`${groupId}:${entry.user_id}`}
              className={`gd-standing-card ${isCurrentUser ? "gd-standing-card--you" : ""} ${index === 0 ? "gd-standing-card--leader" : ""} ${winTone === "bottom" ? "gd-standing-card--long-shot" : ""} ${isExpanded ? "gd-standing-card--expanded" : ""}`}
            >
              <div
                className="gd-standing-card-row"
                onClick={() => setExpandedUserId((current) => (current === entry.user_id ? null : entry.user_id))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setExpandedUserId((current) => (current === entry.user_id ? null : entry.user_id));
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="gd-standing-rank">{index + 1}</div>

                <div className="gd-standing-player">
                  <div className="gd-standing-player-row">
                    <span className="gd-standing-player-name">{entry.display_name}</span>
                    {isCurrentUser ? <span className="gd-standing-you">YOU</span> : null}
                  </div>
                  <span className="gd-standing-bracket-name">
                    {hasBracket ? entry.bracket_name || "Bracket submitted" : "No bracket yet"}
                  </span>
                  <span className="gd-standing-chaos">
                    {hasBracket && canSee && chaosScore !== null ? `${chaosTier.emoji} ${chaosTier.label}` : "No bracket yet"}
                  </span>
                </div>

                <div className="gd-standing-champion">
                  {hasBracket && canSee ? (
                    <>
                      {championLogoUrl ? <img src={championLogoUrl} className="gd-standing-champion-logo" alt="" /> : null}
                      <div className="gd-standing-champion-copy">
                        <span className="gd-standing-champion-name">{championName}</span>
                        <span className="gd-standing-champion-seed">{championSeed ? `#${championSeed}` : "Champion pick"}</span>
                      </div>
                    </>
                  ) : hasBracket ? (
                    <span className="gd-standing-hidden">🔒 Hidden until tipoff</span>
                  ) : (
                    <span className="gd-standing-hidden">No bracket yet</span>
                  )}
                </div>

                <div className="gd-standing-score">
                  <span className="gd-standing-score-value">{scoreValue}</span>
                  <span className="gd-standing-score-meta">{correctLabel}</span>
                </div>

                <div className={`gd-standing-win gd-standing-win--${winTone}`}>
                  <span className="gd-standing-win-label">Win</span>
                  <span className="gd-standing-win-value">{winDisplay}</span>
                </div>

                <div className={`gd-standing-chevron ${isExpanded ? "gd-standing-chevron--open" : ""}`}>⌄</div>
              </div>

              <div className={`gd-standing-panel ${isExpanded ? "gd-standing-panel--open" : ""}`}>
                <div className="gd-standing-panel-inner">
                  <div className="gd-standing-panel-stats">
                    <div className="gd-standing-panel-stat">
                      <span className="gd-standing-panel-label">Exp Pts</span>
                      <span className="gd-standing-panel-value">{formatExpectedPoints(forecastEntry?.expectedPoints)}</span>
                    </div>
                    <div className="gd-standing-panel-stat">
                      <span className="gd-standing-panel-label">Exp Rank</span>
                      <span className="gd-standing-panel-value">{formatExpectedRank(forecastEntry?.expectedRank)}</span>
                    </div>
                    <div className="gd-standing-panel-stat">
                      <span className="gd-standing-panel-label">Max Remaining</span>
                      <span className="gd-standing-panel-value">{entry.max_remaining ?? "—"}</span>
                    </div>
                    <div className="gd-standing-panel-stat">
                      <span className="gd-standing-panel-label">Chaos</span>
                      <span className="gd-standing-panel-value">{formatChaosScore(chaosScore)}</span>
                      <span className="gd-standing-panel-meta">
                        {chaosScore !== null ? `${chaosTier.emoji} ${chaosTier.label}` : "No bracket"}
                      </span>
                    </div>
                  </div>

                  {canOpenBracket || (!hasBracket && isCurrentUser && onSelectBracket) ? (
                    <div className="gd-standing-panel-actions">
                      {canOpenBracket ? (
                        <button
                          type="button"
                          className="gd-standing-open"
                          onClick={(event) => {
                            event.stopPropagation();
                            onViewBracket({
                              bracketId: entry.bracket_id!,
                              displayName: entry.display_name,
                              bracketName: entry.bracket_name,
                            });
                          }}
                        >
                          View Bracket →
                        </button>
                      ) : null}
                      {!hasBracket && isCurrentUser && onSelectBracket ? (
                        <button
                          type="button"
                          className="gd-standing-open"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectBracket();
                          }}
                        >
                          Select Bracket →
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {forecastEntry ? (
                    <div className="gd-standing-panel-hist">
                      <span className="gd-standing-panel-hist-label">Rank Distribution</span>
                      <StandingsForecastHistogram
                        bins={forecast?.bins ?? []}
                        values={forecastEntry.rankHistogram}
                        format={oddsFormat}
                        simCount={forecast?.simCount ?? 10_000}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="gd-footer">
        <p className="gd-footer-scoring">Scoring: 10 / 20 / 40 / 80 / 160 / 320 per round · Max 1920</p>
        <button className="gd-footer-refresh" onClick={onRefresh}>
          ↻ Refresh
        </button>
      </div>
    </div>
  );
}
