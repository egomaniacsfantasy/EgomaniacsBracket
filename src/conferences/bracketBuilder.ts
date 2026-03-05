import type { ConfGameTemplate } from "./types";
import type { ConfDefWithProbMap } from "./conferenceDefs";
import type { ConfTeam } from "./data/confTeams";

/**
 * Explicit per-conference bracket recipes.
 *
 * Each recipe is an ordered list of rounds (first → final). Each round
 * specifies its matchups as pairs of SlotDefs:
 *   s(n)      — seed n gets a bye to this round (initialTeamId)
 *   g(r, s)   — winner of round-index r, slot s feeds this side (sourceGameId)
 *
 * Slot ordering within each round matters for:
 *   1. Visual bracket layout (slot 0 = top)
 *   2. Correct SF pairings: slots {0,1} form one semi, {2,3} the other
 *
 * Standard QF pattern used by all conferences except WCC and MAC:
 *   [1 vs path-for-8, 4 vs path-for-5, 2 vs path-for-7, 3 vs path-for-6]
 *   → SF-0: 1/4 bracket half; SF-1: 2/3 bracket half
 */

type SlotDef =
  | { kind: "seed"; seed: number }
  | { kind: "game"; roundIdx: number; slotIdx: number };

type RoundRecipe = { id: string; games: [SlotDef, SlotDef][] };

const s = (seed: number): SlotDef => ({ kind: "seed", seed });
const g = (roundIdx: number, slotIdx: number): SlotDef => ({ kind: "game", roundIdx, slotIdx });

