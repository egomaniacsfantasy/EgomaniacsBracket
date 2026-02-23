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
}

export interface FuturesRow {
  teamId: string;
  champProb: number;
  regionProb: number;
  sideProb: number;
}

export interface SimulationOutput {
  futures: FuturesRow[];
  likelihoodSimulation: number;
  likelihoodApprox: number;
}
