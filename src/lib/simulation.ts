import { gameTemplates } from "../data/bracket";
import { teams, teamsById } from "../data/teams";
import type { FuturesRow, GameWinProbability, Region, ResolvedGame, Round, SimulationOutput } from "../types";
import type { CustomProbByGame, LockedPicks } from "./bracket";
import { getGameWinProb, resolveGames } from "./bracket";

const rounds = ["R64", "R32", "S16", "E8", "F4", "CHAMP"] as const;
const gameOrder = [...gameTemplates].sort((a, b) => {
  const rankA = rounds.indexOf(a.round);
  const rankB = rounds.indexOf(b.round);
  if (rankA !== rankB) return rankA - rankB;
  return a.slot - b.slot;
});
const templateById = new Map(gameTemplates.map((game) => [game.id, game]));

const eligibleTeamsCache = new Map<string, string[]>();
const eligibleTeamsForGame = (gameId: string): string[] => {
  const cached = eligibleTeamsCache.get(gameId);
  if (cached) return cached;

  const template = templateById.get(gameId);
  if (!template) return [];

  let teamIds: string[] = [];
  if (template.initialTeamIds) {
    teamIds = [...template.initialTeamIds];
  } else if (template.sourceGameIds) {
    teamIds = template.sourceGameIds.flatMap((sourceId) => eligibleTeamsForGame(sourceId));
  }

  const unique = Array.from(new Set(teamIds)).sort((a, b) => {
    const teamA = teamsById.get(a);
    const teamB = teamsById.get(b);
    if (teamA && teamB && teamA.seed !== teamB.seed) return teamA.seed - teamB.seed;
    return a.localeCompare(b);
  });
  eligibleTeamsCache.set(gameId, unique);
  return unique;
};

const eligibleLock = (
  lockId: string | undefined,
  teamAId: string | null,
  teamBId: string | null
): string | null => {
  if (!lockId) return null;
  if (lockId === teamAId || lockId === teamBId) return lockId;
  return null;
};

const sampleWinner = (game: ResolvedGame): string => {
  if (!game.teamAId || !game.teamBId) return "";
  const pA = getGameWinProb(game, game.teamAId);
  if (pA === null) return "";
  return Math.random() < pA ? game.teamAId : game.teamBId;
};

const simulateBracket = (
  locks: LockedPicks,
  forceLocks: boolean,
  customProbByGame: CustomProbByGame = {}
): { winners: Record<string, string>; lockSuccess: boolean } => {
  const winners: Record<string, string> = {};
  let lockSuccess = true;

  for (const game of gameOrder) {
    let teamAId: string | null = null;
    let teamBId: string | null = null;

    if (game.initialTeamIds) {
      teamAId = game.initialTeamIds[0];
      teamBId = game.initialTeamIds[1];
    } else if (game.sourceGameIds) {
      teamAId = winners[game.sourceGameIds[0]] || null;
      teamBId = winners[game.sourceGameIds[1]] || null;
    }

    if (!teamAId || !teamBId) {
      lockSuccess = false;
      continue;
    }

    const resolvedGame: ResolvedGame = {
      ...game,
      teamAId,
      teamBId,
      winnerId: null,
      lockedByUser: false,
      customProbA:
        typeof customProbByGame[game.id] === "number" && Number.isFinite(customProbByGame[game.id] as number)
          ? Math.max(0.000001, Math.min(0.999999, customProbByGame[game.id] as number))
          : null,
    };
    const naturalWinner = sampleWinner(resolvedGame);
    if (!naturalWinner) {
      lockSuccess = false;
      continue;
    }
    const lock = eligibleLock(locks[game.id], teamAId, teamBId);

    if (lock && naturalWinner !== lock) {
      lockSuccess = false;
    } else if (locks[game.id] && !lock) {
      lockSuccess = false;
    }

    winners[game.id] = forceLocks && lock ? lock : naturalWinner;
  }

  return { winners, lockSuccess };
};

const computeApproxLikelihood = (locks: LockedPicks, customProbByGame: CustomProbByGame = {}): number => {
  const { games } = resolveGames(locks, customProbByGame);
  let likelihood = 1;
  for (const game of games) {
    if (!game.lockedByUser || !game.winnerId) continue;
    const p = getGameWinProb(game, game.winnerId);
    if (p === null) return 0;
    likelihood *= p;
  }
  return likelihood;
};

const makeEmptyFutures = (): FuturesRow[] =>
  teams.map((team) => ({
    teamId: team.id,
    round2Prob: 0,
    sweet16Prob: 0,
    elite8Prob: 0,
    final4Prob: 0,
    titleGameProb: 0,
    champProb: 0,
  }));

export const hashLocks = (
  locks: LockedPicks,
  simRuns: number,
  customProbByGame: CustomProbByGame = {}
): string => {
  const picks = Object.entries(locks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([g, t]) => `${g}:${t}`)
    .join("|");
  const probs = Object.entries(customProbByGame)
    .filter(([, p]) => typeof p === "number" && Number.isFinite(p))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([g, p]) => `${g}:${(p as number).toFixed(6)}`)
    .join("|");
  return `${simRuns}::${picks}::${probs}`;
};

