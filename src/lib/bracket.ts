import { gameTemplates, regionOrder, roundOrder } from "../data/bracket";
import { teamsById } from "../data/teams";
import { getMatchupWinProbForRound } from "./matchupProbabilities";
import { winProb } from "./odds";
import type { Region, ResolvedGame, Round } from "../types";

export type LockedPicks = Record<string, string>;

const roundRank: Record<Round, number> = {
  R64: 0,
  R32: 1,
  S16: 2,
  E8: 3,
  F4: 4,
  CHAMP: 5,
};

const templatesOrdered = [...gameTemplates].sort((a, b) => {
  const rankDiff = roundRank[a.round] - roundRank[b.round];
  if (rankDiff !== 0) return rankDiff;
  return a.slot - b.slot;
});

export const resolveGames = (lockedPicks: LockedPicks): { games: ResolvedGame[]; sanitized: LockedPicks } => {
  const winnerByGame: Record<string, string | null> = {};
  const resolved: ResolvedGame[] = [];
  const sanitized: LockedPicks = {};

  for (const template of templatesOrdered) {
    let teamAId: string | null = null;
    let teamBId: string | null = null;

    if (template.initialTeamIds) {
      teamAId = template.initialTeamIds[0];
      teamBId = template.initialTeamIds[1];
    } else if (template.sourceGameIds) {
      teamAId = winnerByGame[template.sourceGameIds[0]] ?? null;
      teamBId = winnerByGame[template.sourceGameIds[1]] ?? null;
    }

    const candidate = lockedPicks[template.id] || null;
    const isValidLock = candidate !== null && (candidate === teamAId || candidate === teamBId);
    const winnerId = isValidLock ? candidate : null;

    if (isValidLock && winnerId) {
      sanitized[template.id] = winnerId;
    }

    winnerByGame[template.id] = winnerId;

    resolved.push({
      ...template,
      teamAId,
      teamBId,
      winnerId,
      lockedByUser: Boolean(isValidLock),
    });
  }

  return { games: resolved, sanitized };
};

export const sanitizeLockedPicks = (lockedPicks: LockedPicks): LockedPicks => resolveGames(lockedPicks).sanitized;

export const getGameWinProb = (game: ResolvedGame, teamId: string): number | null => {
  if (!game.teamAId || !game.teamBId) return null;
  const teamA = teamsById.get(game.teamAId);
  const teamB = teamsById.get(game.teamBId);
  if (!teamA || !teamB) return null;

  const modelProb =
    getMatchupWinProbForRound(teamA.name, teamB.name, game.round) ?? winProb(teamA.rating, teamB.rating);
  const aProb = Math.max(0.000001, Math.min(0.999999, modelProb));
  if (teamId === teamA.id) return aProb;
  if (teamId === teamB.id) return 1 - aProb;
  return null;
};

export const buildChalkPicks = (base: LockedPicks): LockedPicks => {
  const chalk: LockedPicks = { ...base };
  const { games } = resolveGames(chalk);

  for (const game of games) {
    if (!game.teamAId || !game.teamBId) continue;
    const aProb = getGameWinProb(game, game.teamAId);
    if (aProb === null) continue;
    chalk[game.id] = aProb >= 0.5 ? game.teamAId : game.teamBId;

    const sanitized = resolveGames(chalk).sanitized;
    Object.keys(chalk).forEach((key) => {
      if (!sanitized[key]) delete chalk[key];
    });
  }

  return resolveGames(chalk).sanitized;
};

export const gamesByRegionAndRound = (games: ResolvedGame[], region: Region, round: Round): ResolvedGame[] =>
  games.filter((game) => game.region === region && game.round === round).sort((a, b) => a.slot - b.slot);

export const finalRounds = (games: ResolvedGame[]): ResolvedGame[] =>
  games.filter((game) => game.round === "F4" || game.round === "CHAMP").sort((a, b) => roundRank[a.round] - roundRank[b.round]);

export const possibleWinnersByGame = (lockedPicks: LockedPicks): Record<string, Set<string>> => {
  const possible: Record<string, Set<string>> = {};

  for (const template of templatesOrdered) {
    const entrants = new Set<string>();

    if (template.initialTeamIds) {
      template.initialTeamIds.forEach((id) => entrants.add(id));
    } else if (template.sourceGameIds) {
      template.sourceGameIds.forEach((sourceId) => {
        (possible[sourceId] ?? new Set<string>()).forEach((id) => entrants.add(id));
      });
    }

    const lock = lockedPicks[template.id];
    if (lock && entrants.has(lock)) {
      possible[template.id] = new Set([lock]);
    } else {
      possible[template.id] = entrants;
    }
  }

  return possible;
};

const ancestorCache = new Map<string, Set<string>>();

const collectAncestors = (gameId: string): Set<string> => {
  if (ancestorCache.has(gameId)) return ancestorCache.get(gameId)!;
  const game = gameTemplates.find((g) => g.id === gameId);
  const set = new Set<string>();
  if (game?.sourceGameIds) {
    for (const sourceId of game.sourceGameIds) {
      set.add(sourceId);
      const sourceAncestors = collectAncestors(sourceId);
      sourceAncestors.forEach((ancestor) => set.add(ancestor));
    }
  }
  ancestorCache.set(gameId, set);
  return set;
};

const regionGameIds = new Set(
  gameTemplates.filter((game) => game.region !== null).map((game) => game.id)
);

export const resetRegionPicks = (locked: LockedPicks, region: Region): LockedPicks => {
  const next: LockedPicks = {};
  const regionOwned = new Set(gameTemplates.filter((g) => g.region === region).map((g) => g.id));

  for (const [gameId, teamId] of Object.entries(locked)) {
    if (regionOwned.has(gameId)) continue;

    if (!regionGameIds.has(gameId)) {
      const ancestors = collectAncestors(gameId);
      const touchesRegion = [...ancestors].some((id) => regionOwned.has(id));
      if (touchesRegion) continue;
    }

    next[gameId] = teamId;
  }

  return sanitizeLockedPicks(next);
};

export const regionRows = regionOrder;
export const roundsForRegion = ["R64", "R32", "S16", "E8"] as const;
export const roundsAll = roundOrder;
