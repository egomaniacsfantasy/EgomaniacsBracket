import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import { teams, teamsById } from "./data/teams";
import { teamLogoUrl } from "./lib/logo";
import { formatAmerican, toAmericanOdds } from "./lib/odds";
import { runSimulation } from "./lib/simulation";
import type { FuturesRow } from "./types";
import "./CascadeDemoPage.css";

/* ── constants ── */
const UPSET_GAME_ID = "South-R64-7";
const FLORIDA_ID = "South-2";
const MERRIMACK_ID = "South-15";
const SIM_RUNS = 5000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* South R64 matchup pairs (from bracket.ts seedMatchups order) */
const R64_PAIRS: [string, string][] = [
  ["South-1", "South-16a"],  // 1 vs 16 (FF)
  ["South-8", "South-9"],    // 8 vs 9
  ["South-5", "South-12"],   // 5 vs 12
  ["South-4", "South-13"],   // 4 vs 13
  ["South-6", "South-11"],   // 6 vs 11
  ["South-3", "South-14"],   // 3 vs 14
  ["South-7", "South-10"],   // 7 vs 10
  ["South-2", "South-15"],   // 2 vs 15
];

/* All South team IDs to display (exclude UMBC duplicate 16-seed) */
const SOUTH_IDS = teams
  .filter((t) => t.region === "South" && t.id !== "South-16b")
  .map((t) => t.id);

type RoundKey = "R64" | "R32" | "S16" | "E8";

const probField: Record<RoundKey, keyof FuturesRow> = {
  R64: "round2Prob",
  R32: "sweet16Prob",
  S16: "elite8Prob",
  E8: "final4Prob",
};

/* ── helpers ── */
function getProb(futures: FuturesRow[], teamId: string, round: RoundKey): number {
  const row = futures.find((r) => r.teamId === teamId);
  return row ? (row[probField[round]] as number) : 0;
}

function fmtOdds(prob: number): string {
  if (prob >= 0.999) return "LOCK";
  if (prob <= 0.001) return "—";
  return formatAmerican(toAmericanOdds(prob));
}

interface TeamRow {
  id: string;
  name: string;
  seed: number;
  logoUrl: string;
  beforeProb: number;
  afterProb: number;
  afterOdds: string;
  isEliminated: boolean;
  improved: boolean;
  worsened: boolean;
}

function buildRows(
  round: RoundKey,
  before: FuturesRow[],
  after: FuturesRow[],
  ids: string[],
  cap: number,
): TeamRow[] {
  const rows: TeamRow[] = [];
  for (const id of ids) {
    const t = teamsById.get(id);
    if (!t) continue;
    const bp = getProb(before, id, round);
    const ap = getProb(after, id, round);
    rows.push({
      id,
      name: t.name,
      seed: t.seed,
      logoUrl: teamLogoUrl(t),
      beforeProb: bp,
      afterProb: ap,
      afterOdds: fmtOdds(ap),
      isEliminated: id === FLORIDA_ID,
      improved: ap > bp + 0.005,
      worsened: ap < bp - 0.005,
    });
  }
  rows.sort((a, b) => {
    if (a.isEliminated) return 1;
    if (b.isEliminated) return -1;
    return b.afterProb - a.afterProb;
  });
  // Keep top (cap-1) + Florida
  const nonElim = rows.filter((r) => !r.isEliminated).slice(0, cap - 1);
  const florida = rows.find((r) => r.isEliminated);
  if (florida) nonElim.push(florida);
  return nonElim;
}

