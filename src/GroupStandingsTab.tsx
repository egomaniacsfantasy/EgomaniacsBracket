import { useMemo } from "react";
import { teamsById } from "./data/teams";
import { resolveGames, type LockedPicks } from "./lib/bracket";
import type { GroupStanding } from "./groupStorage";

type RankedStanding = GroupStanding & { groupRank: number };

export function GroupStandingsTab({
  standings,
  soleLeader,
  currentUserId,
  tournamentStarted,
  onViewBracket,
  onRefresh,
}: {
  standings: RankedStanding[];
  soleLeader: string | null;
  currentUserId: string | undefined;
  tournamentStarted: boolean;
  onViewBracket: (info: { bracketId: string; displayName: string; bracketName: string }) => void;
  onRefresh: () => void;
}) {
  const forecasts = useMemo(() => {
    if (standings.length === 0) return {} as Record<string, number>;

    if (!tournamentStarted) {
      const equalPct = Math.round(100 / standings.length);
      const map: Record<string, number> = {};
      standings.forEach((s) => {
        map[s.bracket_id] = equalPct;
      });
      return map;
    }

    const ceilings = standings.map((s) => ({
      bracketId: s.bracket_id,
      score: s.total_score || 0,
      ceiling: (s.total_score || 0) + (s.max_remaining || 0),
    }));

    const maxCeiling = Math.max(...ceilings.map((c) => c.ceiling));
    const topScore = Math.max(...ceilings.map((c) => c.score));

    if (topScore === 0) {
      const equalPct = Math.round(100 / standings.length);
      const map: Record<string, number> = {};
      standings.forEach((s) => {
        map[s.bracket_id] = equalPct;
      });
      return map;
    }

    const weights = ceilings.map((c) => {
      if (c.ceiling < topScore) return { ...c, weight: 0 };
      const leadProximity = 1 - (topScore - c.score) / Math.max(1, topScore);
      const ceilingRatio = c.ceiling / Math.max(1, maxCeiling);
      return { ...c, weight: leadProximity * ceilingRatio };
    });

    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    const map: Record<string, number> = {};
    weights.forEach((w) => {
      map[w.bracketId] = totalWeight > 0 ? Math.max(0, Math.round((w.weight / totalWeight) * 100)) : 0;
    });

    return map;
  }, [standings, tournamentStarted]);

  function getChampionPick(picks: LockedPicks | null): string | null {
    if (!picks || typeof picks !== "object") return null;
    const { games } = resolveGames(picks);
    const champGame = games.find((g) => g.round === "CHAMP");
    return champGame?.winnerId ?? null;
  }

  function getTeamInfo(teamId: string) {
    const team = teamsById.get(teamId);
    if (!team) return null;
    return {
      name: team.name,
      shortName: team.name,
      seed: team.seed,
      logoUrl: ("logoUrl" in team ? (team as { logoUrl?: string }).logoUrl : undefined) ?? null,
    };
  }

  return (
    <div className="group-standings">
      <div className="group-standings-header-row">
        <span className="gs-col gs-col-rank">#</span>
        <span className="gs-col gs-col-name">Player</span>
        <span className="gs-col gs-col-champ">Champion</span>
        {tournamentStarted && (
          <>
            <span className="gs-col gs-col-score">Score</span>
            <span className="gs-col gs-col-correct">Correct</span>
            <span className="gs-col gs-col-remaining">Max</span>
          </>
        )}
        <span className="gs-col gs-col-forecast">Win %</span>
      </div>

      {standings.map((entry) => {
        const isCurrentUser = entry.user_id === currentUserId;
        const hasCrown = soleLeader === entry.user_id && tournamentStarted;
        const isTied = !soleLeader && entry.groupRank === 1 && tournamentStarted;
        const champion = getChampionPick(entry.picks);
        const championInfo = champion ? getTeamInfo(champion) : null;
        const forecast = forecasts[entry.bracket_id] || 0;
        const isEliminated = tournamentStarted && forecast === 0;

        return (
          <div
            key={entry.bracket_id}
            className={`group-standings-row ${isCurrentUser ? "group-standings-row--you" : ""} ${isEliminated ? "group-standings-row--eliminated" : ""}`}
            onClick={() => {
              if (entry.is_locked || tournamentStarted) {
                onViewBracket({
                  bracketId: entry.bracket_id,
                  displayName: entry.display_name,
                  bracketName: entry.bracket_name,
                });
              }
            }}
            style={{ cursor: entry.is_locked || tournamentStarted ? "pointer" : "default" }}
          >
            <span className="gs-col gs-col-rank">
              {hasCrown ? (
                <span className="gs-crown">👑</span>
              ) : isTied ? (
                <span className="gs-tied-rank">T{entry.groupRank}</span>
              ) : (
                <span className="gs-rank-num">{entry.groupRank}</span>
              )}
            </span>

            <div className="gs-col gs-col-name">
              <span className="gs-display-name">
                {entry.display_name}
                {isCurrentUser && <span className="gs-you-badge">YOU</span>}
              </span>
              <span className="gs-bracket-name">{entry.bracket_name}</span>
            </div>

            <div className="gs-col gs-col-champ">
              {championInfo ? (
                <div className="gs-champ-pick">
                  {championInfo.logoUrl && (
                    <img
                      src={championInfo.logoUrl}
                      alt=""
                      className="gs-champ-logo"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                  <span className="gs-champ-name">
                    {championInfo.seed} {championInfo.shortName}
                  </span>
                </div>
              ) : champion ? (
                <span className="gs-champ-name-raw">{champion}</span>
              ) : (
                <span className="gs-champ-empty">—</span>
              )}
            </div>

            {tournamentStarted && (
              <>
                <span className="gs-col gs-col-score">{entry.total_score ?? "—"}</span>
                <span className="gs-col gs-col-correct">
                  {entry.correct_picks ?? "—"}/{entry.possible_picks || 63}
                </span>
                <span className="gs-col gs-col-remaining">{entry.max_remaining ?? "—"}</span>
              </>
            )}

            <div className="gs-col gs-col-forecast">
              <div className="gs-forecast-bar-bg">
                <div
                  className="gs-forecast-bar-fill"
                  style={{ width: `${Math.min(forecast, 100)}%` }}
                />
              </div>
              <span className="gs-forecast-pct">{isEliminated ? "ELIM" : `${forecast}%`}</span>
            </div>
          </div>
        );
      })}

      <div className="group-standings-footer">
        <p className="gs-footer-scoring">Scoring: 10 / 20 / 40 / 80 / 160 / 320 per round · Max 1920</p>
        <button className="gs-refresh-btn" onClick={onRefresh}>
          ↻ Refresh
        </button>
      </div>
    </div>
  );
}
