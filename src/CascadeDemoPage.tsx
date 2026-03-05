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
  // Keep Florida in sorted position
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
   PHASES (v3 timing — ~20s cascade):
   0  = pre-pick
   1  = picked (Florida X, Merrimack check)
   2  = R32 card, old odds, Florida present
   3  = R32 Florida fading
   4  = R32 odds repricing
   5  = S16 card, old odds, Florida present
   6  = S16 Florida fading
   7  = S16 odds repricing
   8  = E8 card, old odds, Florida present
   9  = E8 Florida fading
   10 = E8 odds repricing
   11 = Championship card
   12 = CTA + reset
   ═══════════════════════════════════════════ */

export function CascadeDemoPage() {
  const [phase, setPhase] = useState(0);
  const [displayOdds, setDisplayOdds] = useState<Record<string, string>>({});
  const roundRefs = useRef<Record<string, HTMLDivElement | null>>({});

  /* ── simulations ── */
  const { beforeSim, afterSim } = useMemo(() => {
    const b = runSimulation({}, SIM_RUNS);
    const a = runSimulation({ [UPSET_GAME_ID]: MERRIMACK_ID }, SIM_RUNS);

    // Validation: every South team's advancement should improve when #2 seed eliminated
    const southTeams = teams.filter((t) => t.region === "South" && t.id !== FLORIDA_ID && t.id !== "South-16b");
    for (const t of southTeams) {
      const beforeChamp = getProb(b.futures, t.id, "champProb");
      const afterChamp = getProb(a.futures, t.id, "champProb");
      if (afterChamp < beforeChamp - 0.01) {
        console.warn(
          `[DemoCascade] WARNING: ${t.name} championship odds got WORSE after Florida eliminated: ` +
          `${(beforeChamp * 100).toFixed(2)}% -> ${(afterChamp * 100).toFixed(2)}%. ` +
          `This may indicate Monte Carlo variance; increase SIM_RUNS.`
        );
      }
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
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
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

  /* ── cascade sequence (v3 timing — ~20 seconds total) ── */
  const handlePick = useCallback(async () => {
    if (phase > 0) return;

    // 0ms: Picked — Florida eliminated, Merrimack wins
    setPhase(1);
    await delay(2000);

    // 2000ms: R32 appears with old odds, Florida present
    setPhase(2);
    scrollToRef("R32");
    await delay(2000);

    // 4000ms: R32 Florida fading (1000ms CSS animation)
    setPhase(3);
    await delay(1600); // 1000ms fade + 600ms hold

    // 5600ms: R32 reprice (800ms counter animation)
    setPhase(4);
    animateOdds("R32", r32Teams, 800);
    await delay(2300); // 800ms animation + 1500ms hold

    // 7900ms: S16 appears with old odds, Florida present
    setPhase(5);
    scrollToRef("S16");
    await delay(1500);

    // 9400ms: S16 Florida fading (800ms CSS animation)
    setPhase(6);
    await delay(1300); // 800ms fade + 500ms hold

    // 10700ms: S16 reprice (700ms counter)
    setPhase(7);
    animateOdds("S16", s16Teams, 700);
    await delay(1900); // 700ms animation + 1200ms hold

    // 12600ms: E8 appears with old odds, Florida present
    setPhase(8);
    scrollToRef("E8");
    await delay(1200);

    // 13800ms: E8 Florida fading (600ms CSS animation)
    setPhase(9);
    await delay(1000); // 600ms fade + 400ms hold

    // 14800ms: E8 reprice (600ms counter)
    setPhase(10);
    animateOdds("E8", e8Teams, 600);
    await delay(1600); // 600ms animation + 1000ms hold

    // 16400ms: Championship odds card
    setPhase(11);
    scrollToRef("CHAMP");
    await delay(3000);

    // 19400ms: CTA
    setPhase(12);
    scrollToRef("CTA");
  }, [phase, animateOdds, r32Teams, s16Teams, e8Teams, scrollToRef]);

  /* ── reset ── */
  const reset = useCallback(() => {
    setPhase(0);
    setDisplayOdds({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <div className="demo-page">
      {/* ── Brand header ── */}
      <div className="demo-header">
        <div className="demo-eyebrow">O D D S &nbsp; G O D S</div>
        <div className="demo-title">THE BRACKET LAB</div>
      </div>

      {/* ── Instruction / eliminated headline ── */}
      {phase === 0 ? (
        <div className="demo-instruction">
          <p className="demo-instruction-main">Pick the upset.</p>
          <p className="demo-instruction-sub">Tap #15 Merrimack.</p>
        </div>
      ) : (
        <div className="demo-eliminated">
          <p className="demo-eliminated-main">Florida eliminated.</p>
          <p className="demo-eliminated-sub">Watch the South reprice.</p>
        </div>
      )}

      {/* ── Hero matchup card ── */}
      <div className="demo-hero-matchup">
        {/* Florida row */}
        <div
          className={
            "demo-hero-row" +
            (phase >= 1 ? " demo-hero-row--eliminated demo-hero-row--flash-red" : "")
          }
        >
          <span className="demo-hero-seed">{florida.seed}</span>
          <img src={teamLogoUrl(florida)} className="demo-hero-logo" alt="" />
          <span className="demo-hero-name">{florida.name}</span>
          <span className="demo-hero-odds">{floridaOdds}</span>
          {phase >= 1 && <span className="demo-hero-check" style={{ color: "var(--red-loss)" }}>{"\u2715"}</span>}
        </div>
        <div className="demo-hero-divider" />
        {/* Merrimack row */}
        <div
          className={
            "demo-hero-row" +
            (phase === 0 ? " demo-hero-row--hint demo-hero-row--clickable" : " demo-hero-row--picked")
          }
          onClick={handlePick}
        >
          <span className="demo-hero-seed">{merrimack.seed}</span>
          <img src={teamLogoUrl(merrimack)} className="demo-hero-logo" alt="" />
          <span className="demo-hero-name">{merrimack.name}</span>
          <span className="demo-hero-odds">{merrimackOdds}</span>
          {phase >= 1 && <span className="demo-hero-check" style={{ color: "var(--green-win)" }}>{"\u2713"}</span>}
        </div>
      </div>

      {/* ── Region label ── */}
      <div className="demo-region-label">SOUTH REGION &middot; 2026 NCAA TOURNAMENT</div>

      {/* ── Giveaway teaser pill ── */}
      {phase === 0 && (
        <div className="demo-teaser">Best bracket wins $100. Details &darr;</div>
      )}

      {/* ── R32 card ── */}
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

      {/* ── S16 card ── */}
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

      {/* ── E8 card ── */}
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

      {/* ── Championship odds card ── */}
      {phase >= 11 && (
        <ChampCard
          ref={(el) => { roundRefs.current["CHAMP"] = el; }}
          teamList={champTeams}
        />
      )}

      {/* ── CTA ── */}
      {phase >= 12 && (
        <div ref={(el) => { roundRefs.current["CTA"] = el; }} className="demo-cta">
          <div className="demo-cta-emoji">{"\uD83C\uDFC6"}</div>
          <div className="demo-cta-badge">$100 BRACKET GIVEAWAY</div>
          <p className="demo-cta-headline">Best bracket wins $100.</p>
          <p className="demo-cta-body">Build yours free.</p>
          <p className="demo-cta-url">bracket.oddsgods.net</p>
          <p className="demo-cta-brand"><strong>ODDS</strong> GODS</p>
        </div>
      )}

      {/* ── Reset button ── */}
      {phase >= 12 && (
        <button className="demo-reset" onClick={reset}>{"\u21BA"}</button>
      )}
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