/* ═══════════════════════════════════════════ */
/*  MAIN COMPONENT                             */
/* ═══════════════════════════════════════════ */
export function CascadeDemoPage() {
  const [picked, setPicked] = useState<string | null>(null);
  const [revealPhase, setRevealPhase] = useState(-1);
  const [oddsRevealed, setOddsRevealed] = useState<Record<string, number>>({});
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  /* run simulations once */
  const { beforeSim, afterSim } = useMemo(() => {
    const before = runSimulation({}, SIM_RUNS);
    const after = runSimulation({ [UPSET_GAME_ID]: MERRIMACK_ID }, SIM_RUNS);
    return { beforeSim: before, afterSim: after };
  }, []);

  /* R64 matchup pair data */
  const r64Data = useMemo(() => {
    return R64_PAIRS.map(([aId, bId]) => {
      const mkRow = (id: string): TeamRow => {
        const t = teamsById.get(id)!;
        const bp = getProb(beforeSim.futures, id, "R64");
        const ap = getProb(afterSim.futures, id, "R64");
        return {
          id,
          name: t.name,
          seed: t.seed,
          logoUrl: teamLogoUrl(t),
          beforeProb: bp,
          afterProb: ap,
          afterOdds: fmtOdds(ap),
          isEliminated: id === FLORIDA_ID,
          improved: ap > bp + 0.005,
          worsened: ap < bp - 0.005,
        };
      };
      return [mkRow(aId), mkRow(bId)] as const;
    });
  }, [beforeSim, afterSim]);

  /* ranked round data */
  const r32 = useMemo(() => buildRows("R32", beforeSim.futures, afterSim.futures, SOUTH_IDS, 9), [beforeSim, afterSim]);
  const s16 = useMemo(() => buildRows("S16", beforeSim.futures, afterSim.futures, SOUTH_IDS, 7), [beforeSim, afterSim]);
  const e8  = useMemo(() => buildRows("E8",  beforeSim.futures, afterSim.futures, SOUTH_IDS, 5), [beforeSim, afterSim]);

  /* matchup card data */
  const florida = teamsById.get(FLORIDA_ID)!;
  const merrimack = teamsById.get(MERRIMACK_ID)!;
  const floridaMatchupOdds = fmtOdds(getProb(beforeSim.futures, FLORIDA_ID, "R64"));
  const merrimackMatchupOdds = fmtOdds(getProb(beforeSim.futures, MERRIMACK_ID, "R64"));

  /* cascade */
  const handlePick = useCallback(async (team: string) => {
    if (picked) return;
    setPicked(team);
    await delay(800);

    // R64
    setRevealPhase(0);
    await delay(500);
    for (let i = 0; i < r64Data.length; i++) {
      setOddsRevealed((p) => ({ ...p, R64: i + 1 }));
      await delay(150);
    }
    await delay(1000);

    // R32
    refs.current["R32"]?.scrollIntoView({ behavior: "smooth", block: "center" });
    await delay(400);
    setRevealPhase(2);
    await delay(500);
    for (let i = 0; i < r32.length; i++) {
      setOddsRevealed((p) => ({ ...p, R32: i + 1 }));
      await delay(150);
    }
    await delay(1000);

    // S16
    refs.current["S16"]?.scrollIntoView({ behavior: "smooth", block: "center" });
    await delay(400);
    setRevealPhase(4);
    await delay(500);
    for (let i = 0; i < s16.length; i++) {
      setOddsRevealed((p) => ({ ...p, S16: i + 1 }));
      await delay(150);
    }
    await delay(1000);

    // E8
    refs.current["E8"]?.scrollIntoView({ behavior: "smooth", block: "center" });
    await delay(400);
    setRevealPhase(6);
    await delay(500);
    for (let i = 0; i < e8.length; i++) {
      setOddsRevealed((p) => ({ ...p, E8: i + 1 }));
      await delay(150);
    }
    await delay(1000);

    // Caption
    setRevealPhase(8);
    await delay(1200);

    // CTA
    setRevealPhase(9);
  }, [picked, r64Data.length, r32.length, s16.length, e8.length]);

  const reset = useCallback(() => {
    setPicked(null);
    setRevealPhase(-1);
    setOddsRevealed({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /* prompt text */
  const title = !picked
    ? "Pick the upset."
    : revealPhase >= 8
      ? "One upset. The entire South, repriced."
      : "Florida eliminated.";
  const sub = !picked
    ? "Tap #15 Merrimack."
    : revealPhase >= 8
      ? "This is Bracket Lab."
      : "Watch the South reprice.";

  return (
    <div className="demo-page">
      {/* header */}
      <div className="demo-header">
        <span className="demo-header-brand">ODDSGODS</span>
        <span className="demo-header-product">THE BRACKET LAB</span>
      </div>

      {/* prompt */}
      <div className={`demo-prompt${picked ? " demo-prompt--picked" : ""}`}>
        <p className="demo-prompt-title">{title}</p>
        <p className="demo-prompt-sub">{sub}</p>
      </div>

      {/* hero matchup card */}
      <div className="demo-matchup-card">
        <div
          className={`demo-team-row${picked === "florida" ? " demo-team-row--picked" : ""}${picked === "merrimack" ? " demo-team-row--eliminated" : ""}`}
          onClick={() => handlePick("florida")}
        >
          <span className="demo-team-seed">2</span>
          <img src={teamLogoUrl(florida)} className="demo-team-logo" alt="" />
          <span className="demo-team-name">Florida</span>
          <span className="demo-team-odds">{floridaMatchupOdds}</span>
        </div>
        <div className="demo-matchup-vs">VS</div>
        <div
          className={`demo-team-row${picked === "merrimack" ? " demo-team-row--picked" : ""}${picked === "florida" ? " demo-team-row--eliminated" : ""}`}
          onClick={() => handlePick("merrimack")}
        >
          <span className="demo-team-seed">15</span>
          <img src={teamLogoUrl(merrimack)} className="demo-team-logo" alt="" />
          <span className="demo-team-name">Merrimack</span>
          <span className="demo-team-odds">{merrimackMatchupOdds}</span>
        </div>
      </div>

      {/* round cards */}
      {revealPhase >= 0 && (
        <R64Card
          ref={(el) => { refs.current["R64"] = el; }}
          pairs={r64Data}
          rowsRevealed={oddsRevealed.R64 || 0}
          entering={revealPhase === 0}
        />
      )}
      {revealPhase >= 2 && (
        <RoundCard
          ref={(el) => { refs.current["R32"] = el; }}
          label="ROUND OF 32"
          rows={r32}
          rowsRevealed={oddsRevealed.R32 || 0}
          entering={revealPhase === 2}
        />
      )}
      {revealPhase >= 4 && (
        <RoundCard
          ref={(el) => { refs.current["S16"] = el; }}
          label="SWEET 16"
          rows={s16}
          rowsRevealed={oddsRevealed.S16 || 0}
          entering={revealPhase === 4}
        />
      )}
      {revealPhase >= 6 && (
        <RoundCard
          ref={(el) => { refs.current["E8"] = el; }}
          label="ELITE 8"
          rows={e8}
          rowsRevealed={oddsRevealed.E8 || 0}
          entering={revealPhase === 6}
        />
      )}

      {revealPhase >= 8 && (
        <div className="demo-final-caption">
          <p className="demo-final-title">One upset. The entire South, repriced.</p>
          <p className="demo-final-sub">This is Bracket Lab.</p>
        </div>
      )}

      {revealPhase >= 9 && (
        <>
          <div className="demo-cta-card">
            <div className="demo-cta-giveaway">
              <span className="demo-cta-amount">$100</span>
              <span className="demo-cta-giveaway-text">BRACKET{"\n"}GIVEAWAY</span>
            </div>
            <p className="demo-cta-body">
              Build the best bracket and win $100. Every pick reprices the entire tournament.
            </p>
            <a href="https://bracket.oddsgods.net/?ref=demo" className="demo-cta-btn">
              Build your bracket →
            </a>
            <p className="demo-cta-note">Best on laptop · Free to play · No account required</p>
          </div>
          <button className="demo-reset-btn" onClick={reset}>
            ↻ Play again
          </button>
        </>
      )}
    </div>
  );
}

/* ── R64 card (matchup pairs) ── */
interface R64CardProps {
  pairs: readonly (readonly [TeamRow, TeamRow])[];
  rowsRevealed: number;
  entering: boolean;
}

const R64Card = forwardRef<HTMLDivElement, R64CardProps>(
  ({ pairs, rowsRevealed, entering }, ref) => (
    <div
      ref={ref}
      className={`demo-round-card ${entering ? "demo-round-card--entering" : "demo-round-card--visible"}`}
    >
      <div className="demo-round-header">
        <span className="demo-round-label">ROUND OF 64</span>
        <span className="demo-round-region">SOUTH</span>
      </div>
      <div className="demo-round-teams">
        {pairs.map(([a, b], mi) => (
          <div key={a.id} className="demo-matchup-pair">
            <OddsRow team={a} revealed={mi < rowsRevealed} />
            <OddsRow team={b} revealed={mi < rowsRevealed} />
          </div>
        ))}
      </div>
    </div>
  ),
);
R64Card.displayName = "R64Card";

/* ── generic ranked round card ── */
interface RoundCardProps {
  label: string;
  rows: TeamRow[];
  rowsRevealed: number;
  entering: boolean;
}

const RoundCard = forwardRef<HTMLDivElement, RoundCardProps>(
  ({ label, rows, rowsRevealed, entering }, ref) => (
    <div
      ref={ref}
      className={`demo-round-card ${entering ? "demo-round-card--entering" : "demo-round-card--visible"}`}
    >
      <div className="demo-round-header">
        <span className="demo-round-label">{label}</span>
        <span className="demo-round-region">SOUTH</span>
      </div>
      <div className="demo-round-teams">
        {rows.map((team, i) => (
          <OddsRow key={team.id} team={team} revealed={i < rowsRevealed} />
        ))}
      </div>
    </div>
  ),
);
RoundCard.displayName = "RoundCard";

/* ── single team / odds row ── */
function OddsRow({ team, revealed }: { team: TeamRow; revealed: boolean }) {
  return (
    <div
      className={
        "demo-round-row" +
        (revealed ? " demo-round-row--revealed" : "") +
        (team.isEliminated ? " demo-round-row--eliminated" : "")
      }
    >
      <span className="demo-round-row-seed">{team.seed}</span>
      <img src={team.logoUrl} className="demo-round-row-logo" alt="" />
      <span className="demo-round-row-name">{team.name}</span>
      {team.isEliminated ? (
        <span className="demo-round-row-elim">ELIMINATED</span>
      ) : revealed ? (
        <span
          className={
            "demo-round-row-odds" +
            (team.improved ? " demo-odds--improved" : "") +
            (team.worsened ? " demo-odds--worsened" : "")
          }
        >
          {team.afterOdds}
        </span>
      ) : (
        <span className="demo-round-row-odds demo-round-row-odds--pending">---</span>
      )}
    </div>
  );
}
