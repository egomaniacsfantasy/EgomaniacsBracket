import type { ConfGameTemplate } from "./types";
import type { ConfDefWithProbMap } from "./conferenceDefs";
import type { ConfTeam } from "./data/confTeams";

/**
 * Builds an array of ConfGameTemplate for a conference tournament bracket.
 *
 * Algorithm:
 * 1. Work through rounds from first to last
 * 2. For the first round, pair bottom seeds (highest vs lowest)
 * 3. For subsequent rounds, pair bye teams with previous round winners
 *    using bracket-position ordering (top seed gets weakest path)
 * 4. Wire sourceGameIds to connect rounds
 */
export function buildConferenceBracket(
  def: ConfDefWithProbMap,
  teams: ConfTeam[]
): ConfGameTemplate[] {
  const allGames: ConfGameTemplate[] = [];
  const { id: confId, rounds } = def;

  // Sort teams by seed ascending
  const sortedTeams = [...teams].sort((a, b) => a.seed - b.seed);
  const totalTeams = sortedTeams.length;

  // Track which teams have byes to which round
  // First round participants are the bottom seeds
  const firstRoundGames = rounds[0].gameCount;
  const firstRoundTeams = firstRoundGames * 2;
  const byeTeamCount = totalTeams - firstRoundTeams;

  // Seeds 1..byeTeamCount get byes past the first round
  const byeTeams = sortedTeams.slice(0, byeTeamCount);
  const firstRoundParticipants = sortedTeams.slice(byeTeamCount);

  // Build first round: pair highest seed vs lowest seed from participants
  const r0Games: ConfGameTemplate[] = [];
  for (let i = 0; i < firstRoundGames; i++) {
    const topSeed = firstRoundParticipants[i]; // lower seed number (better)
    const bottomSeed = firstRoundParticipants[firstRoundParticipants.length - 1 - i]; // higher seed number (worse)
    const game: ConfGameTemplate = {
      id: `${confId}-${rounds[0].id}-${i}`,
      confId,
      round: rounds[0].id,
      slot: i,
      sourceGameIds: null,
      initialTeamIds: [topSeed.id, bottomSeed.id],
    };
    r0Games.push(game);
  }
  allGames.push(...r0Games);

  // For subsequent rounds, we need to figure out entrants:
  // - Winners from previous round's games
  // - Bye teams entering this round
  //
  // We assign bye teams to enter at the earliest round where the bracket
  // needs them, filling from the top seeds first.
  //
  // Structure: each subsequent round has `gameCount` games.
  // Entrants = 2 * gameCount. From previous round we get `prevGameCount` winners.
  // Remaining slots filled by bye teams.

  let prevGames = r0Games;
  let remainingByeTeams = [...byeTeams]; // sorted by seed ascending (best first)

  for (let roundIdx = 1; roundIdx < rounds.length; roundIdx++) {
    const roundDef = rounds[roundIdx];
    const roundGames: ConfGameTemplate[] = [];
    const totalSlots = roundDef.gameCount * 2;
    const winnersFromPrev = prevGames.length;
    const byesThisRound = totalSlots - winnersFromPrev;
    const byeEntrants = remainingByeTeams.splice(0, byesThisRound);

    // Build entrant list: alternate bye teams and winners to create
    // bracket-style matchups (top bye seed vs weakest winner path)
    //
    // Standard bracket ordering:
    // Game 0: seed 1 (bye) vs winner of game with lowest seeds
    // Game N-1: seed 2 (bye) vs winner of game with next lowest
    //
    // We pair bye teams (sorted best to worst) with prev winners (sorted worst to best)
    // to create standard bracket seeding.

    // Bye teams sorted by seed ascending (1, 2, 3, 4)
    // Prev game winners: slot 0 had the matchup of best-in-group vs worst-in-group

    for (let i = 0; i < roundDef.gameCount; i++) {
      const game: ConfGameTemplate = {
        id: `${confId}-${roundDef.id}-${i}`,
        confId,
        round: roundDef.id,
        slot: i,
        sourceGameIds: null,
        initialTeamIds: null,
      };

      if (byesThisRound > 0 && winnersFromPrev > 0) {
        // Mixed: bye teams + winners from previous round
        // Pair top bye seed with bottom bracket winner (weakest path)
        if (i < byeEntrants.length) {
          // This game has a bye team vs a previous round winner
          const byeTeam = byeEntrants[i];
          // Pair with the winner from the opposite end of the previous round
          const prevGameIdx = prevGames.length - 1 - i;
          if (prevGameIdx >= 0 && prevGameIdx < prevGames.length) {
            game.initialTeamIds = [byeTeam.id, null];
            game.sourceGameIds = [null, prevGames[prevGameIdx].id];
          } else {
            game.initialTeamIds = [byeTeam.id, null];
          }
        } else {
          // Both slots are winners from previous round
          const winnerIdx1 = (i - byeEntrants.length) * 2;
          const winnerIdx2 = winnerIdx1 + 1;
          if (winnerIdx1 < prevGames.length && winnerIdx2 < prevGames.length) {
            game.sourceGameIds = [prevGames[winnerIdx1].id, prevGames[winnerIdx2].id];
          }
        }
      } else if (byesThisRound === 0) {
        // All entrants are winners from previous round
        // Pair winners: first vs last, second vs second-to-last, etc.
        const idx1 = i;
        const idx2 = prevGames.length - 1 - i;
        if (idx1 < prevGames.length && idx2 < prevGames.length && idx1 !== idx2) {
          game.sourceGameIds = [prevGames[idx1].id, prevGames[idx2].id];
        } else if (idx1 < prevGames.length) {
          game.sourceGameIds = [prevGames[idx1].id, null];
        }
      } else {
        // All entrants are bye teams (shouldn't happen in practice)
        if (i * 2 < byeEntrants.length && i * 2 + 1 < byeEntrants.length) {
          game.initialTeamIds = [byeEntrants[i * 2].id, byeEntrants[i * 2 + 1].id];
        }
      }

      roundGames.push(game);
    }

    allGames.push(...roundGames);
    prevGames = roundGames;
  }

  return allGames;
}
