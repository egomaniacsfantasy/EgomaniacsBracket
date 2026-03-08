import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { TEAM_STAT_IMPORTANCE, TEAM_STAT_ORDER, TEAM_STATS_2026, type TeamStatKey } from "../data/teamStats2026";
import { formatOddsDisplay } from "../lib/odds";
import { getMappedEspnLogoPath } from "../lib/logoMap";
import type { OddsDisplayMode } from "../types";
import { buildConferenceBracket } from "./bracketBuilder";
import { CONF_KNOWN_RESULTS, CONFERENCE_DEFS, CONFERENCE_DEFS_BY_ID, type ConfDefWithProbMap } from "./conferenceDefs";
import {
  getConfGameWinProb,
  possibleConfWinnersByGame,
  resolveConfGames,
  type ConfCustomProbByGame,
  type ConfLockedPicks,
} from "./confBracket";
import { CONF_TEAMS } from "./data/confTeams";
import { runConfSimulation } from "./simulation";
import type { ConfGameTemplate, ConfResolvedGame, ConfSimulationOutput } from "./types";

const SIM_RUNS = 2000;
type ConfTeamRow = (typeof CONF_TEAMS)[string][number];
type ConfCandidateRow = { teamId: number; prob: number; team: ConfTeamRow };
const INFO_ICON_TEXT = "\u24D8";
const CLOSE_ICON_TEXT = "\u2715";

const TEAM_STAT_LABELS: Record<TeamStatKey, string> = {
  rank_POM: "KenPom Rank",
  rank_MAS: "Massey Rank",
  rank_WLK: "Whitlock Rank",
  rank_MOR: "Moore Rank",
  elo_sos: "Odds Gods Elo SOS",
  elo_last: "OddsGods Elo",
  avg_net_rtg: "Net Rating",
  avg_off_rtg: "Offensive Rating",
  elo_trend: "OddsGods Elo Trend",
  avg_def_rtg: "Defensive Rating",
  last5_Margin: "Last 5 Margin",
  rank_BIH: "Bihl Rank",
  rank_NET: "NET Rank",
};

const TEAM_STAT_DESCRIPTIONS: Record<TeamStatKey, string> = {
  rank_POM: "KenPom rankings (tempo adjusted efficiency rating).",
  rank_MAS:
    "Massey rankings. We use the ranking differences from the best-performing team-strength set to help compute win probability.",
  rank_WLK:
    "Whitlock rankings. Computer generated power ranking system assigning a numerical strength to each team based on game results and strength of schedule.",
  rank_MOR:
    "Moore rankings. A rating algorithm that evaluates teams using statistical game data to estimate relative performance.",
  elo_sos:
    "Mean of opponents' pre-game Elo across all games this season. OddsGods created SOS metric that prioritizes opponent strength at the time of each game.",
  elo_last:
    "OddsGods custom built Elo system. Continuous rating that carries across seasons and updates after every game based on opponent quality, season phase, and conference context.",
  avg_net_rtg: "Offensive rating minus defensive rating. Overall efficiency margin per 100 possessions.",
  avg_off_rtg: "Offensive rating. 100 * points / possessions.",
  elo_trend:
    "OddsGods Elo trend. Slope of a linear regression line fit to a team's season Elo history, representing average Elo points gained or lost per game.",
  avg_def_rtg: "Defensive rating. 100 * opponent points / opponent possessions.",
  last5_Margin: "Rolling 5-game mean of scoring margin.",
  rank_BIH: "Bihl rankings. Rating system producing strength scores based on game outcomes and strength of schedule.",
  rank_NET:
    "Official NCAA metric used by the selection committee. Combines game result, strength of schedule, net efficiency, and scoring margin.",
};

const IMPORTANCE_HELP_TEXT =
  "Importance% shows how much each stat influences the model's picks. The higher the percentage, the more that stat tends to move and influence predictions.";

const LOWER_IS_BETTER_STATS = new Set<TeamStatKey>([
  "rank_POM",
  "rank_MAS",
  "rank_WLK",
  "rank_MOR",
  "rank_BIH",
  "avg_def_rtg",
  "rank_NET",
]);

