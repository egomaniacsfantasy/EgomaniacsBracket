import type { ResolvedGame, SimulationOutput } from "../types";
import { teamsById } from "../data/teams";
import { getGameWinProb } from "./bracket";
import { teamLogoUrl } from "./logo";
import { abbreviationForTeam } from "./abbreviation";
import { toAmericanOdds, formatAmerican } from "./odds";

// ---------------------------------------------------------------------------
// WrappedData interface — everything the Wrapped UI needs
// ---------------------------------------------------------------------------

export interface WrappedData {
  // === CARD 1: IDENTITY ===
  identity: {
    chaosLabel: string;
    chaosEmoji: string;
    chaosPercentile: number;
    chaosScore: number;
    numUpsets: number;
  };

  // === CARD 2: BOLDEST CALL ===
  boldestPick: {
    gameId: string;
    round: string;
    region: string | null;
    winnerTeamId: string;
    winnerName: string;
    winnerSeed: number;
    winnerLogoUrl: string;
    loserTeamId: string;
    loserName: string;
    loserSeed: number;
    loserLogoUrl: string;
    winProbability: number;
    simBracketFraction: string;
  };

  // === CARD 3: RIPPLE EFFECT ===
  rippleEffect: {
    totalGamesAffected: number;
    biggestCasualty: {
      teamId: string;
      teamName: string;
      teamLogoUrl: string;
      baselineChampOdds: string;
      currentChampOdds: string;
      deltaPercent: number;
    };
    causedByPick: {
      description: string;
    };
  };

  // === CARD 4: WEAKEST LINK ===
  weakestLink: {
    gameId: string;
    round: string;
    region: string | null;
    pickedTeamId: string;
    pickedTeamName: string;
    pickedTeamSeed: number;
    pickedTeamLogoUrl: string;
    opponentTeamId: string;
    opponentTeamName: string;
    opponentTeamSeed: number;
    opponentTeamLogoUrl: string;
    improvementMultiplier: number;
    pickedTeamWinProb: number;
  };

  // === CARD 5: VIRAL SHARE CARD ===
  champion: {
    teamId: string;
    teamName: string;
    teamSeed: number;
    teamLogoUrl: string;
    champOdds: string;
    champProbability: number;
  };
  finalFour: Array<{
    teamId: string;
    teamName: string;
    teamAbbrev: string;
    teamLogoUrl: string;
  }>;
  perfectBracketLine: string;
  bracketLikelihood: number;
  roastText: string;
}

// ---------------------------------------------------------------------------
// Roast templates per chaos tier
// ---------------------------------------------------------------------------

