import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./index.css";
import { teamsById } from "./data/teams";
import { regionRounds } from "./data/bracket";
import {
  finalRounds,
  gamesByRegionAndRound,
  getGameWinProb,
  possibleWinnersByGame,
  resetRegionPicks,
  resolveGames,
  sanitizeLockedPicks,
  type LockedPicks,
} from "./lib/bracket";
import { abbreviationForTeam } from "./lib/abbreviation";
import { formatOddsDisplay, toImpliedLabel, toOneInX } from "./lib/odds";
import { generateSimulatedBracket, hashLocks, runSimulation } from "./lib/simulation";
import { fallbackLogo, teamLogoUrl } from "./lib/logo";
import { fullTeamName } from "./lib/teamNames";
import type { OddsDisplayMode, Region, ResolvedGame, SimulationOutput } from "./types";

const DEFAULT_SIM_RUNS = 5000;
const ONBOARDING_STORAGE_KEY = "oddsGods_onboardingDismissed";

const formatModes: { id: OddsDisplayMode; label: string }[] = [
  { id: "american", label: "American" },
  { id: "implied", label: "Implied %" },
];

const regionSections: Region[][] = [
  ["South", "East"],
  ["West", "Midwest"],
];
const invertedRegions = new Set<Region>(["East", "Midwest"]);

const gameRoundLabel: Record<string, string> = {
  R64: "Round of 64",
  R32: "Round of 32",
  S16: "Sweet 16",
  E8: "Elite 8",
  F4: "Final Four",
  CHAMP: "Championship",
};

const ROUND_RANK: Record<ResolvedGame["round"], number> = {
  R64: 0,
  R32: 1,
  S16: 2,
  E8: 3,
  F4: 4,
  CHAMP: 5,
};

type OnboardingStage = 1 | 2 | 3;

type DemoTitleShiftRow = {
  teamId: string;
  name: string;
  seed: number;
  before: number;
  after: number;
  direction: "up" | "down";
};

type DemoSimulationOutput = {
  before: SimulationOutput;
  after: SimulationOutput;
  titleOddsShift: DemoTitleShiftRow[];
};

