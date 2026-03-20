import type { RankHistogramBin } from "./standingsForecast";

export type ForecastOddsFormat = "percent" | "american";

const NEAR_ZERO_PROBABILITY = 0.0001;
const NEAR_CERTAIN_PROBABILITY = 0.999;

function ordinal(value: number) {
  const remainder10 = value % 10;
  const remainder100 = value % 100;
  if (remainder10 === 1 && remainder100 !== 11) return `${value}st`;
  if (remainder10 === 2 && remainder100 !== 12) return `${value}nd`;
  if (remainder10 === 3 && remainder100 !== 13) return `${value}rd`;
  return `${value}th`;
}

export function formatForecastProbability(
  probability: number | null | undefined,
  format: ForecastOddsFormat = "percent",
) {
  if (typeof probability !== "number" || !Number.isFinite(probability) || probability < NEAR_ZERO_PROBABILITY) {
    return "—";
  }

  if (format === "percent") {
    if (probability > NEAR_CERTAIN_PROBABILITY) return "99.9%+";
    return `${(probability * 100).toFixed(probability >= 0.1 ? 1 : 2)}%`;
  }

  if (probability > NEAR_CERTAIN_PROBABILITY) return "LOCK";
  if (probability >= 0.5) {
    return `${Math.round((-100 * probability) / (1 - probability))}`;
  }
  return `+${Math.round((100 * (1 - probability)) / probability)}`;
}

export function getForecastHeaderLabel(format: ForecastOddsFormat) {
  return format === "american" ? "WIN ODDS" : "WIN %";
}

function formatRankRange(bin: RankHistogramBin) {
  if (bin.start === bin.end) return `${ordinal(bin.start)} place`;
  return `${ordinal(bin.start)}-${ordinal(bin.end)}`;
}

function getEditorialLine(bin: RankHistogramBin, probability: number, fieldSize: number) {
  if (bin.start === 1) {
    if (probability >= 0.15) return "The favorite, but far from a lock.";
    if (probability >= 0.05) return "A real path to the top, but no room to coast.";
    if (probability >= 0.01) return "Still very live. Needs the bracket to break clean.";
    if (probability >= 0.003) return "Alive, but drawing thin from here.";
    return "Wins in a sliver of futures. Needs chaos and help.";
  }

  if (bin.end <= 3) {
    if (probability >= 0.15) return "Podium territory shows up a lot in the sim tree.";
    return "Near the top often enough to stay dangerous.";
  }

  if (bin.start <= Math.max(4, Math.ceil(fieldSize / 3))) {
    return "Usually hanging around the top of the board when things click.";
  }

  if (bin.start > Math.max(4, Math.floor(fieldSize * 0.75))) {
    return "The math pulls this one toward the basement more often than not.";
  }

  return "The range is wide here. This path still has some swing in it.";
}

export function buildHistogramTooltipCopy({
  bin,
  probability,
  simCount,
  fieldSize,
  format,
}: {
  bin: RankHistogramBin;
  probability: number;
  simCount: number;
  fieldSize: number;
  format: ForecastOddsFormat;
}) {
  const formattedProbability = formatForecastProbability(probability, format);
  const headline = `${formatRankRange(bin)} — ${formattedProbability}`;
  const simCountEstimate = `~${Math.round(probability * simCount).toLocaleString()} of ${simCount.toLocaleString()} sims`;
  const editorial = getEditorialLine(bin, probability, fieldSize);
  return { headline, simCountEstimate, editorial };
}
