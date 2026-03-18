import { gameTemplates } from "../data/bracket";
import { NCAA_KNOWN_RESULTS } from "../data/ncaaKnownResults";
import { resolveGames, type LockedPicks } from "./bracket";

export const TOTAL_BRACKET_GAME_COUNT = gameTemplates.length;
export const SUBMITTABLE_BRACKET_GAME_COUNT = gameTemplates.filter((game) => game.round !== "FF").length;

export type BracketCompletionSummary = {
  totalGames: number;
  completedGames: number;
  requiredSubmittableGames: number;
  completedSubmittableGames: number;
  remainingSubmittableGames: number;
  completionPct: number;
  isComplete: boolean;
};

export const mergeKnownNcaaResults = (picks: LockedPicks): LockedPicks => ({
  ...picks,
  ...NCAA_KNOWN_RESULTS,
});

export const resolveBracketWithKnownResults = (picks: LockedPicks) => resolveGames(mergeKnownNcaaResults(picks ?? {}));

export function getBracketCompletionSummary(picks: LockedPicks): BracketCompletionSummary {
  const { games } = resolveBracketWithKnownResults(picks ?? {});
  const completedGames = games.filter((game) => Boolean(game.winnerId && game.teamAId && game.teamBId)).length;
  const completedSubmittableGames = games.filter(
    (game) => game.round !== "FF" && Boolean(game.winnerId && game.teamAId && game.teamBId)
  ).length;

  return {
    totalGames: TOTAL_BRACKET_GAME_COUNT,
    completedGames: Math.min(TOTAL_BRACKET_GAME_COUNT, completedGames),
    requiredSubmittableGames: SUBMITTABLE_BRACKET_GAME_COUNT,
    completedSubmittableGames: Math.min(SUBMITTABLE_BRACKET_GAME_COUNT, completedSubmittableGames),
    remainingSubmittableGames: Math.max(0, SUBMITTABLE_BRACKET_GAME_COUNT - completedSubmittableGames),
    completionPct:
      TOTAL_BRACKET_GAME_COUNT > 0 ? Math.round((Math.min(TOTAL_BRACKET_GAME_COUNT, completedGames) / TOTAL_BRACKET_GAME_COUNT) * 100) : 0,
    isComplete: completedSubmittableGames >= SUBMITTABLE_BRACKET_GAME_COUNT,
  };
}
