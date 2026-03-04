import type { ConfGameTemplate, ConfResolvedGame } from "./types";
import type { ConfDefWithProbMap } from "./conferenceDefs";
import type { ConfTeam } from "./data/confTeams";
import { CONF_MATCHUP_PROBS } from "./data/confMatchupProbs";
import { winProb } from "../lib/odds";

export type ConfLockedPicks = Record<string, number>; // gameId → winning teamId
export type ConfCustomProbByGame = Record<string, number | null | undefined>;

/**
 * Look up the win probability for teamA vs teamB in a given conference round.
 * Falls back to Elo-based calculation if no pre-computed probability exists.
 */
export function getConfMatchupProb(
  confId: string,
  def: ConfDefWithProbMap,
  teamAId: number,
  teamBId: number,
  roundId: string,
  teamsById: Map<number, ConfTeam>
): number {
  const confProbs = CONF_MATCHUP_PROBS[confId];
  const probRoundLabel = def.probRoundMap[roundId] ?? roundId;

  if (confProbs) {
    // Try direct lookup
    const keyAB = `${teamAId}|${teamBId}|${probRoundLabel}`;
    if (keyAB in confProbs) return confProbs[keyAB];

    // Try reverse lookup
    const keyBA = `${teamBId}|${teamAId}|${probRoundLabel}`;
    if (keyBA in confProbs) return 1 - confProbs[keyBA];
  }

  // Fallback to Elo
  const teamA = teamsById.get(teamAId);
  const teamB = teamsById.get(teamBId);
  if (teamA && teamB) return winProb(teamA.elo, teamB.elo);
  return 0.5;
}

/**
 * Get the win probability for a specific team in a resolved game.
 */
export function getConfGameWinProb(
  game: ConfResolvedGame,
  teamId: number,
  confId: string,
  def: ConfDefWithProbMap,
  teamsById: Map<number, ConfTeam>,
  options?: { ignoreCustom?: boolean }
): number | null {
  if (!game.teamAId || !game.teamBId) return null;

  const modelProbA = getConfMatchupProb(confId, def, game.teamAId, game.teamBId, game.round, teamsById);
  const effectiveProbA =
    options?.ignoreCustom || game.customProbA === null || game.customProbA === undefined
      ? modelProbA
      : Math.max(0.000001, Math.min(0.999999, game.customProbA));

  if (teamId === game.teamAId) return effectiveProbA;
  if (teamId === game.teamBId) return 1 - effectiveProbA;
  return null;
}

/**
 * Resolve conference games from templates + locked picks (parallel to resolveGames in bracket.ts).
 */
export function resolveConfGames(
  templates: ConfGameTemplate[],
  roundOrder: string[],
  lockedPicks: ConfLockedPicks,
  customProbByGame: ConfCustomProbByGame = {}
): { games: ConfResolvedGame[]; sanitized: ConfLockedPicks } {
  // Sort templates by round order then slot
  const roundRank = Object.fromEntries(roundOrder.map((r, i) => [r, i]));
  const ordered = [...templates].sort((a, b) => {
    const rankDiff = (roundRank[a.round] ?? 0) - (roundRank[b.round] ?? 0);
    if (rankDiff !== 0) return rankDiff;
    return a.slot - b.slot;
  });

  const winnerByGame: Record<string, number | null> = {};
  const resolved: ConfResolvedGame[] = [];
  const sanitized: ConfLockedPicks = {};

  for (const template of ordered) {
    let teamAId: number | null = template.initialTeamIds?.[0] ?? null;
    let teamBId: number | null = template.initialTeamIds?.[1] ?? null;

    if (!teamAId && template.sourceGameIds?.[0]) {
      teamAId = winnerByGame[template.sourceGameIds[0]] ?? null;
    }
    if (!teamBId && template.sourceGameIds?.[1]) {
      teamBId = winnerByGame[template.sourceGameIds[1]] ?? null;
    }

    const candidate = lockedPicks[template.id] ?? null;
    const participantsReady = teamAId !== null && teamBId !== null;
    const isValidLock =
      participantsReady && candidate !== null && (candidate === teamAId || candidate === teamBId);
    const winnerId = isValidLock ? candidate : null;

    if (isValidLock && winnerId !== null) {
      sanitized[template.id] = winnerId;
    }

    winnerByGame[template.id] = winnerId;

    const rawCustomProb = customProbByGame[template.id];
    const customProbA =
      typeof rawCustomProb === "number" && Number.isFinite(rawCustomProb) && rawCustomProb >= 0 && rawCustomProb <= 1
        ? rawCustomProb
        : null;

    resolved.push({
      ...template,
      teamAId,
      teamBId,
      winnerId,
      lockedByUser: Boolean(isValidLock),
      customProbA,
    });
  }

  return { games: resolved, sanitized };
}