const ROAST_TEMPLATES: Record<string, string[]> = {
  Chalk: [
    "All favorites. All the time. Your bracket is so predictable the model thinks you might actually BE the model. {champion} at {championOdds}? Safe. Boring. The gods are yawning.",
    "Not a single upset past the Sweet 16. You brought a calculator to a party. The gods respect the discipline, but they're not sharing this.",
    "Your bracket reads like a textbook. {champion} wins, favorites advance, zero surprises. You played it safe. The math approves. Your friends will not.",
  ],
  "Mild Chalk": [
    "A couple of upsets for flavor, but nothing that would make the model sweat. {champion} at {championOdds} with a side of mild chaos. Like ordering a jalapeño burger and removing the jalapeño.",
    "You sprinkled in just enough upsets to feel edgy without actually risking anything. {numUpsets} upset picks. Spicy for a Tuesday.",
    "Your bracket says 'I understand variance' but also 'I'm not betting the house on it.' {champion} gets the crown, and you get a participation trophy for mild boldness.",
  ],
  Balanced: [
    "A few upsets. A few chalk picks. You're playing both sides so you always come out on top. {champion} at {championOdds}. The gods see a pragmatist.",
    "Right down the middle — {numUpsets} upsets, a healthy mix of chalk and chaos. Your bracket is the Switzerland of March Madness.",
    "Not too hot, not too cold. {champion} wins it all and your bracket walks the tightrope between safe and interesting. The model nods respectfully.",
  ],
  "Upset Heavy": [
    "{numUpsets} upsets and a dream. You trust your gut more than the model, and your bracket has the scars to prove it. {champion} at {championOdds}? Bold.",
    "Your bracket looked at the favorites and chose violence. {rippleTeam} fans are in shambles. The gods are intrigued.",
    "{numUpsets} upsets scattered across the bracket like a tornado through a trailer park. {champion} somehow survives the chaos. We'll see.",
  ],
  "Chaos Agent": [
    "{numUpsets} double-digit seeds past the first weekend, a perfect bracket line longer than a phone number, and {rippleTeam} fans cursing your name. The gods are entertained.",
    "You didn't fill a bracket — you wrote fan fiction. {champion} at {championOdds} with {numUpsets} upsets clearing the path. This bracket doesn't need luck — it needs a miracle and a therapist.",
    "Your bracket has the structural integrity of a paper towel in a hurricane. {numUpsets} upsets, a {weakestMultiplier}× weakest link, and {champion} cutting down the nets at {championOdds}. Either you're a genius or you're completely unserious. We'll find out in April.",
    "{numUpsets} upsets. {rippleTeam}'s title hopes didn't die in one game — they died in YOUR bracket. {champion} at {championOdds}. The gods are not responsible for what happens next.",
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function probToAmericanStr(prob: number): string {
  return formatAmerican(toAmericanOdds(prob));
}

function formatBracketLine(prob: number): string {
  if (prob <= 0) return "+∞";
  const raw = (1 - prob) / prob;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const rounded = Math.round(raw / (magnitude / 10)) * (magnitude / 10);
  return "+" + Math.round(rounded).toLocaleString("en-US");
}

function getOpponentId(game: ResolvedGame, teamId: string): string | null {
  if (game.teamAId === teamId) return game.teamBId;
  if (game.teamBId === teamId) return game.teamAId;
  return null;
}

const ROUND_RANK: Record<string, number> = {
  FF: 0,
  R64: 1,
  R32: 2,
  S16: 3,
  E8: 4,
  F4: 5,
  CHAMP: 6,
};

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

export function computeWrappedData(args: {
  lockedPicks: Record<string, string>;
  resolvedGames: ResolvedGame[];
  simResult: SimulationOutput;
  baselineByTeamId: Record<string, number>;
  chaosScore: number;
  chaosPercentile: number;
  chaosLabel: string;
  chaosEmoji: string;
}): WrappedData {
  const {
    resolvedGames,
    simResult,
    baselineByTeamId,
    chaosScore,
    chaosPercentile,
    chaosLabel,
    chaosEmoji,
  } = args;

  // Build current-championship-probability lookup from sim futures
  const currentChampByTeamId: Record<string, number> = {};
  for (const row of simResult.futures) {
    currentChampByTeamId[row.teamId] = row.champProb;
  }

  // =========================================================================
  // CARD 1: IDENTITY
  // =========================================================================

  let numUpsets = 0;
  for (const game of resolvedGames) {
    if (!game.winnerId || !game.lockedByUser) continue;
    if (game.round === "FF") continue;
    const winner = teamsById.get(game.winnerId);
    const opponentId = getOpponentId(game, game.winnerId);
    const opponent = opponentId ? teamsById.get(opponentId) : null;
    if (winner && opponent && winner.seed > opponent.seed) {
      numUpsets++;
    }
  }

  // =========================================================================
  // CARD 2: BOLDEST PICK
  // =========================================================================

  let boldestGame: ResolvedGame | null = null;
  let boldestProb = 1;

  for (const game of resolvedGames) {
    if (!game.winnerId || !game.lockedByUser) continue;
    if (game.round === "FF") continue;
    if (!game.teamAId || !game.teamBId) continue;

    const winnerProb = getGameWinProb(game, game.winnerId) ?? 0.5;
    if (winnerProb < boldestProb) {
      boldestProb = winnerProb;
      boldestGame = game;
    }
  }

  // Fallback: if no non-FF game found (shouldn't happen with 63 picks), use first locked game
  if (!boldestGame) {
    boldestGame = resolvedGames.find(
      (g) => g.winnerId && g.lockedByUser && g.round !== "FF"
    )!;
    boldestProb = boldestGame
      ? (getGameWinProb(boldestGame, boldestGame.winnerId!) ?? 0.5)
      : 0.5;
  }

  const boldestWinnerId = boldestGame.winnerId!;
  const boldestLoserId = getOpponentId(boldestGame, boldestWinnerId)!;
  const boldestWinner = teamsById.get(boldestWinnerId)!;
  const boldestLoser = teamsById.get(boldestLoserId)!;

  const simBracketN = Math.max(1, Math.round(1 / boldestProb));
  const simBracketFraction = `1 in ${simBracketN}`;

  // =========================================================================
  // CARD 3: RIPPLE EFFECT
  // =========================================================================

  // Count teams whose championship probability shifted > 1pp from baseline
  let gamesAffected = 0;
  const allTeamIds = Object.keys(baselineByTeamId);
  for (const teamId of allTeamIds) {
    const baseline = baselineByTeamId[teamId] ?? 0;
    const current = currentChampByTeamId[teamId] ?? 0;
    if (Math.abs(current - baseline) > 0.01) {
      gamesAffected++;
    }
  }
  // Also count teams only in sim (not in baseline) with champProb > 1%
  for (const teamId of Object.keys(currentChampByTeamId)) {
    if (!(teamId in baselineByTeamId) && currentChampByTeamId[teamId] > 0.01) {
      gamesAffected++;
    }
  }

  // Find biggest casualty: team with largest NEGATIVE championship delta
  let biggestDrop = 0;
  let casualtyTeamId: string | null = null;

  for (const teamId of allTeamIds) {
    const baseline = baselineByTeamId[teamId] ?? 0;
    const current = currentChampByTeamId[teamId] ?? 0;
    const drop = baseline - current; // positive means they lost probability
    if (drop > biggestDrop) {
      biggestDrop = drop;
      casualtyTeamId = teamId;
    }
  }

  // Default casualty if no team lost probability
  if (!casualtyTeamId) {
    // Pick the team with highest baseline that isn't the champion
    const champGame = resolvedGames.find((g) => g.round === "CHAMP");
    const champId = champGame?.winnerId;
    let bestBaseline = -1;
    for (const teamId of allTeamIds) {
      if (teamId === champId) continue;
      const bl = baselineByTeamId[teamId] ?? 0;
      if (bl > bestBaseline) {
        bestBaseline = bl;
        casualtyTeamId = teamId;
      }
    }
    if (!casualtyTeamId) casualtyTeamId = allTeamIds[0];
  }

  const casualtyTeam = teamsById.get(casualtyTeamId!)!;
  const baselineCasualtyProb = baselineByTeamId[casualtyTeamId!] ?? 0;
  const currentCasualtyProb = currentChampByTeamId[casualtyTeamId!] ?? 0;
  const deltaPercent = -((baselineCasualtyProb - currentCasualtyProb) * 100);

  // Find the user pick that caused the casualty
  let causativeGame: ResolvedGame | null = null;

  // 1. Direct elimination: game where casualty team was one of the teams and user picked opponent
  for (const game of resolvedGames) {
    if (!game.winnerId || !game.lockedByUser) continue;
    if (game.round === "FF") continue;
    if (
      (game.teamAId === casualtyTeamId || game.teamBId === casualtyTeamId) &&
      game.winnerId !== casualtyTeamId
    ) {
      if (
        !causativeGame ||
        ROUND_RANK[game.round] < ROUND_RANK[causativeGame.round]
      ) {
        causativeGame = game;
      }
    }
  }

  // 2. Indirect: boldest upset in the casualty's region
  if (!causativeGame && casualtyTeam.region) {
    let regionBoldestProb = 1;
    for (const game of resolvedGames) {
      if (!game.winnerId || !game.lockedByUser) continue;
      if (game.round === "FF") continue;
      if (game.region !== casualtyTeam.region) continue;
      const wp = getGameWinProb(game, game.winnerId) ?? 0.5;
      if (wp < regionBoldestProb) {
        regionBoldestProb = wp;
        causativeGame = game;
      }
    }
  }

  // 3. Last resort: use the overall boldest pick
  if (!causativeGame) {
    causativeGame = boldestGame;
  }

  const causeWinnerId = causativeGame.winnerId!;
  const causeLoserId = getOpponentId(causativeGame, causeWinnerId)!;
  const causeWinner = teamsById.get(causeWinnerId);
  const causeLoser = teamsById.get(causeLoserId);
  const causedDescription = causeWinner && causeLoser
    ? `you picked #${causeWinner.seed} ${causeWinner.name} over #${causeLoser.seed} ${causeLoser.name}`
    : "your bracket picks";

  // =========================================================================
  // CARD 4: WEAKEST LINK
  // =========================================================================

  let weakestGame: ResolvedGame | null = null;
  let bestMultiplier = 0;

  // First pass: R32+ games only (exclude R64 and FF)
  for (const game of resolvedGames) {
    if (!game.winnerId || !game.lockedByUser) continue;
    if (game.round === "FF" || game.round === "R64") continue;
    if (!game.teamAId || !game.teamBId) continue;

    const winnerProb = getGameWinProb(game, game.winnerId) ?? 0.5;
    const multiplier = (1 - winnerProb) / winnerProb;

    if (multiplier > bestMultiplier) {
      bestMultiplier = multiplier;
      weakestGame = game;
    }
  }

  // If best multiplier < 1.1, fall back to all games excluding boldest
  if (bestMultiplier < 1.1) {
    bestMultiplier = 0;
    weakestGame = null;
    for (const game of resolvedGames) {
      if (!game.winnerId || !game.lockedByUser) continue;
      if (game.round === "FF") continue;
      if (!game.teamAId || !game.teamBId) continue;
      if (game.id === boldestGame.id) continue; // exclude boldest pick

      const winnerProb = getGameWinProb(game, game.winnerId) ?? 0.5;
      const multiplier = (1 - winnerProb) / winnerProb;

      if (multiplier > bestMultiplier) {
        bestMultiplier = multiplier;
        weakestGame = game;
      }
    }
  }

  // Ultimate fallback: if still null, use any locked non-FF game that isn't boldest
  if (!weakestGame) {
    weakestGame = resolvedGames.find(
      (g) =>
        g.winnerId &&
        g.lockedByUser &&
        g.round !== "FF" &&
        g.id !== boldestGame.id &&
        g.teamAId &&
        g.teamBId
    ) ?? boldestGame;
    const wp = getGameWinProb(weakestGame, weakestGame.winnerId!) ?? 0.5;
    bestMultiplier = (1 - wp) / wp;
  }

  const weakestWinnerId = weakestGame.winnerId!;
  const weakestOpponentId = getOpponentId(weakestGame, weakestWinnerId)!;
  const weakestPickedTeam = teamsById.get(weakestWinnerId)!;
  const weakestOpponent = teamsById.get(weakestOpponentId)!;
  const weakestWinProb = getGameWinProb(weakestGame, weakestWinnerId) ?? 0.5;

  // =========================================================================
  // CARD 5: CHAMPION, FINAL FOUR, BRACKET LINE
  // =========================================================================

  const champGame = resolvedGames.find((g) => g.round === "CHAMP");
  const championTeamId = champGame?.winnerId ?? "";
  const championTeam = teamsById.get(championTeamId);
  const champProbability = currentChampByTeamId[championTeamId] ?? 0;
  const baselineChampProbability = baselineByTeamId[championTeamId] ?? 0;

  const f4Games = resolvedGames.filter((g) => g.round === "F4");
  const f4TeamIds = f4Games
    .flatMap((g) => [g.teamAId, g.teamBId])
    .filter((id): id is string => id != null);
  // Deduplicate
  const uniqueF4TeamIds = [...new Set(f4TeamIds)];

  const finalFour = uniqueF4TeamIds.map((id) => {
    const team = teamsById.get(id)!;
    return {
      teamId: id,
      teamName: team.name,
      teamAbbrev: abbreviationForTeam(team.name),
      teamLogoUrl: teamLogoUrl(team),
    };
  });

  const bracketLikelihood = simResult.likelihoodApprox;
  const perfectBracketLine = formatBracketLine(bracketLikelihood);

  // =========================================================================
  // ROAST TEXT
  // =========================================================================

  const templates = ROAST_TEMPLATES[chaosLabel] ?? ROAST_TEMPLATES["Balanced"];
  const template = templates[Math.floor(Math.random() * templates.length)];

  const champOddsStr = baselineChampProbability > 0
    ? probToAmericanStr(baselineChampProbability)
    : "+∞";

  const roastText = template
    .replace(/\{champion\}/g, championTeam?.name ?? "Your champion")
    .replace(/\{championOdds\}/g, champOddsStr)
    .replace(/\{numUpsets\}/g, String(numUpsets))
    .replace(/\{rippleTeam\}/g, casualtyTeam.name)
    .replace(
      /\{weakestMultiplier\}/g,
      Math.max(1, bestMultiplier).toFixed(1)
    )
    .replace(/\{boldestWinner\}/g, boldestWinner.name)
    .replace(/\{boldestLoser\}/g, boldestLoser.name)
    .replace(
      /\{boldestProb\}/g,
      `${(boldestProb * 100).toFixed(1)}%`
    );

  // =========================================================================
  // ASSEMBLE RESULT
  // =========================================================================

  return {
    identity: {
      chaosLabel,
      chaosEmoji,
      chaosPercentile,
      chaosScore,
      numUpsets,
    },

    boldestPick: {
      gameId: boldestGame.id,
      round: boldestGame.round,
      region: boldestGame.region,
      winnerTeamId: boldestWinnerId,
      winnerName: boldestWinner.name,
      winnerSeed: boldestWinner.seed,
      winnerLogoUrl: teamLogoUrl(boldestWinner),
      loserTeamId: boldestLoserId,
      loserName: boldestLoser.name,
      loserSeed: boldestLoser.seed,
      loserLogoUrl: teamLogoUrl(boldestLoser),
      winProbability: boldestProb,
      simBracketFraction,
    },

    rippleEffect: {
      totalGamesAffected: gamesAffected,
      biggestCasualty: {
        teamId: casualtyTeamId!,
        teamName: casualtyTeam.name,
        teamLogoUrl: teamLogoUrl(casualtyTeam),
        baselineChampOdds: probToAmericanStr(baselineCasualtyProb),
        currentChampOdds: probToAmericanStr(currentCasualtyProb),
        deltaPercent: Math.round(deltaPercent * 10) / 10,
      },
      causedByPick: {
        description: causedDescription,
      },
    },

    weakestLink: {
      gameId: weakestGame.id,
      round: weakestGame.round,
      region: weakestGame.region,
      pickedTeamId: weakestWinnerId,
      pickedTeamName: weakestPickedTeam.name,
      pickedTeamSeed: weakestPickedTeam.seed,
      pickedTeamLogoUrl: teamLogoUrl(weakestPickedTeam),
      opponentTeamId: weakestOpponentId,
      opponentTeamName: weakestOpponent.name,
      opponentTeamSeed: weakestOpponent.seed,
      opponentTeamLogoUrl: teamLogoUrl(weakestOpponent),
      improvementMultiplier: Math.round(bestMultiplier * 10) / 10,
      pickedTeamWinProb: weakestWinProb,
    },

    champion: {
      teamId: championTeamId,
      teamName: championTeam?.name ?? "TBD",
      teamSeed: championTeam?.seed ?? 0,
      teamLogoUrl: championTeam ? teamLogoUrl(championTeam) : "",
      champOdds: champOddsStr,
      champProbability,
    },

    finalFour,
    perfectBracketLine,
    bracketLikelihood,
    roastText,
  };
}
