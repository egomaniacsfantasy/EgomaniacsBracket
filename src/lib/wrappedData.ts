import type { FuturesRow, ResolvedGame, Round, SimulationOutput } from "../types";
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

  // === CARD 3: UNLIKELY RUN ===
  unlikelyRun: {
    teamName: string;
    teamSeed: number;
    teamId: string;
    teamLogoUrl: string;
    roundReached: string;
    roundKey: string;
    baselineProb: number;
    region: string;
  };

  // === CARD 4: THE PATH ===
  championPath: {
    championName: string;
    championSeed: number;
    championId: string;
    championLogoUrl: string;
    games: Array<{
      round: string;
      roundLabel: string;
      opponentName: string;
      opponentSeed: number;
      opponentId: string;
      opponentLogoUrl: string;
      winProbability: number;
    }>;
    pathProbability: number;
    toughestGame: {
      round: string;
      roundLabel: string;
      opponentName: string;
      opponentSeed: number;
      winProbability: number;
    };
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
    "Your bracket looked at the favorites and chose violence. {unlikelyRunTeam} on a {unlikelyRunRound} run at {unlikelyRunProb}. The gods are intrigued.",
    "{numUpsets} upsets scattered across the bracket like a tornado through a trailer park. {champion} somehow survives the chaos. We'll see.",
  ],
  "Chaos Agent": [
    "{numUpsets} double-digit seeds past the first weekend, {unlikelyRunTeam} on a {unlikelyRunRound} run at {unlikelyRunProb}, and a perfect bracket line longer than a phone number. The gods are entertained.",
    "You didn't fill a bracket — you wrote fan fiction. {champion} at {championOdds}, {unlikelyRunTeam} on a {unlikelyRunRound} run at {unlikelyRunProb}, and {numUpsets} upsets clearing the path.",
    "Your bracket has the structural integrity of a paper towel in a hurricane. {numUpsets} upsets, a {pathProb} path to the title, and {champion} has to get through {toughestOpponent} in the {toughestRound}. The gods admire the delusion.",
    "{numUpsets} upsets. {unlikelyRunTeam} reaching the {unlikelyRunRound} carried just {unlikelyRunProb} baseline odds. The gods are not responsible for what happens next.",
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function probToAmericanStr(prob: number): string {
  return formatAmerican(toAmericanOdds(prob));
}

function formatPercent(prob: number): string {
  const percent = prob * 100;
  const decimals = percent > 0 && percent < 10 ? 1 : 0;
  return `${percent.toFixed(decimals)}%`;
}

function formatBracketLine(prob: number): string {
  if (prob <= 0 || !isFinite(prob)) return "+∞";
  const raw = (1 - prob) / prob;

  if (raw >= 1e15) {
    const trillions = raw / 1e12;
    if (trillions >= 1000) {
      return "+" + (trillions / 1000).toFixed(1) + " Quadrillion";
    }
    return "+" + trillions.toFixed(0) + " Trillion";
  }
  if (raw >= 1e12) {
    return "+" + (raw / 1e12).toFixed(1) + " Trillion";
  }
  if (raw >= 1e9) {
    return "+" + (raw / 1e9).toFixed(1) + " Billion";
  }

  // Under a billion — show full number with commas
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const rounded = Math.round(raw / (magnitude / 10)) * (magnitude / 10);
  return "+" + Math.round(rounded).toLocaleString("en-US");
}

export function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const remainder = n % 100;
  if (remainder >= 11 && remainder <= 13) return n + "th";
  return n + (suffixes[n % 10] || "th");
}

function getOpponentId(game: ResolvedGame, teamId: string): string | null {
  if (game.teamAId === teamId) return game.teamBId;
  if (game.teamBId === teamId) return game.teamAId;
  return null;
}

interface ReachedRoundMeta {
  roundKey: string;
  roundReached: string;
  baselineField: keyof Omit<FuturesRow, "teamId">;
  depth: number;
}