const normalizeGameWinProbs = (
  winCounts: Map<string, Map<string, number>>,
  simRuns: number,
  resolvedById: Map<string, ResolvedGame>
): Record<string, GameWinProbability[]> => {
  const out: Record<string, GameWinProbability[]> = {};

  for (const game of gameTemplates) {
    const resolved = resolvedById.get(game.id);
    if (resolved?.teamAId && resolved.teamBId) {
      const { teamAId, teamBId } = resolved;
      if (resolved.lockedByUser && resolved.winnerId) {
        out[game.id] = [
          { teamId: teamAId, prob: resolved.winnerId === teamAId ? 1 : 0 },
          { teamId: teamBId, prob: resolved.winnerId === teamBId ? 1 : 0 },
        ];
        continue;
      }

      const pA = getGameWinProb(resolved, teamAId);
      if (pA !== null) {
        out[game.id] = [
          { teamId: teamAId, prob: pA },
          { teamId: teamBId, prob: 1 - pA },
        ];
        continue;
      }
    }

    const byTeam = winCounts.get(game.id) ?? new Map<string, number>();
    const arr: GameWinProbability[] = eligibleTeamsForGame(game.id).map((teamId) => ({
      teamId,
      prob: (byTeam.get(teamId) ?? 0) / simRuns,
    }));
    out[game.id] = arr;
  }

  return out;
};

export const runSimulation = (
  locks: LockedPicks,
  simRuns: number,
  customProbByGame: CustomProbByGame = {}
): SimulationOutput => {
  const { games: resolvedGames } = resolveGames(locks, customProbByGame);
  const resolvedById = new Map(resolvedGames.map((game) => [game.id, game]));
  const rows = makeEmptyFutures();
  const rowMap = new Map(rows.map((row) => [row.teamId, row]));
  const gameWinCounts = new Map<string, Map<string, number>>();

  for (const game of gameTemplates) {
    gameWinCounts.set(game.id, new Map<string, number>());
  }

  let lockSuccesses = 0;

  for (let i = 0; i < simRuns; i += 1) {
    const forced = simulateBracket(locks, true, customProbByGame);
    const natural = simulateBracket(locks, false, customProbByGame);

    if (natural.lockSuccess) lockSuccesses += 1;

    for (const game of gameTemplates) {
      const winnerId = forced.winners[game.id];
      if (!winnerId) continue;

      const byTeam = gameWinCounts.get(game.id)!;
      byTeam.set(winnerId, (byTeam.get(winnerId) ?? 0) + 1);

      const row = rowMap.get(winnerId);
      if (!row) continue;

      if (game.round === "R64") row.round2Prob += 1;
      if (game.round === "R32") row.sweet16Prob += 1;
      if (game.round === "S16") row.elite8Prob += 1;
      if (game.round === "E8") row.final4Prob += 1;
      if (game.round === "F4") row.titleGameProb += 1;
      if (game.round === "CHAMP") row.champProb += 1;
    }
  }

  rows.forEach((row) => {
    row.round2Prob /= simRuns;
    row.sweet16Prob /= simRuns;
    row.elite8Prob /= simRuns;
    row.final4Prob /= simRuns;
    row.titleGameProb /= simRuns;
    row.champProb /= simRuns;
  });

  const sorted = rows.sort((a, b) => b.champProb - a.champProb);

  return {
    futures: sorted,
    gameWinProbs: normalizeGameWinProbs(gameWinCounts, simRuns, resolvedById),
    likelihoodSimulation: lockSuccesses / simRuns,
    likelihoodApprox: computeApproxLikelihood(locks, customProbByGame),
  };
};

export const generateSimulatedBracket = (locks: LockedPicks, customProbByGame: CustomProbByGame = {}): LockedPicks => {
  const forced = simulateBracket(locks, true, customProbByGame);
  return { ...forced.winners };
};

const roundRank: Record<Round, number> = {
  R64: 0,
  R32: 1,
  S16: 2,
  E8: 3,
  F4: 4,
  CHAMP: 5,
};

const defaultRegionOrder: Region[] = ["South", "West", "East", "Midwest"];
const regionRank = (region: Region | null, order: Region[]): number => {
  if (!region) return order.length;
  const idx = order.indexOf(region);
  return idx >= 0 ? idx : order.length;
};

export type SimulatedPickStep = {
  gameId: string;
  winnerId: string;
};

export const generateSimulatedBracketSteps = (
  locks: LockedPicks,
  regionOrder: Region[] = defaultRegionOrder,
  customProbByGame: CustomProbByGame = {}
): SimulatedPickStep[] => {
  const forced = simulateBracket(locks, true, customProbByGame);
  const orderedGames = [...gameTemplates].sort((a, b) => {
    const roundDiff = roundRank[a.round] - roundRank[b.round];
    if (roundDiff !== 0) return roundDiff;

    const regionDiff = regionRank(a.region, regionOrder) - regionRank(b.region, regionOrder);
    if (regionDiff !== 0) return regionDiff;

    return a.slot - b.slot;
  });

  return orderedGames
    .filter((game) => !locks[game.id])
    .map((game) => {
      const winnerId = forced.winners[game.id];
      return winnerId ? { gameId: game.id, winnerId } : null;
    })
    .filter((step): step is SimulatedPickStep => step !== null);
};
