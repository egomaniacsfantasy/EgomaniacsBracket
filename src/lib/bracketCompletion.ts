import { gameTemplates, templatesById } from "../data/bracket";
import { NCAA_KNOWN_RESULTS } from "../data/ncaaKnownResults";
import { resolveGames, type LockedPicks } from "./bracket";

export const TOTAL_BRACKET_GAME_COUNT = gameTemplates.length;
export const SUBMITTABLE_BRACKET_GAME_COUNT = gameTemplates.filter((game) => game.round !== "FF").length;

export type BracketCompletionSummary = {
  totalGames: number;
  completedGames: number;
  requiredSubmittableGames: number;
  completedSubmittableGames: number;
  remainingSubmittableGames: number;
  completionPct: number;
  isComplete: boolean;
};

export const mergeKnownNcaaResults = (picks: LockedPicks): LockedPicks => ({
  ...picks,
  ...NCAA_KNOWN_RESULTS,
});

const roundRank: Record<(typeof gameTemplates)[number]["round"], number> = {
  FF: 0,
  R64: 1,
  R32: 2,
  S16: 3,
  E8: 4,
  F4: 5,
  CHAMP: 6,
};

const possibleEntrantsCache = new Map<string, Set<string>>();

function getPossibleEntrants(gameId: string): Set<string> {
  const cached = possibleEntrantsCache.get(gameId);
  if (cached) return cached;

  const template = templatesById.get(gameId);
  const entrants = new Set<string>();

  template?.initialTeamIds?.forEach((teamId) => {
    if (teamId) entrants.add(teamId);
  });

  template?.sourceGameIds?.forEach((sourceGameId) => {
    if (!sourceGameId) return;
    getPossibleEntrants(sourceGameId).forEach((teamId) => entrants.add(teamId));
  });

  possibleEntrantsCache.set(gameId, entrants);
  return entrants;
}

function inferPickPath(
  picks: LockedPicks,
  gameId: string,
  teamId: string,
  visiting = new Set<string>(),
): boolean {
  const template = templatesById.get(gameId);
  if (!template) return false;

  const possibleEntrants = getPossibleEntrants(gameId);
  if (!possibleEntrants.has(teamId)) return false;

  const existingPick = picks[gameId];
  if (existingPick && existingPick !== teamId) return false;
  if (!existingPick) {
    picks[gameId] = teamId;
  }

  if (visiting.has(gameId)) return true;
  visiting.add(gameId);

  try {
    const sourceGameIds = template.sourceGameIds ?? [];
    const upstreamGameId = sourceGameIds.find((sourceGameId) => {
      if (!sourceGameId) return false;
      return getPossibleEntrants(sourceGameId).has(teamId);
    });

    if (!upstreamGameId) {
      return true;
    }

    return inferPickPath(picks, upstreamGameId, teamId, visiting);
  } finally {
    visiting.delete(gameId);
  }
}

export function normalizeBracketPicks(picks: LockedPicks): LockedPicks {
  const merged = mergeKnownNcaaResults(picks ?? {});
  const normalized: LockedPicks = { ...merged };

  const picksByRound = Object.entries(merged).sort(([gameIdA], [gameIdB]) => {
    const roundA = templatesById.get(gameIdA)?.round ?? "FF";
    const roundB = templatesById.get(gameIdB)?.round ?? "FF";
    return roundRank[roundB] - roundRank[roundA];
  });

  picksByRound.forEach(([gameId, teamId]) => {
    inferPickPath(normalized, gameId, teamId);
  });

  return resolveGames(normalized).sanitized;
}

export const resolveBracketWithKnownResults = (picks: LockedPicks) => resolveGames(normalizeBracketPicks(picks ?? {}));

export function getBracketCompletionSummary(picks: LockedPicks): BracketCompletionSummary {
  const { games } = resolveBracketWithKnownResults(picks ?? {});
  const completedGames = games.filter((game) => Boolean(game.winnerId && game.teamAId && game.teamBId)).length;
  const completedSubmittableGames = games.filter(
    (game) => game.round !== "FF" && Boolean(game.winnerId && game.teamAId && game.teamBId)
  ).length;

  return {
    totalGames: TOTAL_BRACKET_GAME_COUNT,
    completedGames: Math.min(TOTAL_BRACKET_GAME_COUNT, completedGames),
    requiredSubmittableGames: SUBMITTABLE_BRACKET_GAME_COUNT,
    completedSubmittableGames: Math.min(SUBMITTABLE_BRACKET_GAME_COUNT, completedSubmittableGames),
    remainingSubmittableGames: Math.max(0, SUBMITTABLE_BRACKET_GAME_COUNT - completedSubmittableGames),
    completionPct:
      TOTAL_BRACKET_GAME_COUNT > 0 ? Math.round((Math.min(TOTAL_BRACKET_GAME_COUNT, completedGames) / TOTAL_BRACKET_GAME_COUNT) * 100) : 0,
    isComplete: completedSubmittableGames >= SUBMITTABLE_BRACKET_GAME_COUNT,
  };
}