const REACHED_ROUND_BY_GAME_ROUND: Partial<Record<Round, ReachedRoundMeta>> = {
  R32: {
    roundKey: "S16",
    roundReached: "Sweet 16",
    baselineField: "sweet16Prob",
    depth: 3,
  },
  S16: {
    roundKey: "E8",
    roundReached: "Elite 8",
    baselineField: "elite8Prob",
    depth: 4,
  },
  E8: {
    roundKey: "F4",
    roundReached: "Final Four",
    baselineField: "final4Prob",
    depth: 5,
  },
  F4: {
    roundKey: "CHAMP",
    roundReached: "Championship",
    baselineField: "titleGameProb",
    depth: 6,
  },
  CHAMP: {
    roundKey: "CHAMPION",
    roundReached: "Champion",
    baselineField: "champProb",
    depth: 7,
  },
};

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

export function computeWrappedData(args: {
  resolvedGames: ResolvedGame[];
  simResult: SimulationOutput;
  baselineByTeamId: Map<string, FuturesRow>;
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
  // CARD 3: UNLIKELY RUN
  // =========================================================================

  const furthestRunByTeam = new Map<
    string,
    {
      meta: ReachedRoundMeta;
      teamName: string;
      teamSeed: number;
      teamLogoUrl: string;
      region: string;
    }
  >();

  for (const game of resolvedGames) {
    if (!game.winnerId || !game.lockedByUser) continue;
    const reachedMeta = REACHED_ROUND_BY_GAME_ROUND[game.round];
    if (!reachedMeta) continue;

    const team = teamsById.get(game.winnerId);
    if (!team) continue;

    const existing = furthestRunByTeam.get(game.winnerId);
    if (!existing || reachedMeta.depth > existing.meta.depth) {
      furthestRunByTeam.set(game.winnerId, {
        meta: reachedMeta,
        teamName: team.name,
        teamSeed: team.seed,
        teamLogoUrl: teamLogoUrl(team),
        region: team.region,
      });
    }
  }

  let unlikelyRun:
    | (WrappedData["unlikelyRun"] & {
        depth: number;
      })
    | null = null;

  for (const [teamId, run] of furthestRunByTeam) {
    const baselineRow = baselineByTeamId.get(teamId);
    const baselineProb = baselineRow?.[run.meta.baselineField] ?? 0;

    if (
      unlikelyRun === null ||
      baselineProb < unlikelyRun.baselineProb - 1e-9 ||
      (Math.abs(baselineProb - unlikelyRun.baselineProb) <= 1e-9 && run.meta.depth > unlikelyRun.depth)
    ) {
      unlikelyRun = {
        teamId,
        teamName: run.teamName,
        teamSeed: run.teamSeed,
        teamLogoUrl: run.teamLogoUrl,
        roundReached: run.meta.roundReached,
        roundKey: run.meta.roundKey,
        baselineProb,
        region: run.region,
        depth: run.meta.depth,
      };
    }
  }

  // =========================================================================
  // CARD 4+5: CHAMPION, FINAL FOUR, BRACKET LINE, CHAMPION PATH
  // =========================================================================

  const champGame = resolvedGames.find((g) => g.round === "CHAMP");
  const championTeamId = champGame?.winnerId ?? "";
  const championTeam = teamsById.get(championTeamId);
  const champProbability = currentChampByTeamId[championTeamId] ?? 0;
  const baselineChampProbability = baselineByTeamId.get(championTeamId)?.champProb ?? 0;

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

  // Champion path: trace the champion's 6-game route to the title
  const PATH_ROUND_LABELS: Record<string, string> = {
    R64: "Round of 64",
    R32: "Round of 32",
    S16: "Sweet 16",
    E8: "Elite 8",
    F4: "Final Four",
    CHAMP: "Championship",
  };

  const PATH_ROUNDS: string[] = ["R64", "R32", "S16", "E8", "F4", "CHAMP"];

  const championPathGames: WrappedData["championPath"]["games"] = [];

  for (const round of PATH_ROUNDS) {
    const game = resolvedGames.find(
      (g) =>
        g.round === round &&
        g.winnerId &&
        (g.teamAId === championTeamId || g.teamBId === championTeamId)
    );
    if (!game || !game.winnerId) continue;

    const opponentId = getOpponentId(game, championTeamId);
    if (!opponentId) continue;
    const opponent = teamsById.get(opponentId);
    if (!opponent) continue;

    const champWinProb = getGameWinProb(game, championTeamId) ?? 0.5;

    championPathGames.push({
      round,
      roundLabel: PATH_ROUND_LABELS[round] ?? round,
      opponentName: opponent.name,
      opponentSeed: opponent.seed,
      opponentId: opponentId,
      opponentLogoUrl: teamLogoUrl(opponent),
      winProbability: champWinProb,
    });
  }

  const pathProbability = championPathGames.reduce((acc, g) => acc * g.winProbability, 1);

  const toughestGameEntry = championPathGames.length > 0
    ? championPathGames.reduce((worst, g) => (g.winProbability < worst.winProbability ? g : worst))
    : { round: "R64", roundLabel: "Round of 64", opponentName: "TBD", opponentSeed: 0, winProbability: 0.5 };

  // =========================================================================
  // ROAST TEXT
  // =========================================================================

  const templates = ROAST_TEMPLATES[chaosLabel] ?? ROAST_TEMPLATES["Balanced"];
  const template = templates[Math.floor(Math.random() * templates.length)];

  const champOddsStr = baselineChampProbability > 0
    ? probToAmericanStr(baselineChampProbability)
    : "+∞";

  const fallbackUnlikelyRun = championTeam
    ? {
        teamId: championTeamId,
        teamName: championTeam.name,
        teamSeed: championTeam.seed,
        teamLogoUrl: teamLogoUrl(championTeam),
        roundReached: "Champion",
        roundKey: "CHAMPION",
        baselineProb: baselineChampProbability,
        region: championTeam.region,
        depth: 7,
      }
    : {
        teamId: boldestWinnerId,
        teamName: boldestWinner.name,
        teamSeed: boldestWinner.seed,
        teamLogoUrl: teamLogoUrl(boldestWinner),
        roundReached: "Sweet 16",
        roundKey: "S16",
        baselineProb: baselineByTeamId.get(boldestWinnerId)?.sweet16Prob ?? 0,
        region: boldestWinner.region,
        depth: 3,
      };

  const resolvedUnlikelyRun = unlikelyRun ?? fallbackUnlikelyRun;
  const unlikelyRunRoundLabel = resolvedUnlikelyRun.roundReached === "Champion"
    ? "title"
    : resolvedUnlikelyRun.roundReached;

  const pathProbStr = (pathProbability * 100).toFixed(1) + "%";

  const roastText = template
    .replace(/\{champion\}/g, championTeam?.name ?? "Your champion")
    .replace(/\{championOdds\}/g, champOddsStr)
    .replace(/\{numUpsets\}/g, String(numUpsets))
    .replace(/\{unlikelyRunTeam\}/g, resolvedUnlikelyRun.teamName)
    .replace(/\{unlikelyRunRound\}/g, unlikelyRunRoundLabel)
    .replace(/\{unlikelyRunProb\}/g, formatPercent(resolvedUnlikelyRun.baselineProb))
    .replace(/\{pathProb\}/g, pathProbStr)
    .replace(/\{toughestOpponent\}/g, toughestGameEntry.opponentName)
    .replace(/\{toughestRound\}/g, toughestGameEntry.roundLabel)
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

    unlikelyRun: {
      teamId: resolvedUnlikelyRun.teamId,
      teamName: resolvedUnlikelyRun.teamName,
      teamSeed: resolvedUnlikelyRun.teamSeed,
      teamLogoUrl: resolvedUnlikelyRun.teamLogoUrl,
      roundReached: resolvedUnlikelyRun.roundReached,
      roundKey: resolvedUnlikelyRun.roundKey,
      baselineProb: resolvedUnlikelyRun.baselineProb,
      region: resolvedUnlikelyRun.region,
    },

    championPath: {
      championName: championTeam?.name ?? "TBD",
      championSeed: championTeam?.seed ?? 0,
      championId: championTeamId,
      championLogoUrl: championTeam ? teamLogoUrl(championTeam) : "",
      games: championPathGames,
      pathProbability,
      toughestGame: {
        round: toughestGameEntry.round,
        roundLabel: toughestGameEntry.roundLabel,
        opponentName: toughestGameEntry.opponentName,
        opponentSeed: toughestGameEntry.opponentSeed,
        winProbability: toughestGameEntry.winProbability,
      },
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
