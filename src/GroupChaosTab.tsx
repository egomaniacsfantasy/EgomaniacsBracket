import { useMemo } from "react";
import { computeChaosScoreForPicks } from "./bracketStorage";
import { areAllGroupBracketsLocked, canSeeDetails } from "./groupVisibility";
import type { LockedPicks } from "./lib/bracket";
import type { GroupStanding } from "./groupStorage";

type RankedStanding = GroupStanding & { groupRank: number };

const CHAOS_TIERS = [
  { min: 80, label: "CHAOS AGENT", emoji: "🌪️", color: "#e85c5c" },
  { min: 60, label: "UPSET HEAVY", emoji: "🔥", color: "#e8a85c" },
  { min: 40, label: "BALANCED", emoji: "⚖️", color: "var(--text-amber, #b87d18)" },
  { min: 20, label: "MILD CHALK", emoji: "📊", color: "var(--text-secondary, #a09880)" },
  { min: 0, label: "CHALK CITY", emoji: "🏛️", color: "var(--text-tertiary, #6b6350)" },
];

function getChaosTier(score: number | null) {
  if (score === null || score === undefined) return CHAOS_TIERS[4];
  return CHAOS_TIERS.find((t) => score >= t.min) || CHAOS_TIERS[4];
}

export function GroupChaosTab({
  standings,
  currentUserId,
}: {
  standings: RankedStanding[];
  currentUserId: string | undefined;
}) {
  const allBracketsLocked = areAllGroupBracketsLocked(standings);
  const chaosRankings = useMemo(() => {
    const withScores = standings
      .filter((entry) => canSeeDetails(entry, currentUserId))
      .map((s) => ({
        ...s,
        chaosScore: s.picks && Object.keys(s.picks).length > 0 ? computeChaosScoreForPicks(s.picks as LockedPicks) : null,
      }));

    return withScores
      .filter((s) => s.chaosScore !== null)
      .sort((a, b) => (b.chaosScore || 0) - (a.chaosScore || 0));
  }, [currentUserId, standings]);

  if (!allBracketsLocked) {
    return (
      <div className="gd-locked-state">
        <span className="gd-locked-icon">🌪️</span>
        <h3>Chaos scores hidden until tipoff</h3>
        <p>Once brackets lock, see who went full chalk and who chose violence.</p>
      </div>
    );
  }

  if (chaosRankings.length === 0) {
    return (
      <div className="group-chaos-empty">
        <span className="group-chaos-empty-icon">🌀</span>
        <p>Chaos scores will appear once members fill out their brackets.</p>
      </div>
    );
  }

  const topChaos = chaosRankings[0]?.chaosScore;
  const chaosLeaders = chaosRankings.filter((s) => s.chaosScore === topChaos);
  const soleChaosKing = chaosLeaders.length === 1 ? chaosLeaders[0].user_id : null;

  return (
    <div className="group-chaos">
      <p className="group-chaos-description">
        Who&apos;s got the wildest bracket? Chaos score measures how far your picks stray from the chalk.
      </p>

      <div className="group-chaos-list">
        {chaosRankings.map((entry, i) => {
          const tier = getChaosTier(entry.chaosScore);
          const isCurrentUser = entry.user_id === currentUserId;
          const isChaosKing = entry.user_id === soleChaosKing;

          return (
            <div
              key={entry.bracket_id}
              className={`group-chaos-row ${isCurrentUser ? "group-chaos-row--you" : ""}`}
            >
              <span className="group-chaos-rank">{isChaosKing ? "🌪️" : `${i + 1}`}</span>

              <div className="group-chaos-name-area">
                <span className="group-chaos-display-name">
                  {entry.display_name}
                  {isCurrentUser && <span className="gd-player-you">YOU</span>}
                </span>
                <span className="group-chaos-bracket-name">{entry.bracket_name}</span>
              </div>

              <div className="group-chaos-score-area">
                <span className="group-chaos-tier-label" style={{ color: tier.color }}>
                  {tier.emoji} {tier.label}
                </span>
                <span className="group-chaos-score-value">{entry.chaosScore?.toFixed(1)}</span>
              </div>

              <div className="group-chaos-bar-bg">
                <div
                  className="group-chaos-bar-fill"
                  style={{
                    width: `${Math.min(entry.chaosScore || 0, 100)}%`,
                    background: tier.color,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
