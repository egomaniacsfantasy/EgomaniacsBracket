import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const barWrapRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const touchDevice = useMemo(() => isTouchDevice(), []);
  const [tooltipStyle, setTooltipStyle] = useState<{
    left: number;
    top: number;
    caretLeft: number;
  } | null>(null);

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

  useEffect(() => {
    if (activeIndex === null || typeof window === "undefined") return;

    const updateTooltipStyle = () => {
      const activeBarWrap = barWrapRefs.current[activeIndex];
      if (!activeBarWrap) {
        setTooltipStyle(null);
        return;
      }

      const rect = activeBarWrap.getBoundingClientRect();
      const viewportPadding = 12;
      const tooltipWidth = Math.min(260, Math.max(180, window.innerWidth - viewportPadding * 2));
      const idealLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
      const left = Math.min(
        Math.max(idealLeft, viewportPadding),
        Math.max(viewportPadding, window.innerWidth - tooltipWidth - viewportPadding)
      );
      const caretLeft = Math.min(Math.max(rect.left + rect.width / 2 - left, 18), tooltipWidth - 18);

      setTooltipStyle({
        left,
        top: rect.top,
        caretLeft,
      });
    };

    const frame = window.requestAnimationFrame(updateTooltipStyle);
    window.addEventListener("resize", updateTooltipStyle);
    window.addEventListener("scroll", updateTooltipStyle, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateTooltipStyle);
      window.removeEventListener("scroll", updateTooltipStyle, true);
    };
  }, [activeIndex]);

  if (displayBins.length === 0 || values.length === 0) return null;

  const activeTooltip =
    activeIndex !== null
      ? buildHistogramTooltipCopy({
          bin: displayBins[activeIndex],
          probability: displayBins[activeIndex]?.value ?? 0,
          simCount,
          fieldSize,
          format,
        })
      : null;

  return (
    <>
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
                {showPrimaryLabel && bin.start === 1 && bin.value > 0
                  ? formatForecastProbability(bin.value, format)
                  : null}
              </span>
              <span
                ref={(node) => {
                  barWrapRefs.current[index] = node;
                }}
                className={`sfh-bar-wrap sfh-bar-wrap--${tone}`}
              >
                <span className={`sfh-bar sfh-bar--${tone}`} style={{ height: `${height}%` }} />
              </span>
              <span className="sfh-label">{bin.label.replace(/^#/, "")}</span>
            </button>
          );
        })}
      </div>
      {activeTooltip && tooltipStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              className="sfh-tooltip-layer"
              style={
                {
                  left: `${tooltipStyle.left}px`,
                  top: `${tooltipStyle.top}px`,
                  "--sfh-tooltip-caret-left": `${tooltipStyle.caretLeft}px`,
                } as CSSProperties
              }
            >
              <span className="sfh-tooltip">
                <span className="sfh-tooltip-title">{activeTooltip.headline}</span>
                <span className="sfh-tooltip-count">{activeTooltip.simCountEstimate}</span>
                <span className="sfh-tooltip-note">{activeTooltip.editorial}</span>
                <span className="sfh-tooltip-caret" />
              </span>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
