import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import { teams, teamsById } from "./data/teams";
import { teamLogoUrl } from "./lib/logo";
import { formatAmerican, toAmericanOdds } from "./lib/odds";
import { runSimulation } from "./lib/simulation";
import type { FuturesRow } from "./types";
import "./CascadeDemoPage.css";

/* ── constants ── */
const FLORIDA_ID = "South-2";
const MERRIMACK_ID = "South-15";
const UPSET_GAME_ID = "South-R64-7";
const SIM_RUNS = 10_000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── types ── */
interface DemoTeam {
  id: string;
  name: string;
  seed: number;
  logoUrl: string;
  oldProb: number;
  newProb: number;
  oldAmOdds: number;
  newAmOdds: number;
  isFlorida: boolean;
  improved: boolean;
  worsened: boolean;
}

/* ── helpers ── */
function getProb(futures: FuturesRow[], teamId: string, field: keyof FuturesRow): number {
  const row = futures.find((r) => r.teamId === teamId);
  return row ? (row[field] as number) : 0;
}

function fmtOdds(prob: number): string {
  if (prob >= 0.999) return "LOCK";
  if (prob <= 0.001) return "\u2014";
  return formatAmerican(toAmericanOdds(prob));
}

/** Format delta between two American odds as "+110" style string */
function fmtDelta(oldAmOdds: number, newAmOdds: number): string {
  // Delta = how much the American odds shortened (positive = improved)
  const diff = oldAmOdds - newAmOdds;
  if (diff <= 0) return "";
  return `+${Math.abs(Math.round(diff))}`;
}

function buildRoundTeams(
  before: FuturesRow[],
  after: FuturesRow[],
  probField: keyof FuturesRow,
  maxTeams: number,
): DemoTeam[] {
  const result: DemoTeam[] = [];
  for (const t of teams) {
    if (t.region !== "South" || t.id === "South-16b") continue;
    const oldProb = getProb(before, t.id, probField);
    const newProb = getProb(after, t.id, probField);
    if (oldProb < 0.001 && newProb < 0.001) continue;
    result.push({
      id: t.id,
      name: t.name,
      seed: t.seed,
      logoUrl: teamLogoUrl(t),
      oldProb,
      newProb,
      oldAmOdds: oldProb > 0.001 ? toAmericanOdds(oldProb) : 99999,
      newAmOdds: newProb > 0.001 ? toAmericanOdds(newProb) : 99999,
      isFlorida: t.id === FLORIDA_ID,
      improved: newProb > oldProb + 0.003,
      worsened: newProb < oldProb - 0.003,
    });
  }
  result.sort((a, b) => b.oldProb - a.oldProb);
  const florida = result.find((t) => t.isFlorida);
  const others = result.filter((t) => !t.isFlorida).slice(0, maxTeams - (florida ? 1 : 0));
  if (florida) {
    const idx = others.findIndex((t) => t.oldProb < florida.oldProb);
    if (idx === -1) others.push(florida);
    else others.splice(idx, 0, florida);
  }
  return others;
}

/* ═══════════════════════════════════════════
   PHASES (v4):
   "hook"    = spoiler hook (aftermath screen)
   "pick"    = rewind to pick screen
   0         = picked (Florida X, Merrimack check)
   1..12     = cascade phases (same as v3)
   ═══════════════════════════════════════════ */

