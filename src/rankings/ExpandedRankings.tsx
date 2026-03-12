import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { OddsDisplayMode } from "../types";
import { D1_TEAMS, CONF_NAME_MAP } from "./data/d1Rankings";
import {
  RANKING_TREND_DAYNUMS,
  RANKING_TRENDS_BY_TEAM,
  type RankingTrendMetric,
} from "./data/rankingsTrend2026";
import { getMappedEspnLogoPath } from "../lib/logoMap";

function teamLogoUrlByName(name: string): string {
  const mapped = getMappedEspnLogoPath(name);
  if (mapped) return mapped;
  const initials = name
    .replace(/[^a-zA-Z\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return `https://placehold.co/40x40/1b1107/f0e4c6.png?text=${encodeURIComponent(initials || "TM")}`;
}

type RankingMetric = {
  key: RankingTrendMetric;
  label: string;
  format: (v: number) => string;
  ascending: boolean;
  chartDecimals?: number;
};

const RANKING_METRICS: RankingMetric[] = [
  { key: "mrRank", label: "OddsGods Rank", format: (v) => `#${v}`, ascending: true },
  { key: "mrScore", label: "Model Score", format: (v) => v.toFixed(4), ascending: false, chartDecimals: 4 },
  { key: "elo", label: "Elo Rating", format: (v) => v.toFixed(0), ascending: false, chartDecimals: 1 },
  { key: "rankNET", label: "NET Ranking", format: (v) => `#${v}`, ascending: true },
  { key: "rankPOM", label: "KenPom", format: (v) => `#${v}`, ascending: true },
  { key: "rankMAS", label: "Massey", format: (v) => `#${v}`, ascending: true },
  { key: "rankMOR", label: "Moore", format: (v) => `#${v}`, ascending: true },
  { key: "rankWLK", label: "Wolfe", format: (v) => `#${v}`, ascending: true },
  { key: "rankBIH", label: "BIH", format: (v) => `#${v}`, ascending: true },
  { key: "netRtg", label: "Net Rating", format: (v) => v.toFixed(1), ascending: false, chartDecimals: 2 },
  { key: "offRtg", label: "Off. Rating", format: (v) => v.toFixed(1), ascending: false, chartDecimals: 2 },
  { key: "defRtg", label: "Def. Rating", format: (v) => v.toFixed(1), ascending: true, chartDecimals: 2 },
  { key: "eloSos", label: "SOS (Elo)", format: (v) => v.toFixed(0), ascending: false, chartDecimals: 1 },
  {
    key: "eloTrend",
    label: "Elo Trend",
    format: (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
    ascending: false,
    chartDecimals: 4,
  },
  {
    key: "last5Margin",
    label: "Last 5 Margin",
    format: (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
    ascending: false,
    chartDecimals: 1,
  },
];

const RANK_LIKE_METRICS = new Set<RankingTrendMetric>([
  "mrRank",
  "rankNET",
  "rankPOM",
  "rankMAS",
  "rankMOR",
  "rankWLK",
  "rankBIH",
]);

const ALL_CONFS = Array.from(new Set(D1_TEAMS.map((t) => t.conf))).sort();

type TrendPoint = { daynum: number; value: number };

function formatAxisValue(value: number, metric: RankingMetric): string {
  if (RANK_LIKE_METRICS.has(metric.key)) return `${Math.round(value)}`;
  const decimals = metric.chartDecimals ?? 2;
  return value.toFixed(decimals);
}

export function ExpandedRankings({
  displayMode: _displayMode,
  isMobile,
}: {
  displayMode: OddsDisplayMode;
  isMobile: boolean;
}) {
  const [metricIdx, setMetricIdx] = useState(0);
  const [search, setSearch] = useState("");
  const [confFilter, setConfFilter] = useState<string>("all");
  const [sortAsc, setSortAsc] = useState<boolean | null>(null);
  const [trendTeamId, setTrendTeamId] = useState<number | null>(null);

  const metric = RANKING_METRICS[metricIdx];

  const teamById = useMemo(() => new Map(D1_TEAMS.map((team) => [team.id, team])), []);

  const filtered = useMemo(() => {
    let teams = D1_TEAMS;
    if (confFilter !== "all") {
      teams = teams.filter((team) => team.conf === confFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      teams = teams.filter(
        (team) =>
          team.name.toLowerCase().includes(q) ||
          (CONF_NAME_MAP[team.conf] ?? team.conf).toLowerCase().includes(q)
      );
    }
    return teams;
  }, [confFilter, search]);

  const sorted = useMemo(() => {
    const ascending = sortAsc ?? metric.ascending;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = a[metric.key] as number;
      const vb = b[metric.key] as number;
      return ascending ? va - vb : vb - va;
    });
    return arr;
  }, [filtered, metric, sortAsc]);

  const trendTeam = trendTeamId !== null ? teamById.get(trendTeamId) ?? null : null;

  const trendPoints = useMemo(() => {
    if (!trendTeamId) return [] as TrendPoint[];
    const byMetric = RANKING_TRENDS_BY_TEAM[trendTeamId];
    if (!byMetric) return [] as TrendPoint[];
    const values = byMetric[metric.key] ?? [];
    const rankLike = RANK_LIKE_METRICS.has(metric.key);
    const points: TrendPoint[] = [];
    for (let i = 0; i < RANKING_TREND_DAYNUMS.length; i += 1) {
      const daynum = RANKING_TREND_DAYNUMS[i];
      const value = values[i];
      if (value === null || value === undefined || Number.isNaN(value)) continue;
      const normalizedValue = rankLike ? Math.round(value) : value;
      points.push({ daynum, value: normalizedValue });
    }
    return points;
  }, [metric.key, trendTeamId]);

  useEffect(() => {
    if (trendTeamId === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTrendTeamId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [trendTeamId]);

  const chart = useMemo(() => {
    const width = 760;
    const height = 300;
    const padL = 54;
    const padR = 16;
    const padT = 16;
    const padB = 34;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    if (trendPoints.length === 0 || RANKING_TREND_DAYNUMS.length === 0) {
      return {
        width,
        height,
        polyline: "",
        circles: [] as Array<{ cx: number; cy: number; value: number; daynum: number }>,
        xTicks: [] as Array<{ x: number; label: string }>,
        yTicks: [] as Array<{ y: number; label: string }>,
      };
    }

    const xMin = RANKING_TREND_DAYNUMS[0];
    const xMax = RANKING_TREND_DAYNUMS[RANKING_TREND_DAYNUMS.length - 1];
    const rankLike = RANK_LIKE_METRICS.has(metric.key);
    const yVals = trendPoints.map((point) => point.value);
    const rawYMin = Math.min(...yVals);
    const rawYMax = Math.max(...yVals);
    const yMin = rankLike ? Math.floor(rawYMin) : rawYMin;
    const yMax = rankLike ? Math.ceil(rawYMax) : rawYMax;
    const xRange = Math.max(1, xMax - xMin);
    const yRange = Math.max(1e-9, yMax - yMin);

    const xFor = (daynum: number) => padL + ((daynum - xMin) / xRange) * plotW;
    const yFor = (value: number) =>
      rankLike
        ? padT + ((value - yMin) / yRange) * plotH
        : padT + (1 - (value - yMin) / yRange) * plotH;

    const circles = trendPoints.map((point) => ({
      cx: xFor(point.daynum),
      cy: yFor(point.value),
      value: point.value,
      daynum: point.daynum,
    }));
    let polylinePoints = circles.map((point) => `${point.cx.toFixed(2)},${point.cy.toFixed(2)}`);
    if (rankLike && circles.length > 1) {
      const steppedPoints: string[] = [`${circles[0].cx.toFixed(2)},${circles[0].cy.toFixed(2)}`];
      for (let i = 1; i < circles.length; i += 1) {
        const prev = circles[i - 1];
        const curr = circles[i];
        steppedPoints.push(`${curr.cx.toFixed(2)},${prev.cy.toFixed(2)}`);
        steppedPoints.push(`${curr.cx.toFixed(2)},${curr.cy.toFixed(2)}`);
      }
      polylinePoints = steppedPoints;
    }
    const polyline = polylinePoints.join(" ");

    const xTickCount = Math.min(6, RANKING_TREND_DAYNUMS.length);
    const xTicks = Array.from({ length: xTickCount }, (_, idx) => {
      const pos = xTickCount === 1 ? 0 : idx / (xTickCount - 1);
      const daynum = Math.round(xMin + pos * xRange);
      return { x: xFor(daynum), label: `${daynum}` };
    });

    const yTicks = (() => {
      if (rankLike) {
        const rankMin = Math.round(yMin);
        const rankMax = Math.round(yMax);
        const span = Math.max(0, rankMax - rankMin);
        const maxTicks = 7;
        const step = Math.max(1, Math.ceil(Math.max(1, span) / (maxTicks - 1)));
        const tickValues: number[] = [];
        for (let value = rankMin; value <= rankMax; value += step) {
          tickValues.push(value);
        }
        if (tickValues.length === 0 || tickValues[tickValues.length - 1] !== rankMax) {
          tickValues.push(rankMax);
        }
        return tickValues.map((value) => ({
          y: yFor(value),
          label: `${value}`,
        }));
      }
      const yTickCount = 5;
      return Array.from({ length: yTickCount }, (_, idx) => {
        const pos = idx / (yTickCount - 1);
        const y = padT + pos * plotH;
        const value = yMax - pos * yRange;
        return { y, label: formatAxisValue(value, metric) };
      });
    })();

    return { width, height, polyline, circles, xTicks, yTicks };
  }, [metric, trendPoints]);

  const trendModal = trendTeam ? (
    <div className="rank-trend-modal-backdrop" onClick={() => setTrendTeamId(null)}>
      <div className="rank-trend-modal" onClick={(event) => event.stopPropagation()}>
        <div className="rank-trend-modal-head">
          <h3>
            {trendTeam.name} - {metric.label} Trend
          </h3>
          <button type="button" className="rank-trend-close" onClick={() => setTrendTeamId(null)} aria-label="Close trend modal">
            x
          </button>
        </div>
        {trendPoints.length === 0 ? (
          <p className="rank-empty">No daily trend data available for this team/metric yet.</p>
        ) : (
          <div className="rank-trend-chart-wrap">
            <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="rank-trend-chart" role="img" aria-label={`${trendTeam.name} ${metric.label} trend`}>
              <line x1={54} y1={266} x2={744} y2={266} className="rank-chart-axis" />
              <line x1={54} y1={16} x2={54} y2={266} className="rank-chart-axis" />

              {chart.yTicks.map((tick) => (
                <g key={`y-${tick.y.toFixed(2)}`}>
                  <line x1={54} y1={tick.y} x2={744} y2={tick.y} className="rank-chart-grid" />
                  <text x={46} y={tick.y + 3} className="rank-chart-label rank-chart-label--y">
                    {tick.label}
                  </text>
                </g>
              ))}

              {chart.xTicks.map((tick) => (
                <g key={`x-${tick.label}`}>
                  <line x1={tick.x} y1={266} x2={tick.x} y2={16} className="rank-chart-grid rank-chart-grid--x" />
                  <text x={tick.x} y={286} textAnchor="middle" className="rank-chart-label">
                    {tick.label}
                  </text>
                </g>
              ))}

              <polyline points={chart.polyline} className="rank-chart-line" />
              {chart.circles.map((point) => (
                <circle key={`${point.daynum}-${point.value.toFixed(5)}`} cx={point.cx} cy={point.cy} r={2.8} className="rank-chart-dot">
                  <title>
                    Day {point.daynum}: {metric.format(point.value)}
                  </title>
                </circle>
              ))}
            </svg>
            <div className="rank-trend-meta">
              <span>DayNum {RANKING_TREND_DAYNUMS[0]} to {RANKING_TREND_DAYNUMS[RANKING_TREND_DAYNUMS.length - 1]}</span>
              <span>{RANK_LIKE_METRICS.has(metric.key) ? "Lower is better for this metric." : "Higher is better for this metric."}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="rank-page">
      <h2 className="rank-title">D1 Team Rankings</h2>

      <div className="rank-controls">
        <select
          className="rank-metric-select"
          value={metricIdx}
          onChange={(event) => {
            setMetricIdx(Number(event.target.value));
            setSortAsc(null);
          }}
        >
          {RANKING_METRICS.map((m, i) => (
            <option key={m.key} value={i}>
              {m.label}
            </option>
          ))}
        </select>

        <select className="rank-conf-select" value={confFilter} onChange={(event) => setConfFilter(event.target.value)}>
          <option value="all">All Conferences</option>
          {ALL_CONFS.map((conf) => (
            <option key={conf} value={conf}>
              {CONF_NAME_MAP[conf] ?? conf}
            </option>
          ))}
        </select>

        <input
          className="rank-search"
          type="text"
          placeholder="Search teams..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="rank-table-wrap">
        <table className="rank-table">
          <thead>
            <tr>
              <th className="rank-th rank-th--rank">#</th>
              <th className="rank-th rank-th--team">Team</th>
              {!isMobile ? <th className="rank-th rank-th--conf">Conf</th> : null}
              <th
                className="rank-th rank-th--metric"
                onClick={() => setSortAsc((prev) => (prev === null ? !metric.ascending : !prev))}
                style={{ cursor: "pointer" }}
              >
                {metric.label} {(sortAsc ?? metric.ascending) ? "↑" : "↓"}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((team, idx) => (
              <tr key={team.id} className="rank-row">
                <td className="rank-td rank-td--rank">{idx + 1}</td>
                <td className="rank-td rank-td--team">
                  <img src={teamLogoUrlByName(team.name)} alt="" className="rank-team-logo" loading="lazy" />
                  <span className="rank-team-name">{team.name}</span>
                  <button className="rank-trend-link" onClick={() => setTrendTeamId(team.id)} type="button">
                    Trend
                  </button>
                  {isMobile ? (
                    <span className="rank-team-conf-badge">{CONF_NAME_MAP[team.conf] ?? team.conf}</span>
                  ) : null}
                </td>
                {!isMobile ? <td className="rank-td rank-td--conf">{CONF_NAME_MAP[team.conf] ?? team.conf}</td> : null}
                <td className="rank-td rank-td--metric">{metric.format(team[metric.key] as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 ? <p className="rank-empty">No teams match your search.</p> : null}
      </div>

      {trendModal && typeof document !== "undefined" ? createPortal(trendModal, document.body) : null}
    </div>
  );
}
