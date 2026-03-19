import { gameTemplates } from "../data/bracket";
import { NCAA_KNOWN_RESULTS } from "../data/ncaaKnownResults";
import type { ResolvedGame, Round } from "../types";
import { getGameWinProb, resolveGames, type LockedPicks } from "./bracket";
import { normalizeBracketPicks } from "./bracketCompletion";
import { ROUND_POINTS, scoreBracketPicks, type ScoringResult, type ScoringRound } from "./bracketScoring";

export type StandingsForecastParticipant = {
  id: string;
  picks: LockedPicks | null | undefined;
};

export type RankHistogramBin = {
  start: number;
  end: number;
  label: string;
};

export type StandingsForecastEntry = {
  finish1Prob: number;
  expectedPoints: number;
  expectedRank: number;
  rankHistogram: number[];
};

export type StandingsForecastResult = {
  simCount: number;
  seed: number;
  snapshotKey: string;
  fieldSize: number;
  bins: RankHistogramBin[];
  rows: Record<string, StandingsForecastEntry>;
  generatedAt: number;
};

type PreparedParticipant = {
  id: string;
  normalizedPicks: LockedPicks;
  baseScore: number;
};

type FutureGameSupporters = {
  id: string;
  points: number;
  supportersByWinner: Map<string, number[]>;
};

type ComputeOptions = {
  simCount?: number;
  scopeKey?: string;
  onProgress?: (completedRuns: number, totalRuns: number) => void;
};

const FORECAST_CACHE_PREFIX = "og_standings_forecast_v1";
const DEFAULT_SIM_COUNT = 10_000;
const YIELD_INTERVAL_RUNS = 100;

const roundRank: Record<Round, number> = {
  FF: 0,
  R64: 1,
  R32: 2,
  S16: 3,
  E8: 4,
  F4: 5,
  CHAMP: 6,
};

const orderedTemplates = [...gameTemplates].sort((a, b) => {
  const rankDiff = roundRank[a.round] - roundRank[b.round];
  if (rankDiff !== 0) return rankDiff;
  return a.slot - b.slot;
});

const scoringRoundByBracketRound: Partial<Record<Round, ScoringRound>> = {
  R64: 64,
  R32: 32,
  S16: 16,
  E8: 8,
  F4: 4,
  CHAMP: 2,
};

const fnv1aHash = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const mulberry32 = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let z = t;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
};

type CachedValue<T> = {
  savedAt: number;
  value: T;
};

function readCachedValue<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedValue<T> | T;
    if (parsed && typeof parsed === "object" && "value" in parsed) {
      return (parsed as CachedValue<T>).value;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

function writeCachedValue<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    const payload: CachedValue<T> = { value, savedAt: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
}

function buildRankBins(fieldSize: number): RankHistogramBin[] {
  if (fieldSize <= 0) return [];

  if (fieldSize <= 12) {
    return Array.from({ length: fieldSize }, (_, index) => ({
      start: index + 1,
      end: index + 1,
      label: `#${index + 1}`,
    }));
  }

  const bins: RankHistogramBin[] = [];
  const pushBin = (start: number, end: number, label: string) => {
    if (start > fieldSize) return;
    bins.push({
      start,
      end: Math.min(fieldSize, end),
      label,
    });
  };

  pushBin(1, 1, "#1");
  pushBin(2, 2, "#2");
  pushBin(3, 3, "#3");
  pushBin(4, 5, "#4-5");
  pushBin(6, 10, "#6-10");
  pushBin(11, 25, "#11-25");
  pushBin(26, 50, "#26-50");

  if (fieldSize >= 51) {
    pushBin(51, fieldSize, "#51+");
  }

  return bins;
}

function buildRankToBinIndex(fieldSize: number, bins: RankHistogramBin[]) {
  const rankToBinIndex = new Array<number>(fieldSize + 1).fill(0);
  bins.forEach((bin, binIndex) => {
    for (let rank = bin.start; rank <= bin.end; rank += 1) {
      rankToBinIndex[rank] = binIndex;
    }
  });
  return rankToBinIndex;
}

function buildFixedLocks(resultMap: Record<string, ScoringResult>): LockedPicks {
  const scoreLocks = Object.fromEntries(
    Object.entries(resultMap).map(([matchupId, result]) => [matchupId, result.winner]),
  ) as LockedPicks;

  return resolveGames({
    ...NCAA_KNOWN_RESULTS,
    ...scoreLocks,
  }).sanitized;
}

function buildSnapshotKey(
  scopeKey: string,
  simCount: number,
  participants: PreparedParticipant[],
  resultMap: Record<string, ScoringResult>,
) {
  const participantSignature = participants
    .map((participant) => {
      const picksSignature = Object.entries(participant.normalizedPicks)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([gameId, winnerId]) => `${gameId}:${winnerId}`)
        .join("|");
      return `${participant.id}::${picksSignature}`;
    })
    .sort()
    .join("||");

  const resultSignature = Object.entries(resultMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([matchupId, result]) => `${matchupId}:${result.winner}`)
    .join("|");

  return `${scopeKey}::${simCount}::${resultSignature}::${participantSignature}`;
}

