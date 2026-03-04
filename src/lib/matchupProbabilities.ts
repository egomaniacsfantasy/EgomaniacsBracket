import type { Round } from "../types";
import { MATCHUP_PROB_BY_STAGE } from "./matchupProbData";

const TEAM_NAME_ALIASES: Record<string, string> = {
  "connecticut": "Connecticut",
  "iowa st": "Iowa St",
  "michigan st": "Michigan St",
  "st john s": "St John's",
  "st mary s ca": "St Mary's CA",
  "san diego st": "San Diego St",
  "n dakota st": "N Dakota St",
  "morehead st": "Morehead St",
};

const normalizeTeamToken = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/'/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const canonicalTeamNameForMatchup = (name: string): string => {
  const token = normalizeTeamToken(name);
  return TEAM_NAME_ALIASES[token] ?? name.trim();
};

export const getMatchupWinProbForRound = (teamA: string, teamB: string, round: Round): number | null => {
  const canonicalA = canonicalTeamNameForMatchup(teamA);
  const canonicalB = canonicalTeamNameForMatchup(teamB);
  const key = `${canonicalA}|${canonicalB}|${round}`;
  return MATCHUP_PROB_BY_STAGE[key] ?? null;
};