const BRACKET_RECIPES: Record<string, RoundRecipe[]> = {
  // ── SEC (16 teams) ────────────────────────────────────────────────────────
  // R1:  9v16, 12v13, 10v15, 11v14
  // R2:  8v(9/16), 5v(12/13), 7v(10/15), 6v(11/14)
  // QF:  1v(8/...), 4v(5/...), 2v(7/...), 3v(6/...)
  sec: [
    { id: "R1", games: [[s(9), s(16)], [s(12), s(13)], [s(10), s(15)], [s(11), s(14)]] },
    { id: "R2", games: [[s(8), g(0, 0)], [s(5), g(0, 1)], [s(7), g(0, 2)], [s(6), g(0, 3)]] },
    { id: "QF", games: [[s(1), g(1, 0)], [s(4), g(1, 1)], [s(2), g(1, 2)], [s(3), g(1, 3)]] },
    { id: "SF", games: [[g(2, 0), g(2, 1)], [g(2, 2), g(2, 3)]] },
    { id: "F",  games: [[g(3, 0), g(3, 1)]] },
  ],

  // ── Big 12 (16 teams) ─────────────────────────────────────────────────────
  // Same structure as SEC
  big12: [
    { id: "R1", games: [[s(9), s(16)], [s(12), s(13)], [s(10), s(15)], [s(11), s(14)]] },
    { id: "R2", games: [[s(8), g(0, 0)], [s(5), g(0, 1)], [s(7), g(0, 2)], [s(6), g(0, 3)]] },
    { id: "QF", games: [[s(1), g(1, 0)], [s(4), g(1, 1)], [s(2), g(1, 2)], [s(3), g(1, 3)]] },
    { id: "SF", games: [[g(2, 0), g(2, 1)], [g(2, 2), g(2, 3)]] },
    { id: "F",  games: [[g(3, 0), g(3, 1)]] },
  ],

  // ── Big Ten (18 teams) ────────────────────────────────────────────────────
  // R1:  16v17, 15v18
  // R2:  9v(16/17), 12v13, 10v(15/18), 11v14   ← 12v13 and 11v14 are bye-vs-bye
  // R3:  8v(9/...), 5v(12/13), 7v(10/...), 6v(11/14)
  // QF:  1v(8/...), 4v(5/...), 2v(7/...), 3v(6/...)
  bigTen: [
    { id: "R1", games: [[s(16), s(17)], [s(15), s(18)]] },
    { id: "R2", games: [[s(9), g(0, 0)], [s(12), s(13)], [s(10), g(0, 1)], [s(11), s(14)]] },
    { id: "R3", games: [[s(8), g(1, 0)], [s(5), g(1, 1)], [s(7), g(1, 2)], [s(6), g(1, 3)]] },
    { id: "QF", games: [[s(1), g(2, 0)], [s(4), g(2, 1)], [s(2), g(2, 2)], [s(3), g(2, 3)]] },
    { id: "SF", games: [[g(3, 0), g(3, 1)], [g(3, 2), g(3, 3)]] },
    { id: "F",  games: [[g(4, 0), g(4, 1)]] },
  ],

  // ── ACC (15 teams) ────────────────────────────────────────────────────────
  // R1:  10v15, 12v13, 11v14
  // R2:  8v9 (bye-bye), 7v(10/15), 5v(12/13), 6v(11/14)
  // QF:  1v(8/9), 4v(5/...), 2v(7/...), 3v(6/...)
  acc: [
    { id: "R1", games: [[s(10), s(15)], [s(12), s(13)], [s(11), s(14)]] },
    { id: "R2", games: [[s(8), s(9)], [s(7), g(0, 0)], [s(5), g(0, 1)], [s(6), g(0, 2)]] },
    { id: "QF", games: [[s(1), g(1, 0)], [s(4), g(1, 2)], [s(2), g(1, 1)], [s(3), g(1, 3)]] },
    { id: "SF", games: [[g(2, 0), g(2, 1)], [g(2, 2), g(2, 3)]] },
    { id: "F",  games: [[g(3, 0), g(3, 1)]] },
  ],

  // ── Atlantic 10 (14 teams) ────────────────────────────────────────────────
  // R1:  11v14, 12v13
  // R2:  8v9 (bye-bye), 7v10 (bye-bye), 5v(12/13), 6v(11/14)
  // QF:  1v(8/9), 4v(5/...), 2v(7/10), 3v(6/...)
  a10: [
    { id: "R1", games: [[s(11), s(14)], [s(12), s(13)]] },
    { id: "R2", games: [[s(8), s(9)], [s(7), s(10)], [s(5), g(0, 1)], [s(6), g(0, 0)]] },
    { id: "QF", games: [[s(1), g(1, 0)], [s(4), g(1, 2)], [s(2), g(1, 1)], [s(3), g(1, 3)]] },
    { id: "SF", games: [[g(2, 0), g(2, 1)], [g(2, 2), g(2, 3)]] },
    { id: "F",  games: [[g(3, 0), g(3, 1)]] },
  ],

  // ── Big East (11 teams) ───────────────────────────────────────────────────
  // R1:  8v9, 7v10, 6v11
  // QF:  1v(8/9), 4v5 (bye-bye), 2v(7/10), 3v(6/11)
  bigEast: [
    { id: "R1", games: [[s(8), s(9)], [s(7), s(10)], [s(6), s(11)]] },
    { id: "QF", games: [[s(1), g(0, 0)], [s(4), s(5)], [s(2), g(0, 1)], [s(3), g(0, 2)]] },
    { id: "SF", games: [[g(1, 0), g(1, 1)], [g(1, 2), g(1, 3)]] },
    { id: "F",  games: [[g(2, 0), g(2, 1)]] },
  ],

  // ── Missouri Valley (11 teams) ────────────────────────────────────────────
  // Same structure as Big East
  mvc: [
    { id: "R1", games: [[s(8), s(9)], [s(7), s(10)], [s(6), s(11)]] },
    { id: "QF", games: [[s(1), g(0, 0)], [s(4), s(5)], [s(2), g(0, 1)], [s(3), g(0, 2)]] },
    { id: "SF", games: [[g(1, 0), g(1, 1)], [g(1, 2), g(1, 3)]] },
    { id: "F",  games: [[g(2, 0), g(2, 1)]] },
  ],

  // ── Mountain West (12 teams) ──────────────────────────────────────────────
  // R1:  8v9, 5v12, 7v10, 6v11
  // QF:  1v(8/9), 4v(5/12), 2v(7/10), 3v(6/11)
  mwc: [
    { id: "R1", games: [[s(8), s(9)], [s(5), s(12)], [s(7), s(10)], [s(6), s(11)]] },
    { id: "QF", games: [[s(1), g(0, 0)], [s(4), g(0, 1)], [s(2), g(0, 2)], [s(3), g(0, 3)]] },
    { id: "SF", games: [[g(1, 0), g(1, 1)], [g(1, 2), g(1, 3)]] },
    { id: "F",  games: [[g(2, 0), g(2, 1)]] },
  ],

  // ── WCC (12 teams, 6 rounds) ──────────────────────────────────────────────
  // Unique format: only 2 games per round; seeds 1 and 2 don't enter until SF.
  // R1:  9v12, 10v11
  // R2:  8v(9/12), 7v(10/11)
  // R3:  5v(8/...), 6v(7/...)
  // QF:  4v(5/...), 3v(6/...)
  // SF:  1v(4/...), 2v(3/...)
  wcc: [
    { id: "R1", games: [[s(9), s(12)], [s(10), s(11)]] },
    { id: "R2", games: [[s(8), g(0, 0)], [s(7), g(0, 1)]] },
    { id: "R3", games: [[s(5), g(1, 0)], [s(6), g(1, 1)]] },
    { id: "QF", games: [[s(4), g(2, 0)], [s(3), g(2, 1)]] },
    { id: "SF", games: [[s(1), g(3, 0)], [s(2), g(3, 1)]] },
    { id: "F",  games: [[g(4, 0), g(4, 1)]] },
  ],

  // ── MAC (8 teams) ─────────────────────────────────────────────────────────
  // All 8 teams enter QF directly (no first round)
  // QF:  1v8, 4v5, 2v7, 3v6
  mac: [
    { id: "QF", games: [[s(1), s(8)], [s(4), s(5)], [s(2), s(7)], [s(3), s(6)]] },
    { id: "SF", games: [[g(0, 0), g(0, 1)], [g(0, 2), g(0, 3)]] },
    { id: "F",  games: [[g(1, 0), g(1, 1)]] },
  ],
};