function confTeamLogoUrl(name: string): string {
  const mapped = getMappedEspnLogoPath(name);
  if (mapped) return mapped;
  const initials = name
    .replace(/[^a-zA-Z\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return `https://placehold.co/64x64/1b1107/f0e4c6.png?text=${encodeURIComponent(initials || "TM")}`;
}

const formatStatValue = (value: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toFixed(1);
  if (Number.isInteger(value)) return `${value}`;
  if (Math.abs(value) < 1) return value.toFixed(4);
  return value.toFixed(2);
};

const formatDiffValue = (value: number): string => {
  const abs = Math.abs(value);
  if (Number.isInteger(abs)) return `${abs}`;
  if (abs < 1) return abs.toFixed(4);
  return abs.toFixed(2);
};

const differenceForStat = (
  teamAName: string,
  teamAValue: number | null,
  teamBName: string,
  teamBValue: number | null,
  key: TeamStatKey
): string => {
  if (teamAValue === null || teamBValue === null) return "-";
  if (teamAValue === teamBValue) return "Even";

  const lowerIsBetter = LOWER_IS_BETTER_STATS.has(key);
  const aBetter = lowerIsBetter ? teamAValue < teamBValue : teamAValue > teamBValue;
  const betterName = aBetter ? teamAName : teamBName;
  const delta = aBetter ? teamBValue - teamAValue : teamAValue - teamBValue;
  return `${betterName} +${formatDiffValue(delta)}`;
};

const getEntryRoundIndexByTeam = (
  gameTemplates: ConfGameTemplate[],
  roundOrder: string[]
): Record<number, number> => {
  const roundIndexById = new Map(roundOrder.map((roundId, index) => [roundId, index]));
  const entryIndexByTeam: Record<number, number> = {};

  for (const game of gameTemplates) {
    const roundIndex = roundIndexById.get(game.round);
    if (roundIndex === undefined || !game.initialTeamIds) continue;

    for (const teamId of game.initialTeamIds) {
      if (teamId === null || teamId === undefined) continue;
      const previous = entryIndexByTeam[teamId];
      if (previous === undefined || roundIndex < previous) {
        entryIndexByTeam[teamId] = roundIndex;
      }
    }
  }

  return entryIndexByTeam;
};

const getRoundReachProb = (
  row: ConfSimulationOutput["futures"][number],
  roundId: string,
  roundIds: string[],
  roundIndexById: Record<string, number>,
  entryRoundIndexByTeam: Record<number, number>
): number => {
  const roundIndex = roundIndexById[roundId] ?? 0;
  const entryIndex = entryRoundIndexByTeam[row.teamId] ?? 0;
  if (roundIndex <= entryIndex) return 1;

  const previousRoundId = roundIds[roundIndex - 1];
  if (!previousRoundId) return 1;
  return row.roundProbs[previousRoundId] ?? 0;
};

const buildGameRowsForDisplay = (
  game: ConfResolvedGame,
  confId: string,
  def: ConfDefWithProbMap,
  teamsById: Map<number, ConfTeamRow>,
  gameWinProbs: ConfSimulationOutput["gameWinProbs"] | null,
  possibleWinners: Record<string, Set<number>>
): ConfCandidateRow[] => {
  const candidates = (gameWinProbs?.[game.id] ?? [])
    .map((entry) => ({ ...entry, team: teamsById.get(entry.teamId) }))
    .filter((entry): entry is ConfCandidateRow => Boolean(entry.team));
  const probByTeam = new Map(candidates.map((candidate) => [candidate.teamId, candidate.prob]));

  if (game.teamAId && game.teamBId) {
    return [game.teamAId, game.teamBId]
      .map((teamId) => {
        const team = teamsById.get(teamId);
        if (!team) return null;
        const modelProb = getConfGameWinProb(game, teamId, confId, def, teamsById);
        return { teamId, prob: probByTeam.get(teamId) ?? modelProb ?? 0, team };
      })
      .filter((row): row is ConfCandidateRow => row !== null);
  }

  const possibleForGame = possibleWinners[game.id] ?? new Set<number>();
  return candidates
    .filter((candidate) => possibleForGame.has(candidate.teamId))
    .sort((a, b) => {
      if (b.prob !== a.prob) return b.prob - a.prob;
      if (a.team.seed !== b.team.seed) return a.team.seed - b.team.seed;
      return a.team.name.localeCompare(b.team.name);
    });
};

export function ConferenceTournaments({
  displayMode,
  isMobile,
}: {
  displayMode: OddsDisplayMode;
  isMobile: boolean;
}) {
  const [selectedConf, setSelectedConf] = useState<string | null>(null);
  const [locks, setLocks] = useState<Record<string, ConfLockedPicks>>({});
  const [customProbs, setCustomProbs] = useState<Record<string, ConfCustomProbByGame>>({});

  const handleBack = useCallback(() => setSelectedConf(null), []);

  if (selectedConf) {
    return (
      <ConferenceBracketView
        confId={selectedConf}
        displayMode={displayMode}
        isMobile={isMobile}
        locks={locks[selectedConf] ?? {}}
        customProbs={customProbs[selectedConf] ?? {}}
        onLocksChange={(newLocks) => setLocks((prev) => ({ ...prev, [selectedConf]: newLocks }))}
        onCustomProbsChange={(newProbs) => setCustomProbs((prev) => ({ ...prev, [selectedConf]: newProbs }))}
        onBack={handleBack}
      />
    );
  }

  return (
    <div className="conf-page">
      <h2 className="conf-page-title">Conference Tournaments</h2>
      <p className="conf-page-subtitle">Select a conference to simulate their tournament bracket</p>
      <div className="conf-selector-grid">
        {CONFERENCE_DEFS.map((def) => {
          const teams = CONF_TEAMS[def.id] ?? [];
          const topTeam = teams[0];
          return (
            <button key={def.id} className="conf-selector-card" onClick={() => setSelectedConf(def.id)}>
              {topTeam ? (
                <img src={confTeamLogoUrl(topTeam.name)} alt="" className="conf-selector-logo" loading="lazy" />
              ) : null}
              <div className="conf-selector-info">
                <span className="conf-selector-name">{def.shortName}</span>
                <span className="conf-selector-meta">{def.teamCount} teams</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConferenceBracketView({
  confId,
  displayMode,
  isMobile,
  locks,
  customProbs,
  onLocksChange,
  onCustomProbsChange: _onCustomProbsChange,
  onBack,
}: {
  confId: string;
  displayMode: OddsDisplayMode;
  isMobile: boolean;
  locks: ConfLockedPicks;
  customProbs: ConfCustomProbByGame;
  onLocksChange: (locks: ConfLockedPicks) => void;
  onCustomProbsChange: (probs: ConfCustomProbByGame) => void;
  onBack: () => void;
}) {
  void _onCustomProbsChange;
  const def = CONFERENCE_DEFS_BY_ID[confId];
  const teams = useMemo(() => CONF_TEAMS[confId] ?? [], [confId]);
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const gameTemplates = useMemo(() => (def ? buildConferenceBracket(def, teams) : []), [def, teams]);
  const roundOrder = useMemo(() => (def ? def.rounds.map((round) => round.id) : []), [def]);
  const [showFutures, setShowFutures] = useState(false);
  const [selectedStatsGame, setSelectedStatsGame] = useState<ConfResolvedGame | null>(null);

  // Merge known actual results (immutable) on top of user locks so the
  // simulation always reflects real outcomes for completed games.
  const effectiveLocks = useMemo(
    () => ({ ...locks, ...(CONF_KNOWN_RESULTS[confId] ?? {}) }),
    [locks, confId]
  );

  const { games: resolvedGames, sanitized } = useMemo(
    () => resolveConfGames(gameTemplates, roundOrder, effectiveLocks, customProbs),
    [gameTemplates, roundOrder, effectiveLocks, customProbs]
  );

  const simOutput = useMemo(
    () => (def ? runConfSimulation(confId, def, gameTemplates, teams, sanitized, SIM_RUNS, customProbs) : null),
    [confId, customProbs, def, gameTemplates, sanitized, teams]
  );

  const possibleWinners = useMemo(
    () => possibleConfWinnersByGame(gameTemplates, roundOrder, sanitized),
    [gameTemplates, roundOrder, sanitized]
  );

  const gamesByRound = useMemo(() => {
    const map = new Map<string, ConfResolvedGame[]>();
    for (const roundId of roundOrder) {
      map.set(
        roundId,
        resolvedGames.filter((game) => game.round === roundId).sort((a, b) => a.slot - b.slot)
      );
    }
    return map;
  }, [resolvedGames, roundOrder]);

  const laneHeightPx = useMemo(() => {
    const maxGamesInRound = Math.max(1, ...def.rounds.map((round) => (gamesByRound.get(round.id) ?? []).length));
    return 520 + maxGamesInRound * 40;
  }, [def.rounds, gamesByRound]);

  const bracketGridStyle = useMemo<CSSProperties | undefined>(() => {
    if (isMobile) return undefined;
    return { ["--conf-lane-height" as string]: `${laneHeightPx}px` } as CSSProperties;
  }, [isMobile, laneHeightPx]);

  const entryRoundIndexByTeam = useMemo(
    () => getEntryRoundIndexByTeam(gameTemplates, roundOrder),
    [gameTemplates, roundOrder]
  );

  const handlePick = useCallback(
    (game: ConfResolvedGame, teamId: number | null) => {
      const nextLocks = { ...locks };
      if (teamId === null || locks[game.id] === teamId) {
        delete nextLocks[game.id];
      } else {
        nextLocks[game.id] = teamId;
      }
      onLocksChange(nextLocks);
    },
    [locks, onLocksChange]
  );

  const [mobileRound, setMobileRound] = useState(roundOrder[0] ?? "");

  if (!def) return null;

  return (
    <div className="conf-bracket-page">
      <div className="conf-bracket-toolbar">
        <button className="eg-btn conf-back-btn" onClick={onBack}>
          {"<- Back"}
        </button>
        <h2 className="conf-bracket-title">{def.name}</h2>
        <button
          className={`eg-btn conf-futures-toggle ${showFutures ? "conf-futures-toggle--active" : ""}`}
          onClick={() => setShowFutures((previous) => !previous)}
        >
          {showFutures ? "Bracket" : "Odds"}
        </button>
      </div>

      {showFutures && simOutput ? (
        <ConferenceFutures
          def={def}
          futures={simOutput.futures}
          displayMode={displayMode}
          teamsById={teamsById}
          entryRoundIndexByTeam={entryRoundIndexByTeam}
        />
      ) : (
        <>
          {isMobile ? (
            <div className="conf-round-pills">
              {def.rounds.map((round) => (
                <button
                  key={round.id}
                  className={`conf-round-pill ${mobileRound === round.id ? "conf-round-pill--active" : ""}`}
                  onClick={() => setMobileRound(round.id)}
                >
                  {round.label}
                </button>
              ))}
            </div>
          ) : null}

          <div
            className={`conf-bracket-grid ${isMobile ? "conf-bracket-grid--mobile" : ""}`}
            style={bracketGridStyle}
          >
            {def.rounds.map((roundDef) => {
              if (isMobile && roundDef.id !== mobileRound) return null;
              const roundGames = gamesByRound.get(roundDef.id) ?? [];
              const slotCount = Math.max(roundGames.length, 1);
              return (
                <div key={roundDef.id} className="conf-round-col">
                  <p className="conf-round-label">{roundDef.label}</p>
                  <div className="conf-games-lane">
                    {roundGames.map((game) => {
                      const nodeStyle: CSSProperties | undefined = isMobile
                        ? undefined
                        : {
                            top: `${((game.slot + 0.5) / slotCount) * 100}%`,
                          };
                      return (
                        <div key={game.id} className="conf-game-node" data-game-id={game.id} style={nodeStyle}>
                          <ConfGameCard
                            game={game}
                            confId={confId}
                            def={def}
                            teamsById={teamsById}
                            displayMode={displayMode}
                            gameWinProbs={simOutput?.gameWinProbs ?? null}
                            possibleWinners={possibleWinners}
                            onPick={handlePick}
                            onOpenMatchupStats={setSelectedStatsGame}
                            isLocked={game.id in locks}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {selectedStatsGame ? (
        <ConfMatchupStatsModal
          game={selectedStatsGame}
          teamsById={teamsById}
          onClose={() => setSelectedStatsGame(null)}
        />
      ) : null}
    </div>
  );
}

function ConfGameCard({
  game,
  confId,
  def,
  teamsById,
  displayMode,
  gameWinProbs,
  possibleWinners,
  onPick,
  onOpenMatchupStats,
  isLocked,
}: {
  game: ConfResolvedGame;
  confId: string;
  def: ConfDefWithProbMap;
  teamsById: Map<number, ConfTeamRow>;
  displayMode: OddsDisplayMode;
  gameWinProbs: ConfSimulationOutput["gameWinProbs"] | null;
  possibleWinners: Record<string, Set<number>>;
  onPick: (game: ConfResolvedGame, teamId: number | null) => void;
  onOpenMatchupStats: (game: ConfResolvedGame) => void;
  isLocked: boolean;
}) {
  const rows = buildGameRowsForDisplay(game, confId, def, teamsById, gameWinProbs, possibleWinners);
  const knownMatchup = game.teamAId !== null && game.teamBId !== null;

  const renderRow = (candidate: ConfCandidateRow, index: number) => {
    const { team } = candidate;
    const canPick = knownMatchup && (team.id === game.teamAId || team.id === game.teamBId);
    const isWinner = game.winnerId === team.id;
    const isLoser = canPick && game.winnerId !== null && game.winnerId !== team.id;
    const odds = formatOddsDisplay(candidate.prob, displayMode);

    return (
      <button
        key={`${game.id}-${team.id}`}
        className={`conf-team-row ${index === 0 ? "top" : ""} ${isWinner ? "conf-team-row--winner" : ""} ${isLoser ? "conf-team-row--loser" : ""}`}
        onClick={() => {
          if (!canPick) return;
          onPick(game, isWinner ? null : team.id);
        }}
        disabled={!canPick}
      >
        <img src={confTeamLogoUrl(team.name)} alt="" className="conf-team-logo" loading="lazy" />
        <span className="conf-team-seed">{team.seed}</span>
        <span className="conf-team-name">{team.name}</span>
        <span className="conf-team-odds">{odds.primary}</span>
      </button>
    );
  };

  return (
    <div className={`conf-game-card ${isLocked ? "conf-game-card--locked" : ""} ${knownMatchup ? "conf-game-card--with-info" : ""}`}>
      {knownMatchup ? (
        <button
          type="button"
          className="matchup-stats-icon matchup-stats-icon--conf"
          onClick={(event) => {
            event.stopPropagation();
            onOpenMatchupStats(game);
          }}
          title="View matchup stats"
          aria-label="View matchup stats"
        >
          {INFO_ICON_TEXT}
        </button>
      ) : null}
      {rows.length > 0 ? (
        rows.map((candidate, index) => renderRow(candidate, index))
      ) : (
        <>
          <div className="conf-team-row top conf-team-row--placeholder">
            <span className="conf-team-tbd">TBD</span>
          </div>
          <div className="conf-team-row conf-team-row--placeholder">
            <span className="conf-team-tbd">TBD</span>
          </div>
        </>
      )}
    </div>
  );
}

function ConferenceFutures({
  def,
  futures,
  displayMode,
  teamsById,
  entryRoundIndexByTeam,
}: {
  def: ConfDefWithProbMap;
  futures: ConfSimulationOutput["futures"];
  displayMode: OddsDisplayMode;
  teamsById: Map<number, ConfTeamRow>;
  entryRoundIndexByTeam: Record<number, number>;
}) {
  const [sortCol, setSortCol] = useState<string>("champ");
  const [sortAsc, setSortAsc] = useState(false);
  const displayRounds = def.rounds;
  const roundIds = displayRounds.map((round) => round.id);
  const roundIndexById = useMemo(
    () => Object.fromEntries(roundIds.map((roundId, index) => [roundId, index])) as Record<string, number>,
    [roundIds]
  );

  const handleSort = (column: string) => {
    if (column === sortCol) {
      setSortAsc((previous) => !previous);
      return;
    }
    setSortCol(column);
    setSortAsc(false);
  };

  const sortedFutures = useMemo(() => {
    const sorted = [...futures];
    sorted.sort((a, b) => {
      let valueA: number;
      let valueB: number;
      if (sortCol === "champ") {
        valueA = a.champProb;
        valueB = b.champProb;
      } else if (sortCol === "seed") {
        valueA = a.seed;
        valueB = b.seed;
      } else {
        valueA = getRoundReachProb(a, sortCol, roundIds, roundIndexById, entryRoundIndexByTeam);
        valueB = getRoundReachProb(b, sortCol, roundIds, roundIndexById, entryRoundIndexByTeam);
      }
      return sortAsc ? valueA - valueB : valueB - valueA;
    });
    return sorted;
  }, [entryRoundIndexByTeam, futures, roundIds, roundIndexById, sortAsc, sortCol]);

  return (
    <div className="conf-futures">
      <table className="conf-futures-table">
        <thead>
          <tr>
            <th className="conf-futures-th conf-futures-th--team" onClick={() => handleSort("seed")}>
              Team {sortCol === "seed" ? (sortAsc ? "↑" : "↓") : ""}
            </th>
            {displayRounds.map((round) => (
              <th key={round.id} className="conf-futures-th" onClick={() => handleSort(round.id)}>
                {round.id} {sortCol === round.id ? (sortAsc ? "↑" : "↓") : ""}
              </th>
            ))}
            <th className="conf-futures-th conf-futures-th--champ" onClick={() => handleSort("champ")}>
              Champ {sortCol === "champ" ? (sortAsc ? "↑" : "↓") : ""}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedFutures.map((row) => {
            const team = teamsById.get(row.teamId);
            return (
              <tr key={row.teamId} className="conf-futures-row">
                <td className="conf-futures-td conf-futures-td--team">
                  {team ? (
                    <img src={confTeamLogoUrl(team.name)} alt="" className="conf-futures-logo" loading="lazy" />
                  ) : null}
                  <span className="conf-futures-seed">{row.seed}</span>
                  <span className="conf-futures-name">{row.teamName}</span>
                </td>
                {displayRounds.map((round) => {
                  const prob = getRoundReachProb(row, round.id, roundIds, roundIndexById, entryRoundIndexByTeam);
                  return (
                    <td key={round.id} className="conf-futures-td">
                      {formatOddsDisplay(prob, displayMode).primary}
                    </td>
                  );
                })}
                <td className="conf-futures-td conf-futures-td--champ">
                  {formatOddsDisplay(row.champProb, displayMode).primary}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConfMatchupStatsModal({
  game,
  teamsById,
  onClose,
}: {
  game: ConfResolvedGame;
  teamsById: Map<number, ConfTeamRow>;
  onClose: () => void;
}) {
  const teamA = game.teamAId ? teamsById.get(game.teamAId) ?? null : null;
  const teamB = game.teamBId ? teamsById.get(game.teamBId) ?? null : null;
  const [activeStatDescription, setActiveStatDescription] = useState<TeamStatKey | "importance" | null>(null);
  if (!teamA || !teamB) return null;

  const statsA = TEAM_STATS_2026[teamA.name] ?? null;
  const statsB = TEAM_STATS_2026[teamB.name] ?? null;

  return (
    <div className="matchup-stats-overlay" onClick={onClose}>
      <div className="matchup-stats-modal" onClick={(event) => event.stopPropagation()}>
        <div className="matchup-stats-head">
          <h3>Matchup Stats</h3>
          <button className="matchup-stats-close" onClick={onClose} aria-label="Close matchup stats">
            {CLOSE_ICON_TEXT}
          </button>
        </div>
        <p className="matchup-stats-sub">
          {teamA.seed} {teamA.name} vs {teamB.seed} {teamB.name}
        </p>
        <div className="matchup-stats-table-wrap">
          <table className="matchup-stats-table">
            <thead>
              <tr>
                <th>Stat</th>
                <th>{teamA.name}</th>
                <th>{teamB.name}</th>
                <th>Difference</th>
                <th className="matchup-stats-th-help">
                  <span>Importance %</span>
                  <button
                    type="button"
                    className="matchup-stat-help-btn"
                    aria-label="About Importance percent"
                    onClick={() => setActiveStatDescription((previous) => (previous === "importance" ? null : "importance"))}
                  >
                    {INFO_ICON_TEXT}
                  </button>
                  {activeStatDescription === "importance" ? (
                    <div className="matchup-stat-help-popover matchup-stat-help-popover--header">
                      {IMPORTANCE_HELP_TEXT}
                    </div>
                  ) : null}
                </th>
              </tr>
            </thead>
            <tbody>
              {TEAM_STAT_ORDER.map((key) => {
                const aValue = statsA?.[key] ?? null;
                const bValue = statsB?.[key] ?? null;
                return (
                  <tr key={key}>
                    <td className="matchup-stat-name-cell">
                      <span>{TEAM_STAT_LABELS[key]}</span>
                      <button
                        type="button"
                        className="matchup-stat-help-btn"
                        aria-label={`About ${TEAM_STAT_LABELS[key]}`}
                        onClick={() => setActiveStatDescription((previous) => (previous === key ? null : key))}
                      >
                        {INFO_ICON_TEXT}
                      </button>
                      {activeStatDescription === key ? (
                        <div className="matchup-stat-help-popover">{TEAM_STAT_DESCRIPTIONS[key]}</div>
                      ) : null}
                    </td>
                    <td>{formatStatValue(aValue)}</td>
                    <td>{formatStatValue(bValue)}</td>
                    <td>{differenceForStat(teamA.name, aValue, teamB.name, bValue, key)}</td>
                    <td>{TEAM_STAT_IMPORTANCE[key]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
