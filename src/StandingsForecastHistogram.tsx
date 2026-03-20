import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildHistogramTooltipCopy,
  formatForecastProbability,
  type ForecastOddsFormat,
} from "./lib/forecastDisplay";
import type { RankHistogramBin } from "./lib/standingsForecast";

type HistogramVariant = "default" | "leaderboard";

function isTouchDevice() {
  if (typeof window === "undefined") return false;
  return Boolean(window.matchMedia?.("(hover: none)").matches || "ontouchstart" in window);
}

export function StandingsForecastHistogram({
  bins,
  values,
  compact = false,
  format = "percent",
  simCount = 10_000,
  variant = "default",
  showPrimaryLabel = false,
}: {
  bins: RankHistogramBin[];
  values: number[];
  compact?: boolean;
  format?: ForecastOddsFormat;
  simCount?: number;
  variant?: HistogramVariant;
  showPrimaryLabel?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const touchDevice = useMemo(() => isTouchDevice(), []);

  const displayBins = useMemo(
    () =>
      bins.map((bin, index) => ({
        ...bin,
        value: Math.max(0, Math.min(1, values[index] ?? 0)),
      })),
    [bins, values],
  );
  const maxValue = Math.max(...displayBins.map((bin) => bin.value), 0);
  const fieldSize = bins[bins.length - 1]?.end ?? bins.length;

  useEffect(() => {
    if (activeIndex === null || typeof document === "undefined") return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setActiveIndex(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [activeIndex]);

  if (displayBins.length === 0 || values.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className={`sfh sfh--${variant} ${compact ? "sfh--compact" : ""} ${activeIndex !== null ? "sfh--spotlight" : ""}`}
      role="img"
      aria-label="Rank distribution histogram"
      onMouseLeave={() => {
        if (!touchDevice) setActiveIndex(null);
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {displayBins.map((bin, index) => {
        const height = maxValue > 0 ? Math.max((bin.value / maxValue) * 100, bin.value > 0 ? 8 : 0) : 0;
        const tone = bin.start === 1 ? "win" : bin.end <= 3 ? "podium" : "field";
        const isActive = activeIndex === index;
        const isDimmed = activeIndex !== null && activeIndex !== index;
        const tooltip = buildHistogramTooltipCopy({
          bin,
          probability: bin.value,
          simCount,
          fieldSize,
          format,
        });
        const edgeClass =
          index === 0 ? "sfh-tooltip-wrap--left" : index === displayBins.length - 1 ? "sfh-tooltip-wrap--right" : "";

        return (
          <button
            key={`${bin.label}-${index}`}
            type="button"
            className={`sfh-bin ${isActive ? "sfh-bin--active" : ""} ${isDimmed ? "sfh-bin--dim" : ""}`}
            onMouseEnter={() => {
              if (!touchDevice) setActiveIndex(index);
            }}
            onFocus={() => setActiveIndex(index)}
            onBlur={() => setActiveIndex((current) => (current === index ? null : current))}
            onClick={(event) => {
              event.stopPropagation();
              if (!touchDevice) return;
              setActiveIndex((current) => (current === index ? null : index));
            }}
            aria-label={`${tooltip.headline}. ${tooltip.simCountEstimate}. ${tooltip.editorial}`}
          >
            <span className="sfh-value">
              {showPrimaryLabel && bin.start === 1 && bin.value > 0 ? formatForecastProbability(bin.value, format) : null}
            </span>
            <span className={`sfh-bar-wrap sfh-bar-wrap--${tone}`}>
              <span className={`sfh-bar sfh-bar--${tone}`} style={{ height: `${height}%` }} />
            </span>
            <span className="sfh-label">{bin.label.replace(/^#/, "")}</span>
            {isActive ? (
              <span className={`sfh-tooltip-wrap ${edgeClass}`}>
                <span className="sfh-tooltip">
                  <span className="sfh-tooltip-title">{tooltip.headline}</span>
                  <span className="sfh-tooltip-count">{tooltip.simCountEstimate}</span>
                  <span className="sfh-tooltip-note">{tooltip.editorial}</span>
                  <span className="sfh-tooltip-caret" />
                </span>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
