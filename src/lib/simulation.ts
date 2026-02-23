import { gameTemplates } from "../data/bracket";
import { teams, teamsById } from "../data/teams";
import type { FuturesRow, GameWinProbability, SimulationOutput } from "../types";
import type { LockedPicks } from "./bracket";
import { getGameWinProb, resolveGames } from "./bracket";
import { winProb } from "./odds";

const rounds = ["R64", "R32", "S16", "E8", "F4", "CHAMP"] as const;
const gameOrder = [...gameTemplates].sort((a, b) => {
  const rankA = rounds.indexOf(a.round);
  const rankB = rounds.indexOf(b.round);
  if (rankA !== rankB) return rankA - rankB;
  return a.slot - b.slot;
});

const eligibleLock = (
  lockId: string | undefined,
  teamAId: string | null,
  teamBId: string | null
): string | null => {
  if (!lockId) return null;
  if (lockId === teamAId || lockId === teamBId) return lockId;
  return null;
};

const sampleWinner = (teamAId: string, teamBId: string): string => {
  const teamA = teamsById.get(teamAId)!;
  const teamB = teamsById.get(teamBId)!;
  const pA = winProb(teamA.rating, teamB.rating);
  return Math.random() < pA ? teamAId : teamBId;
};

const simulateBracket = (locks: LockedPicks, forceLocks: boolean): { winners: Record<string, string>; lockSuccess: boolean } => {
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

    const naturalWinner = sampleWinner(teamAId, teamBId);
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

const computeApproxLikelihood = (locks: LockedPicks): number => {
  const { games } = resolveGames(locks);
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

export const hashLocks = (locks: LockedPicks, simRuns: number): string => {
  const picks = Object.entries(locks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([g, t]) => `${g}:${t}`)
    .join("|");
  return `${simRuns}::${picks}`;
};

const normalizeGameWinProbs = (
  winCounts: Map<string, Map<string, number>>,
  simRuns: number
): Record<string, GameWinProbability[]> => {
  const out: Record<string, GameWinProbability[]> = {};

  for (const game of gameTemplates) {
    const byTeam = winCounts.get(game.id) ?? new Map<string, number>();
    const arr: GameWinProbability[] = [...byTeam.entries()]
      .map(([teamId, count]) => ({ teamId, prob: count / simRuns }))
      .filter((row) => row.prob > 0)
      .sort((a, b) => b.prob - a.prob);
    out[game.id] = arr;
  }

  return out;
};

export const runSimulation = (locks: LockedPicks, simRuns: number): SimulationOutput => {
  const rows = makeEmptyFutures();
  const rowMap = new Map(rows.map((row) => [row.teamId, row]));
  const gameWinCounts = new Map<string, Map<string, number>>();

  for (const game of gameTemplates) {
    gameWinCounts.set(game.id, new Map<string, number>());
  }

  let lockSuccesses = 0;

  for (let i = 0; i < simRuns; i += 1) {
    const forced = simulateBracket(locks, true);
    const natural = simulateBracket(locks, false);

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
    gameWinProbs: normalizeGameWinProbs(gameWinCounts, simRuns),
    likelihoodSimulation: lockSuccesses / simRuns,
    likelihoodApprox: computeApproxLikelihood(locks),
  };
};

export const generateSimulatedBracket = (locks: LockedPicks): LockedPicks => {
  const forced = simulateBracket(locks, true);
  return { ...forced.winners };
};
