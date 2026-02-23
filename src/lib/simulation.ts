import { gameTemplates, sideRegions } from "../data/bracket";
import { teams, teamsById } from "../data/teams";
import type { FuturesRow, Region, Side, SimulationOutput } from "../types";
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

const sideForRegion = (region: Region): Side =>
  sideRegions.Left.includes(region) ? "Left" : "Right";

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
    champProb: 0,
    regionProb: 0,
    sideProb: 0,
  }));

export const hashLocks = (locks: LockedPicks, simRuns: number): string => {
  const picks = Object.entries(locks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([g, t]) => `${g}:${t}`)
    .join("|");
  return `${simRuns}::${picks}`;
};

export const runSimulation = (locks: LockedPicks, simRuns: number): SimulationOutput => {
  const rows = makeEmptyFutures();
  const rowMap = new Map(rows.map((row) => [row.teamId, row]));

  let lockSuccesses = 0;

  for (let i = 0; i < simRuns; i += 1) {
    const forced = simulateBracket(locks, true);
    const natural = simulateBracket(locks, false);

    if (natural.lockSuccess) lockSuccesses += 1;

    const champId = forced.winners["CHAMP-0"];
    if (champId) {
      rowMap.get(champId)!.champProb += 1;
    }

    for (const region of ["East", "West", "South", "Midwest"] as Region[]) {
      const regionWinner = forced.winners[`${region}-E8-0`];
      if (regionWinner) {
        rowMap.get(regionWinner)!.regionProb += 1;
      }
    }

    const leftWinner = forced.winners["F4-Left-0"];
    const rightWinner = forced.winners["F4-Right-0"];
    if (leftWinner) rowMap.get(leftWinner)!.sideProb += 1;
    if (rightWinner) rowMap.get(rightWinner)!.sideProb += 1;
  }

  rows.forEach((row) => {
    row.champProb /= simRuns;
    row.regionProb /= simRuns;
    row.sideProb /= simRuns;
  });

  const sorted = rows.sort((a, b) => b.champProb - a.champProb);

  return {
    futures: sorted,
    likelihoodSimulation: lockSuccesses / simRuns,
    likelihoodApprox: computeApproxLikelihood(locks),
  };
};

export const sideLabelForTeam = (teamId: string): Side | null => {
  const team = teamsById.get(teamId);
  if (!team) return null;
  return sideForRegion(team.region);
};
