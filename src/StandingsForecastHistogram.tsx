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

function getAxisStep(maxValue: number) {
  if (maxValue <= 0.02) return 0.01;
  if (maxValue <= 0.05) return 0.02;
  if (maxValue <= 0.12) return 0.05;
  if (maxValue <= 0.25) return 0.1;
  return 0.2;
}

function formatAxisProbability(probability: number) {
  const percent = probability * 100;
  if (percent >= 10) return `${Math.round(percent)}%`;
  if (percent >= 1) return `${percent.toFixed(1)}%`;
  return `${percent.toFixed(2)}%`;
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
  const axisStep = getAxisStep(maxValue);
  const axisMax = maxValue > 0 ? Math.ceil(maxValue / axisStep) * axisStep : axisStep;
  const axisTicks = [axisMax, axisMax / 2, 0];
  const fieldSize = bins[bins.length - 1]?.end ?? bins.length;
  const activeTooltip =
    activeIndex !== null
      ? buildHistogramTooltipCopy({
          bin: displayBins[activeIndex],
          probability: displayBins[activeIndex].value,
          simCount,
          fieldSize,
          format,
        })
      : null;

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
      <div className="sfh-tooltip-slot" aria-live="polite">
        {activeTooltip ? (
          <span className="sfh-tooltip sfh-tooltip--inline">
            <span className="sfh-tooltip-title">{activeTooltip.headline}</span>
            <span className="sfh-tooltip-count">{activeTooltip.simCountEstimate}</span>
            <span className="sfh-tooltip-note">{activeTooltip.editorial}</span>
          </span>
        ) : null}
      </div>

      <div className="sfh-chart">
        <div className="sfh-axis" aria-hidden="true">
          {axisTicks.map((tick, index) => (
            <span key={`${tick}-${index}`} className="sfh-axis-label">
              {formatAxisProbability(tick)}
            </span>
          ))}
        </div>

        <div className="sfh-plot">
          <div className="sfh-gridlines" aria-hidden="true">
            {axisTicks
              .filter((tick) => tick > 0)
              .map((tick, index) => (
                <span
                  key={`${tick}-${index}`}
                  className="sfh-gridline"
                  style={{ bottom: `${(tick / axisMax) * 100}%` }}
                />
              ))}
          </div>

          <div className="sfh-bars">
            {displayBins.map((bin, index) => {
              const height = axisMax > 0 ? Math.max((bin.value / axisMax) * 100, bin.value > 0 ? 8 : 0) : 0;
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

              return (
                <button
                  key={`${bin.label}-${index}`}
                  type="button"
                  className={`sfh-bin ${isActive ? "sfh-bin--active" : ""} ${isDimmed ? "sfh-bin--dim" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  onBlur={() => setActiveIndex((current) => (current === index ? null : current))}
                  onClick={(event) => {
                    event.stopPropagation();
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
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
