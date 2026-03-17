import { useEffect, useMemo, useState } from "react";
import { BRACKET_HALVES, gameTemplates } from "./data/bracket";
import { teamsById } from "./data/teams";
import { getBracketPicks } from "./groupStorage";
import { abbreviationForTeam } from "./lib/abbreviation";
import { resolveGames, type LockedPicks } from "./lib/bracket";
import { teamLogoUrl } from "./lib/logo";
import type { Region, ResolvedGame, Round } from "./types";

type BracketData = {
  id: string;
  bracket_name: string;
  picks: LockedPicks;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
};

export type BracketViewerPerformance = {
  displayName: string;
  bracketName: string;
  rank: number | null;
  score: number | null;
  correctPicks: number | null;
  possiblePicks: number | null;
  isCurrentUser?: boolean;
};

type TeamDisplay = {
  name: string;
  abbr: string;
  seed: string;
  logoUrl: string | null;
};

type TeamRowState = "default" | "pending" | "correct" | "incorrect" | "missing";

const LEFT_REGION_ROUNDS: Round[] = ["R64", "R32", "S16", "E8"];
const RIGHT_REGION_ROUNDS: Round[] = ["E8", "S16", "R32", "R64"];
const FINALS_COLUMNS: Array<{ id: string; label: string }> = [
  { id: "F4-Left-0", label: "F4" },
  { id: "CHAMP-0", label: "CH" },
  { id: "F4-Right-0", label: "F4" },
];

function getTeamDisplay(teamId: string | null): TeamDisplay {
  if (!teamId) {
    return {
      name: "TBD",
      abbr: "TBD",
      seed: "",
      logoUrl: null,
    };
  }

  const team = teamsById.get(teamId);
  if (!team) {
    return {
      name: teamId,
      abbr: teamId,
      seed: "",
      logoUrl: null,
    };
  }

  return {
    name: team.name,
    abbr: abbreviationForTeam(team.name) || team.name,
    seed: team.seedLabel ?? String(team.seed),
    logoUrl: teamLogoUrl(team),
  };
}

function formatOrdinal(rank: number | null) {
  if (typeof rank !== "number" || !Number.isFinite(rank) || rank <= 0) return "—";
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  const mod10 = rank % 10;
  if (mod10 === 1) return `${rank}st`;
  if (mod10 === 2) return `${rank}nd`;
  if (mod10 === 3) return `${rank}rd`;
  return `${rank}th`;
}

function formatScoreValue(value: number | null, resultsAvailable: boolean) {
  if (!resultsAvailable || typeof value !== "number" || !Number.isFinite(value)) return "—";
  return String(value);
}

function formatCorrectValue(correctPicks: number | null, possiblePicks: number | null, resultsAvailable: boolean) {
  if (!resultsAvailable || typeof correctPicks !== "number" || !Number.isFinite(correctPicks)) return "—";
  if (typeof possiblePicks !== "number" || !Number.isFinite(possiblePicks)) return String(correctPicks);
  return `${correctPicks}/${possiblePicks}`;
}

function normalizeTournamentResults(tournamentResults: unknown) {
  const resultsByGame = new Map<string, string>();

  if (tournamentResults instanceof Map) {
    tournamentResults.forEach((winnerTeamId, matchupId) => {
      if (typeof matchupId !== "string" || typeof winnerTeamId !== "string") return;
      resultsByGame.set(matchupId, winnerTeamId);
    });
    return resultsByGame;
  }

  if (Array.isArray(tournamentResults)) {
    tournamentResults.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const row = entry as {
        matchup_id?: unknown;
        winner_team_id?: unknown;
        winner?: unknown;
        winnerTeamId?: unknown;
      };
      const matchupId = typeof row.matchup_id === "string" ? row.matchup_id : null;
      const winnerTeamId =
        typeof row.winner_team_id === "string"
          ? row.winner_team_id
          : typeof row.winner === "string"
            ? row.winner
            : typeof row.winnerTeamId === "string"
              ? row.winnerTeamId
              : null;
      if (!matchupId || !winnerTeamId) return;
      resultsByGame.set(matchupId, winnerTeamId);
    });
    return resultsByGame;
  }

  if (!tournamentResults || typeof tournamentResults !== "object") {
    return resultsByGame;
  }

  if ("results" in (tournamentResults as Record<string, unknown>)) {
    return normalizeTournamentResults((tournamentResults as { results?: unknown }).results);
  }

  Object.entries(tournamentResults as Record<string, unknown>).forEach(([gameId, value]) => {
    if (typeof value === "string") {
      resultsByGame.set(gameId, value);
      return;
    }

    if (!value || typeof value !== "object") return;
    const row = value as {
      matchup_id?: unknown;
      winner_team_id?: unknown;
      winner?: unknown;
      winnerTeamId?: unknown;
    };
    const matchupId = typeof row.matchup_id === "string" ? row.matchup_id : gameId;
    const winnerTeamId =
      typeof row.winner_team_id === "string"
        ? row.winner_team_id
        : typeof row.winner === "string"
          ? row.winner
          : typeof row.winnerTeamId === "string"
            ? row.winnerTeamId
            : null;
    if (!matchupId || !winnerTeamId) return;
    resultsByGame.set(matchupId, winnerTeamId);
  });

  return resultsByGame;
}

