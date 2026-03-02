export type Region = "East" | "West" | "South" | "Midwest";

export type Round = "R64" | "R32" | "S16" | "E8" | "F4" | "CHAMP";

export type Side = "Left" | "Right";

export type OddsDisplayMode = "dual" | "american" | "implied" | "decimal";

export interface Team {
  id: string;
  name: string;
  seed: number;
  region: Region;
  rating: number;
  logoUrl?: string;
}

export interface GameTemplate {
  id: string;
  round: Round;
  region: Region | null;
  side: Side | null;
  slot: number;
  sourceGameIds: [string, string] | null;
  initialTeamIds: [string, string] | null;
}

export interface ResolvedGame extends GameTemplate {
  teamAId: string | null;
  teamBId: string | null;
  winnerId: string | null;
  lockedByUser: boolean;
  customProbA: number | null;
}

export interface FuturesRow {
  teamId: string;
  round2Prob: number;
  sweet16Prob: number;
  elite8Prob: number;
  final4Prob: number;
  titleGameProb: number;
  champProb: number;
}

export interface GameWinProbability {
  teamId: string;
  prob: number;
}

export interface ChaosDistribution {
  scores: number[];
  percentiles: Record<number, number>;
  perGameScores?: Record<string, number[]>;
  simRuns?: number;
}

export interface SimulationOutput {
  futures: FuturesRow[];
  gameWinProbs: Record<string, GameWinProbability[]>;
  likelihoodSimulation: number;
  likelihoodApprox: number;
  chaosDistribution?: ChaosDistribution;
}
