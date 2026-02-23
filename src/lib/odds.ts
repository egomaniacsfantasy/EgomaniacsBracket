import type { OddsDisplayMode } from "../types";

export const winProb = (ratingA: number, ratingB: number): number =>
  1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));

export const toAmericanOdds = (prob: number): number => {
  const p = Math.max(0.001, Math.min(0.999, prob));
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
};

export const toDecimalOdds = (prob: number): number => 1 / Math.max(0.001, Math.min(0.999, prob));

export const formatAmerican = (odds: number): string => (odds > 0 ? `+${odds}` : `${odds}`);

export const toImpliedLabel = (prob: number): string => `${(prob * 100).toFixed(1)}%`;

export const toOneInX = (prob: number): string => {
  if (prob <= 0) return "Never";
  return `1 in ${(1 / prob).toFixed(prob < 0.01 ? 0 : 1)}`;
};

export const formatOddsDisplay = (
  prob: number,
  mode: OddsDisplayMode
): { primary: string; secondary?: string } => {
  const american = formatAmerican(toAmericanOdds(prob));
  const implied = toImpliedLabel(prob);
  const decimal = toDecimalOdds(prob).toFixed(2);

  if (mode === "american") return { primary: american };
  if (mode === "implied") return { primary: implied };
  if (mode === "decimal") return { primary: decimal };

  return { primary: american, secondary: implied };
};