function prepareParticipants(
  participants: StandingsForecastParticipant[],
  resultMap: Record<string, ScoringResult>,
): PreparedParticipant[] {
  return participants.map((participant) => {
    const normalizedPicks = normalizeBracketPicks(participant.picks ?? {});
    const score = scoreBracketPicks(normalizedPicks, resultMap);
    return {
      id: participant.id,
      normalizedPicks,
      baseScore: score.totalScore,
    };
  });
}

function buildFutureGameSupporters(
  participants: PreparedParticipant[],
  resultMap: Record<string, ScoringResult>,
): FutureGameSupporters[] {
  return orderedTemplates.flatMap((template) => {
    const scoringRound = scoringRoundByBracketRound[template.round];
    if (!scoringRound) return [];
    if (resultMap[template.id]) return [];

    const supportersByWinner = new Map<string, number[]>();
    participants.forEach((participant, participantIndex) => {
      const pickedWinner = participant.normalizedPicks[template.id];
      if (!pickedWinner) return;
      const existing = supportersByWinner.get(pickedWinner);
      if (existing) {
        existing.push(participantIndex);
        return;
      }
      supportersByWinner.set(pickedWinner, [participantIndex]);
    });

    return [{
      id: template.id,
      points: ROUND_POINTS[scoringRound],
      supportersByWinner,
    }];
  });
}

function buildResolvedGame(
  templateIndex: number,
  winnerByGameId: Record<string, string>,
): ResolvedGame | null {
  const template = orderedTemplates[templateIndex];
  let teamAId = template.initialTeamIds?.[0] ?? null;
  let teamBId = template.initialTeamIds?.[1] ?? null;

  if (!teamAId && template.sourceGameIds?.[0]) {
    teamAId = winnerByGameId[template.sourceGameIds[0]] ?? null;
  }
  if (!teamBId && template.sourceGameIds?.[1]) {
    teamBId = winnerByGameId[template.sourceGameIds[1]] ?? null;
  }

  if (!teamAId || !teamBId) return null;

  return {
    ...template,
    teamAId,
    teamBId,
    winnerId: null,
    lockedByUser: false,
    customProbA: null,
  };
}

function shuffleSlice(indices: number[], start: number, endExclusive: number, random: () => number) {
  for (let index = endExclusive - 1; index > start; index -= 1) {
    const swapIndex = start + Math.floor(random() * (index - start + 1));
    const tmp = indices[index];
    indices[index] = indices[swapIndex];
    indices[swapIndex] = tmp;
  }
}

function rankParticipants(scores: number[], random: () => number) {
  const indices = Array.from({ length: scores.length }, (_, index) => index);
  indices.sort((left, right) => scores[right] - scores[left] || left - right);

  for (let start = 0; start < indices.length; ) {
    let end = start + 1;
    while (end < indices.length && scores[indices[end]] === scores[indices[start]]) {
      end += 1;
    }
    if (end - start > 1) {
      shuffleSlice(indices, start, end, random);
    }
    start = end;
  }

  return indices;
}

function formatResult(result: StandingsForecastResult, cacheKey: string): StandingsForecastResult {
  writeCachedValue(cacheKey, result);
  return result;
}

