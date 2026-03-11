import { useState, useEffect } from "react";
import { getBracketPicks } from "./groupStorage";
import { teamsById } from "./data/teams";
import { resolveGames, type LockedPicks } from "./lib/bracket";
import { gameTemplates, BRACKET_HALVES } from "./data/bracket";
import { abbreviationForTeam } from "./lib/abbreviation";

type BracketData = {
  id: string;
  bracket_name: string;
  picks: LockedPicks;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
};

export function BracketViewer({
  bracketId,
  displayName,
  bracketName,
  onBack,
}: {
  bracketId: string;
  displayName: string;
  bracketName: string;
  onBack: () => void;
  tournamentResults?: unknown;
}) {
  const [bracket, setBracket] = useState<BracketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadBracket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bracketId]);

  async function loadBracket() {
    setLoading(true);
    const { data, error: fetchError } = await getBracketPicks(bracketId);
    if (fetchError) {
      setError("Failed to load bracket.");
    } else {
      setBracket(data);
    }
    setLoading(false);
  }

  return (
    <div className="bracket-viewer-overlay">
      <div className="bracket-viewer-header">
        <button className="group-detail-back" onClick={onBack}>
          ← Back to Group
        </button>
        <div className="bracket-viewer-title-area">
          <h2 className="bracket-viewer-name">{displayName}&apos;s Bracket</h2>
          <span className="bracket-viewer-bracket-name">{bracketName}</span>
        </div>
      </div>

      <div className="bracket-viewer-content">
        {loading && <div className="bracket-viewer-loading">Loading bracket...</div>}
        {error && <div className="bracket-viewer-error">{error}</div>}
        {bracket && !loading && <ReadOnlyBracket picks={bracket.picks} />}
      </div>
    </div>
  );
}

function ReadOnlyBracket({ picks }: { picks: LockedPicks }) {
  const { games } = resolveGames(picks);
  const gameById = new Map(games.map((g) => [g.id, g]));

  const regions = BRACKET_HALVES.flatMap((h) => h.regions);
  const roundOrder = ["R64", "R32", "S16", "E8"] as const;

  function getTeamDisplay(teamId: string | null) {
    if (!teamId) return { name: "—", seed: "", abbr: "—" };
    const team = teamsById.get(teamId);
    if (!team) return { name: teamId, seed: "", abbr: teamId };
    const abbr = abbreviationForTeam(team.name);
    return { name: team.name, seed: String(team.seed), abbr: abbr || team.name };
  }

  // Final Four and Championship
  const f4Games = games.filter((g) => g.round === "F4");
  const champGame = games.find((g) => g.round === "CHAMP");

  return (
    <div className="bv-bracket">
      {regions.map((region) => (
        <div key={region} className="bv-region">
          <h3 className="bv-region-title">{region}</h3>
          <div className="bv-region-rounds">
            {roundOrder.map((round) => {
              const roundGames = gameTemplates
                .filter((t) => t.region === region && t.round === round)
                .sort((a, b) => a.slot - b.slot);

              return (
                <div key={round} className="bv-round">
                  <div className="bv-round-label">{round}</div>
                  {roundGames.map((template) => {
                    const game = gameById.get(template.id);
                    if (!game) return null;

                    const teamA = getTeamDisplay(game.teamAId);
                    const teamB = getTeamDisplay(game.teamBId);
                    const winnerId = game.winnerId;

                    return (
                      <div key={template.id} className="bv-game">
                        <div
                          className={`bv-team ${winnerId === game.teamAId ? "bv-team--winner" : ""} ${game.teamAId && winnerId && winnerId !== game.teamAId ? "bv-team--loser" : ""}`}
                        >
                          <span className="bv-seed">{teamA.seed}</span>
                          <span className="bv-name">{teamA.abbr}</span>
                        </div>
                        <div
                          className={`bv-team ${winnerId === game.teamBId ? "bv-team--winner" : ""} ${game.teamBId && winnerId && winnerId !== game.teamBId ? "bv-team--loser" : ""}`}
                        >
                          <span className="bv-seed">{teamB.seed}</span>
                          <span className="bv-name">{teamB.abbr}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="bv-final-four">
        <h3 className="bv-region-title">Final Four &amp; Championship</h3>
        <div className="bv-ff-games">
          {f4Games.map((game) => {
            const teamA = getTeamDisplay(game.teamAId);
            const teamB = getTeamDisplay(game.teamBId);
            return (
              <div key={game.id} className="bv-game">
                <div className={`bv-team ${game.winnerId === game.teamAId ? "bv-team--winner" : ""}`}>
                  <span className="bv-seed">{teamA.seed}</span>
                  <span className="bv-name">{teamA.abbr}</span>
                </div>
                <div className={`bv-team ${game.winnerId === game.teamBId ? "bv-team--winner" : ""}`}>
                  <span className="bv-seed">{teamB.seed}</span>
                  <span className="bv-name">{teamB.abbr}</span>
                </div>
              </div>
            );
          })}
          {champGame && (
            <div className="bv-game bv-game--champ">
              <div className={`bv-team ${champGame.winnerId === champGame.teamAId ? "bv-team--winner" : ""}`}>
                <span className="bv-seed">{getTeamDisplay(champGame.teamAId).seed}</span>
                <span className="bv-name">{getTeamDisplay(champGame.teamAId).abbr}</span>
              </div>
              <div className={`bv-team ${champGame.winnerId === champGame.teamBId ? "bv-team--winner" : ""}`}>
                <span className="bv-seed">{getTeamDisplay(champGame.teamBId).seed}</span>
                <span className="bv-name">{getTeamDisplay(champGame.teamBId).abbr}</span>
              </div>
            </div>
          )}
          {champGame?.winnerId && (
            <div className="bv-champion-banner">
              🏆 Champion: {getTeamDisplay(champGame.winnerId).seed} {getTeamDisplay(champGame.winnerId).name}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
