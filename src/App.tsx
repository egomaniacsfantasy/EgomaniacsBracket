import { Fragment, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./index.css";
import { teamsById } from "./data/teams";
import { BRACKET_HALVES, regionRounds } from "./data/bracket";
import {
  finalRounds,
  gamesByRegionAndRound,
  getGameWinProb,
  getModelGameWinProb,
  possibleWinnersByGame,
  resetRegionPicks,
  resolveGames,
  sanitizeLockedPicks,
  type CustomProbByGame,
  type LockedPicks,
} from "./lib/bracket";
import { abbreviationForTeam } from "./lib/abbreviation";
import { formatOddsDisplay, toImpliedLabel, toOneInX } from "./lib/odds";
import {
  generateSimulatedBracket,
  generateSimulatedBracketSteps,
  hashLocks,
  runSimulation,
} from "./lib/simulation";
import { fallbackLogo, teamLogoUrl } from "./lib/logo";
import { fullTeamName } from "./lib/teamNames";
import { trackEvent } from "./lib/analytics";
import type { OddsDisplayMode, Region, ResolvedGame, SimulationOutput } from "./types";

const DEFAULT_SIM_RUNS = 5000;
const ONBOARDING_STORAGE_KEY = "oddsGods_onboardingDismissed";
const HINTS_STORAGE_KEY = "oddsGods_hintsShown";
const FIRST_PICK_NUDGE_SESSION_KEY = "oddsGods_firstPickCascadeNudgeSeen";
const STAGGERED_SIM_DELAY_MS = 2000;
const MIN_STAGGERED_SIM_DELAY_MS = 1000;
const MAX_STAGGERED_SIM_DELAY_MS = 5000;
const LANDING_URL = "https://oddsgods.net";
const BRACKET_URL = "https://bracket.oddsgods.net/";
const WATO_URL = "https://wato.oddsgods.net/";

const formatModes: { id: OddsDisplayMode; label: string }[] = [
  { id: "american", label: "American" },
  { id: "implied", label: "Implied %" },
];

const regionSections: Region[][] = BRACKET_HALVES.map((half) => [...half.regions]);
const mobileRegionOrder: Region[] = ["South", "East", "West", "Midwest"];
const invertedRegions = new Set<Region>([regionSections[0][1], regionSections[1][1]]);

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
const MOBILE_ROUND_ORDER: Record<"R64" | "R32" | "S16" | "E8", number> = {
  R64: 0,
  R32: 1,
  S16: 2,
  E8: 3,
};

type ProbabilityPopupState = {
  gameId: string;
  anchorEl: HTMLElement;
  savedProbA: number | null;
};

type MobileTab = "bracket" | "futures";
type MobileSection = Region | "FF";
type MobileRegionRound = "R64" | "R32" | "S16" | "E8";
type MobileFfRound = "F4" | "CHAMP" | "WIN";
type CandidateRow = { teamId: string; prob: number; team: NonNullable<ReturnType<typeof teamsById.get>> };
const MAJOR_SHIFT_NUDGE_COOLDOWN = 3;
type WalkthroughStepId = "make-pick" | "watch-reprice" | "see-futures" | "edit-odds" | "ready";
type WalkthroughStepAdvance = "pick-detected" | "button-click";
type TooltipPlacement = "above" | "below" | "left" | "right";
type HintKey = "undo" | "sim" | "toggle" | "r32";
type HintsShown = Record<HintKey, boolean>;
type ActiveHint = {
  key: HintKey;
  message: string;
  rect: DOMRect;
};
type WalkthroughStepConfig = {
  id: WalkthroughStepId;
  heading: string;
  body: string;
  ctaText: string;
  advanceOn: WalkthroughStepAdvance;
  allowSkip: boolean;
};

const DEFAULT_HINTS_SHOWN: HintsShown = {
  undo: false,
  sim: false,
  toggle: false,
  r32: false,
};

const WALKTHROUGH_STEPS: WalkthroughStepConfig[] = [
  {
    id: "make-pick",
    heading: "Make your first pick",
    body: "Tap a team to lock them as the winner of this game. Try picking the 1-seed.",
    ctaText: "Got it →",
    advanceOn: "pick-detected",
    allowSkip: true,
  },
  {
    id: "watch-reprice",
    heading: "Everything just changed",
    body: "Your pick updated odds across the entire bracket — Round of 32, Sweet 16, Elite 8, all the way to the championship. These aren't static numbers. Every pick you make recalculates everything.",
    ctaText: "Got it →",
    advanceOn: "button-click",
    allowSkip: true,
  },
  {
    id: "see-futures",
    heading: "Meet the Futures panel",
    body: "This shows every team's chances of reaching each round — updated live based on YOUR picks. Scroll down to see the Pre-Tournament Baseline and compare how your picks shifted the odds.",
    ctaText: "Got it →",
    advanceOn: "button-click",
    allowSkip: true,
  },
  {
    id: "edit-odds",
    heading: "Think the model is wrong?",
    body: 'Hover over any game to see the edit icon, or tap "Edit odds" on mobile. Drag the slider to set your own win probability — the entire bracket reprices to match.',
    ctaText: "Got it →",
    advanceOn: "button-click",
    allowSkip: true,
  },
  {
    id: "ready",
    heading: "Your toolkit",
    body: "Undo picks, reset a region, or simulate an entire bracket. Switch between American odds and implied percentages anytime. Now go build your bracket.",
    ctaText: "Start picking →",
    advanceOn: "button-click",
    allowSkip: false,
  },
];

function App() {
  const [lockedPicks, setLockedPicks] = useState<LockedPicks>({});
  const [customProbByGame, setCustomProbByGame] = useState<CustomProbByGame>({});
  const [undoStack, setUndoStack] = useState<LockedPicks[]>([]);
  const [displayMode, setDisplayMode] = useState<OddsDisplayMode>("american");
  const [simRuns] = useState<number>(DEFAULT_SIM_RUNS);
  const [sortDesc, setSortDesc] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastPickedKey, setLastPickedKey] = useState<string | null>(null);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [compactDesktop, setCompactDesktop] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>("bracket");
  const [mobileSection, setMobileSection] = useState<MobileSection>("South");
  const [mobileRound, setMobileRound] = useState<MobileRegionRound>("R64");
  const [mobileFfRound, setMobileFfRound] = useState<MobileFfRound>("F4");
  const [liveOddsChangedIds, setLiveOddsChangedIds] = useState<Set<string>>(new Set());
  const [mobileRoundDeltas, setMobileRoundDeltas] = useState<Partial<Record<MobileRegionRound, number>>>({});
  const [hasSeenFirstPickNudge, setHasSeenFirstPickNudge] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(FIRST_PICK_NUDGE_SESSION_KEY) === "1";
  });
  const [firstPickNudgeVisible, setFirstPickNudgeVisible] = useState(false);
  const [firstPickChangedRounds, setFirstPickChangedRounds] = useState<string[]>([]);
  const [majorShiftNudgeVisible, setMajorShiftNudgeVisible] = useState(false);
  const [majorShiftTeamName, setMajorShiftTeamName] = useState("");
  const [majorShiftPct, setMajorShiftPct] = useState(0);
  const [majorShiftTargetRound, setMajorShiftTargetRound] = useState<MobileRegionRound>("R32");
  const [staggeredSimRunning, setStaggeredSimRunning] = useState(false);
  const [staggeredSimPaused, setStaggeredSimPaused] = useState(false);
  const [staggeredSimDelayMs, setStaggeredSimDelayMs] = useState(STAGGERED_SIM_DELAY_MS);
  const [showStaggeredControls, setShowStaggeredControls] = useState(false);
  const [welcomeGateOpen, setWelcomeGateOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "true";
  });
  const [walkthroughActive, setWalkthroughActive] = useState(false);
  const [walkthroughStep, setWalkthroughStep] = useState(0);
  const [walkthroughTargetEl, setWalkthroughTargetEl] = useState<HTMLElement | null>(null);
  const [walkthroughTargetRect, setWalkthroughTargetRect] = useState<DOMRect | null>(null);
  const [tooltipPlacement, setTooltipPlacement] = useState<TooltipPlacement>("below");
  const [walkthroughFirstPickedTeamId, setWalkthroughFirstPickedTeamId] = useState<string | null>(null);
  const [hintsShown, setHintsShown] = useState<HintsShown>(() => {
    if (typeof window === "undefined") return DEFAULT_HINTS_SHOWN;
    try {
      const raw = window.localStorage.getItem(HINTS_STORAGE_KEY);
      if (!raw) return DEFAULT_HINTS_SHOWN;
      const parsed = JSON.parse(raw) as Partial<HintsShown>;
      return { ...DEFAULT_HINTS_SHOWN, ...parsed };
    } catch {
      return DEFAULT_HINTS_SHOWN;
    }
  });
  const [activeHint, setActiveHint] = useState<ActiveHint | null>(null);
  const [probPopup, setProbPopup] = useState<ProbabilityPopupState | null>(null);
  const [simResult, setSimResult] = useState<SimulationOutput>({
    futures: [],
    gameWinProbs: {},
    likelihoodApprox: 0,
    likelihoodSimulation: 0,
  });

  const simulationCacheRef = useRef<Map<string, SimulationOutput>>(new Map());
  const previousFuturesRef = useRef<SimulationOutput["futures"] | null>(null);
  const previousGameWinProbsRef = useRef<SimulationOutput["gameWinProbs"] | null>(null);
  const mobileFlashTimeoutRef = useRef<number | null>(null);
  const mobileDeltaTimeoutRef = useRef<number | null>(null);
  const firstPickNudgeTimeoutRef = useRef<number | null>(null);
  const pendingPickMetaRef = useRef<{ isFirstPick: boolean; section: MobileSection; round: MobileRegionRound | null } | null>(null);
  const pendingMajorShiftTargetRef = useRef<MobileRegionRound>("R32");
  const picksSinceLastNudgeRef = useRef(0);
  const staggeredTimeoutRef = useRef<number | null>(null);
  const staggeredStepsRef = useRef<Array<{ gameId: string; winnerId: string }>>([]);
  const staggeredIndexRef = useRef(0);
  const staggeredDelayRef = useRef(STAGGERED_SIM_DELAY_MS);
  const simGeneratedGameIdsRef = useRef<Set<string>>(new Set());
  const walkthroughAdvanceTimerRef = useRef<number | null>(null);
  const walkthroughResolveTokenRef = useRef(0);
  const contextualHintTimerRef = useRef<number | null>(null);

  const { games, sanitized } = useMemo(
    () => resolveGames(lockedPicks, customProbByGame),
    [lockedPicks, customProbByGame]
  );
  const possibleWinners = useMemo(() => possibleWinnersByGame(sanitized), [sanitized]);

  useEffect(() => {
    staggeredDelayRef.current = staggeredSimDelayMs;
  }, [staggeredSimDelayMs]);

  useEffect(() => {
    if (simGeneratedGameIdsRef.current.size === 0) return;
    const activeGameIds = new Set(Object.keys(lockedPicks));
    for (const gameId of Array.from(simGeneratedGameIdsRef.current)) {
      if (!activeGameIds.has(gameId)) simGeneratedGameIdsRef.current.delete(gameId);
    }
  }, [lockedPicks]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1850px)");
    const apply = () => setCompactDesktop(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!hasSeenFirstPickNudge || typeof window === "undefined") return;
    window.sessionStorage.setItem(FIRST_PICK_NUDGE_SESSION_KEY, "1");
  }, [hasSeenFirstPickNudge]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(HINTS_STORAGE_KEY, JSON.stringify(hintsShown));
  }, [hintsShown]);

  useEffect(() => {
    if (!sidePanelOpen) return;
    trackEvent("futures_opened", {
      source: isMobile ? "mobile" : "desktop",
    });
  }, [isMobile, sidePanelOpen]);

  const completeWalkthrough = () => {
    trackEvent("onboarding_completed", {
      step_index: walkthroughStep,
    });
    if (walkthroughAdvanceTimerRef.current !== null) {
      window.clearTimeout(walkthroughAdvanceTimerRef.current);
      walkthroughAdvanceTimerRef.current = null;
    }
    setWalkthroughActive(false);
    setWalkthroughStep(0);
    setWalkthroughTargetEl(null);
    setWalkthroughTargetRect(null);
    setWalkthroughFirstPickedTeamId(null);
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    setWelcomeGateOpen(false);
  };

  const skipWalkthrough = () => {
    trackEvent("onboarding_skipped", {
      step_index: walkthroughStep,
    });
    completeWalkthrough();
  };

  const startWalkthrough = (opts?: { replay?: boolean }) => {
    trackEvent("onboarding_started", {
      replay: Boolean(opts?.replay),
    });
    if (opts?.replay) {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "false");
      setHintsShown(DEFAULT_HINTS_SHOWN);
      if (Object.keys(lockedPicks).length > 0 || Object.keys(customProbByGame).length > 0) {
        onResetAll();
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    setWelcomeGateOpen(false);
    setWalkthroughStep(0);
    setWalkthroughTargetEl(null);
    setWalkthroughTargetRect(null);
    setWalkthroughFirstPickedTeamId(null);
    setWalkthroughActive(true);
  };

  const showContextualHint = (key: HintKey, message: string, selector: string, durationMs: number) => {
    if (hintsShown[key]) return;
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setActiveHint({ key, message, rect });
    setHintsShown((prev) => ({ ...prev, [key]: true }));
    if (contextualHintTimerRef.current !== null) {
      window.clearTimeout(contextualHintTimerRef.current);
    }
    contextualHintTimerRef.current = window.setTimeout(() => setActiveHint(null), durationMs);
  };

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
    const key = hashLocks(sanitized, simRuns, customProbByGame);
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
      const result = runSimulation(sanitized, simRuns, customProbByGame);
      simulationCacheRef.current.set(key, result);
      setSimResult(result);
      setIsUpdating(false);
    }, 150);

    return () => {
      active = false;
      window.clearTimeout(updateTimer);
      window.clearTimeout(timer);
    };
  }, [sanitized, simRuns, customProbByGame]);

  useEffect(() => {
    const previous = previousFuturesRef.current;
    previousFuturesRef.current = simResult.futures;
    if (!previous) return;

    const previousMap = new Map(previous.map((row) => [row.teamId, row.champProb]));
    const changed = new Set<string>();
    for (const row of simResult.futures) {
      const prev = previousMap.get(row.teamId);
      if (prev === undefined) continue;
      if (Math.abs(prev - row.champProb) > 0.000001) {
        changed.add(row.teamId);
      }
    }

    if (changed.size > 0) {
      setLiveOddsChangedIds(changed);
      if (mobileFlashTimeoutRef.current !== null) {
        window.clearTimeout(mobileFlashTimeoutRef.current);
      }
      mobileFlashTimeoutRef.current = window.setTimeout(() => {
        setLiveOddsChangedIds(new Set());
        mobileFlashTimeoutRef.current = null;
      }, 850);
    }

    const pendingMeta = pendingPickMetaRef.current;
    if (!pendingMeta || pendingMeta.isFirstPick) return;
    const majorShift = getMajorShiftInfo(previous, simResult.futures);
    if (!majorShift) {
      picksSinceLastNudgeRef.current += 1;
      pendingPickMetaRef.current = null;
      return;
    }
    if (picksSinceLastNudgeRef.current < MAJOR_SHIFT_NUDGE_COOLDOWN) {
      picksSinceLastNudgeRef.current += 1;
      pendingPickMetaRef.current = null;
      return;
    }
    const shiftTeam = teamsById.get(majorShift.teamId);
    if (shiftTeam) {
      setFirstPickNudgeVisible(false);
      setMajorShiftTeamName(shiftTeam.name);
      setMajorShiftPct(majorShift.shiftPct);
      setMajorShiftTargetRound(pendingMajorShiftTargetRef.current);
      setMajorShiftNudgeVisible(true);
      picksSinceLastNudgeRef.current = 0;
    }
    pendingPickMetaRef.current = null;
  }, [simResult.futures]);

  useEffect(() => {
    const previous = previousGameWinProbsRef.current;
    previousGameWinProbsRef.current = simResult.gameWinProbs;
    if (!previous) return;
    if (mobileSection === "FF") return;
    if (mobileRound !== "R64") return;

    const deltas: Partial<Record<MobileRegionRound, number>> = {};
    for (const round of ["R32", "S16", "E8"] as const) {
      const roundGames = gamesByRegionAndRound(games, mobileSection, round);
      let changedCount = 0;
      for (const game of roundGames) {
        const prevRows = previous[game.id] ?? [];
        const nextRows = simResult.gameWinProbs[game.id] ?? [];
        if (prevRows.length !== nextRows.length) {
          changedCount += 1;
          continue;
        }
        for (let i = 0; i < prevRows.length; i += 1) {
          const prevRow = prevRows[i];
          const nextRow = nextRows[i];
          if (!prevRow || !nextRow || prevRow.teamId !== nextRow.teamId || Math.abs(prevRow.prob - nextRow.prob) > 0.000001) {
            changedCount += 1;
            break;
          }
        }
      }
      if (changedCount > 0) deltas[round] = changedCount;
    }
    if (!Object.keys(deltas).length) return;
    const changedRoundEntries = (Object.keys(deltas) as MobileRegionRound[]).sort(
      (a, b) => MOBILE_ROUND_ORDER[a] - MOBILE_ROUND_ORDER[b]
    );
    pendingMajorShiftTargetRef.current = changedRoundEntries[0] ?? "R32";
    setMobileRoundDeltas(deltas);
    if (mobileDeltaTimeoutRef.current !== null) {
      window.clearTimeout(mobileDeltaTimeoutRef.current);
    }
    mobileDeltaTimeoutRef.current = window.setTimeout(() => {
      setMobileRoundDeltas({});
      mobileDeltaTimeoutRef.current = null;
    }, 1600);

    const pendingMeta = pendingPickMetaRef.current;
    if (!pendingMeta || !pendingMeta.isFirstPick || hasSeenFirstPickNudge) return;
    const changedLabels = changedRoundEntries.map((round) => round);
    if (!changedLabels.length) return;
    if (majorShiftNudgeVisible) setMajorShiftNudgeVisible(false);
    if (firstPickNudgeTimeoutRef.current !== null) {
      window.clearTimeout(firstPickNudgeTimeoutRef.current);
    }
    setFirstPickChangedRounds(changedLabels);
    setFirstPickNudgeVisible(true);
    setHasSeenFirstPickNudge(true);
    firstPickNudgeTimeoutRef.current = window.setTimeout(() => {
      setFirstPickNudgeVisible(false);
      firstPickNudgeTimeoutRef.current = null;
    }, 4000);
    picksSinceLastNudgeRef.current = 0;
    pendingPickMetaRef.current = null;
  }, [simResult.gameWinProbs, games, mobileSection, mobileRound]);

  const sortedFutures = useMemo(() => {
    const rows = [...simResult.futures];
    rows.sort((a, b) => {
      const diff = b.champProb - a.champProb;
      return sortDesc ? diff : -diff;
    });
    return rows;
  }, [simResult.futures, sortDesc]);

  const preTournamentBaseline = useMemo(() => runSimulation({}, simRuns), [simRuns]);
  const preTournamentFutures = useMemo(
    () => [...preTournamentBaseline.futures].sort((a, b) => b.champProb - a.champProb),
    [preTournamentBaseline.futures]
  );

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

  const gameById = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);

  const applyCustomProbability = (gameId: string, customProbA: number | null) => {
    setCustomProbByGame((prev) => {
      const next = { ...prev };
      if (customProbA === null || !Number.isFinite(customProbA)) {
        delete next[gameId];
      } else {
        next[gameId] = Math.max(0.01, Math.min(0.99, customProbA));
      }
      return next;
    });
  };

  const closeProbabilityPopup = (revertToSaved = true) => {
    if (revertToSaved && probPopup) {
      applyCustomProbability(probPopup.gameId, probPopup.savedProbA ?? null);
    }
    setProbPopup(null);
  };

  const getUserLockedPicks = (locks: LockedPicks): LockedPicks => {
    if (simGeneratedGameIdsRef.current.size === 0) return { ...locks };
    const next: LockedPicks = {};
    for (const [gameId, winnerId] of Object.entries(locks)) {
      if (!simGeneratedGameIdsRef.current.has(gameId)) next[gameId] = winnerId;
    }
    return next;
  };

  const openProbabilityPopup = (game: ResolvedGame, anchorEl: HTMLElement) => {
    if (!game.teamAId || !game.teamBId || game.winnerId) return;
    if (probPopup) {
      closeProbabilityPopup(true);
    }
    setProbPopup({
      gameId: game.id,
      anchorEl,
      savedProbA: game.customProbA ?? null,
    });
  };

  const previewCustomProbability = (gameId: string, customProbA: number) => {
    applyCustomProbability(gameId, customProbA);
  };

  const saveProbabilityPopup = () => {
    setProbPopup(null);
  };

  const resetProbabilityToModel = (gameId: string) => {
    applyCustomProbability(gameId, null);
    setProbPopup(null);
  };

  const cancelStaggeredSim = () => {
    if (staggeredTimeoutRef.current !== null) {
      window.clearTimeout(staggeredTimeoutRef.current);
      staggeredTimeoutRef.current = null;
    }
    setStaggeredSimRunning(false);
    setStaggeredSimPaused(false);
    staggeredStepsRef.current = [];
    staggeredIndexRef.current = 0;
  };

  const onPick = (game: ResolvedGame, teamId: string | null) => {
    if (!teamId) return;
    if (teamId !== game.teamAId && teamId !== game.teamBId) return;
    const previousWinnerId = lockedPicks[game.id] ?? null;
    const pickAction = previousWinnerId === teamId ? "remove" : previousWinnerId ? "switch" : "set";
    const pickedTeam = teamsById.get(teamId);
    trackEvent("pick_made", {
      game_id: game.id,
      round: game.round,
      region: game.region,
      team_id: teamId,
      team_name: pickedTeam?.name ?? null,
      action: pickAction,
    });
    const isFirstPick =
      Object.keys(sanitized).length === 0 &&
      lockedPicks[game.id] !== teamId &&
      mobileSection !== "FF" &&
      mobileRound === "R64" &&
      !hasSeenFirstPickNudge;
    pendingPickMetaRef.current = {
      isFirstPick,
      section: mobileSection,
      round: mobileSection === "FF" ? null : mobileRound,
    };
    cancelStaggeredSim();
    simGeneratedGameIdsRef.current.delete(game.id);
    pushUndo(lockedPicks);

    const next: LockedPicks = { ...lockedPicks };
    if (lockedPicks[game.id] === teamId) {
      delete next[game.id];
    } else {
      next[game.id] = teamId;
    }
    setLastPickedKey(`${game.id}:${teamId}`);
    if (probPopup?.gameId === game.id) {
      setProbPopup(null);
    }

    setLockedPicks(sanitizeLockedPicks(next));
  };

  const onUndo = () => {
    trackEvent("undo_clicked", {
      undo_depth: undoStack.length,
    });
    showContextualHint(
      "undo",
      "Undo reverts your last pick. You can undo multiple times to step back through your bracket.",
      ".eg-main-actions.toolbar .eg-btn:first-child",
      4000
    );
    cancelStaggeredSim();
    if (undoStack.length === 0) return;
    pendingPickMetaRef.current = null;
    setFirstPickNudgeVisible(false);
    setMajorShiftNudgeVisible(false);
    closeProbabilityPopup(true);
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setLockedPicks(previous);
  };

  const onUndoGame = (gameId: string) => {
    if (!lockedPicks[gameId]) return;
    cancelStaggeredSim();
    pendingPickMetaRef.current = null;
    setFirstPickNudgeVisible(false);
    setMajorShiftNudgeVisible(false);
    closeProbabilityPopup(true);
    simGeneratedGameIdsRef.current.delete(gameId);
    pushUndo(lockedPicks);
    const next = { ...lockedPicks };
    delete next[gameId];
    setLockedPicks(sanitizeLockedPicks(next));
  };

  const onSwitchPick = (game: ResolvedGame, teamId: string) => {
    if (!game.teamAId || !game.teamBId) return;
    if (teamId !== game.teamAId && teamId !== game.teamBId) return;
    if (game.winnerId === teamId) return;
    pendingPickMetaRef.current = {
      isFirstPick: false,
      section: mobileSection,
      round: mobileSection === "FF" ? null : mobileRound,
    };
    cancelStaggeredSim();
    closeProbabilityPopup(true);
    simGeneratedGameIdsRef.current.delete(game.id);
    pushUndo(lockedPicks);
    setLastPickedKey(`${game.id}:${teamId}`);
    setLockedPicks(sanitizeLockedPicks({ ...lockedPicks, [game.id]: teamId }));
  };

  const onUnavailableRoundClick = (round: ResolvedGame["round"]) => {
    if (round !== "R32") return;
    showContextualHint(
      "r32",
      "This matchup isn't decided yet. Pick the winners of both feeder games in Round of 64 first.",
      ".eg-main-actions.toolbar",
      4000
    );
  };

  const onResetAll = () => {
    trackEvent("reset_all_clicked", {
      picks_count: Object.keys(lockedPicks).length,
    });
    cancelStaggeredSim();
    if (Object.keys(lockedPicks).length === 0 && Object.keys(customProbByGame).length === 0) return;
    pendingPickMetaRef.current = null;
    setFirstPickNudgeVisible(false);
    setMajorShiftNudgeVisible(false);
    pushUndo(lockedPicks);
    simGeneratedGameIdsRef.current.clear();
    setLockedPicks({});
    setCustomProbByGame({});
    setProbPopup(null);
  };

  const onResetRegion = (region: Region) => {
    trackEvent("reset_region_clicked", {
      region,
    });
    cancelStaggeredSim();
    pendingPickMetaRef.current = null;
    setFirstPickNudgeVisible(false);
    setMajorShiftNudgeVisible(false);
    closeProbabilityPopup(true);
    pushUndo(lockedPicks);
    for (const game of games) {
      if (game.region === region) simGeneratedGameIdsRef.current.delete(game.id);
    }
    setLockedPicks(resetRegionPicks(lockedPicks, region));
  };

  const onModelSim = () => {
    trackEvent("instant_sim_clicked", {
      existing_picks: Object.keys(lockedPicks).length,
    });
    showContextualHint(
      "sim",
      "Simulation fills out the bracket randomly using the model probabilities. Your locked picks are preserved. Try Staggered Sim to watch it fill round by round.",
      ".eg-main-actions.toolbar .eg-btn:nth-child(3)",
      5000
    );
    cancelStaggeredSim();
    pendingPickMetaRef.current = null;
    setFirstPickNudgeVisible(false);
    setMajorShiftNudgeVisible(false);
    closeProbabilityPopup(true);
    pushUndo(lockedPicks);
    const baseLocks = getUserLockedPicks(lockedPicks);
    const nextLocks = sanitizeLockedPicks(generateSimulatedBracket(baseLocks, customProbByGame));
    simGeneratedGameIdsRef.current = new Set(
      Object.keys(nextLocks).filter((gameId) => !Object.prototype.hasOwnProperty.call(baseLocks, gameId))
    );
    setLockedPicks(nextLocks);
  };

  const onModelSimStaggered = () => {
    trackEvent("staggered_sim_clicked", {
      existing_picks: Object.keys(lockedPicks).length,
    });
    showContextualHint(
      "sim",
      "Simulation fills out the bracket randomly using the model probabilities. Your locked picks are preserved. Try Staggered Sim to watch it fill round by round.",
      ".eg-main-actions.toolbar .eg-btn:nth-child(4)",
      5000
    );
    cancelStaggeredSim();
    pendingPickMetaRef.current = null;
    setFirstPickNudgeVisible(false);
    setMajorShiftNudgeVisible(false);
    closeProbabilityPopup(true);
    setShowStaggeredControls(true);
    const baseLocks = getUserLockedPicks(lockedPicks);
    const steps = generateSimulatedBracketSteps(baseLocks, ["South", "East", "West", "Midwest"], customProbByGame);
    if (steps.length === 0) {
      simGeneratedGameIdsRef.current = new Set();
      return;
    }

    pushUndo(baseLocks);
    setStaggeredSimRunning(true);
    setStaggeredSimPaused(false);
    staggeredStepsRef.current = steps;
    staggeredIndexRef.current = 0;
    simGeneratedGameIdsRef.current = new Set(steps.map((step) => step.gameId));

    const advance = () => {
      if (staggeredSimPaused) {
        staggeredTimeoutRef.current = null;
        return;
      }

      if (staggeredIndexRef.current >= staggeredStepsRef.current.length) {
        setStaggeredSimRunning(false);
        setStaggeredSimPaused(false);
        staggeredTimeoutRef.current = null;
        return;
      }
      const step = staggeredStepsRef.current[staggeredIndexRef.current];
      setLastPickedKey(`${step.gameId}:${step.winnerId}`);
      setLockedPicks((prev) => sanitizeLockedPicks({ ...prev, [step.gameId]: step.winnerId }));
      staggeredIndexRef.current += 1;
      staggeredTimeoutRef.current = window.setTimeout(advance, staggeredDelayRef.current);
    };

    advance();
  };

  const onToggleStaggeredPause = () => {
    trackEvent("staggered_sim_pause_toggled", {
      paused: !staggeredSimPaused,
    });
    if (!staggeredSimRunning) return;
    if (!staggeredSimPaused) {
      if (staggeredTimeoutRef.current !== null) {
        window.clearTimeout(staggeredTimeoutRef.current);
        staggeredTimeoutRef.current = null;
      }
      setStaggeredSimPaused(true);
      return;
    }

    setStaggeredSimPaused(false);
    const resume = () => {
      if (staggeredIndexRef.current >= staggeredStepsRef.current.length) {
        setStaggeredSimRunning(false);
        setStaggeredSimPaused(false);
        return;
      }
      const step = staggeredStepsRef.current[staggeredIndexRef.current];
      setLastPickedKey(`${step.gameId}:${step.winnerId}`);
      setLockedPicks((prev) => sanitizeLockedPicks({ ...prev, [step.gameId]: step.winnerId }));
      staggeredIndexRef.current += 1;
      staggeredTimeoutRef.current = window.setTimeout(resume, staggeredDelayRef.current);
    };
    staggeredTimeoutRef.current = window.setTimeout(resume, staggeredDelayRef.current);
  };

  useEffect(
    () => () => {
      if (staggeredTimeoutRef.current !== null) {
        window.clearTimeout(staggeredTimeoutRef.current);
      }
      if (mobileFlashTimeoutRef.current !== null) {
        window.clearTimeout(mobileFlashTimeoutRef.current);
      }
      if (mobileDeltaTimeoutRef.current !== null) {
        window.clearTimeout(mobileDeltaTimeoutRef.current);
      }
      if (firstPickNudgeTimeoutRef.current !== null) {
        window.clearTimeout(firstPickNudgeTimeoutRef.current);
      }
      if (walkthroughAdvanceTimerRef.current !== null) {
        window.clearTimeout(walkthroughAdvanceTimerRef.current);
      }
      if (contextualHintTimerRef.current !== null) {
        window.clearTimeout(contextualHintTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!probPopup) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".prob-popup")) return;
      if (target.closest(".matchup-edit-btn")) return;
      closeProbabilityPopup(true);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeProbabilityPopup(true);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [probPopup]);

  const finalGames = finalRounds(games);
  const leftSemi = finalGames.find((g) => g.id === "F4-Left-0") ?? null;
  const rightSemi = finalGames.find((g) => g.id === "F4-Right-0") ?? null;
  const titleGame = finalGames.find((g) => g.id === "CHAMP-0") ?? null;
  const regionE8Status = Object.fromEntries(
    mobileRegionOrder.map((region) => [region, games.some((game) => game.region === region && game.round === "E8" && game.winnerId !== null)])
  ) as Record<Region, boolean>;
  const allRegionE8Complete = mobileRegionOrder.every((region) =>
    regionE8Status[region]
  );
  const allFinalFourComplete = [leftSemi, rightSemi].every((game) => game?.winnerId);
  const championshipComplete = Boolean(titleGame?.winnerId);
  const liveOddsTopContenders = sortedFutures.slice(0, 5).map((row) => {
    const team = teamsById.get(row.teamId);
    return {
      id: row.teamId,
      logoUrl: team ? teamLogoUrl(team) : fallbackLogo(row.teamId),
      shortName: team ? mobileShortName(team.name) : row.teamId,
      titleOdds: formatOddsDisplay(row.champProb, displayMode).primary,
      titleImpliedPct: `${Math.round(row.champProb * 100)}%`,
    };
  });

  useEffect(() => {
    if (mobileSection === "FF") return;
    const preferred = getPreferredMobileRegionRound(games, mobileSection);
    setMobileRound((current) => (isRegionRoundAccessible(games, mobileSection, current) ? current : preferred));
  }, [games, mobileSection]);

  useEffect(() => {
    if (mobileSection !== "FF") return;
    const preferred = getPreferredMobileFfRound(allRegionE8Complete, allFinalFourComplete, championshipComplete);
    setMobileFfRound((current) =>
      isMobileFfRoundAccessible(allRegionE8Complete, allFinalFourComplete, championshipComplete, current) ? current : preferred
    );
  }, [mobileSection, allRegionE8Complete, allFinalFourComplete, championshipComplete]);

  const currentWalkthroughStep = WALKTHROUGH_STEPS[walkthroughStep] ?? null;

  useEffect(() => {
    if (!walkthroughActive || !currentWalkthroughStep) return;

    const token = ++walkthroughResolveTokenRef.current;
    let cancelled = false;

    const resolveSouthRegion = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".eg-region-card.bracket-region")).find((card) =>
        card.querySelector("h2")?.textContent?.trim().toLowerCase().includes("south")
      ) ?? null;

    const getTargetElement = (): HTMLElement | null => {
      const southRegion = resolveSouthRegion();
      switch (currentWalkthroughStep.id) {
        case "make-pick": {
          if (isMobile) {
            return document.querySelector<HTMLElement>(".mobile-matchup-card, .m-card, .mobile-matchup-full");
          }
          return southRegion?.querySelector<HTMLElement>(".eg-game-card.round-r64") ?? null;
        }
        case "watch-reprice": {
          if (isMobile) {
            return document.querySelector<HTMLElement>(".mobile-round-pill.active + * .m-card, .m-card, .mobile-prob-card");
          }
          if (southRegion && walkthroughFirstPickedTeamId) {
            const teamName = teamsById.get(walkthroughFirstPickedTeamId)?.name ?? "";
            const rows = Array.from(
              southRegion.querySelectorAll<HTMLElement>(".lane-r32 .matchup-row, .lane-r32 .eg-compact-chip")
            );
            const matched = rows.find((row) => row.textContent?.toLowerCase().includes(teamName.toLowerCase()));
            if (matched) return matched;
          }
          return southRegion?.querySelector<HTMLElement>(".lane-r32 .eg-game-card, .lane-r32 .matchup-row") ?? null;
        }
        case "see-futures": {
          if (isMobile) {
            return document.querySelector<HTMLElement>(".mobile-futures-view");
          }
          return document.querySelector<HTMLElement>(".eg-side-panel.open, .eg-side-panel");
        }
        case "edit-odds": {
          if (isMobile) {
            return document.querySelector<HTMLElement>(".m-edit-prob-btn");
          }
          const r64Cards = southRegion?.querySelectorAll<HTMLElement>(".eg-game-card.round-r64");
          return r64Cards?.[1] ?? r64Cards?.[0] ?? null;
        }
        case "ready":
          return document.querySelector<HTMLElement>(".eg-main-actions.toolbar");
        default:
          return null;
      }
    };

    const runPreAction = () => {
      if (!isMobile) {
        if (currentWalkthroughStep.id === "see-futures" && !sidePanelOpen) {
          setSidePanelOpen(true);
        }
        return;
      }
      if (currentWalkthroughStep.id === "make-pick") {
        setMobileTab("bracket");
        setMobileSection("South");
        setMobileRound("R64");
      }
      if (currentWalkthroughStep.id === "watch-reprice") {
        setMobileTab("bracket");
        setMobileSection("South");
        setMobileRound("R32");
      }
      if (currentWalkthroughStep.id === "see-futures") {
        setMobileTab("futures");
      }
      if (currentWalkthroughStep.id === "edit-odds") {
        setMobileTab("bracket");
        setMobileSection("South");
        setMobileRound("R64");
      }
      if (currentWalkthroughStep.id === "ready") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    };

    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const resolveTarget = async () => {
      runPreAction();
      const maxAttempts = 15;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (cancelled || token !== walkthroughResolveTokenRef.current) return;
        const target = getTargetElement();
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
          await wait(400);
          if (cancelled || token !== walkthroughResolveTokenRef.current) return;
          setWalkthroughTargetEl(target);
          setWalkthroughTargetRect(target.getBoundingClientRect());
          return;
        }
        await wait(200);
      }
      // eslint-disable-next-line no-console
      console.warn(`Walkthrough: target not found for step ${currentWalkthroughStep.id}, skipping.`);
      setWalkthroughStep((prev) => Math.min(prev + 1, WALKTHROUGH_STEPS.length - 1));
    };

    void resolveTarget();
    return () => {
      cancelled = true;
    };
  }, [currentWalkthroughStep, isMobile, mobileRound, mobileSection, sidePanelOpen, walkthroughActive, walkthroughFirstPickedTeamId]);

  useEffect(() => {
    if (!walkthroughActive || !walkthroughTargetEl) return;
    let raf = 0;
    let debounceTimer: number | null = null;
    const update = () => {
      if (!walkthroughTargetEl) return;
      setWalkthroughTargetRect(walkthroughTargetEl.getBoundingClientRect());
    };
    const onScrollOrResize = () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        raf = window.requestAnimationFrame(update);
      }, 100);
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    onScrollOrResize();
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [walkthroughActive, walkthroughTargetEl]);

  useEffect(() => {
    const clearSpotlight = () => {
      document.querySelectorAll<HTMLElement>(".wt-spotlight-target").forEach((el) => {
        el.classList.remove("wt-spotlight-target");
      });
    };

    if (!walkthroughActive || !walkthroughTargetEl) {
      clearSpotlight();
      return;
    }

    clearSpotlight();
    const timer = window.setTimeout(() => {
      walkthroughTargetEl.classList.add("wt-spotlight-target");
    }, 50);

    return () => {
      window.clearTimeout(timer);
      walkthroughTargetEl.classList.remove("wt-spotlight-target");
    };
  }, [walkthroughActive, walkthroughTargetEl]);

  useEffect(() => {
    if (!walkthroughActive || !walkthroughTargetRect) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = walkthroughTargetRect;
    const tooltipWidth = isMobile ? Math.min(vw * 0.9, 340) : 340;
    const tooltipHeight = 200;
    const canPlaceBelow = rect.bottom + 16 + tooltipHeight < vh;
    const canPlaceAbove = rect.top - 16 - tooltipHeight > 0;
    const canPlaceRight = rect.right + 16 + tooltipWidth < vw;
    const placement: TooltipPlacement =
      canPlaceBelow && canPlaceRight ? "below" : canPlaceAbove ? "above" : canPlaceRight ? "right" : "left";
    setTooltipPlacement(placement);
  }, [isMobile, walkthroughActive, walkthroughTargetRect]);

  useEffect(() => {
    if (!walkthroughActive || currentWalkthroughStep?.id !== "make-pick") return;
    const selected = document.querySelector(".eg-team-row.selected.result-win, .mobile-team-btn.winner");
    if (!selected) return;
    if (walkthroughAdvanceTimerRef.current !== null) window.clearTimeout(walkthroughAdvanceTimerRef.current);
    const winnerGame = Object.entries(lockedPicks)[0];
    if (winnerGame?.[1]) setWalkthroughFirstPickedTeamId(winnerGame[1]);
    walkthroughAdvanceTimerRef.current = window.setTimeout(() => {
      setWalkthroughStep(1);
    }, 600);
    return () => {
      if (walkthroughAdvanceTimerRef.current !== null) {
        window.clearTimeout(walkthroughAdvanceTimerRef.current);
      }
    };
  }, [currentWalkthroughStep?.id, lockedPicks, walkthroughActive]);

  useEffect(() => {
    if (!walkthroughActive) return;
    const onNavigate = () => {
      setWalkthroughActive(false);
      setWalkthroughStep(0);
      setWalkthroughTargetEl(null);
      setWalkthroughTargetRect(null);
      setWalkthroughFirstPickedTeamId(null);
    };
    window.addEventListener("popstate", onNavigate);
    return () => window.removeEventListener("popstate", onNavigate);
  }, [walkthroughActive]);

  useEffect(() => {
    if (walkthroughActive) {
      document.body.classList.add("walkthrough-active");
    } else {
      document.body.classList.remove("walkthrough-active");
    }
    return () => document.body.classList.remove("walkthrough-active");
  }, [walkthroughActive]);

  useEffect(() => {
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>(".eg-region-card, .eg-finals-card")
    );
    if (targets.length === 0) return;
    if (!("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("in-view"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.1 }
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [isMobile, sidePanelOpen]);

  const toolbar = (
    <div className="eg-main-actions toolbar">
      <button onClick={onUndo} disabled={undoStack.length === 0} className="eg-btn">
        Undo
      </button>
      <button onClick={onResetAll} className="eg-btn">
        Reset All
      </button>
      <button onClick={onModelSim} className="eg-btn">
        Instant Sim Bracket
      </button>
      <button onClick={onModelSimStaggered} className="eg-btn" disabled={staggeredSimRunning}>
        {staggeredSimRunning ? "Staggered Sim Running..." : "Staggered Sim Bracket"}
      </button>
      {staggeredSimRunning ? (
        <button
          onClick={onToggleStaggeredPause}
          className="eg-btn"
          aria-label={staggeredSimPaused ? "Resume staggered simulation" : "Pause staggered simulation"}
          title={staggeredSimPaused ? "Resume staggered simulation" : "Pause staggered simulation"}
        >
          {staggeredSimPaused ? "▶" : "⏸"}
        </button>
      ) : null}
      {(showStaggeredControls || staggeredSimRunning) ? (
        <div className="eg-stagger-controls">
          <label htmlFor="stagger-delay" className="eg-stagger-label">
            Stagger Delay: {(staggeredSimDelayMs / 1000).toFixed(1)}s
          </label>
          <input
            id="stagger-delay"
            type="range"
            min={MIN_STAGGERED_SIM_DELAY_MS}
            max={MAX_STAGGERED_SIM_DELAY_MS}
            step={250}
            value={staggeredSimDelayMs}
            onChange={(event) => setStaggeredSimDelayMs(Number(event.target.value))}
            className="eg-stagger-slider"
          />
        </div>
      ) : null}
      <div className="eg-mode-toggle">
        {formatModes.map((mode) => (
          <button
            key={mode.id}
            className={`eg-chip ${displayMode === mode.id ? "active" : ""}`}
            onClick={() => {
              showContextualHint(
                "toggle",
                "Switch between American odds (+300) and implied win probability (25.0%) across the entire product.",
                ".eg-mode-toggle",
                4000
              );
              trackEvent("odds_mode_toggled", {
                from: displayMode,
                to: mode.id,
              });
              setDisplayMode(mode.id);
            }}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );

  const futuresContent = (
    <>
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
        <div className="eg-panel-head">
          <h3>Pre-Tournament Baseline</h3>
        </div>
        <p className="eg-metric-label">Static pre-pick advancement odds (never conditioned)</p>
        <div className="eg-futures-list">
          {preTournamentFutures.map((row) => {
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
              <article key={`baseline-${row.teamId}`} className="eg-future-item">
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
                    return (
                      <div key={`baseline-${row.teamId}-${metric.label}`} className="future-metric">
                        <span className="future-metric-label">{metric.label}</span>
                        <span className="future-metric-value">{formatted.primary}</span>
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
        <p className="eg-setting-value">Half A: South/West, Half B: East/Midwest</p>

        <p className="eg-setting-label">Current lock count</p>
        <p className="eg-setting-value">{Object.keys(sanitized).length} picks</p>
        <button className="eg-mini-btn onboarding-replay-btn" onClick={() => startWalkthrough({ replay: true })}>
          Replay Intro
        </button>
      </section>
    </>
  );

  return (
    <div className={`eg-shell ${compactDesktop ? "compact-desktop" : ""}`}>
      <div className="bg-glow" aria-hidden="true" />
      <canvas id="bg-stats" className="bg-canvas" aria-hidden="true" />
      <canvas id="bg-lightning" className="bg-canvas" aria-hidden="true" />
      <canvas id="bg-text" className="bg-canvas" aria-hidden="true" />
      <div className="bg-shape bg-top" aria-hidden="true" />
      <div className="bg-shape bg-bottom" aria-hidden="true" />

      <main className="eg-app">
        <nav className="og-top-nav" aria-label="Odds Gods tools">
          <div className="og-top-nav-desktop">
            <a className="og-top-nav-brand" href={LANDING_URL}>
              <img className="og-top-nav-logo" src="/logo-icon.png?v=20260225" alt="Odds Gods" />
              <span className="odds">ODDS</span> <span className="gods">GODS</span>
            </a>
            <div className="og-top-nav-tabs">
              <a className="og-top-nav-link active" href={BRACKET_URL} aria-current="page">
                The Bracket Lab
                <span className="beta-badge">BETA</span>
              </a>
              <a className="og-top-nav-link" href={WATO_URL}>
                What Are the Odds?
                <span className="beta-badge">BETA</span>
              </a>
            </div>
          </div>
          <div className="og-top-nav-mobile">
            <a className="og-mobile-logo-link" href={LANDING_URL} aria-label="Odds Gods home">
              <img className="nav-logo-icon" src="/logo-icon.png?v=20260225" alt="Odds Gods" />
            </a>
            <span className="nav-product-title">The Bracket Lab</span>
            <a className="nav-mobile-alt" href={WATO_URL}>
              WATO
            </a>
          </div>
        </nav>
        <header className={`eg-header ${isMobile ? "mobile-hidden" : ""}`}>
          <h1>The Bracket Lab</h1>
          <p className="eg-subtitle">
            March Madness what-if odds. Click picks to condition futures in real time.
          </p>
        </header>
        {isMobile ? (
          <section className="eg-mobile-shell">
            {toolbar}
            {mobileTab === "bracket" ? (
              <>
                <MobileRegionTabs activeSection={mobileSection} onChange={setMobileSection} />
                <div className="mobile-bracket-scroll">
                  {mobileSection === "FF" ? (
                    <MobileFinalFourView
                      activeRound={mobileFfRound}
                      allE8sComplete={allRegionE8Complete}
                      regionE8Status={regionE8Status}
                      allFinalFourComplete={allFinalFourComplete}
                      championshipComplete={championshipComplete}
                      leftSemi={leftSemi}
                      rightSemi={rightSemi}
                      titleGame={titleGame}
                      displayMode={displayMode}
                      onRoundChange={setMobileFfRound}
                      onPick={onPick}
                      onSwitchPick={onSwitchPick}
                      onUndoPick={onUndoGame}
                      onEditProb={openProbabilityPopup}
                    />
                  ) : (
                    <MobileRegionView
                      region={mobileSection}
                      activeRound={mobileRound}
                      games={games}
                      gameWinProbs={simResult.gameWinProbs}
                      possibleWinners={possibleWinners}
                      displayMode={displayMode}
                      roundDeltas={mobileRoundDeltas}
                      firstPickNudgeVisible={firstPickNudgeVisible}
                      firstPickChangedRounds={firstPickChangedRounds}
                      majorShiftNudgeVisible={majorShiftNudgeVisible}
                      majorShiftTeamName={majorShiftTeamName}
                      majorShiftPct={majorShiftPct}
                      majorShiftTargetRound={majorShiftTargetRound}
                      onDismissFirstPickNudge={() => setFirstPickNudgeVisible(false)}
                      onDismissMajorShiftNudge={() => setMajorShiftNudgeVisible(false)}
                      onRoundChange={setMobileRound}
                      onPick={onPick}
                      onSwitchPick={onSwitchPick}
                      onUndoPick={onUndoGame}
                      onEditProb={openProbabilityPopup}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="mobile-futures-view">{futuresContent}</div>
            )}
            <LiveOddsStrip
              topContenders={liveOddsTopContenders}
              justChangedIds={liveOddsChangedIds}
              displayMode={displayMode}
              onOpenFutures={() => setMobileTab("futures")}
            />
            <MobileTabBar activeTab={mobileTab} onTabChange={setMobileTab} />
          </section>
        ) : (
          <section className={`eg-layout ${sidePanelOpen ? "panel-open" : "panel-collapsed"}`}>
            <div className="eg-main-panel">
              {toolbar}

              <div className="eg-bracket-stack">
                <section className="eg-bracket-section top-half">
                  <div className="eg-section-head">
                    <h2>Top Half Bracket</h2>
                    <p>{regionSections[0][0]} + {regionSections[0][1]}</p>
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
                          onOpenProbabilityPopup={openProbabilityPopup}
                          onUnavailableRoundClick={onUnavailableRoundClick}
                        />
                      ))}
                    </div>
                  </div>
                </section>

                <section className="eg-bracket-section">
                  <div className="eg-section-head">
                    <h2>Bottom Half Bracket</h2>
                    <p>{regionSections[1][0]} + {regionSections[1][1]}</p>
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
                          onOpenProbabilityPopup={openProbabilityPopup}
                          onUnavailableRoundClick={onUnavailableRoundClick}
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
                      <p className="eg-finals-sub">{regionSections[0][0]} + {regionSections[0][1]}</p>
                      {leftSemi ? (
                        <GameCard
                          key={leftSemi.id}
                          game={leftSemi}
                          gameWinProbs={simResult.gameWinProbs}
                          possibleWinners={possibleWinners}
                          onPick={onPick}
                          lastPickedKey={lastPickedKey}
                          displayMode={displayMode}
                          onOpenProbabilityPopup={openProbabilityPopup}
                          onUnavailableRoundClick={onUnavailableRoundClick}
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
                            onOpenProbabilityPopup={openProbabilityPopup}
                            onUnavailableRoundClick={onUnavailableRoundClick}
                          />
                        </div>
                      ) : null}
                    </div>

                    <div className="eg-semi-col right">
                      <p className="eg-finals-label">Semifinal</p>
                      <p className="eg-finals-sub">{regionSections[1][0]} + {regionSections[1][1]}</p>
                      {rightSemi ? (
                        <GameCard
                          key={rightSemi.id}
                          game={rightSemi}
                          gameWinProbs={simResult.gameWinProbs}
                          possibleWinners={possibleWinners}
                          onPick={onPick}
                          lastPickedKey={lastPickedKey}
                          displayMode={displayMode}
                          onOpenProbabilityPopup={openProbabilityPopup}
                          onUnavailableRoundClick={onUnavailableRoundClick}
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
                onClick={() =>
                  setSidePanelOpen((v) => {
                    const next = !v;
                    trackEvent("futures_toggle_clicked", {
                      next_open: next,
                      source: isMobile ? "mobile" : "desktop",
                    });
                    return next;
                  })
                }
                aria-expanded={sidePanelOpen}
              >
                {sidePanelOpen ? "Collapse ▸" : "Futures ▾"}
              </button>
              {futuresContent}
            </aside>
          </section>
        )}
      </main>

      {probPopup ? (
        <ProbabilityPopup
          matchup={gameById.get(probPopup.gameId) ?? null}
          anchorEl={probPopup.anchorEl}
          currentProbA={customProbByGame[probPopup.gameId] ?? null}
          onPreview={(probA) => previewCustomProbability(probPopup.gameId, probA)}
          onApply={saveProbabilityPopup}
          onResetToModel={() => resetProbabilityToModel(probPopup.gameId)}
          onClose={() => closeProbabilityPopup(true)}
        />
      ) : null}

      {welcomeGateOpen ? (
        <WelcomeGate onStart={() => startWalkthrough()} onSkip={() => skipWalkthrough()} />
      ) : null}

      {walkthroughActive && walkthroughTargetRect && currentWalkthroughStep ? (
        <Suspense fallback={null}>
          <SpotlightWalkthrough
            step={currentWalkthroughStep}
            stepIndex={walkthroughStep}
            targetRect={walkthroughTargetRect}
            placement={tooltipPlacement}
            onAdvance={() => {
              if (currentWalkthroughStep.id === "ready") {
                completeWalkthrough();
                return;
              }
              setWalkthroughStep((prev) => Math.min(prev + 1, WALKTHROUGH_STEPS.length - 1));
            }}
            onSkip={() => skipWalkthrough()}
          />
        </Suspense>
      ) : null}

      {activeHint ? (
        <ContextualHint
          message={activeHint.message}
          rect={activeHint.rect}
          onDismiss={() => setActiveHint(null)}
        />
      ) : null}
    </div>
  );
}

function mobileShortName(name: string) {
  const abbreviation = abbreviationForTeam(name);
  if (abbreviation && abbreviation !== name) return abbreviation;
  const words = name.split(" ");
  return words.length > 2 ? words[words.length - 1] : name;
}

function getRegionRoundStatus(games: ResolvedGame[], region: Region, round: MobileRegionRound) {
  const roundGames = gamesByRegionAndRound(games, region, round);
  if (roundGames.every((game) => game.winnerId)) return "complete" as const;
  if (roundGames.some((game) => game.winnerId)) return "in-progress" as const;
  return "available" as const;
}

function getRegionRoundMode(games: ResolvedGame[], region: Region, round: MobileRegionRound): "interactive" | "probabilistic" {
  if (round === "R64") return "interactive";
  const previousRound: Record<Exclude<MobileRegionRound, "R64">, MobileRegionRound> = {
    R32: "R64",
    S16: "R32",
    E8: "S16",
  };
  const priorGames = gamesByRegionAndRound(games, region, previousRound[round]);
  const prevComplete = priorGames.length > 0 && priorGames.every((game) => Boolean(game.winnerId));
  return prevComplete ? "interactive" : "probabilistic";
}

function isRegionRoundAccessible(_games: ResolvedGame[], _region: Region, _round: MobileRegionRound) {
  return true;
}

function getPreferredMobileRegionRound(games: ResolvedGame[], region: Region): MobileRegionRound {
  for (const round of ["R64", "R32", "S16", "E8"] as const) {
    const mode = getRegionRoundMode(games, region, round);
    const status = getRegionRoundStatus(games, region, round);
    if (mode === "interactive" && status !== "complete") return round;
  }
  return "E8";
}

function getGameRowsForDisplay(
  game: ResolvedGame,
  gameWinProbs: SimulationOutput["gameWinProbs"],
  possibleWinners: Record<string, Set<string>>
): CandidateRow[] {
  const candidates = (gameWinProbs[game.id] || [])
    .map((entry) => ({ ...entry, team: teamsById.get(entry.teamId) }))
    .filter((entry): entry is CandidateRow => Boolean(entry.team));
  const possibleForGame = possibleWinners[game.id] ?? new Set<string>();
  const constrained = candidates.filter((candidate) => possibleForGame.has(candidate.teamId));

  if (game.teamAId && game.teamBId) {
    return [game.teamAId, game.teamBId]
      .map((teamId) => {
        const team = teamsById.get(teamId);
        if (!team) return null;
        return { teamId, prob: candidates.find((entry) => entry.teamId === teamId)?.prob ?? 0, team };
      })
      .filter((row): row is CandidateRow => row !== null);
  }

  return constrained.sort((a, b) => (b.prob !== a.prob ? b.prob - a.prob : a.team.seed - b.team.seed));
}

function isMobileFfRoundAccessible(
  allRegionE8Complete: boolean,
  allFinalFourComplete: boolean,
  championshipComplete: boolean,
  round: MobileFfRound
) {
  if (round === "F4") return allRegionE8Complete;
  if (round === "CHAMP") return allRegionE8Complete && allFinalFourComplete;
  return allRegionE8Complete && allFinalFourComplete && championshipComplete;
}

function getPreferredMobileFfRound(
  allRegionE8Complete: boolean,
  allFinalFourComplete: boolean,
  championshipComplete: boolean
): MobileFfRound {
  if (!allRegionE8Complete) return "F4";
  if (!allFinalFourComplete) return "F4";
  if (!championshipComplete) return "CHAMP";
  return "WIN";
}

function formatRoundList(rounds: string[]) {
  if (rounds.length === 0) return "future rounds";
  if (rounds.length === 1) return rounds[0];
  if (rounds.length === 2) return `${rounds[0]} & ${rounds[1]}`;
  return `${rounds.slice(0, -1).join(", ")} & ${rounds[rounds.length - 1]}`;
}

function getMajorShiftInfo(
  previousFutures: SimulationOutput["futures"],
  nextFutures: SimulationOutput["futures"]
) {
  const previousMap = new Map(previousFutures.map((row) => [row.teamId, row.champProb]));
  let maxShift = 0;
  let maxShiftTeamId: string | null = null;
  for (const row of nextFutures) {
    const prev = previousMap.get(row.teamId) ?? 0;
    const shift = Math.abs(row.champProb - prev);
    if (shift > maxShift) {
      maxShift = shift;
      maxShiftTeamId = row.teamId;
    }
  }
  if (!maxShiftTeamId || maxShift < 0.03) return null;
  return { teamId: maxShiftTeamId, shiftPct: Math.round(maxShift * 100) };
}

function CascadeFirstPickNudge({
  visible,
  changedRounds,
  onDismiss,
}: {
  visible: boolean;
  changedRounds: string[];
  onDismiss: () => void;
}) {
  const roundText = formatRoundList(changedRounds);
  return (
    <div className={`cascade-nudge cascade-nudge--firstpick ${visible ? "visible" : ""}`}>
      <span className="cascade-nudge-icon">↻</span>
      <div className="cascade-nudge-text">
        <span className="cascade-nudge-headline">Your pick just repriced {roundText}</span>
        <span className="cascade-nudge-sub">Tap {roundText} above to see how the field shifted →</span>
      </div>
      <button className="cascade-nudge-dismiss" onClick={onDismiss} aria-label="Dismiss nudge">
        ✕
      </button>
    </div>
  );
}

function CascadeMajorShiftNudge({
  visible,
  teamName,
  shiftPct,
  onTapSee,
  onDismiss,
}: {
  visible: boolean;
  teamName: string;
  shiftPct: number;
  onTapSee: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={`cascade-nudge cascade-nudge--majorshift ${visible ? "visible" : ""}`}>
      <span className="cascade-nudge-icon">⚡</span>
      <div className="cascade-nudge-text">
        <span className="cascade-nudge-headline">Big swing - {teamName}&apos;s title odds moved {shiftPct}%</span>
        <span className="cascade-nudge-sub">See how the rest of the field repriced →</span>
      </div>
      <button className="cascade-nudge-cta" onClick={onTapSee}>
        R32 →
      </button>
      <button className="cascade-nudge-dismiss" onClick={onDismiss} aria-label="Dismiss nudge">
        ✕
      </button>
    </div>
  );
}

function MobileRegionTabs({
  activeSection,
  onChange,
}: {
  activeSection: MobileSection;
  onChange: (section: MobileSection) => void;
}) {
  const sections: Array<{ id: MobileSection; label: string }> = [
    ...mobileRegionOrder.map((region) => ({ id: region, label: region })),
    { id: "FF", label: "FF+" },
  ];

  return (
    <div className="mobile-region-tabs">
      {sections.map((section) => (
        <button
          key={section.id}
          className={`mobile-region-tab ${activeSection === section.id ? "active" : ""}`}
          onClick={() => onChange(section.id)}
        >
          {section.label}
        </button>
      ))}
    </div>
  );
}

function MobileTabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}) {
  return (
    <div className="mobile-tab-bar">
      <button
        className={`mobile-tab ${activeTab === "bracket" ? "active" : ""}`}
        onClick={() => onTabChange("bracket")}
      >
        <span className="mobile-tab-icon">⬡</span>
        <span className="mobile-tab-label">Bracket</span>
      </button>
      <button
        className={`mobile-tab ${activeTab === "futures" ? "active" : ""}`}
        onClick={() => onTabChange("futures")}
      >
        <span className="mobile-tab-icon">↗</span>
        <span className="mobile-tab-label">Futures</span>
      </button>
    </div>
  );
}

function MobileRoundNav({
  rounds,
  activeRound,
  getStatus,
  getMode,
  deltaByRound,
  onRoundChange,
}: {
  rounds: Array<{ id: string; label: string }>;
  activeRound: string;
  getStatus: (roundId: string) => "available" | "in-progress" | "complete";
  getMode: (roundId: string) => "interactive" | "probabilistic";
  deltaByRound?: Partial<Record<string, number>>;
  onRoundChange: (roundId: string) => void;
}) {
  return (
    <div className="mobile-round-nav">
      {rounds.map((round) => {
        const status = getStatus(round.id);
        const mode = getMode(round.id);
        const delta = deltaByRound?.[round.id] ?? 0;
        return (
          <button
            key={round.id}
            className={`mobile-round-pill mobile-round-pill--${status} mobile-round-pill--${mode} ${
              activeRound === round.id ? "active" : ""
            }`}
            onClick={() => onRoundChange(round.id)}
          >
            {round.label}
            {status === "complete" ? <span className="mobile-round-check">✓</span> : null}
            {delta > 0 ? <span className="m-pill-delta">{delta}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function MobileRegionView({
  region,
  activeRound,
  games,
  gameWinProbs,
  possibleWinners,
  displayMode,
  roundDeltas,
  firstPickNudgeVisible,
  firstPickChangedRounds,
  majorShiftNudgeVisible,
  majorShiftTeamName,
  majorShiftPct,
  majorShiftTargetRound,
  onDismissFirstPickNudge,
  onDismissMajorShiftNudge,
  onRoundChange,
  onPick,
  onSwitchPick,
  onUndoPick,
  onEditProb,
}: {
  region: Region;
  activeRound: MobileRegionRound;
  games: ResolvedGame[];
  gameWinProbs: SimulationOutput["gameWinProbs"];
  possibleWinners: Record<string, Set<string>>;
  displayMode: OddsDisplayMode;
  roundDeltas: Partial<Record<MobileRegionRound, number>>;
  firstPickNudgeVisible: boolean;
  firstPickChangedRounds: string[];
  majorShiftNudgeVisible: boolean;
  majorShiftTeamName: string;
  majorShiftPct: number;
  majorShiftTargetRound: MobileRegionRound;
  onDismissFirstPickNudge: () => void;
  onDismissMajorShiftNudge: () => void;
  onRoundChange: (round: MobileRegionRound) => void;
  onPick: (game: ResolvedGame, teamId: string | null) => void;
  onSwitchPick: (game: ResolvedGame, teamId: string) => void;
  onUndoPick: (gameId: string) => void;
  onEditProb: (game: ResolvedGame, anchorEl: HTMLElement) => void;
}) {
  const roundOrder: Array<{ id: MobileRegionRound; label: string }> = [
    { id: "R64", label: "R64" },
    { id: "R32", label: "R32" },
    { id: "S16", label: "S16" },
    { id: "E8", label: "E8" },
  ];
  const activeGames = gamesByRegionAndRound(games, region, activeRound);
  const roundMode = getRegionRoundMode(games, region, activeRound);

  const handlePickForRound = (game: ResolvedGame, teamId: string) => {
    const roundGames = gamesByRegionAndRound(games, region, activeRound);
    const allCompleteAfterPick = roundGames.every((roundGame) => roundGame.id === game.id || Boolean(roundGame.winnerId));
    onPick(game, teamId);
    if (allCompleteAfterPick) {
      const nextRound: Record<MobileRegionRound, MobileRegionRound | null> = {
        R64: "R32",
        R32: "S16",
        S16: "E8",
        E8: null,
      };
      const next = nextRound[activeRound];
      if (next) {
        window.setTimeout(() => {
          onRoundChange(next);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }, 600);
      }
    }
  };

  return (
    <>
      <MobileRoundNav
        rounds={roundOrder}
        activeRound={activeRound}
        getStatus={(roundId) => getRegionRoundStatus(games, region, roundId as MobileRegionRound)}
        getMode={(roundId) => getRegionRoundMode(games, region, roundId as MobileRegionRound)}
        deltaByRound={roundDeltas}
        onRoundChange={(roundId) => onRoundChange(roundId as MobileRegionRound)}
      />
      <CascadeFirstPickNudge
        visible={firstPickNudgeVisible}
        changedRounds={firstPickChangedRounds}
        onDismiss={onDismissFirstPickNudge}
      />
      <CascadeMajorShiftNudge
        visible={!firstPickNudgeVisible && majorShiftNudgeVisible}
        teamName={majorShiftTeamName}
        shiftPct={majorShiftPct}
        onTapSee={() => {
          onRoundChange(majorShiftTargetRound);
          onDismissMajorShiftNudge();
        }}
        onDismiss={onDismissMajorShiftNudge}
      />
      {roundMode === "probabilistic" ? (
        <>
          <div className="m-prob-banner">
            <span>↻</span>
            <span>These odds update live as you make picks. Tap R64 to continue picking.</span>
            <button onClick={() => onRoundChange("R64")}>Back to R64 →</button>
          </div>
          {activeGames.map((game) => (
            <MobileProbSlotCard
              key={game.id}
              game={game}
              contenders={getGameRowsForDisplay(game, gameWinProbs, possibleWinners)}
              displayMode={displayMode}
            />
          ))}
        </>
      ) : (
        activeGames.map((game) => (
          <MobileMatchupCard
            key={game.id}
            game={game}
            displayMode={displayMode}
            onPick={handlePickForRound}
            onSwitchPick={onSwitchPick}
            onUndoPick={onUndoPick}
            onEditProb={onEditProb}
          />
        ))
      )}
    </>
  );
}

function MobileFinalFourView({
  activeRound,
  allE8sComplete,
  regionE8Status,
  allFinalFourComplete,
  championshipComplete,
  leftSemi,
  rightSemi,
  titleGame,
  displayMode,
  onRoundChange,
  onPick,
  onSwitchPick,
  onUndoPick,
  onEditProb,
}: {
  activeRound: MobileFfRound;
  allE8sComplete: boolean;
  regionE8Status: Record<Region, boolean>;
  allFinalFourComplete: boolean;
  championshipComplete: boolean;
  leftSemi: ResolvedGame | null;
  rightSemi: ResolvedGame | null;
  titleGame: ResolvedGame | null;
  displayMode: OddsDisplayMode;
  onRoundChange: (round: MobileFfRound) => void;
  onPick: (game: ResolvedGame, teamId: string | null) => void;
  onSwitchPick: (game: ResolvedGame, teamId: string) => void;
  onUndoPick: (gameId: string) => void;
  onEditProb: (game: ResolvedGame, anchorEl: HTMLElement) => void;
}) {
  const rounds: Array<{ id: MobileFfRound; label: string }> = [
    { id: "F4", label: "F4" },
    { id: "CHAMP", label: "CHAMP" },
    { id: "WIN", label: "WIN" },
  ];

  if (!allE8sComplete) {
    return (
      <div className="m-ff-locked">
        <p className="m-ff-locked-msg">Complete all four Elite 8s to unlock the Final Four.</p>
        <div className="m-ff-locked-progress">
          {mobileRegionOrder.map((region) => {
            return (
              <div key={region} className={`m-ff-region-dot ${regionE8Status[region] ? "complete" : ""}`}>
                {region.charAt(0)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const semifinals = [leftSemi, rightSemi].filter((game): game is ResolvedGame => Boolean(game));
  const championshipGames = titleGame ? [titleGame] : [];

  const handlePickForRound = (game: ResolvedGame, teamId: string) => {
    const roundGames = activeRound === "F4" ? semifinals : activeRound === "CHAMP" ? championshipGames : [];
    const allCompleteAfterPick = roundGames.every((roundGame) => roundGame.id === game.id || Boolean(roundGame.winnerId));
    onPick(game, teamId);
    if (allCompleteAfterPick) {
      const nextMap: Record<MobileFfRound, MobileFfRound | null> = {
        F4: "CHAMP",
        CHAMP: "WIN",
        WIN: null,
      };
      const next = nextMap[activeRound];
      if (next) {
        window.setTimeout(() => {
          onRoundChange(next);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }, 600);
      }
    }
  };

  return (
    <>
      <MobileRoundNav
        rounds={rounds}
        activeRound={activeRound}
        getMode={() => "interactive"}
        getStatus={(roundId) => {
          if (roundId === "F4") return allFinalFourComplete ? "complete" : "available";
          if (roundId === "CHAMP") return championshipComplete ? "complete" : "available";
          return championshipComplete ? "complete" : "available";
        }}
        onRoundChange={(roundId) => onRoundChange(roundId as MobileFfRound)}
      />
      {activeRound === "F4"
        ? semifinals.map((game) => (
            <MobileMatchupCard
              key={game.id}
              game={game}
              displayMode={displayMode}
              onPick={handlePickForRound}
              onSwitchPick={onSwitchPick}
              onUndoPick={onUndoPick}
              onEditProb={onEditProb}
            />
          ))
        : null}
      {activeRound === "CHAMP" && titleGame ? (
        <MobileMatchupCard
          game={titleGame}
          displayMode={displayMode}
          onPick={handlePickForRound}
          onSwitchPick={onSwitchPick}
          onUndoPick={onUndoPick}
          onEditProb={onEditProb}
        />
      ) : null}
      {activeRound === "WIN" ? <MobileChampionCard titleGame={titleGame} /> : null}
    </>
  );
}

function MobileChampionCard({ titleGame }: { titleGame: ResolvedGame | null }) {
  const champion = titleGame?.winnerId ? teamsById.get(titleGame.winnerId) : null;

  if (!champion) {
    return (
      <div className="m-ff-locked">
        <p className="m-ff-locked-msg">Complete the championship matchup to reveal the champion.</p>
      </div>
    );
  }

  return (
    <div className="m-card m-card--picked">
      <div className="m-card-footer">
        <span className="m-winner-label">Champion</span>
      </div>
      <div className="m-champion-body">
        <TeamLogo teamName={champion.name} src={teamLogoUrl(champion)} />
        <span className="m-champion-name">{champion.name}</span>
      </div>
    </div>
  );
}

function MobileMatchupCard({
  game,
  displayMode,
  onPick,
  onSwitchPick,
  onUndoPick,
  onEditProb,
}: {
  game: ResolvedGame;
  displayMode: OddsDisplayMode;
  onPick: (game: ResolvedGame, teamId: string) => void;
  onSwitchPick: (game: ResolvedGame, teamId: string) => void;
  onUndoPick: (gameId: string) => void;
  onEditProb: (game: ResolvedGame, anchorEl: HTMLElement) => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const teamA = game.teamAId ? teamsById.get(game.teamAId) ?? null : null;
  const teamB = game.teamBId ? teamsById.get(game.teamBId) ?? null : null;
  if (!teamA || !teamB) return null;

  const probA = Math.round((getGameWinProb(game, teamA.id) ?? 0) * 100);
  const probB = Math.round((getGameWinProb(game, teamB.id) ?? 0) * 100);
  const isPicked = Boolean(game.winnerId);
  const isEdited = game.customProbA !== null;
  const teamAOdds = formatOddsDisplay(probA / 100, displayMode).primary;
  const teamBOdds = formatOddsDisplay(probB / 100, displayMode).primary;

  return (
    <div className={`m-card ${isPicked ? "m-card--picked" : ""}`} ref={cardRef}>
      <button
        className={`m-team ${game.winnerId === teamA.id ? "m-team--winner" : ""} ${
          game.winnerId && game.winnerId !== teamA.id ? "m-team--loser" : ""
        }`}
        onClick={() => {
          if (!isPicked) onPick(game, teamA.id);
          if (isPicked && game.winnerId !== teamA.id) onSwitchPick(game, teamA.id);
        }}
      >
        <span className="m-seed">{teamA.seed}</span>
        <TeamLogo teamName={teamA.name} src={teamLogoUrl(teamA)} />
        <span className="m-name">{teamA.name}</span>
        <div className="m-stats">
          <span className="m-prob">{probA}%</span>
          <span className={`m-odds ${isEdited ? "m-odds--edited" : ""}`}>{teamAOdds}</span>
        </div>
      </button>

      <div className="m-vs">vs</div>

      <button
        className={`m-team ${game.winnerId === teamB.id ? "m-team--winner" : ""} ${
          game.winnerId && game.winnerId !== teamB.id ? "m-team--loser" : ""
        }`}
        onClick={() => {
          if (!isPicked) onPick(game, teamB.id);
          if (isPicked && game.winnerId !== teamB.id) onSwitchPick(game, teamB.id);
        }}
      >
        <span className="m-seed">{teamB.seed}</span>
        <TeamLogo teamName={teamB.name} src={teamLogoUrl(teamB)} />
        <span className="m-name">{teamB.name}</span>
        <div className="m-stats">
          <span className="m-prob">{probB}%</span>
          <span className={`m-odds ${isEdited ? "m-odds--edited" : ""}`}>{teamBOdds}</span>
        </div>
      </button>

      <div className="m-card-footer">
        {isPicked ? (
          <>
            <span className="m-winner-label">✓ {(game.winnerId === teamA.id ? teamA.name : teamB.name)} advances</span>
            <button className="m-undo-btn" onClick={() => onUndoPick(game.id)}>
              Undo
            </button>
          </>
        ) : (
          <>
            <span />
            <button
              className="m-edit-prob-btn"
              onClick={() => {
                if (cardRef.current) onEditProb(game, cardRef.current);
              }}
            >
              ✎ Edit odds
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function LiveOddsStrip({
  topContenders,
  justChangedIds,
  displayMode,
  onOpenFutures,
}: {
  topContenders: Array<{ id: string; logoUrl: string; shortName: string; titleOdds: string; titleImpliedPct: string }>;
  justChangedIds: Set<string>;
  displayMode: OddsDisplayMode;
  onOpenFutures: () => void;
}) {
  return (
    <div className="live-odds-strip">
      <span className="live-odds-strip-label">Title</span>
      <div className="live-odds-strip-chips">
        {topContenders.slice(0, 5).map((team) => (
          <div
            key={team.id}
            className={`live-odds-chip ${justChangedIds.has(team.id) ? "live-odds-chip--changed" : ""}`}
          >
            <img src={team.logoUrl} className="live-chip-logo" alt="" />
            <span className="live-chip-name">{team.shortName}</span>
            <span className="live-chip-odds">{displayMode === "implied" ? team.titleImpliedPct : team.titleOdds}</span>
          </div>
        ))}
      </div>
      <button className="live-odds-strip-expand" onClick={onOpenFutures}>
        All →
      </button>
    </div>
  );
}

function MobileProbSlotCard({
  game,
  contenders,
  displayMode,
}: {
  game: ResolvedGame;
  contenders: CandidateRow[];
  displayMode: OddsDisplayMode;
}) {
  const alive = contenders.filter((row) => row.prob > 0).sort((a, b) => (b.prob !== a.prob ? b.prob - a.prob : a.team.seed - b.team.seed));

  return (
    <div className="m-prob-card">
      <div className="m-prob-card-header">
        <span className="m-prob-eyebrow">All paths · {gameRoundLabel[game.round]}</span>
        <span className="m-prob-updating">↻ Live</span>
      </div>
      {alive.map((row) => {
        const reach = Math.round(row.prob * 100);
        const locked = reach === 100;
        return (
          <div className={`m-prob-row ${locked ? "m-prob-row--locked" : ""}`} key={`${game.id}-${row.teamId}`}>
            <div className="m-prob-rank-bar" style={{ width: `${reach}%` }} />
            <div className="m-prob-row-content">
              <div className="m-prob-row-left">
                <span className="m-seed">{row.team.seed}</span>
                <img src={teamLogoUrl(row.team)} className="m-logo-sm" alt="" />
                <div className="m-prob-row-info">
                  <span className="m-name-sm">{row.team.name}</span>
                  <span className="m-prob-reach">{locked ? "✓ Locked in" : `${reach}% to reach`}</span>
                </div>
              </div>
              <div className="m-prob-row-right">
                <span className="m-odds-sm">{formatOddsDisplay(row.prob, displayMode).primary}</span>
                <span className="m-prob-win-label">to win slot</span>
              </div>
            </div>
          </div>
        );
      })}
      <div className="m-prob-card-footer">
        <span className="m-prob-footer-note">Read-only · Make R64 picks to update</span>
      </div>
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
  onOpenProbabilityPopup,
  onUnavailableRoundClick,
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
  onOpenProbabilityPopup: (game: ResolvedGame, anchorEl: HTMLElement) => void;
  onUnavailableRoundClick: (round: ResolvedGame["round"]) => void;
}) {
  const rounds = inverted ? [...regionRounds].reverse() : [...regionRounds];
  const collapseByRound = useMemo(() => {
    const r64Games = gamesByRegionAndRound(games, region, "R64");
    const r32Games = gamesByRegionAndRound(games, region, "R32");
    const s16Games = gamesByRegionAndRound(games, region, "S16");
    const e8Games = gamesByRegionAndRound(games, region, "E8");

    const regionState = {
      r32FullyDetermined: r32Games.length > 0 && r32Games.every((game) => Boolean(game.teamAId && game.teamBId)),
      s16FullyDetermined: s16Games.length > 0 && s16Games.every((game) => Boolean(game.teamAId && game.teamBId)),
      e8FullyDetermined: e8Games.length > 0 && e8Games.every((game) => Boolean(game.teamAId && game.teamBId)),
      r64HasGames: r64Games.length > 0,
      r32HasGames: r32Games.length > 0,
      s16HasGames: s16Games.length > 0,
    };

    const shouldCollapseRound = (round: "R64" | "R32" | "S16" | "E8") => {
      if (round === "E8") return false;
      if (round === "R64") return regionState.r64HasGames && regionState.r32FullyDetermined;
      if (round === "R32") return regionState.r32HasGames && regionState.s16FullyDetermined;
      if (round === "S16") return regionState.s16HasGames && regionState.e8FullyDetermined;
      return false;
    };

    return {
      R64: shouldCollapseRound("R64"),
      R32: shouldCollapseRound("R32"),
      S16: shouldCollapseRound("S16"),
      E8: false,
    } as Record<"R64" | "R32" | "S16" | "E8", boolean>;
  }, [games, region]);
  const gridStateClasses = [
    collapseByRound.R64 ? "r64-collapsed" : "",
    collapseByRound.R32 ? "r32-collapsed" : "",
    collapseByRound.S16 ? "s16-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const shortRoundLabel: Record<ResolvedGame["round"], string> = {
    R64: "R64",
    R32: "R32",
    S16: "S16",
    E8: "E8",
    F4: "F4",
    CHAMP: "CHAMP",
  };

  return (
    <section className={`eg-region-card bracket-region ${inverted ? "region-inverted" : ""}`}>
      <div className="eg-region-head">
        <h2>{region}</h2>
        <button className="eg-mini-btn" onClick={() => onResetRegion(region)}>
          Reset Region
        </button>
      </div>

      <div className={`eg-round-grid bracket-grid ${gridStateClasses}`}>
        {rounds.map((round) => {
          const roundGames = gamesByRegionAndRound(games, region, round);
          const collapsed =
            round === "R64" || round === "R32" || round === "S16" || round === "E8"
              ? Boolean(collapseByRound[round])
              : false;
          const e8Game = round === "E8" ? roundGames[0] : null;
          const e8Confirmed = Boolean(e8Game?.teamAId && e8Game?.teamBId);
          return (
            <div
              key={`${region}-${round}`}
              className={`eg-round-col lane-${round.toLowerCase()} ${collapsed ? "eg-round-col--collapsed" : ""} ${round === "E8" && e8Confirmed ? "eg-round-col--e8" : ""} ${round === "E8" && !e8Confirmed ? "eg-round-col--e8-pending" : ""}`}
            >
              <div className="eg-round-col-content">
                <p className="eg-round-label">{collapsed ? shortRoundLabel[round] : gameRoundLabel[round]}</p>
                <div className="eg-games-lane">
                  {roundGames.map((game, idx) => {
                    const topPercent = ((idx + 0.5) / Math.max(1, roundGames.length)) * 100;
                    const nodeStyle = { top: `${topPercent}%` } as React.CSSProperties;
                    return (
                      <div key={game.id} className="eg-game-node" style={nodeStyle}>
                        <GameCard
                          game={game}
                          collapsed={collapsed}
                          gameWinProbs={gameWinProbs}
                          possibleWinners={possibleWinners}
                          onPick={onPick}
                          lastPickedKey={lastPickedKey}
                          displayMode={displayMode}
                          onOpenProbabilityPopup={onOpenProbabilityPopup}
                          onUnavailableRoundClick={onUnavailableRoundClick}
                        />
                      </div>
                    );
                  })}
                </div>
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
  collapsed = false,
  gameWinProbs,
  possibleWinners,
  onPick,
  lastPickedKey,
  displayMode,
  onOpenProbabilityPopup,
  onUnavailableRoundClick,
}: {
  game: ResolvedGame;
  collapsed?: boolean;
  gameWinProbs: SimulationOutput["gameWinProbs"];
  possibleWinners: Record<string, Set<string>>;
  onPick: (game: ResolvedGame, teamId: string | null) => void;
  lastPickedKey: string | null;
  displayMode: OddsDisplayMode;
  onOpenProbabilityPopup: (game: ResolvedGame, anchorEl: HTMLElement) => void;
  onUnavailableRoundClick?: (round: ResolvedGame["round"]) => void;
}) {
  type CandidateRow = { teamId: string; prob: number; team: NonNullable<ReturnType<typeof teamsById.get>> };

  const candidates = (gameWinProbs[game.id] || [])
    .map((entry) => ({ ...entry, team: teamsById.get(entry.teamId) }))
    .filter((entry): entry is CandidateRow => Boolean(entry.team));
  const possibleForGame = possibleWinners[game.id] ?? new Set<string>();
  const constrainedCandidatesUnsorted = candidates.filter((candidate) =>
    possibleForGame.has(candidate.teamId)
  );
  const constrainedCandidates =
    constrainedCandidatesUnsorted.length > 2
      ? [...constrainedCandidatesUnsorted].sort((a, b) => {
          if (b.prob !== a.prob) return b.prob - a.prob;
          return a.team.seed - b.team.seed;
        })
      : constrainedCandidatesUnsorted;
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
  const useShowdownCard = (game.round === "E8" || game.round === "F4" || game.round === "CHAMP") && finalistRows.length === 2;
  const compactColumns = getCompactColumns(game.round, rows.length);
  const compactDensity = getCompactDensity(game.round, rows.length);
  const compactLongPressTimerRef = useRef<number | null>(null);
  const compactLongPressFiredRef = useRef(false);

  if (collapsed) {
    const compactTeams = [game.teamAId, game.teamBId]
      .map((teamId) => (teamId ? teamsById.get(teamId) ?? null : null))
      .filter((team): team is NonNullable<typeof team> => Boolean(team));

    return (
      <article className={`eg-game-card round-${game.round.toLowerCase()} collapsed`}>
        <div className="bracket-cell--compact">
          {compactTeams.length > 0 ? (
            compactTeams.map((team) => (
              <CompactTeamRow
                key={`${game.id}-${team.id}-compact`}
                team={team}
                isWinner={game.winnerId === team.id}
              />
            ))
          ) : (
            <>
              <div className="compact-team-row compact-team-row--loser">
                <span className="compact-seed">--</span>
                <span className="compact-logo" />
                <span className="compact-result">✕</span>
              </div>
              <div className="compact-team-row compact-team-row--loser">
                <span className="compact-seed">--</span>
                <span className="compact-logo" />
                <span className="compact-result">✕</span>
              </div>
            </>
          )}
        </div>
      </article>
    );
  }

  return (
    <article className={`eg-game-card round-${game.round.toLowerCase()}`}>
      <div className="eg-game-list">
        {useShowdownCard ? (
          <ShowdownCard
            game={game}
            finalists={finalistRows}
            displayMode={displayMode}
            lastPickedKey={lastPickedKey}
            onPick={onPick}
          />
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
                  editedProb={game.customProbA !== null}
                  canEditProb={!game.winnerId && game.teamAId !== null && game.teamBId !== null}
                  onOpenProbEditor={(anchorEl) => onOpenProbabilityPopup(game, anchorEl)}
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
                const normalizedTeamName = normalizeTeamName(team.name);
                const teamLabel = game.round === "E8" ? abbreviationForTeam(normalizedTeamName) : normalizedTeamName;
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
                    className={`eg-compact-chip matchup-row ${game.winnerId ? "matchup-row--picked" : ""} ${selected ? "selected" : ""} ${lastPickedKey === `${game.id}:${team.id}` ? "fresh-pick" : ""} ${outcome === "win" ? "result-win" : ""} ${outcome === "loss" ? "result-loss" : ""}`}
                    onClick={(event) => {
                      if (compactLongPressFiredRef.current) {
                        compactLongPressFiredRef.current = false;
                        event.preventDefault();
                        return;
                      }
                      if (!canPick) {
                        onUnavailableRoundClick?.(game.round);
                        return;
                      }
                      onPick(game, canPick ? team.id : null);
                    }}
                    onTouchStart={(event) => {
                      if (game.winnerId || !game.teamAId || !game.teamBId) return;
                      if (compactLongPressTimerRef.current !== null) {
                        window.clearTimeout(compactLongPressTimerRef.current);
                      }
                      compactLongPressFiredRef.current = false;
                      compactLongPressTimerRef.current = window.setTimeout(() => {
                        compactLongPressFiredRef.current = true;
                        onOpenProbabilityPopup(game, event.currentTarget);
                      }, 400);
                    }}
                    onTouchEnd={() => {
                      if (compactLongPressTimerRef.current !== null) {
                        window.clearTimeout(compactLongPressTimerRef.current);
                        compactLongPressTimerRef.current = null;
                      }
                    }}
                    onTouchCancel={() => {
                      if (compactLongPressTimerRef.current !== null) {
                        window.clearTimeout(compactLongPressTimerRef.current);
                        compactLongPressTimerRef.current = null;
                      }
                    }}
                    title={`Chance to advance from this game: ${(candidate.prob * 100).toFixed(1)}%`}
                  >
                    <span className="chip-seed">{team.seed}</span>
                    {showLogo ? (
                      <TeamHoverAnchor teamName={team.name} logoSrc={teamLogoUrl(team)} className="team-logo-cell">
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
                          <span className={`chip-prob ${game.customProbA !== null ? "edited-prob" : ""}`}>{primary}</span>
                          {secondary ? <span className="chip-sub">{secondary}</span> : null}
                        </>
                      )}
                    </span>
                    {!game.winnerId && game.teamAId && game.teamBId ? (
                      <>
                        <span
                          role="button"
                          tabIndex={0}
                          className="matchup-edit-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenProbabilityPopup(game, event.currentTarget as HTMLElement);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            event.stopPropagation();
                            onOpenProbabilityPopup(game, event.currentTarget as HTMLElement);
                          }}
                          title="Edit probability"
                          aria-label="Edit matchup probability"
                        >
                          ✎
                        </span>
                      </>
                    ) : null}
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
              editedProb={false}
              canEditProb={false}
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
              editedProb={false}
              canEditProb={false}
              onPick={() => {}}
            />
          </>
        )}
      </div>
    </article>
  );
}

function CompactTeamRow({
  team,
  isWinner,
}: {
  team: NonNullable<ReturnType<typeof teamsById.get>>;
  isWinner: boolean;
}) {
  return (
    <div
      className={`compact-team-row ${isWinner ? "compact-team-row--winner" : "compact-team-row--loser"}`}
      data-team-name={`${team.seed} ${team.name}`}
      title={`${team.seed} ${team.name}`}
    >
      <span className="compact-seed">{team.seed}</span>
      <img src={teamLogoUrl(team)} className="compact-logo" alt={team.name} loading="lazy" />
      <span className="compact-result">{isWinner ? "✓" : "✕"}</span>
    </div>
  );
}

function ShowdownCard({
  game,
  finalists,
  displayMode,
  lastPickedKey,
  onPick,
}: {
  game: ResolvedGame;
  finalists: CandidateRow[];
  displayMode: OddsDisplayMode;
  lastPickedKey: string | null;
  onPick: (game: ResolvedGame, teamId: string | null) => void;
}) {
  const roundClass = game.round === "CHAMP" ? "round-champ" : game.round === "F4" ? "round-f4" : "round-e8";
  const roundLabel = game.round === "CHAMP" ? "National Championship" : game.round === "F4" ? "Final Four" : "Elite 8";
  const decided = Boolean(game.lockedByUser && game.winnerId);

  return (
    <div className={`eg-showdown-card ${roundClass} eg-showdown-card--entering ${decided ? "decided" : ""}`}>
      <p className="eg-showdown-label">{roundLabel}</p>
      <div className="eg-showdown-matchup">
        {finalists.map((candidate, index) => {
          const team = candidate.team;
          const selected = game.winnerId === team.id;
          const outcome =
            game.lockedByUser && game.winnerId
              ? game.winnerId === team.id
                ? "win"
                : "loss"
              : null;
          const { primary } = formatOddsDisplay(candidate.prob, displayMode);
          const resultLabel =
            outcome === "win"
              ? game.round === "CHAMP"
                ? "✓ NCAA Champion"
                : "✓ Advances"
              : outcome === "loss"
                ? game.round === "CHAMP"
                  ? "✕ Runner-up"
                  : "✕ Eliminated"
                : null;
          return (
            <Fragment key={`${game.id}-${team.id}-showdown`}>
              {index === 1 ? <span className="eg-showdown-vs">VS</span> : null}
              <button
                type="button"
                className={`eg-showdown-team ${selected ? "picked winner" : ""} ${decided && !selected ? "loser" : ""} ${lastPickedKey === `${game.id}:${team.id}` ? "fresh-pick" : ""}`}
                onClick={() => onPick(game, team.id)}
                title={`Chance to advance from this game: ${(candidate.prob * 100).toFixed(1)}%`}
              >
                <span className="eg-showdown-seed">#{team.seed}</span>
                <TeamLogo teamName={team.name} src={teamLogoUrl(team)} className="eg-showdown-logo" />
                <span className="eg-showdown-name">{showdownTeamName(team.name)}</span>
                {!decided ? <span className="eg-showdown-odds">{primary}</span> : null}
                {resultLabel ? <span className="eg-showdown-result">{resultLabel}</span> : null}
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
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
  editedProb,
  canEditProb,
  onOpenProbEditor,
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
  editedProb: boolean;
  canEditProb: boolean;
  onOpenProbEditor?: (anchorEl: HTMLElement) => void;
  onPick: () => void;
}) {
  const formatted = prob !== null ? formatOddsDisplay(prob, displayMode) : { primary: "--" };
  const fullLabel = normalizeTeamName(label);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const rowRef = useRef<HTMLButtonElement | null>(null);

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const isTouchDevice = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

  return (
    <button
      type="button"
      ref={rowRef}
      className={`eg-team-row matchup-row ${canEditProb ? "" : "matchup-row--picked"} ${compact ? "compact" : ""} ${selected ? "selected" : ""} ${freshPick ? "fresh-pick" : ""} ${outcome === "win" ? "result-win" : ""} ${outcome === "loss" ? "result-loss" : ""}`}
      disabled={disabled}
      onClick={(event) => {
        if (longPressFiredRef.current) {
          longPressFiredRef.current = false;
          event.preventDefault();
          return;
        }
        onPick();
      }}
      onTouchStart={(event) => {
        if (!canEditProb || !onOpenProbEditor || !isTouchDevice) return;
        clearLongPress();
        longPressFiredRef.current = false;
        longPressTimerRef.current = window.setTimeout(() => {
          if (!rowRef.current) return;
          longPressFiredRef.current = true;
          onOpenProbEditor(rowRef.current);
          event.preventDefault();
        }, 400);
      }}
      onTouchEnd={clearLongPress}
      onTouchCancel={clearLongPress}
      title={tooltip}
    >
      <span className="team-seed" aria-label={seed !== null ? `Seed ${seed}` : "Seed unavailable"}>
        {seed !== null ? seed : "--"}
      </span>
      {teamName && logoSrc ? (
        <TeamHoverAnchor teamName={teamName} logoSrc={logoSrc} className="team-logo-cell">
          <TeamLogo teamName={teamName} src={logoSrc} />
        </TeamHoverAnchor>
      ) : (
        <span className="team-logo team-logo-placeholder" aria-hidden="true" />
      )}
      {compact ? null : (
        <TeamHoverAnchor teamName={fullLabel} logoSrc={logoSrc ?? fallbackLogo(fullLabel)}>
          <span className="team-name-wrap">
            <AdaptiveTeamLabel className="team-name btw-abbrev-name" fullName={fullLabel} />
            {formatted.secondary ? <span className="btw-title-odds">{formatted.secondary}</span> : null}
          </span>
        </TeamHoverAnchor>
      )}
      <span className="team-odds-wrap">
        {outcome ? (
            <span className={`outcome-badge ${outcome}`}>{outcome === "win" ? "✓" : "✕"}</span>
        ) : (
          <>
            <span className={`team-odds ${editedProb ? "edited-prob" : ""}`}>{formatted.primary}</span>
            {formatted.secondary ? <span className="team-odds-sub">{formatted.secondary}</span> : null}
          </>
        )}
      </span>
      {canEditProb && onOpenProbEditor ? (
        <>
          <span
            role="button"
            tabIndex={0}
            className="matchup-edit-btn"
            onClick={(event) => {
              event.stopPropagation();
              if (!rowRef.current) return;
              onOpenProbEditor(rowRef.current);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              if (!rowRef.current) return;
              onOpenProbEditor(rowRef.current);
            }}
            title="Edit probability"
            aria-label="Edit matchup probability"
          >
            ✎
          </span>
        </>
      ) : null}
    </button>
  );
}

function TeamLogo({ teamName, src, className }: { teamName: string; src: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const fallback = fallbackLogo(teamName);

  return (
    <img
      className={className ? `team-logo ${className}` : "team-logo"}
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

function showdownTeamName(name: string): string {
  return fullTeamName(name)
    .replace(/^University of\s+/i, "")
    .replace(/^University\s+/i, "")
    .replace(/\s+University\s+/gi, " ")
    .replace(/\s+University$/gi, "")
    .trim();
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
  className,
  children,
}: {
  teamName: string;
  logoSrc: string;
  className?: string;
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
      className={className ? `team-hover-anchor ${className}` : "team-hover-anchor"}
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

function ProbabilityPopup({
  matchup,
  anchorEl,
  currentProbA,
  onPreview,
  onApply,
  onResetToModel,
  onClose,
}: {
  matchup: ResolvedGame | null;
  anchorEl: HTMLElement;
  currentProbA: number | null;
  onPreview: (probA: number) => void;
  onApply: () => void;
  onResetToModel: () => void;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const teamA = matchup?.teamAId ? teamsById.get(matchup.teamAId) ?? null : null;
  const teamB = matchup?.teamBId ? teamsById.get(matchup.teamBId) ?? null : null;
  const modelProbA =
    matchup && teamA ? (getModelGameWinProb(matchup, teamA.id) ?? 0.5) : 0.5;
  const [probA, setProbA] = useState<number>(Math.round(((currentProbA ?? modelProbA) * 100)));
  const isEdited = Math.round(probA) !== Math.round(modelProbA * 100);

  useEffect(() => {
    setProbA(Math.round(((currentProbA ?? modelProbA) * 100)));
  }, [currentProbA, modelProbA]);

  useLayoutEffect(() => {
    const updatePosition = () => {
      const rect = anchorEl.getBoundingClientRect();
      const popupWidth = 240;
      const popupHeight = 188;
      const spaceRight = window.innerWidth - rect.right;
      const left = spaceRight >= popupWidth + 12 ? rect.right + 8 : rect.left - popupWidth - 8;
      const top = Math.max(
        8,
        Math.min(rect.top + rect.height / 2 - popupHeight / 2, window.innerHeight - popupHeight - 8)
      );
      setPosition({ left: Math.max(8, left), top });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorEl]);

  if (!matchup || !teamA || !teamB) return null;

  return createPortal(
    <div
      ref={popupRef}
      className="prob-popup"
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      role="dialog"
      aria-label="Edit matchup probability"
    >
      <div className="prob-popup-header">
        <span className="prob-popup-label">Matchup Probability</span>
        <button className="prob-popup-close" onClick={onClose} aria-label="Close probability editor">
          ✕
        </button>
      </div>
      <div className="prob-popup-team">
        <span className="prob-popup-team-name">{teamA.seed} {teamA.name}</span>
        <span className="prob-popup-pct">{Math.round(probA)}%</span>
      </div>
      <div className="prob-popup-slider-wrap">
        <input
          type="range"
          min={1}
          max={99}
          step={1}
          value={Math.round(probA)}
          onChange={(event) => {
            const next = Math.min(99, Math.max(1, Number(event.target.value)));
            setProbA(next);
            onPreview(next / 100);
          }}
          className="prob-slider"
          style={{
            background: `linear-gradient(to right, rgba(184,125,24,0.8) 0%, rgba(184,125,24,0.8) ${Math.round(probA)}%, rgba(255,255,255,0.1) ${Math.round(probA)}%, rgba(255,255,255,0.1) 100%)`,
          }}
        />
      </div>
      <div className="prob-popup-team prob-popup-team--b">
        <span className="prob-popup-team-name">{teamB.seed} {teamB.name}</span>
        <span className="prob-popup-pct">{100 - Math.round(probA)}%</span>
      </div>
      <div className="prob-popup-baseline">
        <span>Model: {Math.round(modelProbA * 100)}% / {100 - Math.round(modelProbA * 100)}%</span>
        {isEdited ? (
          <button className="prob-popup-reset-link" onClick={onResetToModel}>
            Reset to model
          </button>
        ) : null}
      </div>
      <button
        className="prob-popup-save"
        disabled={!isEdited}
        onClick={onApply}
      >
        {isEdited ? "Apply" : "No changes"}
      </button>
    </div>,
    document.body
  );
}

function WelcomeGate({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return createPortal(
    <div className="wlcm-gate" role="dialog" aria-modal="true" aria-label="Welcome to The Bracket Lab">
      <div className="wlcm-gate-card">
        <h2>THE BRACKET LAB</h2>
        <p>Pick outcomes. Watch the entire tournament reprice in real time.</p>
        <button type="button" className="wlcm-start-btn" onClick={onStart}>
          Show me how →
        </button>
        <button type="button" className="wlcm-skip-btn" onClick={onSkip}>
          Skip — I&apos;ll figure it out
        </button>
      </div>
    </div>,
    document.body
  );
}

function SpotlightWalkthrough({
  step,
  stepIndex,
  targetRect,
  placement,
  onAdvance,
  onSkip,
}: {
  step: WalkthroughStepConfig;
  stepIndex: number;
  targetRect: DOMRect;
  placement: TooltipPlacement;
  onAdvance: () => void;
  onSkip: () => void;
}) {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const ctaRef = useRef<HTMLButtonElement | null>(null);
  const buttonLabel = step.ctaText?.trim() || "Next →";
  const padded = {
    top: Math.max(8, targetRect.top - 8),
    left: Math.max(8, targetRect.left - 8),
    width: targetRect.width + 16,
    height: targetRect.height + 16,
  };

  useEffect(() => {
    ctaRef.current?.focus();
  }, [step.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onSkip();
        return;
      }
      if (event.key === "Enter" && document.activeElement === ctaRef.current) {
        event.preventDefault();
        onAdvance();
        return;
      }
      if (event.key !== "Tab" || !tooltipRef.current) return;
      const focusables = Array.from(
        tooltipRef.current.querySelectorAll<HTMLElement>("button, a, [tabindex]:not([tabindex='-1'])")
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onAdvance, onSkip]);

  const tooltipStyle: React.CSSProperties = (() => {
    const gap = 14;
    const maxWidth = window.innerWidth < 768 ? Math.min(window.innerWidth * 0.9, 340) : 340;
    const approxHeight = 220;
    let top = padded.top + padded.height + gap;
    let left = padded.left;
    if (placement === "above") top = padded.top - approxHeight - gap;
    if (placement === "left") left = padded.left - maxWidth - gap;
    if (placement === "right") left = padded.left + padded.width + gap;
    if (placement === "below") left = padded.left + Math.min(24, padded.width / 4);
    left = Math.max(8, Math.min(window.innerWidth - maxWidth - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - approxHeight - 8, top));
    return { top, left, maxWidth };
  })();

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const shadeStyles = {
    top: { left: 0, top: 0, width: viewportWidth, height: padded.top },
    left: { left: 0, top: padded.top, width: padded.left, height: padded.height },
    right: {
      left: padded.left + padded.width,
      top: padded.top,
      width: Math.max(0, viewportWidth - (padded.left + padded.width)),
      height: padded.height,
    },
    bottom: {
      left: 0,
      top: padded.top + padded.height,
      width: viewportWidth,
      height: Math.max(0, viewportHeight - (padded.top + padded.height)),
    },
  };

  return createPortal(
    <div className="walkthrough-layer" role="dialog" aria-modal="true" aria-label="Bracket walkthrough">
      <div className="walkthrough-shade walkthrough-shade--top" style={shadeStyles.top} />
      <div className="walkthrough-shade walkthrough-shade--left" style={shadeStyles.left} />
      <div className="walkthrough-shade walkthrough-shade--right" style={shadeStyles.right} />
      <div className="walkthrough-shade walkthrough-shade--bottom" style={shadeStyles.bottom} />
      <div
        className="walkthrough-cutout"
        style={{
          top: `${padded.top}px`,
          left: `${padded.left}px`,
          width: `${padded.width}px`,
          height: `${padded.height}px`,
        }}
      />
      <div className={`walkthrough-tooltip placement-${placement}`} ref={tooltipRef} style={tooltipStyle}>
        <p className="walkthrough-step-label">STEP {stepIndex + 1} OF {WALKTHROUGH_STEPS.length}</p>
        <h3>{step.heading}</h3>
        <p>{step.body}</p>
        <div className="walkthrough-dots" aria-hidden="true">
          {WALKTHROUGH_STEPS.map((_, i) => (
            <span key={i} className={i === stepIndex ? "active" : ""} />
          ))}
        </div>
        <div className="walkthrough-actions">
          <button type="button" className="walkthrough-cta-btn" ref={ctaRef} onClick={onAdvance}>
            {buttonLabel}
          </button>
          {step.allowSkip ? (
            <button type="button" className="walkthrough-skip-link" onClick={onSkip}>
              Skip walkthrough
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

function ContextualHint({ message, rect, onDismiss }: { message: string; rect: DOMRect; onDismiss: () => void }) {
  useEffect(() => {
    const handler = () => onDismiss();
    document.addEventListener("click", handler, { once: true });
    return () => document.removeEventListener("click", handler);
  }, [onDismiss]);

  const style: React.CSSProperties = {
    top: Math.min(window.innerHeight - 100, rect.bottom + 8),
    left: Math.max(8, Math.min(window.innerWidth - 360, rect.left)),
  };

  return createPortal(
    <div className="contextual-hint" style={style}>
      {message}
    </div>,
    document.body
  );
}

export default App;
