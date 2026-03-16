import { useState } from "react";
import { teamsById } from "../data/teams";
import { getGameWinProb, getModelGameWinProb } from "../lib/bracket";
import { teamLogoUrl } from "../lib/logo";
import { formatOddsDisplay } from "../lib/odds";
import type { OddsDisplayMode, ResolvedGame, SimulationOutput, Team } from "../types";

function playInSeedLabel(team: Team): string {
  return team.seedLabel ?? String(team.seed);
}

function FirstFourBarTeamLogo({
  team,
  className,
}: {
  team: Team;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const classNames = className ? `ff-bar-team-logo ${className}` : "ff-bar-team-logo";

  if (failed) {
    return <span className={`${classNames} ff-bar-team-logo--fallback`}>{playInSeedLabel(team)}</span>;
  }

  return (
    <img
      className={classNames}
      src={teamLogoUrl(team)}
      alt={`${team.name} logo`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function FirstFourBarCard({
  game,
  gameWinProbs,
  displayMode,
  lastPickedKey,
  onPick,
}: {
  game: ResolvedGame;
  gameWinProbs: SimulationOutput["gameWinProbs"];
  displayMode: OddsDisplayMode;
  lastPickedKey: string | null;
  onPick: (game: ResolvedGame, teamId: string) => void;
}) {
  const teamA = game.teamAId ? teamsById.get(game.teamAId) ?? null : null;
  const teamB = game.teamBId ? teamsById.get(game.teamBId) ?? null : null;
  if (!teamA || !teamB) return null;

  const probA = getGameWinProb(game, teamA.id, gameWinProbs) ?? getModelGameWinProb(game, teamA.id) ?? 0.5;
  const probB = 1 - probA;
  const winnerId = game.winnerId;
  const seedLabel = playInSeedLabel(teamA).replace(/[ab]$/i, "");

  const renderTeamButton = (team: Team, prob: number, opponentProb: number) => {
    const isWinner = winnerId === team.id;
    const isLoser = Boolean(winnerId && winnerId !== team.id);
    const isFreshPick = lastPickedKey === `${game.id}:${team.id}`;

    return (
      <button
        key={team.id}
        type="button"
        className={[
          "ff-bar-team",
          isWinner ? "ff-bar-team--picked" : "",
          isLoser ? "ff-bar-team--loser" : "",
          isFreshPick ? "ff-bar-team--fresh" : "",
        ].filter(Boolean).join(" ")}
        disabled={isLoser}
        aria-pressed={isWinner}
        onClick={() => onPick(game, team.id)}
      >
        <span className="ff-bar-team-top">
          <span className="ff-bar-team-seed">{playInSeedLabel(team)}</span>
          <FirstFourBarTeamLogo team={team} />
          <span className="ff-bar-team-name">{team.name}</span>
        </span>
        <span
          className={`ff-bar-team-odds ${prob >= opponentProb ? "ff-bar-team-odds--favorite" : "ff-bar-team-odds--underdog"}`}
        >
          {formatOddsDisplay(prob, displayMode).primary}
        </span>
      </button>
    );
  };

  return (
    <article className={`ff-bar-card ${winnerId ? "ff-bar-card--decided" : ""}`}>
      <div className="ff-bar-card-header">
        <span className="ff-bar-card-label">PLAY-IN · {teamA.region.toUpperCase()}</span>
        <span className="ff-bar-card-meta">
          <span className="ff-bar-card-seed">Seed {seedLabel}</span>
          {winnerId ? <span className="ff-bar-card-check">✓</span> : null}
        </span>
      </div>
      <div className="ff-bar-matchup">
        {renderTeamButton(teamA, probA, probB)}
        <span className="ff-bar-vs">vs</span>
        {renderTeamButton(teamB, probB, probA)}
      </div>
    </article>
  );
}

export function FirstFourBar({
  games,
  gameWinProbs,
  displayMode,
  expanded,
  lastPickedKey,
  onPick,
  onRandomize,
}: {
  games: ResolvedGame[];
  gameWinProbs: SimulationOutput["gameWinProbs"];
  displayMode: OddsDisplayMode;
  expanded: boolean;
  lastPickedKey: string | null;
  onPick: (game: ResolvedGame, teamId: string) => void;
  onRandomize: () => void;
}) {
  if (games.length === 0) return null;

  const decidedCount = games.filter((game) => Boolean(game.winnerId)).length;
  const allDecided = decidedCount === games.length;

  return (
    <div className={`ff-bar-wrapper ${expanded ? "expanded" : "collapsed"}`} aria-hidden={!expanded}>
      <section className="ff-bar">
        <div className="ff-bar-header">
          <div className="ff-bar-header-copy">
            <span className="ff-bar-label">FIRST FOUR</span>
            {decidedCount === 0 ? (
              <span className="ff-bar-subtitle">Pick the winners to set your Round of 64 field.</span>
            ) : null}
          </div>
          <div className="ff-bar-header-actions">
            {!allDecided ? (
              <button type="button" className="ff-bar-pick-btn" onClick={onRandomize}>
                🎲 Pick for me
              </button>
            ) : null}
            <span className={`ff-bar-progress ${allDecided ? "ff-bar-progress--done" : ""}`}>
              {allDecided ? "✓ All decided" : `${decidedCount}/${games.length} decided`}
            </span>
          </div>
        </div>

        <div className="ff-bar-grid">
          {games.map((game) => (
            <FirstFourBarCard
              key={game.id}
              game={game}
              gameWinProbs={gameWinProbs}
              displayMode={displayMode}
              lastPickedKey={lastPickedKey}
              onPick={onPick}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