function TeamLogo({ team }: { team: TeamDisplay }) {
  const [failed, setFailed] = useState(false);

  if (!team.logoUrl || failed) {
    return (
      <span className="grp-bv-team-logo-fallback" aria-hidden="true">
        {team.seed || "?"}
      </span>
    );
  }

  return (
    <img
      src={team.logoUrl}
      alt={`${team.name} logo`}
      className="grp-bv-team-logo"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function getPickedRowState(game: ResolvedGame, actualWinnerId: string | null): TeamRowState {
  if (!game.winnerId) return "missing";
  if (!actualWinnerId) return "pending";
  return actualWinnerId === game.winnerId ? "correct" : "incorrect";
}

function TeamRow({
  team,
  isPicked,
  rowState,
}: {
  team: TeamDisplay;
  isPicked: boolean;
  rowState: TeamRowState;
}) {
  return (
    <div
      className={[
        "grp-bv-team",
        isPicked ? "grp-bv-team--picked" : "",
        rowState !== "default" ? `grp-bv-team--${rowState}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <TeamLogo team={team} />
      <div className="grp-bv-team-copy">
        <div className="grp-bv-team-main">
          <span className="grp-bv-team-name">{team.abbr}</span>
          {isPicked && rowState === "correct" ? <span className="grp-bv-team-icon">✓</span> : null}
        </div>
        <span className="grp-bv-team-seed">{team.seed ? `#${team.seed}` : "—"}</span>
      </div>
    </div>
  );
}

function GameCard({
  game,
  direction,
  showConnector,
  resultsByGame,
}: {
  game: ResolvedGame;
  direction: "to-left" | "to-right";
  showConnector: boolean;
  resultsByGame: Map<string, string>;
}) {
  const teamA = getTeamDisplay(game.teamAId);
  const teamB = getTeamDisplay(game.teamBId);
  const actualWinnerId = resultsByGame.get(game.id) ?? null;
  const pickedRowState = getPickedRowState(game, actualWinnerId);
  const rowStateA = game.winnerId === game.teamAId ? pickedRowState : pickedRowState === "missing" ? "missing" : "default";
  const rowStateB = game.winnerId === game.teamBId ? pickedRowState : pickedRowState === "missing" ? "missing" : "default";

  return (
    <div
      className={[
        "grp-bv-game",
        `grp-bv-game--${direction}`,
        showConnector ? "grp-bv-game--linked" : "",
        pickedRowState === "missing" ? "grp-bv-game--missing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <TeamRow team={teamA} isPicked={game.winnerId === game.teamAId} rowState={rowStateA} />
      <TeamRow team={teamB} isPicked={game.winnerId === game.teamBId} rowState={rowStateB} />
    </div>
  );
}

function RegionBoard({
  region,
  direction,
  gamesById,
  resultsByGame,
}: {
  region: Region;
  direction: "to-left" | "to-right";
  gamesById: Map<string, ResolvedGame>;
  resultsByGame: Map<string, string>;
}) {
  const rounds = direction === "to-right" ? LEFT_REGION_ROUNDS : RIGHT_REGION_ROUNDS;

  return (
    <section className={`grp-bv-region grp-bv-region--${direction} grp-bv-region--${region.toLowerCase()}`}>
      <div className="grp-bv-region-topline">
        <h3 className="grp-bv-region-title">{region.toUpperCase()}</h3>
      </div>

      <div className="grp-bv-region-grid">
        {rounds.map((round, roundIndex) => {
          const showConnector =
            direction === "to-right" ? roundIndex < rounds.length - 1 : roundIndex > 0;
          const gamesForRound = gameTemplates
            .filter((template) => template.region === region && template.round === round)
            .sort((templateA, templateB) => templateA.slot - templateB.slot)
            .map((template) => gamesById.get(template.id))
            .filter((game): game is ResolvedGame => Boolean(game));

          return (
            <div key={`${region}-${round}`} className="grp-bv-round">
              <div className="grp-bv-round-label">{round}</div>
              <div className="grp-bv-round-games">
                {gamesForRound.map((game) => (
                  <GameCard
                    key={game.id}
                    game={game}
                    direction={direction}
                    showConnector={showConnector}
                    resultsByGame={resultsByGame}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FinalsBoard({
  gamesById,
  resultsByGame,
}: {
  gamesById: Map<string, ResolvedGame>;
  resultsByGame: Map<string, string>;
}) {
  return (
    <section className="grp-bv-finals">
      <div className="grp-bv-region-topline">
        <h3 className="grp-bv-region-title">FINALS</h3>
      </div>

      <div className="grp-bv-finals-grid">
        {FINALS_COLUMNS.map((column) => {
          const game = gamesById.get(column.id);
          return (
            <div key={column.id} className="grp-bv-finals-column">
              <div className="grp-bv-round-label">{column.label}</div>
              {game ? (
                <GameCard
                  game={game}
                  direction={column.id === "F4-Right-0" ? "to-left" : "to-right"}
                  showConnector={false}
                  resultsByGame={resultsByGame}
                />
              ) : (
                <div className="grp-bv-game grp-bv-game--placeholder">
                  <TeamRow team={getTeamDisplay(null)} isPicked={false} rowState="default" />
                  <TeamRow team={getTeamDisplay(null)} isPicked={false} rowState="default" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function GroupBracketViewerSurface({
  bracket,
  tournamentResults,
}: {
  bracket: BracketViewerPerformance & { picks: LockedPicks };
  tournamentResults?: unknown;
}) {
  const resultsByGame = useMemo(() => normalizeTournamentResults(tournamentResults), [tournamentResults]);
  const resultsAvailable = resultsByGame.size > 0;
  const { games } = useMemo(() => resolveGames(bracket.picks ?? ({} as LockedPicks)), [bracket.picks]);
  const gamesById = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);
  const displayName = bracket.isCurrentUser ? "Your Bracket" : bracket.displayName;

  return (
    <div className="grp-bv-surface">
      <div className="grp-bv-header">
        <div className="grp-bv-header-main">
          <h3 className="grp-bv-header-name">{displayName}</h3>
          <span className="grp-bv-header-bracket">{bracket.bracketName || "Bracket submitted"}</span>
        </div>

        <div className="grp-bv-stats">
          <div className="grp-bv-stat-pill">
            <span className="grp-bv-stat-label">RANK</span>
            <span className="grp-bv-stat-value grp-bv-stat-value--amber">
              {resultsAvailable ? formatOrdinal(bracket.rank) : "—"}
            </span>
          </div>

          <div className="grp-bv-stat-pill">
            <span className="grp-bv-stat-label">SCORE</span>
            <span className="grp-bv-stat-value">{formatScoreValue(bracket.score, resultsAvailable)}</span>
          </div>

          <div className="grp-bv-stat-pill">
            <span className="grp-bv-stat-label">CORRECT</span>
            <span className="grp-bv-stat-value grp-bv-stat-value--success">
              {formatCorrectValue(bracket.correctPicks, bracket.possiblePicks, resultsAvailable)}
            </span>
          </div>
        </div>
      </div>

      <div className="grp-bv-board-wrap">
        <div className="grp-bv-board">
          <RegionBoard region={BRACKET_HALVES[0].regions[0]} direction="to-right" gamesById={gamesById} resultsByGame={resultsByGame} />
          <RegionBoard region={BRACKET_HALVES[0].regions[1]} direction="to-left" gamesById={gamesById} resultsByGame={resultsByGame} />
          <FinalsBoard gamesById={gamesById} resultsByGame={resultsByGame} />
          <RegionBoard region={BRACKET_HALVES[1].regions[0]} direction="to-right" gamesById={gamesById} resultsByGame={resultsByGame} />
          <RegionBoard region={BRACKET_HALVES[1].regions[1]} direction="to-left" gamesById={gamesById} resultsByGame={resultsByGame} />
        </div>
      </div>
    </div>
  );
}

export function BracketViewer({
  bracketId,
  displayName,
  bracketName,
  onBack,
  tournamentResults,
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
    void loadBracket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bracketId]);

  async function loadBracket() {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await getBracketPicks(bracketId);
    if (fetchError) {
      setError("Failed to load bracket.");
      setBracket(null);
    } else {
      setBracket(data);
    }
    setLoading(false);
  }

  return (
    <div className="bracket-viewer-overlay">
      <div className="bracket-viewer-header">
        <button className="grp-bv-back-btn" onClick={onBack} type="button">
          ← Back to Group
        </button>
      </div>

      <div className="bracket-viewer-content">
        {loading ? <div className="bracket-viewer-loading">Loading bracket...</div> : null}
        {error ? <div className="bracket-viewer-error">{error}</div> : null}
        {bracket && !loading ? (
          <GroupBracketViewerSurface
            bracket={{
              displayName,
              bracketName: bracket.bracket_name || bracketName,
              picks: bracket.picks,
              rank: null,
              score: null,
              correctPicks: null,
              possiblePicks: null,
            }}
            tournamentResults={tournamentResults}
          />
        ) : null}
      </div>
    </div>
  );
}
