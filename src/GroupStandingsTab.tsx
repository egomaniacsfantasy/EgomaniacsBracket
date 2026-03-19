import { useMemo } from "react";
import { computeChaosScoreForPicks } from "./bracketStorage";
import { teamsById } from "./data/teams";
import { type LockedPicks } from "./lib/bracket";
import { resolveBracketWithKnownResults } from "./lib/bracketCompletion";
import { teamLogoUrl } from "./lib/logo";
import { canSeeDetails } from "./groupVisibility";
import type { GroupStanding } from "./groupStorage";
import { StandingsForecastHistogram } from "./StandingsForecastHistogram";
import type { StandingsForecastResult } from "./lib/standingsForecast";

type RankedStanding = GroupStanding & { groupRank: number };

const CHAOS_TIERS = [
  { min: 80, label: "Chaos Agent", emoji: "🌪️" },
  { min: 60, label: "Upset Heavy", emoji: "🔥" },
  { min: 40, label: "Balanced", emoji: "⚖️" },
  { min: 20, label: "Mild Chalk", emoji: "📊" },
  { min: 0, label: "Chalk City", emoji: "🏛️" },
] as const;

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
    seed: team.seed,
    logoUrl: teamLogoUrl(team),
  };
}

function formatForecastPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

function formatExpectedPoints(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

function formatExpectedRank(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `#${value.toFixed(1)}`;
}

export function GroupStandingsTab({
  groupId,
  standings,
  groupMemberCount,
  soleLeader,
  currentUserId,
  tournamentStarted,
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
  const orderedStandings = useMemo(
    () =>
      [...standings].sort((a, b) => {
        if ((b.total_score || 0) !== (a.total_score || 0)) return (b.total_score || 0) - (a.total_score || 0);
        if ((b.correct_picks || 0) !== (a.correct_picks || 0)) return (b.correct_picks || 0) - (a.correct_picks || 0);
        return (a.groupRank || Number.MAX_SAFE_INTEGER) - (b.groupRank || Number.MAX_SAFE_INTEGER);
      }),
    [standings]
  );

  const standingsCount = orderedStandings.length;
  const showForecast = submissionsLocked && orderedStandings.some((entry) => entry.bracket_id && entry.picks);

  return (
    <div className="gd-standings">
      {showForecast ? (
        <div className="gd-forecast-banner">
          {forecastLoading ? (
            <>
              <span className="gd-forecast-banner-label">Win Odds</span>
              <span className="gd-forecast-banner-value">
                Simulating 10,000 seeded futures... {Math.round(Math.max(0, Math.min(1, forecastProgress)) * 100)}%
              </span>
            </>
          ) : forecast ? (
            <>
              <span className="gd-forecast-banner-label">Win Odds</span>
              <span className="gd-forecast-banner-value">
                Updated from {forecast.simCount.toLocaleString()} seeded simulations
              </span>
            </>
          ) : forecastError ? (
            <>
              <span className="gd-forecast-banner-label">Win Odds</span>
              <span className="gd-forecast-banner-value gd-forecast-banner-value--error">{forecastError}</span>
            </>
          ) : null}
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
          <p>Members can still be in the group before their brackets show up here. Check the Members tab to see everyone in the room.</p>
        </div>
      ) : null}

      <div className="gd-standings-list">
        {orderedStandings.map((entry) => {
          const isCurrentUser = entry.user_id === currentUserId;
          const hasBracket = entry.bracket_id != null;
          const canSee = canSeeDetails(entry, currentUserId, canPreviewHidden);
          const isLeader = Boolean(tournamentStarted && hasBracket && soleLeader === entry.user_id);
          const championId = hasBracket && canSee ? getChampionPick(entry.picks) : null;
          const championInfo = championId ? getTeamInfo(championId) : null;
          const championLogoUrl = championInfo?.logoUrl ?? entry.champion_logo_url ?? null;
          const championName = championInfo?.name ?? entry.champion_name ?? championId ?? "Champion pending";
          const championSeed = championInfo?.seed ?? entry.champion_seed ?? null;
          const chaosScore =
            hasBracket && canSee && entry.picks && Object.keys(entry.picks).length > 0
              ? computeChaosScoreForPicks(entry.picks as LockedPicks)
              : null;
          const chaosTier = getChaosTier(chaosScore);
          const canOpenBracket = Boolean(hasBracket && canSee);
          const forecastEntry = forecast?.rows[entry.user_id] ?? null;

          return (
            <div
              key={`${groupId}:${entry.user_id}`}
              className={`gd-player-card ${isCurrentUser ? "gd-player-card--you" : ""} ${isLeader ? "gd-player-card--leader" : ""} ${canOpenBracket ? "gd-player-card--clickable" : ""}`}
              onClick={() => {
                if (!canOpenBracket) return;
                onViewBracket({
                  bracketId: entry.bracket_id!,
                  displayName: entry.display_name,
                  bracketName: entry.bracket_name,
                });
              }}
              onKeyDown={(event) => {
                if (!canOpenBracket) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onViewBracket({
                    bracketId: entry.bracket_id!,
                    displayName: entry.display_name,
                    bracketName: entry.bracket_name,
                  });
                }
              }}
              role={canOpenBracket ? "button" : undefined}
              tabIndex={canOpenBracket ? 0 : undefined}
            >
              <div className="gd-player-left">
                <div className="gd-player-rank">
                  {isLeader ? "👑" : hasBracket ? entry.groupRank : "—"}
                </div>

                <div className="gd-player-identity">
                  <div className="gd-player-name-row">
                    <span className="gd-player-name">{entry.display_name}</span>
                    {isCurrentUser && <span className="gd-player-you">YOU</span>}
                  </div>

                  <span className="gd-player-bracket-name">
                    {hasBracket ? entry.bracket_name || "Bracket submitted" : "No bracket yet"}
                  </span>

                  {hasBracket && canSee && chaosScore !== null && (
                    <span className="gd-player-chaos">
                      {chaosTier.emoji} {chaosTier.label}
                    </span>
                  )}
                </div>
              </div>

              <div className="gd-player-right">
                {!hasBracket ? (
                  isCurrentUser ? (
                    <button
                      className="gd-select-bracket-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectBracket?.();
                      }}
                    >
                      Select Bracket →
                    </button>
                  ) : (
                    <span className="gd-no-bracket">No bracket yet</span>
                  )
                ) : canSee ? (
                  <div className="gd-player-champion">
                    {championLogoUrl ? (
                      <img
                        src={championLogoUrl}
                        className="gd-champion-logo"
                        alt=""
                        onError={(event) => {
                          (event.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : null}

                    <div className="gd-champion-info">
                      <span className="gd-champion-name">{championName}</span>
                      <span className="gd-champion-seed">
                        {championSeed ? `#${championSeed} seed` : "Champion pick"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="gd-player-hidden">
                    <span className="gd-hidden-icon">🔒</span>
                    <span className="gd-hidden-text">Hidden until tipoff</span>
                  </div>
                )}
              </div>

              {hasBracket && canSee && tournamentStarted && (
                <div className="gd-player-stats">
                  <div className="gd-player-score-main">
                    <span className="gd-player-score-label">Score</span>
                    <span className="gd-player-score-value">{entry.total_score ?? 0}</span>
                  </div>
                  <div className="gd-player-score-meta">
                    <span>{entry.correct_picks ?? 0}/{entry.possible_picks ?? 63} correct</span>
                    <span>Max remaining: {entry.max_remaining ?? 0}</span>
                  </div>
                </div>
              )}

              {hasBracket && canSee && forecastEntry ? (
                <div className="gd-player-forecast">
                  <div className="gd-player-forecast-stats">
                    <div className="gd-player-forecast-stat">
                      <span className="gd-player-forecast-label">Win</span>
                      <span className="gd-player-forecast-value">{formatForecastPercent(forecastEntry.finish1Prob)}</span>
                    </div>
                    <div className="gd-player-forecast-stat">
                      <span className="gd-player-forecast-label">Exp Pts</span>
                      <span className="gd-player-forecast-value">{formatExpectedPoints(forecastEntry.expectedPoints)}</span>
                    </div>
                    <div className="gd-player-forecast-stat">
                      <span className="gd-player-forecast-label">Exp Rank</span>
                      <span className="gd-player-forecast-value">{formatExpectedRank(forecastEntry.expectedRank)}</span>
                    </div>
                  </div>
                  <div className="gd-player-forecast-hist">
                    <span className="gd-player-forecast-hist-label">Rank distribution</span>
                    <StandingsForecastHistogram bins={forecast?.bins ?? []} values={forecastEntry.rankHistogram} compact />
                  </div>
                </div>
              ) : null}
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
