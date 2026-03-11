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
  onSelectBracket,
}: {
  standings: RankedStanding[];
  soleLeader: string | null;
  currentUserId: string | undefined;
  tournamentStarted: boolean;
  onViewBracket: (info: { bracketId: string; displayName: string; bracketName: string }) => void;
  onRefresh: () => void;
  onSelectBracket?: () => void;
}) {
  const forecasts = useMemo(() => {
    const withBrackets = standings.filter((s) => s.bracket_id != null);
    if (withBrackets.length === 0) return {} as Record<string, number>;

    if (!tournamentStarted) {
      const equalPct = Math.round(100 / withBrackets.length);
      const map: Record<string, number> = {};
      withBrackets.forEach((s) => {
        map[s.bracket_id!] = equalPct;
      });
      return map;
    }

    const ceilings = withBrackets.map((s) => ({
      bracketId: s.bracket_id!,
      score: s.total_score || 0,
      ceiling: (s.total_score || 0) + (s.max_remaining || 0),
    }));

    const maxCeiling = Math.max(...ceilings.map((c) => c.ceiling));
    const topScore = Math.max(...ceilings.map((c) => c.score));

    if (topScore === 0) {
      const equalPct = Math.round(100 / withBrackets.length);
      const map: Record<string, number> = {};
      withBrackets.forEach((s) => {
        map[s.bracket_id!] = equalPct;
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
        const hasBracket = entry.bracket_id != null;
        const hasCrown = soleLeader === entry.user_id && tournamentStarted && hasBracket;
        const isTied = !soleLeader && entry.groupRank === 1 && tournamentStarted && hasBracket;
        const champion = hasBracket ? getChampionPick(entry.picks) : null;
        const championInfo = champion ? getTeamInfo(champion) : null;
        const forecast = hasBracket ? (forecasts[entry.bracket_id!] || 0) : 0;
        const isEliminated = tournamentStarted && hasBracket && forecast === 0;

        return (
          <div
            key={entry.bracket_id ?? `member-${entry.user_id}`}
            className={`group-standings-row ${isCurrentUser ? "group-standings-row--you" : ""} ${isEliminated ? "group-standings-row--eliminated" : ""} ${!hasBracket ? "group-standings-row--no-bracket" : ""}`}
            onClick={() => {
              if (!hasBracket) return;
              if (entry.is_locked || tournamentStarted) {
                onViewBracket({
                  bracketId: entry.bracket_id!,
                  displayName: entry.display_name,
                  bracketName: entry.bracket_name,
                });
              }
            }}
            style={{ cursor: hasBracket && (entry.is_locked || tournamentStarted) ? "pointer" : "default" }}
          >
            <span className="gs-col gs-col-rank">
              {!hasBracket ? (
                <span className="gs-rank-num">—</span>
              ) : hasCrown ? (
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
              <span className={`gs-bracket-name ${!hasBracket ? "gs-bracket-name--empty" : ""}`}>
                {hasBracket ? entry.bracket_name : (
                  isCurrentUser && onSelectBracket ? (
                    <button className="gs-select-bracket-btn" onClick={(e) => { e.stopPropagation(); onSelectBracket(); }}>
                      Select Bracket →
                    </button>
                  ) : "No bracket yet"
                )}
              </span>
            </div>

            <div className="gs-col gs-col-champ">
              {!hasBracket ? (
                <span className="gs-champ-empty">—</span>
              ) : championInfo ? (
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
                <span className="gs-col gs-col-score">{hasBracket ? (entry.total_score ?? "—") : "—"}</span>
                <span className="gs-col gs-col-correct">
                  {hasBracket ? `${entry.correct_picks ?? "—"}/${entry.possible_picks || 63}` : "—"}
                </span>
                <span className="gs-col gs-col-remaining">{hasBracket ? (entry.max_remaining ?? "—") : "—"}</span>
              </>
            )}

            <div className="gs-col gs-col-forecast">
              {hasBracket ? (
                <>
                  <div className="gs-forecast-bar-bg">
                    <div
                      className="gs-forecast-bar-fill"
                      style={{ width: `${Math.min(forecast, 100)}%` }}
                    />
                  </div>
                  <span className="gs-forecast-pct">{isEliminated ? "ELIM" : `${forecast}%`}</span>
                </>
              ) : (
                <span className="gs-forecast-pct gs-forecast-pct--empty">—</span>
              )}
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