async function yieldToBrowser() {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

export async function computeStandingsForecast(
  participants: StandingsForecastParticipant[],
  resultMap: Record<string, ScoringResult>,
  options: ComputeOptions = {},
): Promise<StandingsForecastResult> {
  const simCount = Math.max(1, Math.floor(options.simCount ?? DEFAULT_SIM_COUNT));
  const preparedParticipants = prepareParticipants(participants, resultMap);
  const scopeKey = options.scopeKey ?? "default";
  const snapshotKey = buildSnapshotKey(scopeKey, simCount, preparedParticipants, resultMap);
  const cacheKey = `${FORECAST_CACHE_PREFIX}:${snapshotKey}`;
  const cached = readCachedValue<StandingsForecastResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const fieldSize = preparedParticipants.length;
  const bins = buildRankBins(fieldSize);
  const rankToBinIndex = buildRankToBinIndex(fieldSize, bins);
  const fixedLocks = buildFixedLocks(resultMap);
  const futureGames = buildFutureGameSupporters(preparedParticipants, resultMap);
  const snapshotSeed = fnv1aHash(snapshotKey) || 1;
  const random = mulberry32(snapshotSeed);

  const winCounts = new Array<number>(fieldSize).fill(0);
  const scoreSums = new Array<number>(fieldSize).fill(0);
  const rankSums = new Array<number>(fieldSize).fill(0);
  const histogramCounts = Array.from({ length: fieldSize }, () => new Array<number>(bins.length).fill(0));
  const baseScores = preparedParticipants.map((participant) => participant.baseScore);

  for (let runIndex = 0; runIndex < simCount; runIndex += 1) {
    const winnerByGameId: Record<string, string> = {};
    const finalScores = baseScores.slice();
    let futureGameIndex = 0;

    for (let templateIndex = 0; templateIndex < orderedTemplates.length; templateIndex += 1) {
      const template = orderedTemplates[templateIndex];
      const resolvedGame = buildResolvedGame(templateIndex, winnerByGameId);
      if (!resolvedGame?.teamAId || !resolvedGame.teamBId) {
        continue;
      }

      const lockedWinner = fixedLocks[template.id];
      let winnerId = lockedWinner;

      if (!winnerId || (winnerId !== resolvedGame.teamAId && winnerId !== resolvedGame.teamBId)) {
        const probA = getGameWinProb(resolvedGame, resolvedGame.teamAId);
        winnerId =
          probA === null
            ? resolvedGame.teamAId
            : random() < probA
              ? resolvedGame.teamAId
              : resolvedGame.teamBId;
      }

      winnerByGameId[template.id] = winnerId;

      if (scoringRoundByBracketRound[template.round] && !resultMap[template.id]) {
        const futureGame = futureGames[futureGameIndex];
        futureGameIndex += 1;
        const supporters = futureGame?.supportersByWinner.get(winnerId);
        if (supporters) {
          for (let supporterIndex = 0; supporterIndex < supporters.length; supporterIndex += 1) {
            finalScores[supporters[supporterIndex]] += futureGame.points;
          }
        }
      }
    }

    const rankedIndices = rankParticipants(finalScores, random);
    rankedIndices.forEach((participantIndex, position) => {
      const rank = position + 1;
      if (position === 0) {
        winCounts[participantIndex] += 1;
      }
      scoreSums[participantIndex] += finalScores[participantIndex];
      rankSums[participantIndex] += rank;
      const binIndex = rankToBinIndex[rank] ?? 0;
      histogramCounts[participantIndex][binIndex] += 1;
    });

    if ((runIndex + 1) % YIELD_INTERVAL_RUNS === 0 || runIndex === simCount - 1) {
      options.onProgress?.(runIndex + 1, simCount);
      await yieldToBrowser();
    }
  }

  const rows = Object.fromEntries(
    preparedParticipants.map((participant, participantIndex) => [
      participant.id,
      {
        finish1Prob: winCounts[participantIndex] / simCount,
        expectedPoints: scoreSums[participantIndex] / simCount,
        expectedRank: rankSums[participantIndex] / simCount,
        rankHistogram: histogramCounts[participantIndex].map((count) => count / simCount),
      } satisfies StandingsForecastEntry,
    ]),
  );

  return formatResult(
    {
      simCount,
      seed: snapshotSeed,
      snapshotKey,
      fieldSize,
      bins,
      rows,
      generatedAt: Date.now(),
    },
    cacheKey,
  );
}
