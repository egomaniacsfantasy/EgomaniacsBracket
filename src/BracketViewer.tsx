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
  id: string | null;
  name: string;
  abbr: string;
  seed: string;
  logoUrl: string | null;
};

type TeamRowState = "default" | "correct" | "incorrect" | "missing";
type RegionDirection = "to-right" | "to-left";

const LEFT_REGION_ROUNDS: Round[] = ["R64", "R32", "S16", "E8"];
const RIGHT_REGION_ROUNDS: Round[] = ["E8", "S16", "R32", "R64"];

function getRoundTemplates(region: Region, round: Round) {
  return gameTemplates
    .filter((template) => template.region === region && template.round === round)
    .sort((templateA, templateB) => templateA.slot - templateB.slot);
}

function getTeamDisplay(teamId: string | null): TeamDisplay {
  if (!teamId) {
    return {
      id: null,
      name: "TBD",
      abbr: "TBD",
      seed: "—",
      logoUrl: null,
    };
  }

  const team = teamsById.get(teamId);
  if (!team) {
    return {
      id: teamId,
      name: teamId,
      abbr: teamId,
      seed: "—",
      logoUrl: null,
    };
  }

  return {
    id: team.id,
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

function getPickedRowState(game: ResolvedGame, actualWinnerId: string | null): TeamRowState {
  if (!game.winnerId) return "missing";
  if (!actualWinnerId) return "default";
  return actualWinnerId === game.winnerId ? "correct" : "incorrect";
}

function TeamLogo({ team, large = false }: { team: TeamDisplay; large?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const shouldFallback = !team.logoUrl || failedUrl === team.logoUrl;

  if (shouldFallback) {
    return (
      <span
        className={[
          "grp-bv-logo-fallback",
          large ? "grp-bv-logo-fallback--large" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-hidden="true"
      >
        {team.abbr.slice(0, 1)}
      </span>
    );
  }

  return (
    <img
      src={team.logoUrl ?? undefined}
      alt={`${team.name} logo`}
      className={large ? "grp-bv-logo grp-bv-logo--large" : "grp-bv-logo"}
      loading="lazy"
      onError={() => setFailedUrl(team.logoUrl ?? null)}
    />
  );
}

function TeamRow({
  team,
  isPicked,
  rowState,
  faded,
}: {
  team: TeamDisplay;
  isPicked: boolean;
  rowState: TeamRowState;
  faded: boolean;
}) {
  return (
    <div
      className={[
        "grp-bv-team-row",
        isPicked ? "grp-bv-team-row--picked" : "",
        faded ? "grp-bv-team-row--faded" : "",
        rowState !== "default" ? `grp-bv-team-row--${rowState}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="grp-bv-team-seed">{team.seed}</span>
      <TeamLogo team={team} />
      <span className="grp-bv-team-name" title={team.name}>
        {team.abbr}
      </span>
      {isPicked && rowState === "correct" ? <span className="grp-bv-team-check">✓</span> : null}
    </div>
  );
}

function PlaceholderSlot() {
  const placeholder = getTeamDisplay(null);

  return (
    <div className="grp-bv-slot grp-bv-slot--placeholder">
      <TeamRow team={placeholder} isPicked={false} rowState="missing" faded={false} />
      <TeamRow team={placeholder} isPicked={false} rowState="missing" faded={false} />
    </div>
  );
}

function GameSlot({
  game,
  className = "",
  resultsByGame,
}: {
  game: ResolvedGame;
  className?: string;
  resultsByGame: Map<string, string>;
}) {
  const teamA = getTeamDisplay(game.teamAId);
  const teamB = getTeamDisplay(game.teamBId);
  const actualWinnerId = resultsByGame.get(game.id) ?? null;
  const pickedRowState = getPickedRowState(game, actualWinnerId);
  const hasPick = Boolean(game.winnerId);

  return (
    <div className={["grp-bv-slot", className, hasPick ? "" : "grp-bv-slot--missing"].filter(Boolean).join(" ")}>
      <TeamRow
        team={teamA}
        isPicked={game.winnerId === game.teamAId}
        rowState={hasPick ? (game.winnerId === game.teamAId ? pickedRowState : "default") : "missing"}
        faded={hasPick && game.winnerId !== game.teamAId}
      />
      <TeamRow
        team={teamB}
        isPicked={game.winnerId === game.teamBId}
        rowState={hasPick ? (game.winnerId === game.teamBId ? pickedRowState : "default") : "missing"}
        faded={hasPick && game.winnerId !== game.teamBId}
      />
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
  direction: RegionDirection;
  gamesById: Map<string, ResolvedGame>;
  resultsByGame: Map<string, string>;
}) {
  const rounds = direction === "to-right" ? LEFT_REGION_ROUNDS : RIGHT_REGION_ROUNDS;

  return (
    <section className={`grp-bv-region grp-bv-region--${direction} grp-bv-region--${region.toLowerCase()}`}>
      <div className="grp-bv-region-label">{region}</div>

      <div className="grp-bv-region-rounds">
        {rounds.map((round) => {
          const gamesForRound = getRoundTemplates(region, round)
            .map((template) => gamesById.get(template.id))
            .filter((game): game is ResolvedGame => Boolean(game));

          return (
            <div key={`${region}-${round}`} className="grp-bv-round-column">
              <div className="grp-bv-round-heading">{round}</div>
              <div className="grp-bv-round-stack">
                {gamesForRound.length > 0
                  ? gamesForRound.map((game) => <GameSlot key={game.id} game={game} resultsByGame={resultsByGame} />)
                  : <PlaceholderSlot />}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ChampionBadge({
  championship,
  resultsByGame,
}: {
  championship: ResolvedGame | null;
  resultsByGame: Map<string, string>;
}) {
  const championTeam = getTeamDisplay(championship?.winnerId ?? null);
  const actualWinnerId = championship ? resultsByGame.get(championship.id) ?? null : null;
  const state = championship ? getPickedRowState(championship, actualWinnerId) : "missing";

  return (
    <div
      className={[
        "grp-bv-champion",
        state === "correct" ? "grp-bv-champion--correct" : "",
        state === "incorrect" ? "grp-bv-champion--incorrect" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="grp-bv-champion-trophy" aria-hidden="true">
        🏆
      </span>
      <TeamLogo team={championTeam} large />
      <span className="grp-bv-champion-name">{championTeam.name === "TBD" ? "Champion TBD" : championTeam.name}</span>
    </div>
  );
}

function FinalsBoard({
  gamesById,
  resultsByGame,
}: {
  gamesById: Map<string, ResolvedGame>;
  resultsByGame: Map<string, string>;
}) {
  const topSemifinal = gamesById.get("F4-Left-0") ?? null;
  const bottomSemifinal = gamesById.get("F4-Right-0") ?? null;
  const championship = gamesById.get("CHAMP-0") ?? null;

  return (
    <section className="grp-bv-finals">
      <div className="grp-bv-finals-section">
        <div className="grp-bv-round-heading">F4</div>
        {topSemifinal ? <GameSlot game={topSemifinal} resultsByGame={resultsByGame} className="grp-bv-slot--final" /> : <PlaceholderSlot />}
      </div>

      <div className="grp-bv-finals-section grp-bv-finals-section--champ">
        <div className="grp-bv-round-heading">Champ</div>
        {championship ? <GameSlot game={championship} resultsByGame={resultsByGame} className="grp-bv-slot--championship" /> : <PlaceholderSlot />}
        <ChampionBadge championship={championship} resultsByGame={resultsByGame} />
      </div>

      <div className="grp-bv-finals-section">
        <div className="grp-bv-round-heading">F4</div>
        {bottomSemifinal ? <GameSlot game={bottomSemifinal} resultsByGame={resultsByGame} className="grp-bv-slot--final" /> : <PlaceholderSlot />}
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
  const { games } = useMemo(() => resolveGames(bracket.picks ?? {}), [bracket.picks]);
  const gamesById = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);
  const displayName = bracket.isCurrentUser ? "Your Bracket" : bracket.displayName;

  return (
    <div className="grp-bv-panel">
      <div className="grp-bv-scorebar">
        <div className="grp-bv-scorebar-main">
          <h3 className="grp-bv-scorebar-name">{displayName}</h3>
          <div className="grp-bv-scorebar-bracket">{bracket.bracketName || "Bracket submitted"}</div>
        </div>

        <div className="grp-bv-scorebar-stats">
          <div className="grp-bv-stat">
            <span className="grp-bv-stat-label">Rank</span>
            <span className="grp-bv-stat-value grp-bv-stat-value--amber">
              {resultsAvailable ? formatOrdinal(bracket.rank) : "—"}
            </span>
          </div>

          <div className="grp-bv-stat">
            <span className="grp-bv-stat-label">Score</span>
            <span className="grp-bv-stat-value">{formatScoreValue(bracket.score, resultsAvailable)}</span>
          </div>

          <div className="grp-bv-stat">
            <span className="grp-bv-stat-label">Correct</span>
            <span className="grp-bv-stat-value grp-bv-stat-value--success">
              {formatCorrectValue(bracket.correctPicks, bracket.possiblePicks, resultsAvailable)}
            </span>
          </div>
        </div>
      </div>

      <div className="grp-bv-scroll">
        <div className="grp-bv-board-grid">
          <RegionBoard
            region={BRACKET_HALVES[0].regions[0]}
            direction="to-right"
            gamesById={gamesById}
            resultsByGame={resultsByGame}
          />
          <FinalsBoard gamesById={gamesById} resultsByGame={resultsByGame} />
          <RegionBoard
            region={BRACKET_HALVES[0].regions[1]}
            direction="to-left"
            gamesById={gamesById}
            resultsByGame={resultsByGame}
          />
          <RegionBoard
            region={BRACKET_HALVES[1].regions[0]}
            direction="to-right"
            gamesById={gamesById}
            resultsByGame={resultsByGame}
          />
          <RegionBoard
            region={BRACKET_HALVES[1].regions[1]}
            direction="to-left"
            gamesById={gamesById}
            resultsByGame={resultsByGame}
          />
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
