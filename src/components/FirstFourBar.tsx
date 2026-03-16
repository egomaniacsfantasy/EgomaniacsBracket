import { teamsById } from "../data/teams";
import { getGameWinProb, getModelGameWinProb } from "../lib/bracket";
import { formatOddsDisplay } from "../lib/odds";
import { teamLogoUrl } from "../lib/logo";
import type { OddsDisplayMode, ResolvedGame, SimulationOutput } from "../types";

function seedLabel(team: NonNullable<ReturnType<typeof teamsById.get>>) {
  return team.seedLabel ?? String(team.seed);
}

function TeamLogo({ teamName, src, className, teamSeed }: { teamName: string; src: string; className?: string; teamSeed?: string }) {
  return (
    <img
      src={src}
      alt={teamName}
      className={className}
      loading="lazy"
      onError={(e) => {
        const img = e.currentTarget;
        if (!img.dataset.fallback) {
          img.dataset.fallback = "1";
          img.src = `https://www.ncaa.com/sites/default/files/images/logos/schools/bgd/${teamName.toLowerCase().replace(/[^a-z]/g, "-")}.svg`;
        }
      }}
    />
  );
}

interface FirstFourBarProps {
  playInGames: ResolvedGame[];
  gameWinProbs: SimulationOutput["gameWinProbs"];
  displayMode: OddsDisplayMode;
  expanded: boolean;
  onPick: (gameId: string, teamId: string | null) => void;
  onRandomize: () => void;
}

export function FirstFourBar({
  playInGames,
  gameWinProbs,
  displayMode,
  expanded,
  onPick,
  onRandomize,
}: FirstFourBarProps) {
  const decidedCount = playInGames.filter((g) => Boolean(g.winnerId)).length;
  const allDecided = playInGames.length > 0 && decidedCount === playInGames.length;

  return (
    <div className={`ff-bar-wrapper ${expanded ? "expanded" : "collapsed"}`}>
      <div className="ff-bar">
        <div className="ff-bar-header">
          <div className="ff-bar-header-left">
            <span className="ff-bar-label">FIRST FOUR</span>
            {decidedCount === 0 ? (
              <span className="ff-bar-subtitle">Pick the winners to set your Round of 64 field.</span>
            ) : null}
          </div>
          <div className="ff-bar-header-right">
            {!allDecided ? (
              <button type="button" className="ff-bar-pick-btn" onClick={onRandomize}>
                🎲 Pick for me
              </button>
            ) : null}
            <span className="ff-bar-progress">
              {allDecided ? (
                <span className="ff-bar-progress--done">✓ All decided</span>
              ) : (
                `${decidedCount}/${playInGames.length} decided`
              )}
            </span>
          </div>
        </div>

        <div className="ff-bar-grid">
          {playInGames.map((game) => (
            <FirstFourBarCard
              key={game.id}
              game={game}
              gameWinProbs={gameWinProbs}
              displayMode={displayMode}
              onPick={(teamId) => onPick(game.id, teamId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FirstFourBarCard({
  game,
  gameWinProbs,
  displayMode,
  onPick,
}: {
  game: ResolvedGame;
  gameWinProbs: SimulationOutput["gameWinProbs"];
  displayMode: OddsDisplayMode;
  onPick: (teamId: string) => void;
}) {
  const teamA = game.teamAId ? teamsById.get(game.teamAId) ?? null : null;
  const teamB = game.teamBId ? teamsById.get(game.teamBId) ?? null : null;
  if (!teamA || !teamB) return null;

  const probA = getGameWinProb(game, teamA.id, gameWinProbs) ?? getModelGameWinProb(game, teamA.id) ?? 0.5;
  const probB = 1 - probA;
  const winner = game.winnerId;
  const decided = Boolean(winner);

  const formatProb = (prob: number): string => formatOddsDisplay(prob, displayMode).primary;

  return (
    <div className={`ff-bar-card ${decided ? "ff-bar-card--decided" : ""}`}>
      <div className="ff-bar-card-header">
        <span className="ff-bar-card-region">PLAY-IN · {(teamA.region || "").toUpperCase()}</span>
        <span className="ff-bar-card-seed">
          Seed {seedLabel(teamA).replace(/[ab]$/i, "")}
          {decided ? <span className="ff-bar-card-check">✓</span> : null}
        </span>
      </div>

      <div className="ff-bar-matchup">
        <button
          type="button"
          className={`ff-bar-team ${winner === teamA.id ? "ff-bar-team--picked" : ""} ${winner && winner !== teamA.id ? "ff-bar-team--loser" : ""}`}
          onClick={() => onPick(teamA.id)}
        >
          <div className="ff-bar-team-info">
            <span className="ff-bar-team-seed">{seedLabel(teamA)}</span>
            <TeamLogo teamName={teamA.name} src={teamLogoUrl(teamA)} className="ff-bar-team-logo" teamSeed={seedLabel(teamA)} />
            <span className="ff-bar-team-name">{teamA.name}</span>
          </div>
          <span className="ff-bar-team-odds">{formatProb(probA)}</span>
        </button>

        <span className="ff-bar-vs">vs</span>

        <button
          type="button"
          className={`ff-bar-team ${winner === teamB.id ? "ff-bar-team--picked" : ""} ${winner && winner !== teamB.id ? "ff-bar-team--loser" : ""}`}
          onClick={() => onPick(teamB.id)}
        >
          <div className="ff-bar-team-info">
            <span className="ff-bar-team-seed">{seedLabel(teamB)}</span>
            <TeamLogo teamName={teamB.name} src={teamLogoUrl(teamB)} className="ff-bar-team-logo" teamSeed={seedLabel(teamB)} />
            <span className="ff-bar-team-name">{teamB.name}</span>
          </div>
          <span className="ff-bar-team-odds">{formatProb(probB)}</span>
        </button>
      </div>
    </div>
  );
}
