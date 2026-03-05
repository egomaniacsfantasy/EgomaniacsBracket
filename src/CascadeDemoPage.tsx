import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import { teams, teamsById } from "./data/teams";
import { teamLogoUrl } from "./lib/logo";
import { abbreviationForTeam } from "./lib/abbreviation";
import { formatAmerican, toAmericanOdds } from "./lib/odds";
import { runSimulation } from "./lib/simulation";
import type { FuturesRow } from "./types";
import "./CascadeDemoPage.css";

/* ── constants ── */
const FLORIDA_ID = "South-2";
const MERRIMACK_ID = "South-15";
const UPSET_GAME_ID = "South-R64-7";
const SIM_RUNS = 5000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── types ── */
interface DemoTeam {
  id: string;
  name: string;
  abbrev: string;
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
      abbrev: abbreviationForTeam(t.name),
      seed: t.seed,
      logoUrl: teamLogoUrl(t),
      oldProb,
      newProb,
      oldAmOdds: oldProb > 0.001 ? toAmericanOdds(oldProb) : 99999,
      newAmOdds: newProb > 0.001 ? toAmericanOdds(newProb) : 99999,
      isFlorida: t.id === FLORIDA_ID,
      improved: newProb > oldProb + 0.005,
      worsened: newProb < oldProb - 0.005,
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
   PHASES:
   0  = pre-pick
   1  = picked (Florida ✗, Merrimack ✓)
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
    const all = buildRoundTeams(beforeSim.futures, afterSim.futures, "champProb", 6);
    return all.filter((t) => !t.isFlorida);
  }, [beforeSim, afterSim]);

  /* ── hero matchup data ── */
  const florida = teamsById.get(FLORIDA_ID)!;
  const merrimack = teamsById.get(MERRIMACK_ID)!;
  const floridaOdds = fmtOdds(getProb(beforeSim.futures, FLORIDA_ID, "round2Prob"));
  const merrimackOdds = fmtOdds(getProb(beforeSim.futures, MERRIMACK_ID, "round2Prob"));

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

  /* ── cascade sequence (v2 timing table) ── */
  const handlePick = useCallback(async () => {
    if (phase > 0) return;

    // 0ms: Picked
    setPhase(1);
    await delay(1200);

    // 1200ms: R32 appears with old odds, Florida present
    setPhase(2);
    await delay(100);
    roundRefs.current["R32"]?.scrollIntoView({ behavior: "smooth", block: "center" });
    await delay(1400);

    // 2700ms: R32 Florida fading (800ms CSS anim)
    setPhase(3);
    await delay(1200);

    // 4300ms: R32 reprice (600ms counter)
    setPhase(4);
    animateOdds("R32", r32Teams, 600);
    await delay(1200);

    // 5500ms: S16 appears with old odds, Florida present
    setPhase(5);
    await delay(100);
    roundRefs.current["S16"]?.scrollIntoView({ behavior: "smooth", block: "center" });
    await delay(900);

    // 6500ms: S16 Florida fading (600ms CSS anim)
    setPhase(6);
    await delay(900);

    // 7400ms: S16 reprice
    setPhase(7);
    animateOdds("S16", s16Teams, 600);
    await delay(800);

    // 8200ms: E8 appears with old odds, Florida present
    setPhase(8);
    await delay(100);
    roundRefs.current["E8"]?.scrollIntoView({ behavior: "smooth", block: "center" });
    await delay(700);

    // 9000ms: E8 Florida fading (500ms CSS anim)
    setPhase(9);
    await delay(700);

    // 9700ms: E8 reprice
    setPhase(10);
    animateOdds("E8", e8Teams, 500);
    await delay(1000);

    // 10700ms: Championship card
    setPhase(11);
    await delay(100);
    roundRefs.current["CHAMP"]?.scrollIntoView({ behavior: "smooth", block: "center" });
    await delay(1900);

    // 12700ms: CTA
    setPhase(12);
    await delay(100);
    roundRefs.current["CTA"]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [phase, animateOdds, r32Teams, s16Teams, e8Teams]);

  /* ── reset ── */
  const reset = useCallback(() => {
    setPhase(0);
    setDisplayOdds({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <div className="demo-page">
      {/* header */}
      <div className="demo-header">
        <div className="demo-brand-eyebrow">ODDS GODS</div>
        <div className="demo-brand-title">THE BRACKET LAB</div>
      </div>

      {/* instruction / status */}
      {phase === 0 ? (
        <div className="demo-instruction">
          <p className="demo-instruction-main">Pick the upset.</p>
          <p className="demo-instruction-sub">Tap #15 Merrimack.</p>
        </div>
      ) : (
        <div className="demo-eliminated-headline">
          <p className="demo-eliminated-main">Florida eliminated.</p>
          <p className="demo-eliminated-sub">Watch the South reprice.</p>
        </div>
      )}

      {/* hero matchup card */}
      <div className="demo-matchup">
        {/* Florida */}
        <div
          className={
            "demo-team-row" +
            (phase >= 1 ? " demo-team-row--eliminated demo-team-row--flash-red" : "")
          }
        >
          <span className="demo-team-seed">{florida.seed}</span>
          <img src={teamLogoUrl(florida)} className="demo-team-logo" alt="" />
          <span className="demo-team-name">{abbreviationForTeam(florida.name)}</span>
          {phase >= 1 ? (
            <span className="demo-outcome demo-outcome--loss">{"\u2715"}</span>
          ) : (
            <span className="demo-team-odds">{floridaOdds}</span>
          )}
        </div>
        <div className="demo-matchup-divider" />
        {/* Merrimack */}
        <div
          className={
            "demo-team-row" +
            (phase === 0 ? " demo-team-row--hint" : " demo-team-row--picked")
          }
          onClick={handlePick}
          style={{ cursor: phase === 0 ? "pointer" : "default" }}
        >
          <span className="demo-team-seed">{merrimack.seed}</span>
          <img src={teamLogoUrl(merrimack)} className="demo-team-logo" alt="" />
          <span className="demo-team-name">{abbreviationForTeam(merrimack.name)}</span>
          {phase >= 1 ? (
            <span className="demo-outcome demo-outcome--win">{"\u2713"}</span>
          ) : (
            <span className="demo-team-odds">{merrimackOdds}</span>
          )}
        </div>
      </div>

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
          <div className="demo-cta-badge">$100 BRACKET GIVEAWAY</div>
          <p className="demo-cta-headline">Best bracket wins $100.</p>
          <p className="demo-cta-body">Build yours now.</p>
          <p className="demo-cta-url">bracket.oddsgods.net</p>
          <p className="demo-cta-brand"><strong>ODDS</strong> GODS</p>
        </div>
      )}

      {/* Reset button */}
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
      className={`demo-round-card ${entering ? "demo-round-card--entering" : "demo-round-card--visible"}`}
    >
      <div className="demo-round-header">
        <span className="demo-round-name">{label} {"\u00B7"} SOUTH</span>
      </div>
      {teamList.map((team) => {
        if (team.isFlorida && floridaState === "gone") return null;
        const isFading = team.isFlorida && floridaState === "fading";
        const rowClass =
          "demo-team-row" + (isFading ? ` demo-team-row--fading ${fadeClass}` : "");

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
          <div key={team.id} className="demo-matchup" style={{ marginBottom: 3 }}>
            <div className={rowClass}>
              <span className="demo-team-seed">{team.seed}</span>
              <img src={team.logoUrl} className="demo-team-logo" alt="" />
              <span className="demo-team-name">{team.abbrev}</span>
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
      <div className="demo-champ-header">CHAMPIONSHIP ODDS {"\u00B7"} SOUTH</div>
      {teamList.map((team, i) => (
        <div key={team.id} className="demo-champ-row">
          <span className="demo-champ-rank">{i + 1}.</span>
          <img src={team.logoUrl} className="demo-champ-logo" alt="" />
          <span className="demo-champ-name">{team.abbrev}</span>
          <span className="demo-champ-odds">{fmtOdds(team.newProb)}</span>
          <span className="demo-champ-delta">
            {"\u25B2"} was {fmtOdds(team.oldProb)}
          </span>
        </div>
      ))}
    </div>
  ),
);
ChampCard.displayName = "ChampCard";
