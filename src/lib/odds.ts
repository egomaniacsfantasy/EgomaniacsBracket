import type { OddsDisplayMode } from "../types";

export const clampDisplayProb = (prob: number): number => {
  if (!Number.isFinite(prob)) return 0.5;
  return Math.max(0.001, Math.min(0.999, prob));
};

export const winProb = (ratingA: number, ratingB: number): number =>
  1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));

export const toAmericanOdds = (prob: number): number => {
  const p = clampDisplayProb(prob);
  const raw = p >= 0.5 ? -(p / (1 - p)) * 100 : ((1 - p) / p) * 100;
  return Math.max(-99900, Math.min(99900, Math.round(raw)));
};

export const toDecimalOdds = (prob: number): number => 1 / clampDisplayProb(prob);

export const formatAmerican = (odds: number): string => (odds > 0 ? `+${odds}` : `${odds}`);

export const toImpliedLabel = (prob: number): string => {
  if (!Number.isFinite(prob)) return "50.0%";
  if (prob >= 1) return "100%";
  if (prob <= 0) return "0%";
  return `${(clampDisplayProb(prob) * 100).toFixed(1)}%`;
};

export const toOneInX = (prob: number): string => {
  if (prob <= 0) return "Never";
  return `1 in ${(1 / prob).toFixed(prob < 0.01 ? 0 : 1)}`;
};

export const formatOddsDisplay = (
  prob: number,
  mode: OddsDisplayMode
): { primary: string; secondary?: string } => {
  if (Number.isFinite(prob) && prob >= 1) {
    const implied = toImpliedLabel(prob);
    if (mode === "american") return { primary: "LOCK" };
    if (mode === "implied") return { primary: implied };
    if (mode === "decimal") return { primary: "1.00" };
    return { primary: "LOCK", secondary: implied };
  }

  if (Number.isFinite(prob) && prob <= 0) {
    const implied = toImpliedLabel(prob);
    if (mode === "american") return { primary: "0%" };
    if (mode === "implied") return { primary: implied };
    if (mode === "decimal") return { primary: "—" };
    return { primary: "—", secondary: implied };
  }

  const americanRaw = toAmericanOdds(prob);
  const american = americanRaw > 50000 ? "+50000+" : formatAmerican(americanRaw);
  const implied = toImpliedLabel(prob);
  const decimal = toDecimalOdds(prob).toFixed(2);

  if (mode === "american") return { primary: american };
  if (mode === "implied") return { primary: implied };
  if (mode === "decimal") return { primary: decimal };

  return { primary: american, secondary: implied };
};
