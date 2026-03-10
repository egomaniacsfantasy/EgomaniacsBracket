import { useState, useMemo } from "react";
import type { OddsDisplayMode } from "../types";
import { D1_TEAMS, CONF_NAME_MAP, type D1Team } from "./data/d1Rankings";
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
  key: keyof D1Team;
  label: string;
  format: (v: number) => string;
  ascending: boolean; // true if lower is better (ranks)
};

const RANKING_METRICS: RankingMetric[] = [
  { key: "mrRank", label: "Odds Gods Rank", format: (v) => `#${v}`, ascending: true },
  { key: "elo", label: "Elo Rating", format: (v) => v.toFixed(0), ascending: false },
  { key: "rankNET", label: "NET Ranking", format: (v) => `#${v}`, ascending: true },
  { key: "rankPOM", label: "KenPom", format: (v) => `#${v}`, ascending: true },
  { key: "rankMAS", label: "Massey", format: (v) => `#${v}`, ascending: true },
  { key: "rankMOR", label: "Moore", format: (v) => `#${v}`, ascending: true },
  { key: "rankWLK", label: "Wolfe", format: (v) => `#${v}`, ascending: true },
  { key: "rankBIH", label: "BIH", format: (v) => `#${v}`, ascending: true },
  { key: "netRtg", label: "Net Rating", format: (v) => v.toFixed(1), ascending: false },
  { key: "offRtg", label: "Off. Rating", format: (v) => v.toFixed(1), ascending: false },
  { key: "defRtg", label: "Def. Rating", format: (v) => v.toFixed(1), ascending: true },
  { key: "eloSos", label: "SOS (Elo)", format: (v) => v.toFixed(0), ascending: false },
  { key: "eloTrend", label: "Elo Trend", format: (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)), ascending: false },
  { key: "last5Margin", label: "Last 5 Margin", format: (v) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)), ascending: false },
];

const ALL_CONFS = Array.from(new Set(D1_TEAMS.map((t) => t.conf))).sort();

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
  const [sortAsc, setSortAsc] = useState<boolean | null>(null); // null = use metric default

  const metric = RANKING_METRICS[metricIdx];

  const filtered = useMemo(() => {
    let teams = D1_TEAMS;
    if (confFilter !== "all") {
      teams = teams.filter((t) => t.conf === confFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      teams = teams.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (CONF_NAME_MAP[t.conf] ?? t.conf).toLowerCase().includes(q)
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

  return (
    <div className="rank-page">
      <section className="tool-page-header">
        <p className="tool-page-kicker">College Basketball</p>
        <h1>Power Rankings</h1>
        <p className="tool-page-subtitle">
          A Markov-style ladder ranking every D1 team by neutral-floor win probability. Sort by any metric. Filter by conference.
        </p>
      </section>

      <div className="rank-controls">
        <select
          className="rank-metric-select"
          value={metricIdx}
          onChange={(e) => {
            setMetricIdx(Number(e.target.value));
            setSortAsc(null); // reset to metric default
          }}
        >
          {RANKING_METRICS.map((m, i) => (
            <option key={m.key} value={i}>
              {m.label}
            </option>
          ))}
        </select>

        <select
          className="rank-conf-select"
          value={confFilter}
          onChange={(e) => setConfFilter(e.target.value)}
        >
          <option value="all">All Conferences</option>
          {ALL_CONFS.map((c) => (
            <option key={c} value={c}>
              {CONF_NAME_MAP[c] ?? c}
            </option>
          ))}
        </select>

        <input
          className="rank-search"
          type="text"
          placeholder="Search teams..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="rank-table-wrap">
        <table className="rank-table">
          <thead>
            <tr>
              <th className="rank-th rank-th--rank">#</th>
              <th className="rank-th rank-th--team">Team</th>
              {!isMobile && <th className="rank-th rank-th--conf">Conf</th>}
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
                  <img
                    src={teamLogoUrlByName(team.name)}
                    alt=""
                    className="rank-team-logo"
                    loading="lazy"
                  />
                  <span className="rank-team-name">{team.name}</span>
                  {isMobile && (
                    <span className="rank-team-conf-badge">{CONF_NAME_MAP[team.conf] ?? team.conf}</span>
                  )}
                </td>
                {!isMobile && (
                  <td className="rank-td rank-td--conf">{CONF_NAME_MAP[team.conf] ?? team.conf}</td>
                )}
                <td className="rank-td rank-td--metric">{metric.format(team[metric.key] as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <p className="rank-empty">No teams match your search.</p>
        )}
      </div>
    </div>
  );
}