export function CascadeDemoPage() {
  const [screen, setScreen] = useState<"hook" | "pick" | "cascade">("hook");
  const [phase, setPhase] = useState(0);
  const [overlayText, setOverlayText] = useState<{ main: string; sub?: string; style?: string } | null>(null);
  const [displayOdds, setDisplayOdds] = useState<Record<string, string>>({});
  const roundRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cascadeStarted = useRef(false);

  /* ── simulations ── */
  const { beforeSim, afterSim } = useMemo(() => {
    const b = runSimulation({}, SIM_RUNS);
    const a = runSimulation({ [UPSET_GAME_ID]: MERRIMACK_ID }, SIM_RUNS);

    // Validation
    const southTeams = teams.filter((t) => t.region === "South" && t.id !== FLORIDA_ID && t.id !== "South-16b");
    let dataValid = true;
    for (const t of southTeams) {
      const beforeR32 = getProb(b.futures, t.id, "sweet16Prob");
      const afterR32 = getProb(a.futures, t.id, "sweet16Prob");
      if (afterR32 < beforeR32 - 0.01) {
        console.error(`DATA BUG: ${t.name}'s R32 odds got WORSE after Florida elimination.`);
        console.error(`  Pre: ${beforeR32}, Post: ${afterR32}`);
        dataValid = false;
      }
    }
    // Verify Florida eliminated
    const floridaPostR32 = getProb(a.futures, FLORIDA_ID, "sweet16Prob");
    if (floridaPostR32 > 0) {
      console.error("DATA BUG: Florida still has R32 probability after being eliminated in R64.");
      dataValid = false;
    }
    if (!dataValid) {
      console.error("CRITICAL: Simulation data is incorrect. The demo will show wrong numbers.");
    }

    return { beforeSim: b, afterSim: a };
  }, []);

  /* ── round data ── */
  const r32Teams = useMemo(
    () => buildRoundTeams(beforeSim.futures, afterSim.futures, "sweet16Prob", 10),
    [beforeSim, afterSim],
  );
  const s16Teams = useMemo(
    () => buildRoundTeams(beforeSim.futures, afterSim.futures, "elite8Prob", 8),
    [beforeSim, afterSim],
  );
  const e8Teams = useMemo(
    () => buildRoundTeams(beforeSim.futures, afterSim.futures, "final4Prob", 6),
    [beforeSim, afterSim],
  );
  const champTeams = useMemo(() => {
    const all = buildRoundTeams(beforeSim.futures, afterSim.futures, "champProb", 8);
    return all.filter((t) => !t.isFlorida).slice(0, 5);
  }, [beforeSim, afterSim]);

  /* ── hero matchup data ── */
  const florida = teamsById.get(FLORIDA_ID)!;
  const merrimack = teamsById.get(MERRIMACK_ID)!;
  const floridaOdds = fmtOdds(getProb(beforeSim.futures, FLORIDA_ID, "round2Prob"));
  const merrimackOdds = fmtOdds(getProb(beforeSim.futures, MERRIMACK_ID, "round2Prob"));

  /* ── scroll helper ── */
  const scrollToRef = useCallback((key: string) => {
    requestAnimationFrame(() => {
      const el = roundRefs.current[key];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  /* ── animated counter ── */
  const animateOdds = useCallback(
    (roundKey: string, teamList: DemoTeam[], duration: number) => {
      const startTime = performance.now();
      function tick(now: number) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const updates: Record<string, string> = {};
        for (const t of teamList) {
          if (t.isFlorida) continue;
          if (Math.abs(t.oldAmOdds) > 50000 || Math.abs(t.newAmOdds) > 50000) continue;
          const current = Math.round(t.oldAmOdds + (t.newAmOdds - t.oldAmOdds) * eased);
          updates[`${roundKey}-${t.id}`] = formatAmerican(current);
        }
        setDisplayOdds((prev) => ({ ...prev, ...updates }));
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    },
    [],
  );

  /* ── overlay text helper ── */
  const showOverlay = useCallback(async (main: string, sub?: string, style?: string, durationMs?: number) => {
    setOverlayText({ main, sub, style });
    if (durationMs) {
      await delay(durationMs);
      setOverlayText(null);
    }
  }, []);

  /* ── hook → pick crossfade ── */
  const handleRewind = useCallback(() => {
    setScreen("pick");
    window.scrollTo({ top: 0 });
  }, []);

  /* ── cascade sequence (~20 seconds) ── */
  const handlePick = useCallback(async () => {
    if (cascadeStarted.current) return;
    cascadeStarted.current = true;
    setScreen("cascade");
    setPhase(1);

    // 0ms: "Florida eliminated."
    showOverlay("Florida eliminated.", undefined, "red");
    await delay(2000);

    // 2000ms: R32 appears with old odds, Florida present
    setPhase(2);
    scrollToRef("R32");
    showOverlay("Watch the Round of 32.", undefined, "tertiary", 2000);
    await delay(2000);

    // 4000ms: R32 Florida fading
    setPhase(3);
    await delay(1600);

    // 5600ms: R32 reprice
    setPhase(4);
    animateOdds("R32", r32Teams, 800);
    await delay(2200);

    // 7800ms: hold
    await delay(200);

    // 8000ms: S16 appears
    setPhase(5);
    scrollToRef("S16");
    await delay(1500);

    // 9500ms: S16 Florida fading
    setPhase(6);
    await delay(1300);

    // 10800ms: S16 reprice
    setPhase(7);
    animateOdds("S16", s16Teams, 700);
    await delay(1900);

    // 12700ms: E8 appears
    setPhase(8);
    scrollToRef("E8");
    await delay(1200);

    // 13900ms: E8 Florida fading
    setPhase(9);
    await delay(1000);

    // 14900ms: E8 reprice
    setPhase(10);
    animateOdds("E8", e8Teams, 600);
    await delay(1400);

    // 16300ms: hold
    await delay(200);

    // 16500ms: Championship card
    setPhase(11);
    scrollToRef("CHAMP");
    showOverlay("One upset. The entire South shifted.");
    await delay(3000);
    setOverlayText(null);

    // 19500ms: CTA
    setPhase(12);
    scrollToRef("CTA");
  }, [animateOdds, r32Teams, s16Teams, e8Teams, scrollToRef, showOverlay]);

  /* ── reset ── */
  const reset = useCallback(() => {
    setScreen("hook");
    setPhase(0);
    setDisplayOdds({});
    setOverlayText(null);
    cascadeStarted.current = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /* ═══════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════ */
  return (
    <div className="demo-page">
      {/* ═══ PHASE 0: HOOK SCREEN ═══ */}
      <div className={`demo-hook ${screen !== "hook" ? "demo-hook--hidden" : ""}`}>
        {/* Brand */}
        <div className="demo-header">
          <div className="demo-eyebrow">O D D S &nbsp; G O D S</div>
          <div className="demo-title">THE BRACKET LAB</div>
        </div>

        {/* Headline card */}
        <div className="demo-hook-headline-card">
          <p className="demo-hook-headline">{"\u26A1"} ONE PICK JUST DID THIS {"\u26A1"}</p>
        </div>

        {/* Section label */}
        <div className="demo-hook-section">SOUTH REGION &middot; CHAMPIONSHIP ODDS</div>

        {/* Top 5 championship odds with deltas */}
        {champTeams.map((team, i) => {
          const delta = fmtDelta(team.oldAmOdds, team.newAmOdds);
          return (
            <div key={team.id} className="demo-hook-team-row">
              <span className="demo-hook-rank">{i + 1}.</span>
              <img src={team.logoUrl} className="demo-hook-logo" alt="" />
              <span className="demo-hook-name">{team.name}</span>
              <span className="demo-hook-odds">{fmtOdds(team.newProb)}</span>
              {delta && <span className="demo-hook-delta">{"\u25B2"} {delta}</span>}
            </div>
          );
        })}

        {/* Florida eliminated card */}
        <div className="demo-hook-eliminated">
          <span className="demo-hook-elim-team">{"\u2717"} #2 Florida &mdash; ELIMINATED</span>
          <span className="demo-hook-elim-by">by #15 Merrimack</span>
        </div>

        {/* Bottom text */}
        <div className="demo-hook-bottom-text">
          <p className="demo-hook-bottom-line1">Every team's odds just changed.</p>
          <p className="demo-hook-bottom-line2">From one single pick.</p>
        </div>

        {/* CTA button */}
        <button className="demo-hook-cta" onClick={handleRewind}>
          See how it happened &darr;
        </button>
      </div>

      {/* ═══ PHASE 1: PICK SCREEN ═══ */}
      <div className={`demo-phase ${screen === "pick" ? "demo-phase--visible" : "demo-phase--hidden"}`}>
        <div className="demo-header demo-header--compact">
          <div className="demo-title demo-title--compact">THE BRACKET LAB</div>
        </div>

        <div className="demo-instruction">
          <p className="demo-instruction-main">Pick the upset.</p>
          <p className="demo-instruction-sub">Tap #15 Merrimack.</p>
        </div>

        {/* Hero matchup card */}
        <div className="demo-hero-matchup">
          <div className="demo-hero-row">
            <span className="demo-hero-seed">{florida.seed}</span>
            <img src={teamLogoUrl(florida)} className="demo-hero-logo" alt="" />
            <span className="demo-hero-name">{florida.name}</span>
            <span className="demo-hero-odds">{floridaOdds}</span>
          </div>
          <div className="demo-hero-divider" />
          <div
            className="demo-hero-row demo-hero-row--hint demo-hero-row--clickable"
            onClick={handlePick}
          >
            <span className="demo-hero-seed">{merrimack.seed}</span>
            <img src={teamLogoUrl(merrimack)} className="demo-hero-logo" alt="" />
            <span className="demo-hero-name">{merrimack.name}</span>
            <span className="demo-hero-odds">{merrimackOdds}</span>
          </div>
        </div>
      </div>

      {/* ═══ PHASE 2: CASCADE ═══ */}
      <div className={`demo-phase ${screen === "cascade" ? "demo-phase--visible" : "demo-phase--hidden"}`}>
        <div className="demo-header demo-header--compact">
          <div className="demo-title demo-title--compact">THE BRACKET LAB</div>
        </div>

        {/* Hero matchup — post-pick state */}
        <div className="demo-hero-matchup">
          <div className="demo-hero-row demo-hero-row--eliminated demo-hero-row--flash-red">
            <span className="demo-hero-seed">{florida.seed}</span>
            <img src={teamLogoUrl(florida)} className="demo-hero-logo" alt="" />
            <span className="demo-hero-name">{florida.name}</span>
            <span className="demo-hero-odds">{floridaOdds}</span>
            <span className="demo-hero-check" style={{ color: "var(--red-loss)" }}>{"\u2715"}</span>
          </div>
          <div className="demo-hero-divider" />
          <div className="demo-hero-row demo-hero-row--picked">
            <span className="demo-hero-seed">{merrimack.seed}</span>
            <img src={teamLogoUrl(merrimack)} className="demo-hero-logo" alt="" />
            <span className="demo-hero-name">{merrimack.name}</span>
            <span className="demo-hero-odds">{merrimackOdds}</span>
            <span className="demo-hero-check" style={{ color: "var(--green-win)" }}>{"\u2713"}</span>
          </div>
        </div>

        {/* Overlay text */}
        {overlayText && (
          <div className="demo-overlay-text">
            <div className={
              "demo-overlay-text-main" +
              (overlayText.style === "red" ? " demo-overlay-text--red" : "") +
              (overlayText.style === "tertiary" ? " demo-overlay-text--tertiary" : "")
            }>
              {overlayText.main}
            </div>
            {overlayText.sub && <div className="demo-overlay-text-sub">{overlayText.sub}</div>}
          </div>
        )}

        {/* R32 card */}
        {phase >= 2 && (
          <RoundCard
            ref={(el) => { roundRefs.current["R32"] = el; }}
            roundKey="R32"
            label="ROUND OF 32"
            teamList={r32Teams}
            floridaState={phase < 3 ? "present" : phase < 4 ? "fading" : "gone"}
            fadeClass="demo-team-row--fading-r32"
            oddsState={phase < 4 ? "old" : "new"}
            displayOdds={displayOdds}
            entering={phase === 2}
          />
        )}

        {/* S16 card */}
        {phase >= 5 && (
          <RoundCard
            ref={(el) => { roundRefs.current["S16"] = el; }}
            roundKey="S16"
            label="SWEET 16"
            teamList={s16Teams}
            floridaState={phase < 6 ? "present" : phase < 7 ? "fading" : "gone"}
            fadeClass="demo-team-row--fading-s16"
            oddsState={phase < 7 ? "old" : "new"}
            displayOdds={displayOdds}
            entering={phase === 5}
          />
        )}

        {/* E8 card */}
        {phase >= 8 && (
          <RoundCard
            ref={(el) => { roundRefs.current["E8"] = el; }}
            roundKey="E8"
            label="ELITE 8"
            teamList={e8Teams}
            floridaState={phase < 9 ? "present" : phase < 10 ? "fading" : "gone"}
            fadeClass="demo-team-row--fading-e8"
            oddsState={phase < 10 ? "old" : "new"}
            displayOdds={displayOdds}
            entering={phase === 8}
          />
        )}

        {/* Championship odds card */}
        {phase >= 11 && (
          <ChampCard
            ref={(el) => { roundRefs.current["CHAMP"] = el; }}
            teamList={champTeams}
          />
        )}

        {/* CTA */}
        {phase >= 12 && (
          <div ref={(el) => { roundRefs.current["CTA"] = el; }} className="demo-cta">
            <div className="demo-cta-emoji">{"\uD83C\uDFC6"}</div>
            <p className="demo-cta-headline">Best bracket wins $100.</p>
            <p className="demo-cta-body">Build yours free.</p>
            <p className="demo-cta-url">bracket.oddsgods.net</p>
            <p className="demo-cta-brand"><strong>ODDS</strong> GODS</p>
          </div>
        )}

        {/* Reset button */}
        {phase >= 12 && (
          <button className="demo-reset" onClick={reset}>{"\u21BA"}</button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ROUND CARD — R32, S16, E8
   ═══════════════════════════════════════════ */
interface RoundCardProps {
  roundKey: string;
  label: string;
  teamList: DemoTeam[];
  floridaState: "present" | "fading" | "gone";
  fadeClass: string;
  oddsState: "old" | "new";
  displayOdds: Record<string, string>;
  entering: boolean;
}

const RoundCard = forwardRef<HTMLDivElement, RoundCardProps>(
  ({ roundKey, label, teamList, floridaState, fadeClass, oddsState, displayOdds, entering }, ref) => (
    <div
      ref={ref}
      className={`demo-round-card ${entering ? "demo-round-card--entering" : ""}`}
    >
      <div className="demo-round-header">
        <span className="demo-round-name">{label}</span>
        <span className="demo-round-region">SOUTH</span>
      </div>
      {teamList.map((team) => {
        if (team.isFlorida && floridaState === "gone") return null;
        const isFading = team.isFlorida && floridaState === "fading";
        const rowClass =
          "demo-team-row" +
          (isFading ? ` demo-team-row--florida-fading ${fadeClass}` : "");

        let oddsText: string;
        if (team.isFlorida) {
          oddsText = fmtOdds(team.oldProb);
        } else if (oddsState === "old") {
          oddsText = fmtOdds(team.oldProb);
        } else {
          oddsText = displayOdds[`${roundKey}-${team.id}`] ?? fmtOdds(team.newProb);
        }

        const flashClass =
          oddsState === "new" && !team.isFlorida
            ? team.improved
              ? " demo-team-odds--flash-green"
              : team.worsened
                ? " demo-team-odds--flash-red"
                : ""
            : "";

        return (
          <div key={team.id} className="demo-matchup">
            <div className={rowClass}>
              <span className="demo-team-seed">{team.seed}</span>
              <img src={team.logoUrl} className="demo-team-logo" alt="" />
              <span className="demo-team-name">{team.name}</span>
              <span className={`demo-team-odds${flashClass}`}>{oddsText}</span>
            </div>
          </div>
        );
      })}
    </div>
  ),
);
RoundCard.displayName = "RoundCard";

/* ═══════════════════════════════════════════
   CHAMPIONSHIP ODDS CARD
   ═══════════════════════════════════════════ */
interface ChampCardProps {
  teamList: DemoTeam[];
}

const ChampCard = forwardRef<HTMLDivElement, ChampCardProps>(
  ({ teamList }, ref) => (
    <div ref={ref} className="demo-champ-card">
      <div className="demo-champ-header">CHAMPIONSHIP ODDS &middot; SOUTH</div>
      {teamList.map((team, i) => {
        const improved = team.newProb > team.oldProb + 0.001;
        return (
          <div key={team.id} className="demo-champ-row">
            <span className="demo-champ-rank">{i + 1}.</span>
            <img src={team.logoUrl} className="demo-champ-logo" alt="" />
            <span className="demo-champ-name">{team.name}</span>
            <span className="demo-champ-odds-new">{fmtOdds(team.newProb)}</span>
            <span className="demo-champ-odds-old">was {fmtOdds(team.oldProb)}</span>
            <span className={improved ? "demo-champ-arrow" : "demo-champ-arrow-down"}>
              {improved ? "\u25B2" : "\u25BC"}
            </span>
          </div>
        );
      })}
    </div>
  ),
);
ChampCard.displayName = "ChampCard";
