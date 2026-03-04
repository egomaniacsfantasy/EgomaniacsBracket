import { useState, useMemo, useCallback } from "react";
import type { OddsDisplayMode } from "../types";
import type { ConfResolvedGame, ConfSimulationOutput } from "./types";
import type { ConfLockedPicks, ConfCustomProbByGame } from "./confBracket";
import { CONFERENCE_DEFS, CONFERENCE_DEFS_BY_ID } from "./conferenceDefs";
import { CONF_TEAMS } from "./data/confTeams";
import { buildConferenceBracket } from "./bracketBuilder";
import { resolveConfGames, getConfGameWinProb } from "./confBracket";
import { runConfSimulation } from "./simulation";
import { getMappedEspnLogoPath } from "../lib/logoMap";
import { formatOddsDisplay } from "../lib/odds";

const SIM_RUNS = 2000;

function confTeamLogoUrl(name: string): string {
  const mapped = getMappedEspnLogoPath(name);
  if (mapped) return mapped;
  const initials = name
    .replace(/[^a-zA-Z\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return `https://placehold.co/64x64/1b1107/f0e4c6.png?text=${encodeURIComponent(initials || "TM")}`;
}

// ─── Main Component ───

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
        onLocksChange={(newLocks) =>
          setLocks((prev) => ({ ...prev, [selectedConf]: newLocks }))
        }
        onCustomProbsChange={(newProbs) =>
          setCustomProbs((prev) => ({ ...prev, [selectedConf]: newProbs }))
        }
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
            <button
              key={def.id}
              className="conf-selector-card"
              onClick={() => setSelectedConf(def.id)}
            >
              {topTeam && (
                <img
                  src={confTeamLogoUrl(topTeam.name)}
                  alt=""
                  className="conf-selector-logo"
                  loading="lazy"
                />
              )}
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

// ─── Conference Bracket View ───

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
  const def = CONFERENCE_DEFS_BY_ID[confId];
  const teams = CONF_TEAMS[confId] ?? [];
  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  // Build bracket game templates
  const gameTemplates = useMemo(
    () => (def ? buildConferenceBracket(def, teams) : []),
    [def, teams]
  );

  const roundOrder = useMemo(() => (def ? def.rounds.map((r) => r.id) : []), [def]);

  // Resolve games from templates + locks
  const { games: resolvedGames, sanitized } = useMemo(
    () => resolveConfGames(gameTemplates, roundOrder, locks, customProbs),
    [gameTemplates, roundOrder, locks, customProbs]
  );

  // Run simulation
  const simOutput = useMemo(
    () =>
      def
        ? runConfSimulation(confId, def, gameTemplates, teams, sanitized, SIM_RUNS, customProbs)
        : null,
    [confId, def, gameTemplates, teams, sanitized, customProbs]
  );

  // Group games by round
  const gamesByRound = useMemo(() => {
    const map = new Map<string, ConfResolvedGame[]>();
    for (const round of roundOrder) {
      map.set(
        round,
        resolvedGames.filter((g) => g.round === round).sort((a, b) => a.slot - b.slot)
      );
    }
    return map;
  }, [resolvedGames, roundOrder]);

  const handlePick = useCallback(
    (game: ConfResolvedGame, teamId: number | null) => {
      const newLocks = { ...locks };
      if (teamId === null || (locks[game.id] === teamId)) {
        delete newLocks[game.id];
      } else {
        newLocks[game.id] = teamId;
      }
      onLocksChange(newLocks);
    },
    [locks, onLocksChange]
  );

  // Mobile round navigation
  const [mobileRound, setMobileRound] = useState(roundOrder[0] ?? "");

  const [showFutures, setShowFutures] = useState(false);

  if (!def) return null;

  return (
    <div className="conf-bracket-page">
      <div className="conf-bracket-toolbar">
        <button className="eg-btn conf-back-btn" onClick={onBack}>
          ← Back
        </button>
        <h2 className="conf-bracket-title">{def.name}</h2>
        <button
          className={`eg-btn conf-futures-toggle ${showFutures ? "conf-futures-toggle--active" : ""}`}
          onClick={() => setShowFutures((p) => !p)}
        >
          {showFutures ? "Bracket" : "Odds"}
        </button>
      </div>

      {showFutures && simOutput ? (
        <ConferenceFutures
          confId={confId}
          def={def}
          futures={simOutput.futures}
          displayMode={displayMode}
          teamsById={teamsById}
        />
      ) : (
        <>
          {isMobile && (
            <div className="conf-round-pills">
              {def.rounds.map((r) => (
                <button
                  key={r.id}
                  className={`conf-round-pill ${mobileRound === r.id ? "conf-round-pill--active" : ""}`}
                  onClick={() => setMobileRound(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}

          <div className={`conf-bracket-grid ${isMobile ? "conf-bracket-grid--mobile" : ""}`}>
            {def.rounds.map((roundDef) => {
              if (isMobile && roundDef.id !== mobileRound) return null;
              const roundGames = gamesByRound.get(roundDef.id) ?? [];
              return (
                <div key={roundDef.id} className="conf-round-col">
                  <p className="conf-round-label">{roundDef.label}</p>
                  <div className="conf-games-lane">
                    {roundGames.map((game, idx) => {
                      const topPercent = ((idx + 0.5) / Math.max(1, roundGames.length)) * 100;
                      return (
                        <div
                          key={game.id}
                          className="conf-game-node"
                          style={!isMobile ? { top: `${topPercent}%` } : undefined}
                        >
                          <ConfGameCard
                            game={game}
                            confId={confId}
                            def={def}
                            teamsById={teamsById}
                            displayMode={displayMode}
                            simOutput={simOutput}
                            onPick={handlePick}
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
    </div>
  );
}

// ─── Conference Game Card ───

function ConfGameCard({
  game,
  confId,
  def,
  teamsById,
  displayMode,
  simOutput,
  onPick,
  isLocked,
}: {
  game: ConfResolvedGame;
  confId: string;
  def: typeof CONFERENCE_DEFS_BY_ID[string];
  teamsById: Map<number, (typeof CONF_TEAMS)[string][number]>;
  displayMode: OddsDisplayMode;
  simOutput: ConfSimulationOutput | null;
  onPick: (game: ConfResolvedGame, teamId: number | null) => void;
  isLocked: boolean;
}) {
  const teamA = game.teamAId ? teamsById.get(game.teamAId) : null;
  const teamB = game.teamBId ? teamsById.get(game.teamBId) : null;

  // Get win probabilities from simulation output (game-level) or model
  let probA: number | null = null;
  let probB: number | null = null;
  if (simOutput && game.teamAId && game.teamBId) {
    const gwp = simOutput.gameWinProbs[game.id];
    if (gwp) {
      const entryA = gwp.find((e) => e.teamId === game.teamAId);
      const entryB = gwp.find((e) => e.teamId === game.teamBId);
      probA = entryA?.prob ?? null;
      probB = entryB?.prob ?? null;
    }
  }
  if (probA === null && game.teamAId && game.teamBId) {
    probA = getConfGameWinProb(game, game.teamAId, confId, def, teamsById);
    probB = probA !== null ? 1 - probA : null;
  }

  const renderTeamRow = (
    teamId: number | null,
    team: (typeof CONF_TEAMS)[string][number] | null | undefined,
    prob: number | null,
    position: "top" | "bottom"
  ) => {
    const isWinner = game.winnerId === teamId;
    const isLoser = game.winnerId !== null && game.winnerId !== teamId;
    const odds = prob !== null ? formatOddsDisplay(prob, displayMode) : null;

    return (
      <button
        className={`conf-team-row ${position} ${isWinner ? "conf-team-row--winner" : ""} ${isLoser ? "conf-team-row--loser" : ""}`}
        onClick={() => {
          if (!teamId) return;
          onPick(game, isWinner ? null : teamId);
        }}
        disabled={!teamId}
      >
        {team ? (
          <>
            <img src={confTeamLogoUrl(team.name)} alt="" className="conf-team-logo" loading="lazy" />
            <span className="conf-team-seed">{team.seed}</span>
            <span className="conf-team-name">{team.name}</span>
            {odds && <span className="conf-team-odds">{odds.primary}</span>}
          </>
        ) : (
          <span className="conf-team-tbd">TBD</span>
        )}
      </button>
    );
  };

  return (
    <div className={`conf-game-card ${isLocked ? "conf-game-card--locked" : ""}`}>
      {renderTeamRow(game.teamAId, teamA, probA, "top")}
      {renderTeamRow(game.teamBId, teamB, probB, "bottom")}
    </div>
  );
}

// ─── Conference Futures Table ───

function ConferenceFutures({
  confId: _confId,
  def,
  futures,
  displayMode,
  teamsById,
}: {
  confId: string;
  def: typeof CONFERENCE_DEFS_BY_ID[string];
  futures: ConfSimulationOutput["futures"];
  displayMode: OddsDisplayMode;
  teamsById: Map<number, (typeof CONF_TEAMS)[string][number]>;
}) {
  const [sortCol, setSortCol] = useState<string>("champ");
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (col: string) => {
    if (col === sortCol) {
      setSortAsc((p) => !p);
    } else {
      setSortCol(col);
      setSortAsc(false);
    }
  };

  const sortedFutures = useMemo(() => {
    const sorted = [...futures];
    sorted.sort((a, b) => {
      let va: number, vb: number;
      if (sortCol === "champ") {
        va = a.champProb;
        vb = b.champProb;
      } else if (sortCol === "seed") {
        va = a.seed;
        vb = b.seed;
      } else {
        va = a.roundProbs[sortCol] ?? 0;
        vb = b.roundProbs[sortCol] ?? 0;
      }
      return sortAsc ? va - vb : vb - va;
    });
    return sorted;
  }, [futures, sortCol, sortAsc]);

  // Only show rounds from QF onwards for the futures table
  const displayRounds = def.rounds.filter(
    (r) => r.id === "QF" || r.id === "SF" || r.id === "F"
  );

  return (
    <div className="conf-futures">
      <table className="conf-futures-table">
        <thead>
          <tr>
            <th className="conf-futures-th conf-futures-th--team" onClick={() => handleSort("seed")}>
              Team {sortCol === "seed" ? (sortAsc ? "↑" : "↓") : ""}
            </th>
            {displayRounds.map((r) => (
              <th key={r.id} className="conf-futures-th" onClick={() => handleSort(r.id)}>
                {r.label} {sortCol === r.id ? (sortAsc ? "↑" : "↓") : ""}
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
                  {team && (
                    <img
                      src={confTeamLogoUrl(team.name)}
                      alt=""
                      className="conf-futures-logo"
                      loading="lazy"
                    />
                  )}
                  <span className="conf-futures-seed">{row.seed}</span>
                  <span className="conf-futures-name">{row.teamName}</span>
                </td>
                {displayRounds.map((r) => {
                  const prob = row.roundProbs[r.id] ?? 0;
                  const odds = formatOddsDisplay(prob, displayMode);
                  return (
                    <td key={r.id} className="conf-futures-td">
                      {odds.primary}
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