export function buildConferenceBracket(
  def: ConfDefWithProbMap,
  teams: ConfTeam[]
): ConfGameTemplate[] {
  const recipe = BRACKET_RECIPES[def.id];
  if (!recipe) {
    console.warn(`No bracket recipe for conference: ${def.id}`);
    return [];
  }

  // Build seed → teamId lookup
  const seedToTeamId = new Map<number, number>();
  for (const t of teams) {
    seedToTeamId.set(t.seed, t.id);
  }

  const allGames: ConfGameTemplate[] = [];
  // gameIdByRound[roundIdx][slotIdx] → game ID string
  const gameIdByRound: string[][] = [];

  for (let roundIdx = 0; roundIdx < recipe.length; roundIdx++) {
    const roundRecipe = recipe[roundIdx];
    const roundGameIds: string[] = [];

    for (let slotIdx = 0; slotIdx < roundRecipe.games.length; slotIdx++) {
      const [slotA, slotB] = roundRecipe.games[slotIdx];
      const gameId = `${def.id}-${roundRecipe.id}-${slotIdx}`;

      // Resolve slot A
      let teamAId: number | null = null;
      let sourceGameIdA: string | null = null;
      if (slotA.kind === "seed") {
        teamAId = seedToTeamId.get(slotA.seed) ?? null;
      } else {
        sourceGameIdA = gameIdByRound[slotA.roundIdx]?.[slotA.slotIdx] ?? null;
      }

      // Resolve slot B
      let teamBId: number | null = null;
      let sourceGameIdB: string | null = null;
      if (slotB.kind === "seed") {
        teamBId = seedToTeamId.get(slotB.seed) ?? null;
      } else {
        sourceGameIdB = gameIdByRound[slotB.roundIdx]?.[slotB.slotIdx] ?? null;
      }

      const game: ConfGameTemplate = {
        id: gameId,
        confId: def.id,
        round: roundRecipe.id,
        slot: slotIdx,
        initialTeamIds: teamAId !== null || teamBId !== null ? [teamAId, teamBId] : null,
        sourceGameIds: sourceGameIdA !== null || sourceGameIdB !== null ? [sourceGameIdA, sourceGameIdB] : null,
      };

      allGames.push(game);
      roundGameIds.push(gameId);
    }

    gameIdByRound.push(roundGameIds);
  }

  return allGames;
}