function App() {
  const [lockedPicks, setLockedPicks] = useState<LockedPicks>({});
  const [undoStack, setUndoStack] = useState<LockedPicks[]>([]);
  const [displayMode, setDisplayMode] = useState<OddsDisplayMode>("american");
  const [simRuns] = useState<number>(DEFAULT_SIM_RUNS);
  const [sortDesc, setSortDesc] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastPickedKey, setLastPickedKey] = useState<string | null>(null);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [compactDesktop, setCompactDesktop] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "true";
  });
  const [simResult, setSimResult] = useState<SimulationOutput>({
    futures: [],
    gameWinProbs: {},
    likelihoodApprox: 0,
    likelihoodSimulation: 0,
  });

  const simulationCacheRef = useRef<Map<string, SimulationOutput>>(new Map());
  const demoGame = useMemo(
    () => resolveGames({}).games.find((game) => game.id === "South-R64-0") ?? null,
    []
  );

  const { games, sanitized } = useMemo(() => resolveGames(lockedPicks), [lockedPicks]);
  const possibleWinners = useMemo(() => possibleWinnersByGame(sanitized), [sanitized]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1850px)");
    const apply = () => setCompactDesktop(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const statsCanvas = document.getElementById("bg-stats") as HTMLCanvasElement | null;
    const lightningCanvas = document.getElementById("bg-lightning") as HTMLCanvasElement | null;
    const textCanvas = document.getElementById("bg-text") as HTMLCanvasElement | null;
    if (!statsCanvas || !lightningCanvas || !textCanvas) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const statCtx = statsCanvas.getContext("2d");
    const boltCtx = lightningCanvas.getContext("2d");
    const textCtx = textCanvas.getContext("2d");
    if (!statCtx || !boltCtx || !textCtx) return;

    let width = 0;
    let height = 0;
    let running = true;
    let raf = 0;
    let nextFlash = performance.now() + 12000;
    let flashAlpha = 0;
    let flashTrail: Array<{ x: number; y: number }> = [];

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      [statsCanvas, lightningCanvas, textCanvas].forEach((canvas) => {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      });
      statCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      boltCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      textCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
    const randomFloat = (min: number, max: number) => Math.random() * (max - min) + min;

    const drawStatsLayer = (time: number) => {
      statCtx.clearRect(0, 0, width, height);
      statCtx.globalAlpha = 0.14;
      statCtx.fillStyle = "rgba(236, 209, 132, 0.36)";
      statCtx.font = "11px 'Space Grotesk', sans-serif";
      for (let y = 28; y < height; y += 52) {
        for (let x = 18; x < width; x += 94) {
          const pulse = 0.5 + 0.5 * Math.sin((time * 0.00045) + x * 0.004 + y * 0.002);
          statCtx.globalAlpha = 0.08 + pulse * 0.09;
          statCtx.fillText(`${randomInt(10, 99)}.${randomInt(0, 9)}%`, x, y);
        }
      }
    };

    const drawTextLayer = () => {
      textCtx.clearRect(0, 0, width, height);
      textCtx.save();
      textCtx.globalAlpha = 0.05 + flashAlpha * 0.16;
      textCtx.fillStyle = "rgba(240, 228, 198, 0.85)";
      textCtx.font = "700 34px 'Instrument Serif', serif";
      textCtx.translate(width * 0.58, height * 0.64);
      textCtx.rotate(-0.06);
      textCtx.fillText("ODDS GODS", 0, 0);
      textCtx.font = "500 18px 'Space Grotesk', sans-serif";
      textCtx.globalAlpha = 0.04 + flashAlpha * 0.1;
      textCtx.fillText("THE BRACKET LAB", 6, 30);
      textCtx.restore();
    };

    const buildLightning = () => {
      const startX = randomFloat(width * 0.2, width * 0.8);
      flashTrail = [{ x: startX, y: -40 }];
      let x = startX;
      let y = -40;
      while (y < height * 0.92) {
        x += randomFloat(-28, 28);
        y += randomFloat(32, 72);
        flashTrail.push({ x, y });
      }
      flashAlpha = 0.95;
    };

    const drawLightningLayer = () => {
      boltCtx.clearRect(0, 0, width, height);
      if (flashAlpha <= 0 || flashTrail.length < 2) return;
      boltCtx.save();
      boltCtx.lineWidth = 1.4;
      boltCtx.strokeStyle = `rgba(250, 232, 185, ${0.2 + flashAlpha * 0.55})`;
      boltCtx.shadowColor = "rgba(245, 210, 135, 0.4)";
      boltCtx.shadowBlur = 18;
      boltCtx.beginPath();
      flashTrail.forEach((point, index) => {
        if (index === 0) boltCtx.moveTo(point.x, point.y);
        else boltCtx.lineTo(point.x, point.y);
      });
      boltCtx.stroke();
      boltCtx.restore();
    };

    const frame = (time: number) => {
      if (!running) return;
      if (time >= nextFlash) {
        buildLightning();
        nextFlash = time + randomInt(10000, 18000);
      }

      drawStatsLayer(time);
      drawTextLayer();
      drawLightningLayer();

      flashAlpha = Math.max(0, flashAlpha * 0.91 - 0.01);
      raf = window.requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = window.requestAnimationFrame(frame);

    return () => {
      running = false;
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    const key = hashLocks(sanitized, simRuns);
    const existing = simulationCacheRef.current.get(key);
    let active = true;

    if (existing) {
      setSimResult(existing);
      setIsUpdating(false);
      return undefined;
    }

    const updateTimer = window.setTimeout(() => {
      if (!active) return;
      setIsUpdating(true);
    }, 20);

    const timer = window.setTimeout(() => {
      if (!active) return;
      const result = runSimulation(sanitized, simRuns);
      simulationCacheRef.current.set(key, result);
      setSimResult(result);
      setIsUpdating(false);
    }, 150);

    return () => {
      active = false;
      window.clearTimeout(updateTimer);
      window.clearTimeout(timer);
    };
  }, [sanitized, simRuns]);

  const sortedFutures = useMemo(() => {
    const rows = [...simResult.futures];
    rows.sort((a, b) => {
      const diff = b.champProb - a.champProb;
      return sortDesc ? diff : -diff;
    });
    return rows;
  }, [simResult.futures, sortDesc]);

  const teamProgress = useMemo(() => {
    const progress = new Map<string, { lastWinRank: number; firstLossRank: number }>();

    for (const team of teamsById.values()) {
      progress.set(team.id, { lastWinRank: -1, firstLossRank: Number.POSITIVE_INFINITY });
    }

    for (const game of games) {
      if (!game.lockedByUser || !game.teamAId || !game.teamBId || !game.winnerId) continue;
      const rank = ROUND_RANK[game.round];
      const loserId = game.winnerId === game.teamAId ? game.teamBId : game.teamAId;

      const winnerState = progress.get(game.winnerId);
      if (winnerState) winnerState.lastWinRank = Math.max(winnerState.lastWinRank, rank);

      const loserState = progress.get(loserId);
      if (loserState) loserState.firstLossRank = Math.min(loserState.firstLossRank, rank);
    }

    return progress;
  }, [games]);

  const stageRankByMetric: Record<"R32" | "S16" | "E8" | "F4" | "Title" | "Champ", number> = {
    R32: ROUND_RANK.R64,
    S16: ROUND_RANK.R32,
    E8: ROUND_RANK.S16,
    F4: ROUND_RANK.E8,
    Title: ROUND_RANK.F4,
    Champ: ROUND_RANK.CHAMP,
  };

  const pushUndo = (current: LockedPicks) => {
    setUndoStack((prev) => [...prev, current]);
  };

  const onPick = (game: ResolvedGame, teamId: string | null) => {
    if (!teamId) return;
    if (teamId !== game.teamAId && teamId !== game.teamBId) return;
    pushUndo(lockedPicks);

    const next: LockedPicks = { ...lockedPicks };
    if (lockedPicks[game.id] === teamId) {
      delete next[game.id];
    } else {
      next[game.id] = teamId;
    }
    setLastPickedKey(`${game.id}:${teamId}`);

    setLockedPicks(sanitizeLockedPicks(next));
  };

  const onUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setLockedPicks(previous);
  };

  const onResetAll = () => {
    if (Object.keys(lockedPicks).length === 0) return;
    pushUndo(lockedPicks);
    setLockedPicks({});
  };

  const onResetRegion = (region: Region) => {
    pushUndo(lockedPicks);
    setLockedPicks(resetRegionPicks(lockedPicks, region));
  };

  const onModelSim = () => {
    pushUndo(lockedPicks);
    setLockedPicks(sanitizeLockedPicks(generateSimulatedBracket(lockedPicks)));
  };

  const runDemoSimulation = (gameId: string, winnerId: string): DemoSimulationOutput => {
    const baseLocks: LockedPicks = {};
    const before = runSimulation(baseLocks, simRuns);
    const after = runSimulation({ [gameId]: winnerId }, simRuns);
    const game = before.gameWinProbs[gameId] ? resolveGames(baseLocks).games.find((g) => g.id === gameId) : null;
    const excludedTeams = new Set<string>();
    if (game?.teamAId) excludedTeams.add(game.teamAId);
    if (game?.teamBId) excludedTeams.add(game.teamBId);

    const beforeMap = new Map(before.futures.map((row) => [row.teamId, row.champProb]));
    const titleOddsShift = after.futures
      .filter((row) => !excludedTeams.has(row.teamId) && row.champProb > 0)
      .sort((a, b) => b.champProb - a.champProb)
      .slice(0, 5)
      .map((row) => {
        const team = teamsById.get(row.teamId);
        const previous = beforeMap.get(row.teamId) ?? 0;
        return {
          teamId: row.teamId,
          name: team?.name ?? row.teamId,
          seed: team?.seed ?? 99,
          before: previous,
          after: row.champProb,
          direction: (row.champProb >= previous ? "up" : "down") as "up" | "down",
        };
      });
    return { before, after, titleOddsShift };
  };

  const dismissOnboarding = (dontShowAgain: boolean) => {
    if (dontShowAgain) {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    }
    setOnboardingOpen(false);
  };

  const skipOnboarding = (dontShowAgain: boolean) => {
    if (dontShowAgain) {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    }
    setOnboardingOpen(false);
  };

  const finalGames = finalRounds(games);
  const leftSemi = finalGames.find((g) => g.id === "F4-Left-0") ?? null;
  const rightSemi = finalGames.find((g) => g.id === "F4-Right-0") ?? null;
  const titleGame = finalGames.find((g) => g.id === "CHAMP-0") ?? null;

  return (
    <div className={`eg-shell ${compactDesktop ? "compact-desktop" : ""}`}>
      <div className="bg-glow" aria-hidden="true" />
      <canvas id="bg-stats" className="bg-canvas" aria-hidden="true" />
      <canvas id="bg-lightning" className="bg-canvas" aria-hidden="true" />
      <canvas id="bg-text" className="bg-canvas" aria-hidden="true" />
      <div className="bg-shape bg-top" aria-hidden="true" />
      <div className="bg-shape bg-bottom" aria-hidden="true" />

      <main className="eg-app">
        <header className="eg-header">
          <p className="eg-kicker">Odds Gods presents</p>
          <h1>The Bracket Lab</h1>
          <p className="eg-subtitle">
            March Madness what-if odds. Click picks to condition futures in real time.
          </p>
        </header>

        <section className={`eg-layout ${sidePanelOpen ? "panel-open" : "panel-collapsed"}`}>
          <div className="eg-main-panel">
            <div className="eg-main-actions">
              <button onClick={onUndo} disabled={undoStack.length === 0} className="eg-btn">
                Undo
              </button>
              <button onClick={onResetAll} className="eg-btn">
                Reset All
              </button>
              <button onClick={onModelSim} className="eg-btn">
                Model Sim Bracket
              </button>
              <div className="eg-mode-toggle">
                {formatModes.map((mode) => (
                  <button
                    key={mode.id}
                    className={`eg-chip ${displayMode === mode.id ? "active" : ""}`}
                    onClick={() => setDisplayMode(mode.id)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="eg-bracket-stack">
              <section className="eg-bracket-section top-half">
                <div className="eg-section-head">
                  <h2>Top Half Bracket</h2>
                  <p>South + East</p>
                </div>
                <div className="eg-region-scroll">
                  <div className="eg-region-grid bracket-style">
                    {regionSections[0].map((region) => (
                      <RegionBracket
                        key={region}
                        region={region}
                        games={games}
                        gameWinProbs={simResult.gameWinProbs}
                        possibleWinners={possibleWinners}
                        onPick={onPick}
                        lastPickedKey={lastPickedKey}
                        onResetRegion={onResetRegion}
                        inverted={invertedRegions.has(region)}
                        displayMode={displayMode}
                      />
                    ))}
                  </div>
                </div>
              </section>

              <section className="eg-bracket-section">
                <div className="eg-section-head">
                  <h2>Bottom Half Bracket</h2>
                  <p>West + Midwest</p>
                </div>
                <div className="eg-region-scroll">
                  <div className="eg-region-grid bracket-style">
                    {regionSections[1].map((region) => (
                      <RegionBracket
                        key={region}
                        region={region}
                        games={games}
                        gameWinProbs={simResult.gameWinProbs}
                        possibleWinners={possibleWinners}
                        onPick={onPick}
                        lastPickedKey={lastPickedKey}
                        onResetRegion={onResetRegion}
                        inverted={invertedRegions.has(region)}
                        displayMode={displayMode}
                      />
                    ))}
                  </div>
                </div>
              </section>

              <section className="eg-finals-card bracket-finals">
                <h2>Final Four & Championship</h2>
                <div className="eg-finals-stage">
                  <div className="eg-semi-col left">
                    <p className="eg-finals-label">Semifinal</p>
                    <p className="eg-finals-sub">South + East</p>
                    {leftSemi ? (
                      <GameCard
                        key={leftSemi.id}
                        game={leftSemi}
                        gameWinProbs={simResult.gameWinProbs}
                        possibleWinners={possibleWinners}
                        onPick={onPick}
                        lastPickedKey={lastPickedKey}
                        displayMode={displayMode}
                      />
                    ) : null}
                  </div>

                  <div className="eg-title-col">
                    <p className="eg-finals-label title">National Championship</p>
                    {titleGame ? (
                      <div className="eg-title-hero">
                        <GameCard
                          key={titleGame.id}
                          game={titleGame}
                          gameWinProbs={simResult.gameWinProbs}
                          possibleWinners={possibleWinners}
                          onPick={onPick}
                          lastPickedKey={lastPickedKey}
                          displayMode={displayMode}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="eg-semi-col right">
                    <p className="eg-finals-label">Semifinal</p>
                    <p className="eg-finals-sub">West + Midwest</p>
                    {rightSemi ? (
                      <GameCard
                        key={rightSemi.id}
                        game={rightSemi}
                        gameWinProbs={simResult.gameWinProbs}
                        possibleWinners={possibleWinners}
                        onPick={onPick}
                        lastPickedKey={lastPickedKey}
                        displayMode={displayMode}
                      />
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          </div>

          <aside className={`eg-side-panel ${sidePanelOpen ? "open" : "collapsed"}`}>
            <button
              type="button"
              className="eg-side-toggle"
              onClick={() => setSidePanelOpen((v) => !v)}
              aria-expanded={sidePanelOpen}
            >
              {sidePanelOpen ? "Collapse ▸" : "Futures ▾"}
            </button>

            <section className="eg-panel-block">
              <div className="eg-panel-head">
                <h3>
                  Futures
                  <span
                    className="eg-info"
                    title="Futures are recalculated via simulation given your locked picks."
                  >
                    i
                  </span>
                </h3>
                <button className="eg-mini-btn" onClick={() => setSortDesc((v) => !v)}>
                  Sort {sortDesc ? "↓" : "↑"}
                </button>
              </div>

              {isUpdating ? <p className="eg-updating">Updating…</p> : null}
              <div className="eg-futures-list">
                {sortedFutures.map((row) => {
                  const team = teamsById.get(row.teamId);
                  if (!team) return null;
                  const metrics: Array<{ label: "R32" | "S16" | "E8" | "F4" | "Title" | "Champ"; prob: number }> = [
                    { label: "R32", prob: row.round2Prob },
                    { label: "S16", prob: row.sweet16Prob },
                    { label: "E8", prob: row.elite8Prob },
                    { label: "F4", prob: row.final4Prob },
                    { label: "Title", prob: row.titleGameProb },
                    { label: "Champ", prob: row.champProb },
                  ];
                  return (
                    <article key={row.teamId} className="eg-future-item">
                      <div className="team-cell">
                        <TeamHoverAnchor teamName={team.name} logoSrc={teamLogoUrl(team)}>
                          <TeamLogo teamName={team.name} src={teamLogoUrl(team)} />
                        </TeamHoverAnchor>
                        <span className="seed">{team.seed}</span>
                        <TeamHoverAnchor teamName={team.name} logoSrc={teamLogoUrl(team)}>
                          <span className="future-team-name">{team.name}</span>
                        </TeamHoverAnchor>
                      </div>
                      <div className="future-metric-grid">
                        {metrics.map((metric) => {
                          const formatted = formatOddsDisplay(metric.prob, displayMode);
                          const state = teamProgress.get(row.teamId);
                          const requiredRank = stageRankByMetric[metric.label];
                          const isAchieved = Boolean(state && state.lastWinRank >= requiredRank);
                          const isEliminated = Boolean(state && state.firstLossRank <= requiredRank);
                          return (
                            <div key={`${row.teamId}-${metric.label}`} className="future-metric">
                              <span className="future-metric-label">{metric.label}</span>
                              <span className="future-metric-value">
                                {isAchieved ? (
                                  <span className="outcome-badge win">✓</span>
                                ) : isEliminated ? (
                                  <span className="outcome-badge loss">✕</span>
                                ) : (
                                  formatted.primary
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="eg-panel-block">
              <h3>Your Bracket</h3>
              <p className="eg-metric-label">Likelihood of your picks so far (simulation-based)</p>
              <p className="eg-metric-value">{toImpliedLabel(simResult.likelihoodSimulation)}</p>
              <p className="eg-metric-sub">{toOneInX(simResult.likelihoodSimulation)}</p>

              <p className="eg-metric-label">Fast approximation (product of locked game win probs)</p>
              <p className="eg-metric-value">{toImpliedLabel(simResult.likelihoodApprox)}</p>
              <p className="eg-metric-sub">{toOneInX(simResult.likelihoodApprox)}</p>
            </section>

            <section className="eg-panel-block settings-block">
              <h3>Settings</h3>
              <p className="eg-setting-label">Side definition</p>
              <p className="eg-setting-value">Left side: East/West, Right side: South/Midwest</p>

              <p className="eg-setting-label">Current lock count</p>
              <p className="eg-setting-value">{Object.keys(sanitized).length} picks</p>
              <button className="eg-mini-btn onboarding-replay-btn" onClick={() => setOnboardingOpen(true)}>
                Replay Intro
              </button>
            </section>
          </aside>
        </section>
      </main>

      {onboardingOpen && demoGame ? (
        <OnboardingFlow
          demoGame={demoGame}
          runDemoSimulation={runDemoSimulation}
          onComplete={dismissOnboarding}
          onSkip={skipOnboarding}
        />
      ) : null}
    </div>
  );
}

function RegionBracket({
  region,
  games,
  gameWinProbs,
  possibleWinners,
  onPick,
  lastPickedKey,
  onResetRegion,
  inverted,
  displayMode,
}: {
  region: Region;
  games: ResolvedGame[];
  gameWinProbs: SimulationOutput["gameWinProbs"];
  possibleWinners: Record<string, Set<string>>;
  onPick: (game: ResolvedGame, teamId: string | null) => void;
  lastPickedKey: string | null;
  onResetRegion: (region: Region) => void;
  inverted: boolean;
  displayMode: OddsDisplayMode;
}) {
  const rounds = inverted ? [...regionRounds].reverse() : [...regionRounds];

  return (
    <section className={`eg-region-card bracket-region ${inverted ? "region-inverted" : ""}`}>
      <div className="eg-region-head">
        <h2>{region}</h2>
        <button className="eg-mini-btn" onClick={() => onResetRegion(region)}>
          Reset Region
        </button>
      </div>

      <div className="eg-round-grid bracket-grid">
        {rounds.map((round) => {
          const roundGames = gamesByRegionAndRound(games, region, round);
          return (
            <div key={`${region}-${round}`} className={`eg-round-col lane-${round.toLowerCase()}`}>
              <p className="eg-round-label">{gameRoundLabel[round]}</p>
              <div className="eg-games-lane">
                {roundGames.map((game, idx) => {
                  const topPercent = ((idx + 0.5) / Math.max(1, roundGames.length)) * 100;
                  const nodeStyle = { top: `${topPercent}%` } as React.CSSProperties;
                  return (
                    <div key={game.id} className="eg-game-node" style={nodeStyle}>
                      <GameCard
                        game={game}
                        gameWinProbs={gameWinProbs}
                        possibleWinners={possibleWinners}
                        onPick={onPick}
                        lastPickedKey={lastPickedKey}
                        displayMode={displayMode}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function GameCard({
  game,
  gameWinProbs,
  possibleWinners,
  onPick,
  lastPickedKey,
  displayMode,
}: {
  game: ResolvedGame;
  gameWinProbs: SimulationOutput["gameWinProbs"];
  possibleWinners: Record<string, Set<string>>;
  onPick: (game: ResolvedGame, teamId: string | null) => void;
  lastPickedKey: string | null;
  displayMode: OddsDisplayMode;
}) {
  type CandidateRow = { teamId: string; prob: number; team: NonNullable<ReturnType<typeof teamsById.get>> };

  const candidates = (gameWinProbs[game.id] || [])
    .map((entry) => ({ ...entry, team: teamsById.get(entry.teamId) }))
    .filter((entry): entry is CandidateRow => Boolean(entry.team));
  const sortedCandidates =
    game.round === "F4" || game.round === "CHAMP"
      ? [...candidates].sort((a, b) => {
          if (b.prob !== a.prob) return b.prob - a.prob;
          return a.team.seed - b.team.seed;
        })
      : candidates;
  const possibleForGame = possibleWinners[game.id] ?? new Set<string>();
  const constrainedCandidates = sortedCandidates.filter((candidate) => possibleForGame.has(candidate.teamId));
  const probByTeam = new Map(candidates.map((c) => [c.teamId, c.prob]));
  const rows: CandidateRow[] =
    game.teamAId && game.teamBId
      ? [game.teamAId, game.teamBId]
          .map((teamId) => {
            const team = teamsById.get(teamId);
            if (!team) return null;
            return { teamId, prob: probByTeam.get(teamId) ?? 0, team };
          })
          .filter((row): row is CandidateRow => row !== null)
      : constrainedCandidates;
  const finalistRows = rows.filter((candidate) => {
    const team = candidate.team!;
    return (
      game.teamAId !== null &&
      game.teamBId !== null &&
      (team.id === game.teamAId || team.id === game.teamBId)
    );
  });
  const useShowdownSplit = (game.round === "CHAMP" || game.round === "F4") && finalistRows.length === 2;
  const compactColumns = getCompactColumns(game.round, rows.length);
  const compactDensity = getCompactDensity(game.round, rows.length);

  return (
    <article className={`eg-game-card round-${game.round.toLowerCase()}`}>
      <div className="eg-game-list">
        {useShowdownSplit ? (
          <div className={`eg-champ-split ${game.round === "CHAMP" ? "championship" : "semifinal"}`}>
            {finalistRows.map((candidate) => {
              const team = candidate.team!;
              const selected = game.winnerId === team.id;
              const outcome =
                game.lockedByUser && game.winnerId
                  ? game.winnerId === team.id
                    ? "win"
                    : "loss"
                  : null;
              const { primary, secondary } = formatOddsDisplay(candidate.prob, displayMode);
              return (
                <button
                  key={`${game.id}-${team.id}-split`}
                  type="button"
                  className={`eg-title-choice ${selected ? "selected" : ""} ${outcome === "win" ? "result-win" : ""} ${outcome === "loss" ? "result-loss" : ""}`}
                  onClick={() => onPick(game, team.id)}
                  title={`Chance to win title: ${(candidate.prob * 100).toFixed(1)}%`}
                >
                  <span className="title-choice-left">
                    <span className="chip-seed">{team.seed}</span>
                    <TeamHoverAnchor teamName={team.name} logoSrc={teamLogoUrl(team)}>
                      <TeamLogo teamName={team.name} src={teamLogoUrl(team)} />
                    </TeamHoverAnchor>
                    <TeamHoverAnchor teamName={team.name} logoSrc={teamLogoUrl(team)}>
                      <span className={`title-choice-name ${game.round === "CHAMP" ? "full-team-name" : ""}`}>
                        {game.round === "CHAMP" ? fullTeamName(team.name) : team.name}
                      </span>
                    </TeamHoverAnchor>
                  </span>
                  <span className="title-choice-odds">
                    {outcome ? (
                      <span className={`outcome-badge ${outcome}`}>{outcome === "win" ? "✓" : "✕"}</span>
                    ) : (
                      <>
                        <span className="title-choice-prob">{primary}</span>
                        {secondary ? <span className="title-choice-sub">{secondary}</span> : null}
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ) : rows.length > 0 ? (
          game.round === "R64" ? (
            rows.map((candidate) => {
              const team = candidate.team!;
              const canPick =
                game.teamAId !== null &&
                game.teamBId !== null &&
                (team.id === game.teamAId || team.id === game.teamBId);
              return (
                <TeamRow
                  key={`${game.id}-${team.id}`}
                  label={team.name}
                  seed={team.seed}
                  teamName={team.name}
                  logoSrc={teamLogoUrl(team)}
                  prob={candidate.prob}
                  selected={game.winnerId === team.id}
                  freshPick={Boolean(lastPickedKey === `${game.id}:${team.id}`)}
                  disabled={!canPick}
                  outcome={
                    game.lockedByUser && game.winnerId
                      ? game.winnerId === team.id
                        ? "win"
                        : "loss"
                      : null
                  }
                  tooltip={`Chance to advance from this game: ${(candidate.prob * 100).toFixed(1)}%`}
                  compact={false}
                  displayMode={displayMode}
                  onPick={() => onPick(game, canPick ? team.id : null)}
                />
              );
            })
          ) : (
            <div
              className={`eg-compact-grid round-${game.round.toLowerCase()} density-${compactDensity}`}
              style={{ gridTemplateColumns: `repeat(${compactColumns}, minmax(0, 1fr))` }}
            >
              {rows.map((candidate) => {
                const team = candidate.team!;
                const canPick =
                  game.teamAId !== null &&
                  game.teamBId !== null &&
                  (team.id === game.teamAId || team.id === game.teamBId);
                const selected = game.winnerId === team.id;
                const { primary, secondary } = formatOddsDisplay(candidate.prob, displayMode);
                const showLogo = true;
                const teamLabel = normalizeTeamName(team.name);
                const outcome =
                  game.lockedByUser && game.winnerId
                    ? game.winnerId === team.id
                      ? "win"
                      : "loss"
                    : null;
                return (
                  <button
                    key={`${game.id}-${team.id}`}
                    type="button"
                    className={`eg-compact-chip ${selected ? "selected" : ""} ${outcome === "win" ? "result-win" : ""} ${outcome === "loss" ? "result-loss" : ""}`}
                    disabled={!canPick}
                    onClick={() => onPick(game, canPick ? team.id : null)}
                    title={`Chance to advance from this game: ${(candidate.prob * 100).toFixed(1)}%`}
                  >
                    <span className="chip-seed">{team.seed}</span>
                    {showLogo ? (
                      <TeamHoverAnchor teamName={team.name} logoSrc={teamLogoUrl(team)}>
                        <TeamLogo teamName={team.name} src={teamLogoUrl(team)} />
                      </TeamHoverAnchor>
                    ) : null}
                    <TeamHoverAnchor teamName={team.name} logoSrc={teamLogoUrl(team)}>
                      <AdaptiveTeamLabel className={`chip-code ${showLogo ? "" : "no-logo"}`} fullName={teamLabel} />
                    </TeamHoverAnchor>
                    <span className="chip-odds">
                      {outcome ? (
                        <span className={`outcome-badge ${outcome}`}>{outcome === "win" ? "✓" : "✕"}</span>
                      ) : (
                        <>
                          <span className="chip-prob">{primary}</span>
                          {secondary ? <span className="chip-sub">{secondary}</span> : null}
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )
        ) : (
          <>
            <TeamRow
              label="TBD"
              seed={null}
              teamName={null}
              logoSrc={null}
              prob={null}
              selected={false}
              freshPick={false}
              disabled
              outcome={null}
              tooltip="Waiting for simulation..."
              compact={false}
              displayMode={displayMode}
              onPick={() => {}}
            />
            <TeamRow
              label="TBD"
              seed={null}
              teamName={null}
              logoSrc={null}
              prob={null}
              selected={false}
              freshPick={false}
              disabled
              outcome={null}
              tooltip="Waiting for simulation..."
              compact={false}
              displayMode={displayMode}
              onPick={() => {}}
            />
          </>
        )}
      </div>
    </article>
  );
}

function getCompactColumns(round: ResolvedGame["round"], count: number): number {
  if (round === "R32") return 1;
  if (round === "S16") return 1;
  if (round === "E8") return 1;
  if (round === "F4" || round === "CHAMP") {
    if (count <= 2) return 1;
    if (count <= 8) return 2;
    return 3;
  }
  return 2;
}

function getCompactDensity(round: ResolvedGame["round"], count: number): "sm" | "md" | "lg" | "xl" {
  if (round !== "F4" && round !== "CHAMP") return "sm";
  if (count <= 2) return "xl";
  if (count <= 4) return "lg";
  if (count <= 8) return "md";
  return "sm";
}

function TeamRow({
  label,
  seed,
  teamName,
  logoSrc,
  prob,
  selected,
  freshPick,
  disabled,
  outcome,
  tooltip,
  compact,
  displayMode,
  onPick,
}: {
  label: string;
  seed: number | null;
  teamName: string | null;
  logoSrc: string | null;
  prob: number | null;
  selected: boolean;
  freshPick: boolean;
  disabled: boolean;
  outcome: "win" | "loss" | null;
  tooltip: string;
  compact: boolean;
  displayMode: OddsDisplayMode;
  onPick: () => void;
}) {
  const formatted = prob !== null ? formatOddsDisplay(prob, displayMode) : { primary: "--" };
  const fullLabel = normalizeTeamName(label);

  return (
    <button
      type="button"
      className={`eg-team-row ${compact ? "compact" : ""} ${selected ? "selected" : ""} ${freshPick ? "fresh-pick" : ""} ${outcome === "win" ? "result-win" : ""} ${outcome === "loss" ? "result-loss" : ""}`}
      disabled={disabled}
      onClick={onPick}
      title={tooltip}
    >
      <span className="team-seed" aria-label={seed !== null ? `Seed ${seed}` : "Seed unavailable"}>
        {seed !== null ? seed : "--"}
      </span>
      {teamName && logoSrc ? (
        <TeamHoverAnchor teamName={teamName} logoSrc={logoSrc}>
          <TeamLogo teamName={teamName} src={logoSrc} />
        </TeamHoverAnchor>
      ) : (
        <span className="team-logo team-logo-placeholder" aria-hidden="true" />
      )}
      {compact ? null : (
        <TeamHoverAnchor teamName={fullLabel} logoSrc={logoSrc ?? fallbackLogo(fullLabel)}>
          <AdaptiveTeamLabel className="team-name" fullName={fullLabel} />
        </TeamHoverAnchor>
      )}
      <span className="team-odds-wrap">
        {outcome ? (
          <span className={`outcome-badge ${outcome}`}>{outcome === "win" ? "✓" : "✕"}</span>
        ) : (
          <>
            <span className="team-odds">{formatted.primary}</span>
            {formatted.secondary ? <span className="team-odds-sub">{formatted.secondary}</span> : null}
          </>
        )}
      </span>
    </button>
  );
}

function TeamLogo({ teamName, src }: { teamName: string; src: string }) {
  const [failed, setFailed] = useState(false);
  const fallback = fallbackLogo(teamName);

  return (
    <img
      className="team-logo"
      src={failed ? fallback : src}
      alt={`${teamName} logo`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function normalizeTeamName(name: string): string {
  const dictionary: Record<string, string> = {
    "James Madison": "James Madison",
    "Western Kentucky": "Western Kentucky",
    "Texas A&M": "Texas A&M",
    "North Carolina State": "NC State",
    "Florida Atlantic": "Florida Atlantic",
    "Mississippi State": "Mississippi State",
    "Morehead State": "Morehead State",
    "South Dakota State": "South Dakota St.",
    "Washington State": "Washington State",
    "San Diego State": "San Diego State",
    "Saint Mary's": "Saint Mary's",
  };
  return dictionary[name] ?? name;
}

function AdaptiveTeamLabel({ className, fullName }: { className: string; fullName: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [label, setLabel] = useState(fullName);
  const [prevLabel, setPrevLabel] = useState(fullName);
  const [switching, setSwitching] = useState(false);
  const labelRef = useRef(fullName);
  const switchTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const measure = (text: string, font: string): number => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return text.length * 8;
      ctx.font = font;
      return ctx.measureText(text).width;
    };

    const recalc = () => {
      const el = ref.current;
      if (!el) return;
      const style = window.getComputedStyle(el);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const maxWidth = (el.parentElement as HTMLElement | null)?.clientWidth ?? el.clientWidth;
      const full = fullName;
      const abbreviated = abbreviationForTeam(fullName);
      const fullWidth = measure(full, font);
      const abbrevWidth = measure(abbreviated, font);

      let next = full;
      if (fullWidth > maxWidth + 1) next = abbreviated;
      if (next === abbreviated && abbrevWidth > maxWidth + 1) {
        // Keep full abbreviation even in tight layouts; never collapse to 1-letter initials.
        next = abbreviated;
      }
      if (next === labelRef.current) return;

      if (switchTimerRef.current !== null) window.clearTimeout(switchTimerRef.current);
      setPrevLabel(labelRef.current);
      labelRef.current = next;
      setLabel(next);
      setSwitching(true);
      switchTimerRef.current = window.setTimeout(() => setSwitching(false), 230);
    };

    recalc();
    const observer = new ResizeObserver(recalc);
    observer.observe(node);
    window.addEventListener("resize", recalc);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recalc);
      if (switchTimerRef.current !== null) window.clearTimeout(switchTimerRef.current);
    };
  }, [fullName]);

  return (
    <span ref={ref} className={`${className} adaptive-label ${switching ? "is-switching" : ""}`} title={fullName}>
      {switching ? (
        <>
          <span className="adaptive-label-prev">{prevLabel}</span>
          <span className="adaptive-label-next">{label}</span>
        </>
      ) : (
        <span className="adaptive-label-current">{label}</span>
      )}
    </span>
  );
}

function TeamHoverAnchor({
  teamName,
  logoSrc,
  children,
}: {
  teamName: string;
  logoSrc: string;
  children: React.ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const updatePos = () => {
    const node = anchorRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPos({
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  };

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onWindowChange = () => updatePos();
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);
    return () => {
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
    };
  }, [open]);

  return (
    <span
      ref={anchorRef}
      className="team-hover-anchor"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && typeof document !== "undefined"
        ? createPortal(
            <span
              className="team-hover-card team-hover-card-portal"
              role="tooltip"
              aria-label={fullTeamName(teamName)}
              style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
            >
              <img className="team-hover-logo" src={logoSrc} alt={`${teamName} logo`} loading="lazy" />
              <span className="team-hover-name">{fullTeamName(teamName)}</span>
            </span>,
            document.body
          )
        : null}
    </span>
  );
}

function pct(prob: number): string {
  return `${(prob * 100).toFixed(1)}%`;
}

function useCountUp(from: number, to: number, duration = 400, delay = 0): number {
  const [value, setValue] = useState(from);
  useEffect(() => {
    let raf = 0;
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        setValue(from + (to - from) * ease);
        if (t < 1) raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
    }, delay);

    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(raf);
    };
  }, [from, to, duration, delay]);
  return value;
}

function OnboardingOddsRow({ row, index }: { row: DemoTitleShiftRow; index: number }) {
  const implied = useCountUp(row.before, row.after, 400, index * 50);
  const american = formatOddsDisplay(implied, "american").primary;
  const delta = row.after - row.before;
  const hasShift = Math.abs(delta) > 0.01;
  return (
    <div className="odds-table-row">
      <span className="seed">{row.seed}</span>
      <span className="team-name">{row.name}</span>
      <span className="american">{american}</span>
      <span className={`implied ${hasShift ? row.direction : ""}`}>
        {pct(implied)} {hasShift ? (row.direction === "up" ? "↑" : "↓") : ""}
      </span>
    </div>
  );
}

function OnboardingFlow({
  demoGame,
  runDemoSimulation,
  onComplete,
  onSkip,
}: {
  demoGame: ResolvedGame;
  runDemoSimulation: (gameId: string, winnerId: string) => DemoSimulationOutput;
  onComplete: (dontShowAgain: boolean) => void;
  onSkip: (dontShowAgain: boolean) => void;
}) {
  const [stage, setStage] = useState<OnboardingStage>(1);
  const [isStageTransitioning, setIsStageTransitioning] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [firstPick, setFirstPick] = useState<string | null>(null);
  const [secondPick, setSecondPick] = useState<string | null>(null);
  const [simResult1, setSimResult1] = useState<DemoSimulationOutput | null>(null);
  const [simResult2, setSimResult2] = useState<DemoSimulationOutput | null>(null);
  const [stage2Repricing, setStage2Repricing] = useState(false);
  const [stage2PromptVisible, setStage2PromptVisible] = useState(false);
  const [stage2AdvVisible, setStage2AdvVisible] = useState(false);
  const [stage2Resetting, setStage2Resetting] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    document.body.classList.add("og-onboarding-open");
    return () => document.body.classList.remove("og-onboarding-open");
  }, []);

  const teamA = demoGame.teamAId ? teamsById.get(demoGame.teamAId) ?? null : null;
  const teamB = demoGame.teamBId ? teamsById.get(demoGame.teamBId) ?? null : null;
  const teamAProb = teamA ? getGameWinProb(demoGame, teamA.id) ?? 0 : 0;
  const teamBProb = teamB ? getGameWinProb(demoGame, teamB.id) ?? 0 : 0;
  const [baselineResult] = useState<DemoSimulationOutput | null>(() => {
    if (!demoGame.teamAId) return null;
    return runDemoSimulation(demoGame.id, demoGame.teamAId);
  });
  const baselineRows = useMemo(
    () =>
      (baselineResult?.titleOddsShift ?? []).map((row) => ({
        ...row,
        after: row.before,
        direction: "up" as const,
      })),
    [baselineResult]
  );

  const transitionToStage = (nextStage: OnboardingStage) => {
    setIsStageTransitioning(true);
    window.setTimeout(() => {
      setStage(nextStage);
      setIsStageTransitioning(false);
    }, 180);
  };

  const applyPickResult = (winnerId: string, asSecond = false) => {
    setStage2Repricing(true);
    window.setTimeout(() => {
      const result = runDemoSimulation(demoGame.id, winnerId);
      if (asSecond) {
        setSecondPick(winnerId);
        setSimResult2(result);
        setStage2AdvVisible(true);
      } else {
        setFirstPick(winnerId);
        setSimResult1(result);
        setStage2PromptVisible(true);
      }
      setStage2Repricing(false);
    }, 200);
  };

  const handleFirstPick = (winnerId: string) => {
    if (!teamA || !teamB || firstPick) return;
    applyPickResult(winnerId, false);
  };

  const performFlipTo = (winnerId: string) => {
    if (!firstPick || !teamA || !teamB) return;
    setStage2Resetting(true);
    setStage2PromptVisible(false);
    window.setTimeout(() => {
      setStage2Resetting(false);
      applyPickResult(winnerId, true);
    }, 350);
  };

  const handleTryOpposite = () => {
    if (!firstPick || !teamA || !teamB) return;
    performFlipTo(firstPick === teamA.id ? teamB.id : teamA.id);
  };

  const handleStage2TeamClick = (winnerId: string) => {
    if (!firstPick) {
      handleFirstPick(winnerId);
      return;
    }
    if (winnerId !== activePick) {
      performFlipTo(winnerId);
    }
  };

  const handleOpenBracket = () => {
    setExiting(true);
    window.setTimeout(() => onComplete(dontShowAgain), 560);
  };

  const activePick = stage2Resetting ? null : secondPick ?? firstPick;
  const visibleRows =
    stage2Resetting || stage2Repricing
      ? baselineRows
      : secondPick && simResult2
        ? simResult2.titleOddsShift
        : firstPick && simResult1
          ? simResult1.titleOddsShift
          : baselineRows;

  const overlay = (
    <div
      className={`onboarding-flow ${exiting ? "is-exiting" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Odds Gods onboarding"
    >
      <div className="backdrop-bracket" />
      <div className="backdrop-scrim" />
      <div className="backdrop-grain" />
      <div className="backdrop-glow" />
      <div className={`onboarding-stage ${isStageTransitioning ? "stage-exit" : "stage-enter"}`} key={stage}>
        {stage === 1 ? (
          <section className="onboarding-stage-content stage-hook">
            <p className="stage-kicker">
              <span className="kicker-intro">Introducing</span>{" "}
              <span className="kicker-brand">The Bracket Lab</span>
            </p>
            <h2 className="stage-title">
              <span className="headline-word" style={{ animationDelay: "0ms" }}>
                Every
              </span>{" "}
              <span className="headline-word" style={{ animationDelay: "80ms" }}>
                pick
              </span>{" "}
              <span className="headline-word" style={{ animationDelay: "160ms" }}>
                changes
              </span>{" "}
              <span className="headline-word" style={{ animationDelay: "240ms" }}>
                everything.
              </span>
            </h2>
            <p className="stage-subtitle">
              Choose an outcome, and the entire tournament reprices around it, every round, every
              contender, all the way to the championship.
            </p>
            <p className="stage-subtitle secondary">
              Understand the fragility and leverage in your bracket before it counts.
            </p>
            <button className="cta-stage1" onClick={() => transitionToStage(2)}>
              Show me how →
            </button>
          </section>
        ) : null}

        {stage === 2 ? (
          <section className="onboarding-stage-content stage-pick">
            <div className="stage-copy">
              <p className="stage-counter">Step 2 of 3</p>
              <h3>Pick a side. Watch the field reprice.</h3>
              <p>
                Pick either side and watch contender title odds reprice in real time.
              </p>
            </div>
            <div className="stage-demo">
              {!firstPick ? <p className="pick-prompt-label">↓ Pick a side</p> : null}
              <p className="stage-label">Round of 64 — South</p>
              {teamA ? (
                <button
                  type="button"
                  className={`team-row-active ${!firstPick ? "pre-pick" : ""} ${activePick === teamA.id ? "team-row-locked-win" : ""} ${activePick && activePick !== teamA.id ? "team-row-loss" : ""}`}
                  onClick={() => handleStage2TeamClick(teamA.id)}
                >
                  <span className="seed">{teamA.seed}</span>
                  <TeamLogo teamName={teamA.name} src={teamLogoUrl(teamA)} />
                  <span className="name">{teamA.name}</span>
                  <span className="odds">{formatOddsDisplay(teamAProb, "american").primary}</span>
                  {activePick === teamA.id ? <span className="outcome-badge win">✓</span> : null}
                  {activePick && activePick !== teamA.id ? <span className="outcome-badge loss">✕</span> : null}
                </button>
              ) : null}
              {teamB ? (
                <button
                  type="button"
                  className={`team-row-active ${!firstPick ? "pre-pick" : ""} ${activePick === teamB.id ? "team-row-locked-win" : ""} ${activePick && activePick !== teamB.id ? "team-row-loss" : ""}`}
                  onClick={() => handleStage2TeamClick(teamB.id)}
                >
                  <span className="seed">{teamB.seed}</span>
                  <TeamLogo teamName={teamB.name} src={teamLogoUrl(teamB)} />
                  <span className="name">{teamB.name}</span>
                  <span className="odds">{formatOddsDisplay(teamBProb, "american").primary}</span>
                  {activePick === teamB.id ? <span className="outcome-badge win">✓</span> : null}
                  {activePick && activePick !== teamB.id ? <span className="outcome-badge loss">✕</span> : null}
                </button>
              ) : null}
              <p className="stage-label odds-header">Title odds — top contenders</p>
              <div className="odds-table">
                <div className="odds-table-head">
                  <span />
                  <span />
                  <span>American</span>
                  <span>Implied</span>
                </div>
                {visibleRows.map((row, idx) => (
                  <OnboardingOddsRow key={row.teamId} row={row} index={idx} />
                ))}
              </div>
              {stage2PromptVisible && firstPick && !secondPick && teamA && teamB ? (
                <div className="reversal-prompt">
                  <p>
                    {firstPick === teamA.id
                      ? `${teamA.name} advances, the favorite holds. Now flip it and see the other side.`
                      : `${teamB.name} wins, the bracket is in chaos. Now see the opposite outcome.`}
                  </p>
                  <button className="reversal-link" onClick={handleTryOpposite}>
                    ↩ Try {firstPick === teamA.id ? teamB.name : teamA.name} instead
                  </button>
                </div>
              ) : null}
              {stage2AdvVisible ? (
                <button className="cta-advance stage2-advance" onClick={() => transitionToStage(3)}>
                  See your full scenario →
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {stage === 3 ? (
          <section className="onboarding-stage-content stage-handoff">
            <p className="stage-counter">Step 3 of 3</p>
            <h3>You&apos;re in. Build your scenario.</h3>
            <p className="stage-subtitle">
              You&apos;ve seen how one result moves the entire field. Now do it for real, every
              pick reshapes the tournament around it.
            </p>
            <div className="suggestion-box">
              <span className="suggestion-label">Suggested first move</span>
              <p className="suggestion-body">
                Pick any 1-seed to lose in Round 1. Open Futures. Watch title odds redistribute.
              </p>
            </div>
            <button className="cta-open-bracket" onClick={handleOpenBracket}>
              Enter The Bracket Lab
            </button>
            <p className="replay-note">Replay this intro from the Help menu.</p>
            <label className="dont-show-inline">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(event) => setDontShowAgain(event.target.checked)}
              />
              <span>Don&apos;t show again</span>
            </label>
          </section>
        ) : null}
      </div>

      <div className="onboarding-bottom">
        <button className="skip-link" onClick={() => onSkip(dontShowAgain)}>
          Skip intro
        </button>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

export default App;
