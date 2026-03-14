import { useMemo, useState } from "react";
import { teamsById } from "./data/teams";
import { areAllGroupBracketsLocked, canSeeDetails } from "./groupVisibility";
import type { GroupStanding } from "./groupStorage";

type RankedStanding = GroupStanding & { groupRank: number };

const ROUND_LABELS = [
  { key: "R64", label: "Round of 64" },
  { key: "R32", label: "Round of 32" },
  { key: "S16", label: "Sweet 16" },
  { key: "E8", label: "Elite 8" },
  { key: "F4", label: "Final Four" },
  { key: "CHAMP", label: "Championship" },
] as const;

export function GroupPicksTab({
  standings,
  currentUserId,
  canPreviewHidden = false,
}: {
  standings: RankedStanding[];
  currentUserId: string | undefined;
  tournamentStarted: boolean;
  canPreviewHidden?: boolean;
}) {
  const [expandedRound, setExpandedRound] = useState<string>("R64");
  const allBracketsLocked = areAllGroupBracketsLocked(standings, canPreviewHidden);
  const visibleStandings = useMemo(
    () => standings.filter((entry) => canSeeDetails(entry, currentUserId, canPreviewHidden)),
    [canPreviewHidden, currentUserId, standings],
  );

  const agreementData = useMemo(() => {
    if (visibleStandings.length === 0) return {} as Record<string, AgreementInfo>;

    const allPickKeys = new Set<string>();
    visibleStandings.forEach((s) => {
      if (s.picks && typeof s.picks === "object") {
        Object.keys(s.picks).forEach((k) => allPickKeys.add(k));
      }
    });

    const data: Record<string, AgreementInfo> = {};
    allPickKeys.forEach((matchupId) => {
      const tally: Record<string, Array<{ userId: string; displayName: string }>> = {};
      visibleStandings.forEach((s) => {
        const pick = s.picks?.[matchupId];
        if (pick) {
          if (!tally[pick]) tally[pick] = [];
          tally[pick].push({
            userId: s.user_id,
            displayName: s.display_name,
          });
        }
      });

      const totalVoters = Object.values(tally).reduce((sum, arr) => sum + arr.length, 0);
      const teams = Object.entries(tally)
        .map(([teamId, voters]) => ({
          teamId,
          voters,
          count: voters.length,
          pct: totalVoters > 0 ? Math.round((voters.length / totalVoters) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count);

      const currentUserPick = visibleStandings.find((s) => s.user_id === currentUserId)?.picks?.[matchupId];
      const currentUserTeam = teams.find((t) => t.teamId === currentUserPick);
      const isLoneWolf = Boolean(currentUserTeam && currentUserTeam.count === 1 && totalVoters > 1);

      data[matchupId] = {
        teams,
        totalVoters,
        isLoneWolf,
        matchupId,
      };
    });

    return data;
  }, [visibleStandings, currentUserId]);

  function getMatchupsByRound(roundKey: string) {
    const allKeys = Object.keys(agreementData);
    // Game IDs follow pattern: "{Region}-{Round}-{slot}" or "F4-{Side}-{slot}" or "CHAMP-{slot}"
    return allKeys.filter((k) => {
      const upper = k.toUpperCase();
      if (roundKey === "CHAMP") return upper.startsWith("CHAMP");
      if (roundKey === "F4") return upper.startsWith("F4");
      // Regional rounds: e.g., "South-R64-0" contains "-R64-"
      return upper.includes(`-${roundKey}-`);
    });
  }

  function getLoneWolfCount(roundKey: string) {
    const matchups = getMatchupsByRound(roundKey);
    return matchups.filter((m) => agreementData[m]?.isLoneWolf).length;
  }

  function getTeamDisplayName(teamId: string): string {
    const team = teamsById.get(teamId);
    if (team) return `${team.seed} ${team.name}`;
    return teamId;
  }

  if (!allBracketsLocked) {
    return (
      <div className="gd-locked-state">
        <span className="gd-locked-icon">🔒</span>
        <h3>Picks are hidden until tipoff</h3>
        <p>Once brackets lock, you&apos;ll see how your group&apos;s picks compare — who agreed, who went rogue, and who&apos;s the lone wolf.</p>
      </div>
    );
  }

  return (
    <div className="group-picks">
      <p className="group-picks-description">See where your group agrees — and where you stand alone.</p>

      <div className="group-picks-round-pills">
        {ROUND_LABELS.map((r) => {
          const loneWolves = getLoneWolfCount(r.key);
          return (
            <button
              key={r.key}
              className={`group-picks-pill ${expandedRound === r.key ? "group-picks-pill--active" : ""}`}
              onClick={() => setExpandedRound(r.key)}
            >
              {r.label}
              {loneWolves > 0 && <span className="group-picks-pill-badge">{loneWolves} 🐺</span>}
            </button>
          );
        })}
      </div>

      <div className="group-picks-list">
        {getMatchupsByRound(expandedRound).map((matchupId) => {
          const data = agreementData[matchupId];
          if (!data || data.totalVoters === 0) return null;

          return (
            <div
              key={matchupId}
              className={`group-picks-card ${data.isLoneWolf ? "group-picks-card--lone-wolf" : ""}`}
            >
              {data.isLoneWolf && <span className="group-picks-lone-wolf-badge">🐺 Lone Wolf</span>}

              {data.teams.map((team) => {
                const isUnanimous = team.pct === 100;

                return (
                  <div key={team.teamId} className="group-picks-team-row">
                    <div className="group-picks-team-info">
                      <span className="group-picks-team-name">{getTeamDisplayName(team.teamId)}</span>
                    </div>

                    <div className="group-picks-bar-area">
                      <div className="group-picks-bar-bg">
                        <div
                          className={`group-picks-bar-fill ${isUnanimous ? "group-picks-bar-fill--unanimous" : ""}`}
                          style={{ width: `${team.pct}%` }}
                        />
                      </div>
                      <span className="group-picks-bar-label">
                        {team.count}/{data.totalVoters}
                        {isUnanimous && " ✓"}
                      </span>
                    </div>

                    {data.totalVoters <= 12 && (
                      <div className="group-picks-voters">
                        {team.voters.map((v) => (
                          <span
                            key={v.userId}
                            className={`group-picks-voter ${v.userId === currentUserId ? "group-picks-voter--you" : ""}`}
                          >
                            {v.displayName}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type AgreementInfo = {
  teams: Array<{
    teamId: string;
    voters: Array<{ userId: string; displayName: string }>;
    count: number;
    pct: number;
  }>;
  totalVoters: number;
  isLoneWolf: boolean;
  matchupId: string;
};
