import { useMemo } from "react";
import { computeChaosScoreForPicks } from "./bracketStorage";
import { teamsById } from "./data/teams";
import { resolveGames, type LockedPicks } from "./lib/bracket";
import { teamLogoUrl } from "./lib/logo";
import { canSeeDetails } from "./groupVisibility";
import type { GroupStanding } from "./groupStorage";

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
  const { games } = resolveGames(picks);
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

export function GroupStandingsTab({
  standings,
  groupMemberCount,
  soleLeader,
  currentUserId,
  tournamentStarted,
  canPreviewHidden = false,
  onViewBracket,
  onRefresh,
  onSelectBracket,
  onInvite,
}: {
  standings: RankedStanding[];
  groupMemberCount: number;
  soleLeader: string | null;
  currentUserId: string | undefined;
  tournamentStarted: boolean;
  canPreviewHidden?: boolean;
  onViewBracket: (info: { bracketId: string; displayName: string; bracketName: string }) => void;
  onRefresh: () => void;
  onSelectBracket?: () => void;
  onInvite: () => void;
}) {
  const forecasts = useMemo(() => {
    const withBrackets = standings.filter((entry) => entry.bracket_id != null);
    if (withBrackets.length === 0) return {} as Record<string, number>;

    if (!tournamentStarted) {
      const equalPct = Math.round(100 / withBrackets.length);
      const map: Record<string, number> = {};
      withBrackets.forEach((entry) => {
        map[entry.bracket_id!] = equalPct;
      });
      return map;
    }

    const ceilings = withBrackets.map((entry) => ({
      bracketId: entry.bracket_id!,
      score: entry.total_score || 0,
      ceiling: (entry.total_score || 0) + (entry.max_remaining || 0),
    }));

    const maxCeiling = Math.max(...ceilings.map((entry) => entry.ceiling));
    const topScore = Math.max(...ceilings.map((entry) => entry.score));

    if (topScore === 0) {
      const equalPct = Math.round(100 / withBrackets.length);
      const map: Record<string, number> = {};
      withBrackets.forEach((entry) => {
        map[entry.bracket_id!] = equalPct;
      });
      return map;
    }

    const weights = ceilings.map((entry) => {
      if (entry.ceiling < topScore) return { ...entry, weight: 0 };
      const leadProximity = 1 - (topScore - entry.score) / Math.max(1, topScore);
      const ceilingRatio = entry.ceiling / Math.max(1, maxCeiling);
      return { ...entry, weight: leadProximity * ceilingRatio };
    });

    const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
    const map: Record<string, number> = {};
    weights.forEach((entry) => {
      map[entry.bracketId] = totalWeight > 0 ? Math.max(0, Math.round((entry.weight / totalWeight) * 100)) : 0;
    });

    return map;
  }, [standings, tournamentStarted]);

  const standingsCount = standings.length;

  return (
    <div className="gd-standings">
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

      {standings.length === 0 ? (
        <div className="gd-empty-state">
          <span className="gd-empty-state-icon">📋</span>
          <h3>No brackets in the standings yet</h3>
          <p>Members can still be in the group before their brackets show up here. Check the Members tab to see everyone in the room.</p>
        </div>
      ) : null}

      <div className="gd-standings-list">
        {standings.map((entry) => {
          const isCurrentUser = entry.user_id === currentUserId;
          const hasBracket = entry.bracket_id != null;
          const canSee = canSeeDetails(entry, currentUserId, canPreviewHidden);
          const isLeader = Boolean(tournamentStarted && hasBracket && soleLeader === entry.user_id);
          const championId = hasBracket && canSee ? getChampionPick(entry.picks) : null;
          const championInfo = championId ? getTeamInfo(championId) : null;
          const chaosScore =
            hasBracket && canSee && entry.picks && Object.keys(entry.picks).length > 0
              ? computeChaosScoreForPicks(entry.picks as LockedPicks)
              : null;
          const chaosTier = getChaosTier(chaosScore);
          const forecast = hasBracket ? forecasts[entry.bracket_id!] || 0 : 0;
          const canOpenBracket = Boolean(hasBracket && canSee);

          return (
            <div
              key={entry.user_id}
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
                    {championInfo?.logoUrl ? (
                      <img
                        src={championInfo.logoUrl}
                        className="gd-champion-logo"
                        alt=""
                        onError={(event) => {
                          (event.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : null}

                    <div className="gd-champion-info">
                      <span className="gd-champion-name">{championInfo?.name ?? championId ?? "Champion pending"}</span>
                      <span className="gd-champion-seed">
                        {championInfo?.seed ? `#${championInfo.seed} seed` : "Champion pick"}
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
                  <div className="gd-player-score">
                    <span>Score: {entry.total_score ?? 0}</span>
                    <span>·</span>
                    <span>{entry.correct_picks ?? 0}/{entry.possible_picks ?? 63} correct</span>
                    <span>·</span>
                    <span>Max remaining: {entry.max_remaining ?? 0}</span>
                  </div>

                  <div className="gd-forecast-bar">
                    <div className="gd-forecast-fill" style={{ width: `${Math.min(forecast, 100)}%` }} />
                  </div>
                  <span className="gd-forecast-pct">{forecast}% win chance</span>
                </div>
              )}
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
