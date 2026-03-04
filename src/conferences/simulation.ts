import type { ConfGameTemplate, ConfFuturesRow, ConfSimulationOutput } from "./types";
import type { ConfDefWithProbMap } from "./conferenceDefs";
import type { ConfTeam } from "./data/confTeams";
import type { ConfLockedPicks, ConfCustomProbByGame } from "./confBracket";
import { getConfMatchupProb } from "./confBracket";

const DEFAULT_SIM_SEED = 42;

const fnv1aHash = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
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

function hashConfLocks(locks: ConfLockedPicks, simRuns: number, customProbByGame: ConfCustomProbByGame): string {
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
}

interface SimBracketResult {
  winners: Record<string, number>;
  lockSuccess: boolean;
}

function simulateConfBracket(
  gameOrder: ConfGameTemplate[],
  confId: string,
  def: ConfDefWithProbMap,
  teamsById: Map<number, ConfTeam>,
  locks: ConfLockedPicks,
  forceLocks: boolean,
  customProbByGame: ConfCustomProbByGame,
  random: () => number
): SimBracketResult {
  const winners: Record<string, number> = {};
  let lockSuccess = true;

  for (const game of gameOrder) {
    let teamAId: number | null = game.initialTeamIds?.[0] ?? null;
    let teamBId: number | null = game.initialTeamIds?.[1] ?? null;

    if (!teamAId && game.sourceGameIds?.[0]) {
      teamAId = winners[game.sourceGameIds[0]] ?? null;
    }
    if (!teamBId && game.sourceGameIds?.[1]) {
      teamBId = winners[game.sourceGameIds[1]] ?? null;
    }

    if (!teamAId || !teamBId) {
      lockSuccess = false;
      continue;
    }

    // Get win probability for team A
    let probA = getConfMatchupProb(confId, def, teamAId, teamBId, game.round, teamsById);

    // Apply custom probability if set
    const customProb = customProbByGame[game.id];
    if (typeof customProb === "number" && Number.isFinite(customProb)) {
      probA = Math.max(0.000001, Math.min(0.999999, customProb));
    }

    probA = Math.max(0.000001, Math.min(0.999999, probA));
    const naturalWinner = random() < probA ? teamAId : teamBId;

    const lock = locks[game.id];
    const validLock = lock !== undefined && (lock === teamAId || lock === teamBId) ? lock : null;

    if (validLock && naturalWinner !== validLock) {
      lockSuccess = false;
    }

    winners[game.id] = forceLocks && validLock ? validLock : naturalWinner;
  }

  return { winners, lockSuccess };
}

/**
 * Run conference tournament simulation.
 * Parallel to runSimulation() in src/lib/simulation.ts but generalized for conference brackets.
 */
export function runConfSimulation(
  confId: string,
  def: ConfDefWithProbMap,
  gameTemplates: ConfGameTemplate[],
  teams: ConfTeam[],
  locks: ConfLockedPicks,
  simRuns: number,
  customProbByGame: ConfCustomProbByGame = {}
): ConfSimulationOutput {
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const roundOrder = def.rounds.map((r) => r.id);
  const roundRank = Object.fromEntries(roundOrder.map((r, i) => [r, i]));

  // Sort games by round order then slot
  const gameOrder = [...gameTemplates].sort((a, b) => {
    const rankDiff = (roundRank[a.round] ?? 0) - (roundRank[b.round] ?? 0);
    if (rankDiff !== 0) return rankDiff;
    return a.slot - b.slot;
  });

  const seedInput = hashConfLocks(locks, simRuns, customProbByGame);
  const rootSeed = fnv1aHash(`${DEFAULT_SIM_SEED}::${confId}::${seedInput}`);
  const forcedRng = mulberry32(rootSeed ^ 0xa5a5a5a5);

  // Initialize futures: track how many times each team wins each round
  const roundCounts: Record<number, Record<string, number>> = {};
  const champCounts: Record<number, number> = {};
  for (const team of teams) {
    roundCounts[team.id] = Object.fromEntries(roundOrder.map((r) => [r, 0]));
    champCounts[team.id] = 0;
  }

  // Track game win counts for game-level probabilities
  const gameWinCounts = new Map<string, Map<number, number>>();
  for (const game of gameTemplates) {
    gameWinCounts.set(game.id, new Map());
  }

  const finalRound = roundOrder[roundOrder.length - 1];

  for (let i = 0; i < simRuns; i++) {
    const { winners } = simulateConfBracket(
      gameOrder,
      confId,
      def,
      teamsById,
      locks,
      true,
      customProbByGame,
      forcedRng
    );

    // Accumulate per-game win counts
    for (const game of gameTemplates) {
      const winnerId = winners[game.id];
      if (winnerId !== undefined) {
        const byTeam = gameWinCounts.get(game.id)!;
        byTeam.set(winnerId, (byTeam.get(winnerId) ?? 0) + 1);

        // Track round advancement
        if (roundCounts[winnerId]) {
          roundCounts[winnerId][game.round] = (roundCounts[winnerId][game.round] ?? 0) + 1;
        }

        // Track championship
        if (game.round === finalRound) {
          champCounts[winnerId] = (champCounts[winnerId] ?? 0) + 1;
        }
      }
    }
  }

  // Build futures rows
  const futures: ConfFuturesRow[] = teams.map((team) => {
    const counts = roundCounts[team.id] ?? {};
    const roundProbs: Record<string, number> = {};
    for (const round of roundOrder) {
      roundProbs[round] = (counts[round] ?? 0) / simRuns;
    }
    return {
      teamId: team.id,
      teamName: team.name,
      seed: team.seed,
      roundProbs,
      champProb: (champCounts[team.id] ?? 0) / simRuns,
    };
  });

  // Sort by champion probability descending
  futures.sort((a, b) => b.champProb - a.champProb);

  // Build game win probabilities
  const gameWinProbs: Record<string, Array<{ teamId: number; prob: number }>> = {};
  for (const game of gameTemplates) {
    const byTeam = gameWinCounts.get(game.id)!;
    const entries: Array<{ teamId: number; prob: number }> = [];
    for (const [teamId, count] of byTeam) {
      entries.push({ teamId, prob: count / simRuns });
    }
    entries.sort((a, b) => b.prob - a.prob);
    gameWinProbs[game.id] = entries;
  }

  return { futures, gameWinProbs };
}
