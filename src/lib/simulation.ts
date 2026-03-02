import { gameTemplates } from "../data/bracket";
import { teams, teamsById } from "../data/teams";
import type { ChaosDistribution, FuturesRow, GameWinProbability, Region, ResolvedGame, Round, SimulationOutput } from "../types";
import type { CustomProbByGame, LockedPicks } from "./bracket";
import { getGameWinProb, resolveGames } from "./bracket";

const DEFAULT_SIM_SEED = 42;
const rounds = ["R64", "R32", "S16", "E8", "F4", "CHAMP"] as const;
const gameOrder = [...gameTemplates].sort((a, b) => {
  const rankA = rounds.indexOf(a.round);
  const rankB = rounds.indexOf(b.round);
  if (rankA !== rankB) return rankA - rankB;
  return a.slot - b.slot;
});
const templateById = new Map(gameTemplates.map((game) => [game.id, game]));
const CHAOS_MIN_PROB = 1e-12;

const fnv1aHash = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const mulberry32 = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let z = t;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
};

const runtimeRandom = (): number => {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
    const bytes = new Uint32Array(1);
    globalThis.crypto.getRandomValues(bytes);
    return bytes[0] / 4294967296;
  }
  return Math.random();
};

const createRuntimeRng = (): (() => number) => () => runtimeRandom();

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

const sampleWinner = (game: ResolvedGame, random: () => number): string => {
  if (!game.teamAId || !game.teamBId) return "";
  const pA = getGameWinProb(game, game.teamAId);
  if (pA === null) return "";
  return random() < pA ? game.teamAId : game.teamBId;
};

const computeChaosContribution = (winProb: number): number => -Math.log(Math.max(CHAOS_MIN_PROB, winProb));

const buildChaosDistribution = (
  scores: number[],
  perGameScores?: Record<string, number[]>
): ChaosDistribution => {
  const sorted = [...scores].sort((a, b) => a - b);
  const percentiles: Record<number, number> = {};
  const total = sorted.length;

  for (let pct = 5; pct <= 100; pct += 5) {
    if (total === 0) {
      percentiles[pct] = 0;
      continue;
    }
    const index = Math.max(0, Math.min(total - 1, Math.ceil((pct / 100) * total) - 1));
    percentiles[pct] = sorted[index];
  }

  return { scores: sorted, percentiles, perGameScores, simRuns: total };
};

export const getChaosScorePercentile = (
  score: number,
  chaosDistribution?: ChaosDistribution | null
): number | null => {
  if (!chaosDistribution || chaosDistribution.scores.length === 0 || !Number.isFinite(score)) return null;
  const scores = chaosDistribution.scores;

  let lo = 0;
  let hi = scores.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (scores[mid] <= score) lo = mid + 1;
    else hi = mid;
  }

  return (lo / scores.length) * 100;
};

export const getChaosScorePercentileForPickedGames = (
  score: number,
  pickedGameIds: string[],
  chaosDistribution?: ChaosDistribution | null
): number | null => {
  if (!chaosDistribution || !Number.isFinite(score)) return null;
  const perGameScores = chaosDistribution.perGameScores;
  if (!perGameScores) return getChaosScorePercentile(score, chaosDistribution);

  const uniquePickedIds = Array.from(new Set(pickedGameIds.filter((gameId) => Boolean(gameId))));
  if (uniquePickedIds.length === 0) return null;

  const firstColumn = uniquePickedIds.map((gameId) => perGameScores[gameId]).find((column) => Array.isArray(column));
  if (!firstColumn || firstColumn.length === 0) return null;
  const simCount = firstColumn.length;

  const totals = new Array<number>(simCount).fill(0);
  for (const gameId of uniquePickedIds) {
    const column = perGameScores[gameId];
    if (!column || column.length !== simCount) continue;
    for (let i = 0; i < simCount; i += 1) {
      totals[i] += column[i];
    }
  }

  totals.sort((a, b) => a - b);
  let lo = 0;
  let hi = totals.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (totals[mid] <= score) lo = mid + 1;
    else hi = mid;
  }

  return (lo / totals.length) * 100;
};

const simulateBracket = (
  locks: LockedPicks,
  forceLocks: boolean,
  customProbByGame: CustomProbByGame = {},
  random: () => number,
  options?: { trackChaos?: boolean }
): {
  winners: Record<string, string>;
  lockSuccess: boolean;
  chaosScore: number;
  chaosByGameId?: Record<string, number>;
} => {
  const winners: Record<string, string> = {};
  let lockSuccess = true;
  let chaosScore = 0;
  const chaosByGameId: Record<string, number> | undefined = options?.trackChaos ? {} : undefined;

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
    const naturalWinner = sampleWinner(resolvedGame, random);
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

    const winnerId = forceLocks && lock ? lock : naturalWinner;
    winners[game.id] = winnerId;

    if (options?.trackChaos) {
      const winnerProb = getGameWinProb(resolvedGame, winnerId, { ignoreCustom: true });
      if (winnerProb !== null) {
        const contribution = computeChaosContribution(winnerProb);
        chaosScore += contribution;
        if (chaosByGameId) chaosByGameId[game.id] = contribution;
      }
    }
  }

  return { winners, lockSuccess, chaosScore, chaosByGameId };
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
  customProbByGame: CustomProbByGame = {},
  options?: { trackChaosDistribution?: boolean }
): SimulationOutput => {
  const seedInput = hashLocks(locks, simRuns, customProbByGame);
  const rootSeed = fnv1aHash(`${DEFAULT_SIM_SEED}::${seedInput}`);
  const forcedRng = mulberry32(rootSeed ^ 0xa5a5a5a5);
  const naturalRng = mulberry32(rootSeed ^ 0x5a5a5a5a);

  const { games: resolvedGames } = resolveGames(locks, customProbByGame);
  const resolvedById = new Map(resolvedGames.map((game) => [game.id, game]));
  const rows = makeEmptyFutures();
  const rowMap = new Map(rows.map((row) => [row.teamId, row]));
  const gameWinCounts = new Map<string, Map<string, number>>();

  for (const game of gameTemplates) {
    gameWinCounts.set(game.id, new Map<string, number>());
  }

  let lockSuccesses = 0;
  const chaosScores: number[] = options?.trackChaosDistribution ? [] : [];
  const chaosPerGameScores: Record<string, number[]> | undefined = options?.trackChaosDistribution
    ? Object.fromEntries(gameOrder.map((game) => [game.id, [] as number[]]))
    : undefined;

  for (let i = 0; i < simRuns; i += 1) {
    const forced = simulateBracket(locks, true, customProbByGame, forcedRng);
    const natural = simulateBracket(locks, false, customProbByGame, naturalRng, {
      trackChaos: options?.trackChaosDistribution,
    });

    if (natural.lockSuccess) lockSuccesses += 1;
    if (options?.trackChaosDistribution) {
      chaosScores.push(natural.chaosScore);
      for (const game of gameOrder) {
        const contribution = natural.chaosByGameId?.[game.id] ?? 0;
        chaosPerGameScores?.[game.id].push(contribution);
      }
    }

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
    chaosDistribution: options?.trackChaosDistribution ? buildChaosDistribution(chaosScores, chaosPerGameScores) : undefined,
  };
};

export const generateSimulatedBracket = (locks: LockedPicks, customProbByGame: CustomProbByGame = {}): LockedPicks => {
  const random = createRuntimeRng();
  const forced = simulateBracket(locks, true, customProbByGame, random);
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
  const random = createRuntimeRng();
  const forced = simulateBracket(locks, true, customProbByGame, random);
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
