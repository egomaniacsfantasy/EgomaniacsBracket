import type { LockedPicks } from "./bracket";

export type ScoringRound = 64 | 32 | 16 | 8 | 4 | 2;

export const ROUND_POINTS: Record<ScoringRound, number> = {
  64: 10,
  32: 20,
  16: 40,
  8: 80,
  4: 160,
  2: 320,
};

export const GAMES_PER_ROUND: Record<ScoringRound, number> = {
  64: 32,
  32: 16,
  16: 8,
  8: 4,
  4: 2,
  2: 1,
};

export const SCORING_ROUNDS: ScoringRound[] = [64, 32, 16, 8, 4, 2];

export const TOTAL_SCORING_GAMES = SCORING_ROUNDS.reduce((sum, round) => sum + GAMES_PER_ROUND[round], 0);
export const MAX_SCORING_POINTS = SCORING_ROUNDS.reduce((sum, round) => sum + GAMES_PER_ROUND[round] * ROUND_POINTS[round], 0);

export type TournamentResultLike = {
  matchup_id: string;
  winner_team_id: string;
  round: number | string;
};

export type ScoringResult = {
  winner: string;
  round: ScoringRound;
};

export type BracketScore = {
  totalScore: number;
  correctPicks: number;
  possiblePicks: number;
  maxRemaining: number;
  roundScores: Record<ScoringRound, number>;
  playedByRound: Record<ScoringRound, number>;
};

function isScoringRound(value: number): value is ScoringRound {
  return value in ROUND_POINTS;
}

function emptyByRound(): Record<ScoringRound, number> {
  return { 64: 0, 32: 0, 16: 0, 8: 0, 4: 0, 2: 0 };
}

export function buildScoringResultMap(results: TournamentResultLike[]): Record<string, ScoringResult> {
  const resultMap: Record<string, ScoringResult> = {};
  for (const result of results) {
    const roundNum = Number(result.round);
    if (!isScoringRound(roundNum)) continue;
    if (!result.matchup_id || !result.winner_team_id) continue;
    resultMap[result.matchup_id] = {
      winner: String(result.winner_team_id),
      round: roundNum,
    };
  }
  return resultMap;
}

export function scoreBracketPicks(
  picks: LockedPicks,
  resultMap: Record<string, ScoringResult>
): BracketScore {
  const roundScores = emptyByRound();
  const playedByRound = emptyByRound();
  let totalScore = 0;
  let correctPicks = 0;

  for (const result of Object.values(resultMap)) {
    playedByRound[result.round] += 1;
  }

  for (const [matchupId, result] of Object.entries(resultMap)) {
    const pickedWinner = picks[matchupId];
    if (!pickedWinner) continue;
    if (pickedWinner !== result.winner) continue;
    const points = ROUND_POINTS[result.round];
    totalScore += points;
    roundScores[result.round] += points;
    correctPicks += 1;
  }

  const possiblePicks = SCORING_ROUNDS.reduce((sum, round) => sum + playedByRound[round], 0);
  const remainingPotential = SCORING_ROUNDS.reduce((sum, round) => {
    const remainingGames = Math.max(0, GAMES_PER_ROUND[round] - playedByRound[round]);
    return sum + remainingGames * ROUND_POINTS[round];
  }, 0);

  return {
    totalScore,
    correctPicks,
    possiblePicks,
    maxRemaining: totalScore + remainingPotential,
    roundScores,
    playedByRound,
  };
}
