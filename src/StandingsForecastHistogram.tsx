import type { RankHistogramBin } from "./lib/standingsForecast";

export function StandingsForecastHistogram({
  bins,
  values,
  compact = false,
}: {
  bins: RankHistogramBin[];
  values: number[];
  compact?: boolean;
}) {
  if (bins.length === 0 || values.length === 0) return null;

  return (
    <div
      className={`sfh ${compact ? "sfh--compact" : ""}`}
      role="img"
      aria-label="Rank distribution histogram"
    >
      {bins.map((bin, index) => {
        const value = Math.max(0, Math.min(1, values[index] ?? 0));
        return (
          <div
            key={`${bin.label}-${index}`}
            className="sfh-bin"
            title={`${bin.label}: ${(value * 100).toFixed(1)}%`}
          >
            <span className="sfh-bar-wrap">
              <span className="sfh-bar" style={{ height: `${Math.max(value * 100, value > 0 ? 8 : 0)}%` }} />
            </span>
            <span className="sfh-label">{bin.label.replace(/^#/, "")}</span>
          </div>
        );
      })}
    </div>
  );
}
