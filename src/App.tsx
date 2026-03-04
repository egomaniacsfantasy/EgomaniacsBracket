import { Fragment, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import html2canvas from "html2canvas";
import "./index.css";
import { teamsById } from "./data/teams";
import { BRACKET_HALVES, gameTemplates, regionRounds } from "./data/bracket";
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
import { formatOddsDisplay, toAmericanOdds, toImpliedLabel, toOneInX } from "./lib/odds";
import {
  generateSimulatedBracket,
  generateSimulatedBracketSteps,
  getChaosScorePercentileForPickedGames,
  hashLocks,
  runSimulation,
} from "./lib/simulation";
import { fallbackLogo, teamLogoUrl } from "./lib/logo";
import { fullTeamName } from "./lib/teamNames";
import { trackEvent } from "./lib/analytics";
import { useAuth } from "./AuthContext";
import { AuthModal } from "./AuthModal";
import { MyBracketsModal } from "./MyBracketsModal";
import { LeaderboardFullWidth } from "./Leaderboard";
import { deserializePicks, getUserBrackets, saveBracket, serializePicks, type SavedBracket } from "./bracketStorage";
import { TEAM_STAT_IMPORTANCE, TEAM_STAT_ORDER, TEAM_STATS_2026, type TeamStatKey } from "./data/teamStats2026";
import type { OddsDisplayMode, Region, ResolvedGame, SimulationOutput } from "./types";

const DEFAULT_SIM_RUNS = 5000;
const CHAOS_DISTRIBUTION_SIM_RUNS = 10000;
const ONBOARDING_STORAGE_KEY = "oddsGods_onboardingDismissed";
const HINTS_STORAGE_KEY = "oddsGods_hintsShown";
const FIRST_PICK_NUDGE_SESSION_KEY = "oddsGods_firstPickCascadeNudgeSeen";
const PROMO_DISMISSED_KEY = "bracketlab-promo-dismissed";
const DESKTOP_FIRST_SEEN_KEY = "bracketlab-desktop-first-seen";
const ODDS_FORMAT_STORAGE_KEY = "bracketlab-odds-format";
const STAGGERED_SIM_DELAY_MS = 2000;
const MIN_STAGGERED_SIM_DELAY_MS = 1000;
const MAX_STAGGERED_SIM_DELAY_MS = 5000;
const LANDING_URL = "https://oddsgods.net";

const regionSections: Region[][] = BRACKET_HALVES.map((half) => [...half.regions]);
const mobileRegionOrder: Region[] = ["East", "West", "Midwest", "South"];
const invertedRegions = new Set<Region>([regionSections[0][1], regionSections[1][1]]);

const gameRoundLabel: Record<string, string> = {
  FF: "First Four",
  R64: "Round of 64",
  R32: "Round of 32",
  S16: "Sweet 16",
  E8: "Elite 8",
  F4: "Final Four",
  CHAMP: "Championship",
};

const MOBILE_ROUND_ORDER: Record<"FF" | "R64" | "R32" | "S16" | "E8", number> = {
  FF: 0,
  R64: 1,
  R32: 2,
  S16: 3,
  E8: 4,
};

const URL_REGION_ORDER: Region[] = ["South", "West", "East", "Midwest"];
const URL_ROUND_ORDER: ResolvedGame["round"][] = ["FF", "R64", "R32", "S16", "E8", "F4", "CHAMP"];
const URL_EXPECTED_GAME_COUNT = gameTemplates.length;
const URL_EXPECTED_BITS = URL_EXPECTED_GAME_COUNT * 2;

const getRecommendedSimRuns = (): number => {
  if (typeof window === "undefined") return DEFAULT_SIM_RUNS;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  const isMobileViewport = window.matchMedia("(max-width: 767px)").matches;

  if (isMobileViewport || memory <= 4 || cores <= 4) return 1500;
  if (memory <= 8 || cores <= 8) return 2500;
  return DEFAULT_SIM_RUNS;
};

const canonicalGameTemplates = (() => {
  const regional: typeof gameTemplates = [];
  for (const region of URL_REGION_ORDER) {
    for (const round of ["FF", "R64", "R32", "S16", "E8"] as const) {
      regional.push(
        ...gameTemplates
          .filter((game) => game.region === region && game.round === round)
          .sort((a, b) => a.slot - b.slot)
      );
    }
  }

  const finalFour = gameTemplates.filter((game) => game.round === "F4").sort((a, b) => a.slot - b.slot);
  const championship = gameTemplates.filter((game) => game.round === "CHAMP").sort((a, b) => a.slot - b.slot);
  return [...regional, ...finalFour, ...championship];
})();

const canonicalGameIds = canonicalGameTemplates.map((game) => game.id);
const canonicalTemplateById = new Map(canonicalGameTemplates.map((game) => [game.id, game]));

function bitsToBase64Url(bitString: string): string {
  const padded = bitString.padEnd(Math.ceil(bitString.length / 8) * 8, "0");
  const bytes: number[] = [];

  for (let i = 0; i < padded.length; i += 8) {
    bytes.push(Number.parseInt(padded.slice(i, i + 8), 2));
  }

  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBits(encoded: string): string {
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";

  const decoded = atob(base64);
  let bits = "";
  for (let i = 0; i < decoded.length; i += 1) {
    bits += decoded.charCodeAt(i).toString(2).padStart(8, "0");
  }

  return bits;
}

function encodeBracketState(locks: LockedPicks): string {
  let pickedBits = "";
  let winnerBits = "";

  const { games } = resolveGames(locks);
  const gameById = new Map(games.map((game) => [game.id, game]));

  for (const gameId of canonicalGameIds) {
    const game = gameById.get(gameId);
    if (!game || !game.winnerId || !game.teamAId || !game.teamBId) {
      pickedBits += "0";
      winnerBits += "0";
      continue;
    }

    pickedBits += "1";
    winnerBits += game.winnerId === game.teamAId ? "0" : "1";
  }

  return bitsToBase64Url(pickedBits + winnerBits);
}

function decodeBracketState(hash: string): LockedPicks | null {
  if (!hash) return null;

  let bits: string;
  try {
    bits = base64UrlToBits(hash);
  } catch {
    return null;
  }

  if (bits.length < URL_EXPECTED_BITS || canonicalGameIds.length !== URL_EXPECTED_GAME_COUNT) return null;

  const pickedBits = bits.slice(0, URL_EXPECTED_GAME_COUNT);
  const winnerBits = bits.slice(URL_EXPECTED_GAME_COUNT, URL_EXPECTED_GAME_COUNT * 2);

  const decodedByGame = new Map<string, "A" | "B">();
  for (let i = 0; i < canonicalGameIds.length; i += 1) {
    if (pickedBits[i] !== "1") continue;
    decodedByGame.set(canonicalGameIds[i], winnerBits[i] === "1" ? "B" : "A");
  }

  const nextLocks: LockedPicks = {};
  for (const round of URL_ROUND_ORDER) {
    const roundGames = canonicalGameIds.filter((gameId) => canonicalTemplateById.get(gameId)?.round === round);
    for (const gameId of roundGames) {
      const side = decodedByGame.get(gameId);
      if (!side) continue;

      const resolvedGame = resolveGames(nextLocks).games.find((game) => game.id === gameId);
      if (!resolvedGame || !resolvedGame.teamAId || !resolvedGame.teamBId) return null;
      nextLocks[gameId] = side === "A" ? resolvedGame.teamAId : resolvedGame.teamBId;
    }
  }

  return sanitizeLockedPicks(nextLocks);
}

type ProbabilityPopupState = {
  gameId: string;
  anchorEl: HTMLElement;
  savedProbA: number | null;
};

type MobileTab = "bracket" | "futures" | "leaderboard";
type MobileSection = Region | "FF";
type MobileRegionRound = "FF" | "R64" | "R32" | "S16" | "E8";
type MobileFfRound = "F4" | "CHAMP" | "WIN";
type CandidateRow = { teamId: string; prob: number; team: NonNullable<ReturnType<typeof teamsById.get>> };
const MAJOR_SHIFT_NUDGE_COOLDOWN = 3;
type WalkthroughStepId = "hook" | "upset-pick" | "bracket-ripple" | "futures-panel" | "ready";
type WalkthroughStepAdvance = "pick-detected" | "button-click";
type TooltipPlacement = "above" | "below" | "left" | "right" | "bottom-sheet";
type HintKey = "undo" | "sim" | "toggle" | "r32";
type HintsShown = Record<HintKey, boolean>;
type ActiveHint = {
  key: HintKey;
  message: string;
  rect: DOMRect;
};
type ResetModalConfig = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
};
type RegionalRound = "FF" | "R64" | "R32" | "S16" | "E8";
type ManualRoundExpansionState = Partial<Record<`${Region}-${RegionalRound}`, boolean>>;
type WalkthroughStepConfig = {
  id: WalkthroughStepId;
  heading: string;
  body: string;
  ctaText: string;
  advanceOn: WalkthroughStepAdvance;
  allowSkip: boolean;
  centered?: boolean;
};

type ShareFinalFourTeam = {
  id: string;
  seed: string;
  name: string;
  logoUrl: string;
  champProbLabel: string;
  isChampion: boolean;
};

type ShareChampionTeam = {
  id: string;
  seed: string;
  name: string;
  logoUrl: string;
  champProbLabel: string;
  baselineProb: number | null;
  flavor: string;
};

type ShareBoldPick = {
  winnerSeed: string;
  winnerName: string;
  loserSeed: string;
  loserName: string;
  winProbPct: number;
};

type ShareCardData = {
  champion: ShareChampionTeam | null;
  f4Teams: ShareFinalFourTeam[];
  boldestPicks: ShareBoldPick[];
  totalPicks: number;
  chaosScore: number;
  chaosLabel: string;
  chaosEmoji: string;
  bracketLikelihood: string | null;
};

type ShareFormat = "story" | "twitter";

type CompletionCelebrationData = {
  championName: string;
  chaosLabel: string;
  chaosEmoji: string;
};

function computeGameChaos(prob: number): number {
  const clamped = Math.max(prob, 1e-12);
  return -Math.log(clamped);
}

function computeChaosScoreFromGames(games: ResolvedGame[]): number | null {
  const decided = games.filter((game) => Boolean(game.winnerId && game.teamAId && game.teamBId));
  if (decided.length === 0) return null;
  let total = 0;
  for (const game of decided) {
    const teamAId = game.teamAId as string;
    const winnerId = game.winnerId as string;
    const modelProbA = getModelGameWinProb(game, teamAId);
    if (modelProbA === null) continue;
    const winnerProb = winnerId === teamAId ? modelProbA : 1 - modelProbA;
    total += computeGameChaos(winnerProb);
  }
  return total;
}

function getPickedChaosGameIds(games: ResolvedGame[]): string[] {
  return games
    .filter((game) => Boolean(game.id && game.winnerId && game.teamAId && game.teamBId))
    .filter((game) => {
      const modelProbA = getModelGameWinProb(game, game.teamAId as string);
      return modelProbA !== null;
    })
    .map((game) => game.id);
}

function getChaosLabel(score: number | null, decidedCount: number): { label: string; emoji: string } | null {
  if (score === null || decidedCount === 0) return null;
  const perGame = score / decidedCount;
  if (perGame < 0.2) return { label: "Chalk", emoji: "📋" };
  if (perGame < 0.35) return { label: "Mild Chalk", emoji: "📊" };
  if (perGame < 0.55) return { label: "Balanced", emoji: "⚖️" };
  if (perGame < 0.8) return { label: "Upset Heavy", emoji: "🔥" };
  return { label: "Chaos Agent", emoji: "🌪️" };
}

function getChaosColor(score: number | null, decidedCount: number): string {
  if (score === null || decidedCount === 0) return "rgba(184,125,24,0.85)";
  const perGame = score / decidedCount;
  if (perGame < 0.2) return "rgba(76,175,80,0.85)";
  if (perGame < 0.55) return "rgba(184,125,24,0.85)";
  if (perGame < 0.8) return "rgba(220,120,50,0.85)";
  return "rgba(239,83,80,0.85)";
}

function getChampionFlavor(baselineProb: number | null): string {
  if (baselineProb === null) return "Finish your bracket to crown a champion.";
  const pct = baselineProb * 100;
  if (pct < 5) return "Cinderella story";
  if (pct < 15) return "Against all odds";
  if (pct < 30) return "Bold call";
  if (pct < 50) return "Strong conviction";
  return "Chalk champion";
}

const DEFAULT_HINTS_SHOWN: HintsShown = {
  undo: false,
  sim: false,
  toggle: false,
  r32: false,
};

const ONBOARDING_UPSET_REGION: Region = "South";
const ONBOARDING_UPSET_WINNER = "Merrimack";
const ONBOARDING_UPSET_LOSER = "Florida";

const WALKTHROUGH_STEPS: WalkthroughStepConfig[] = [
  {
    id: "hook",
    heading: "Every pick changes everything.",
    body: "This isn't a regular bracket tool. Every outcome you choose reprices the entire tournament - every round, every contender, all the way to the championship.",
    ctaText: "Show me →",
    advanceOn: "button-click",
    allowSkip: true,
    centered: true,
  },
  {
    id: "upset-pick",
    heading: "Pick the upset.",
    body: "Tap #15 Merrimack to knock off #2 Florida. Then watch what happens to every team in the South.",
    ctaText: "Pick a team",
    advanceOn: "button-click",
    allowSkip: true,
  },
  {
    id: "bracket-ripple",
    heading: "Every pick does this.",
    body: "You just saw one upset reshape an entire region. Now imagine 63 picks — each one sending ripples across the whole tournament. That's what Bracket Lab shows you.",
    ctaText: "Got it →",
    advanceOn: "button-click",
    allowSkip: true,
  },
  {
    id: "futures-panel",
    heading: "Meet the Futures panel.",
    body: "This tracks every team's championship path - round by round, updated live as you pick.",
    ctaText: "Got it →",
    advanceOn: "button-click",
    allowSkip: true,
  },
  {
    id: "ready",
    heading: "Your bracket. Your scenario.",
    body: "Start picking. Every game you decide reprices every round downstream.",
    ctaText: "Start building →",
    advanceOn: "button-click",
    allowSkip: false,
    centered: true,
  },
];

const FUTURES_METRIC_KEYS = ["R32", "S16", "E8", "F4", "Title", "Champ"] as const;
type FuturesMetricKey = (typeof FUTURES_METRIC_KEYS)[number];

const getMetricProb = (row: SimulationOutput["futures"][number], metric: FuturesMetricKey): number => {
  if (metric === "R32") return row.round2Prob;
  if (metric === "S16") return row.sweet16Prob;
  if (metric === "E8") return row.elite8Prob;
  if (metric === "F4") return row.final4Prob;
  if (metric === "Title") return row.titleGameProb;
  return row.champProb;
};

const computeDelta = (conditionedProb: number, baselineProb: number, displayMode: OddsDisplayMode): number => {
  if (displayMode === "implied") {
    return (conditionedProb - baselineProb) * 100;
  }
  const conditionedAmerican = toAmericanOdds(conditionedProb);
  const baselineAmerican = toAmericanOdds(baselineProb);
  return baselineAmerican - conditionedAmerican;
};

const hasMeaningfulDelta = (delta: number, displayMode: OddsDisplayMode): boolean =>
  displayMode === "implied" ? Math.abs(delta) >= 0.1 : Math.abs(delta) >= 1;

const formatDelta = (delta: number, displayMode: OddsDisplayMode): string => {
  if (displayMode === "implied") {
    const sign = delta > 0 ? "+" : "";
    return `${sign}${delta.toFixed(1)}%`;
  }
  const rounded = Math.round(delta);
  if (Math.abs(rounded) > 50000) return rounded > 0 ? "MAX" : "-MAX";
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}`;
};

const findOnboardingUpsetMatchupId = (games: ResolvedGame[]): string => {
  const byNames = games.find((game) => {
    if (game.round !== "R64" || game.region !== ONBOARDING_UPSET_REGION || !game.teamAId || !game.teamBId) return false;
    const teamA = teamsById.get(game.teamAId);
    const teamB = teamsById.get(game.teamBId);
    if (!teamA || !teamB) return false;
    const names = new Set([teamA.name, teamB.name]);
    return names.has(ONBOARDING_UPSET_WINNER) && names.has(ONBOARDING_UPSET_LOSER);
  });
  if (byNames) return byNames.id;
  const bySeed = games.find((game) => {
    if (game.round !== "R64" || game.region !== ONBOARDING_UPSET_REGION || !game.teamAId || !game.teamBId) return false;
    const teamA = teamsById.get(game.teamAId);
    const teamB = teamsById.get(game.teamBId);
    if (!teamA || !teamB) return false;
    const seeds = new Set([teamA.seedLabel, teamB.seedLabel]);
    return seeds.has("15") && seeds.has("2");
  });
  return bySeed?.id ?? "South-R64-2";
};

const ROUND_TO_DATA_ATTR: Record<"R32" | "S16" | "E8", string> = {
  R32: "32",
  S16: "16",
  E8: "8",
};

const getOnboardingPathByRound = (startGameId: string | null): Record<"R32" | "S16" | "E8", Set<string>> => {
  const path: Record<"R32" | "S16" | "E8", Set<string>> = {
    R32: new Set<string>(),
    S16: new Set<string>(),
    E8: new Set<string>(),
  };
  if (!startGameId) return path;
  let currentIds = [startGameId];
  const rounds: Array<"R32" | "S16" | "E8"> = ["R32", "S16", "E8"];
  for (const round of rounds) {
    const next = gameTemplates.find(
      (tmpl) =>
        tmpl.region === ONBOARDING_UPSET_REGION &&
        tmpl.round === round &&
        Boolean(tmpl.sourceGameIds?.some((sourceId) => sourceId && currentIds.includes(sourceId)))
    );
    if (!next) break;
    path[round].add(next.id);
    currentIds = [next.id];
  }
  return path;
};

function App() {
  const { user, profile, isAuthenticated, signOut, loading: authLoading } = useAuth();
  const [lockedPicks, setLockedPicks] = useState<LockedPicks>({});
  const [customProbByGame, setCustomProbByGame] = useState<CustomProbByGame>({});
  const [undoStack, setUndoStack] = useState<LockedPicks[]>([]);
  const [displayMode, setDisplayMode] = useState<OddsDisplayMode>(() => {
    if (typeof window === "undefined") return "implied";
    const saved = window.localStorage.getItem(ODDS_FORMAT_STORAGE_KEY);
    return saved === "american" || saved === "implied" ? saved : "implied";
  });
  const [simRuns] = useState<number>(() => getRecommendedSimRuns());
  const [futuresFieldExpanded, setFuturesFieldExpanded] = useState(false);
  const [futuresEliminatedExpanded, setFuturesEliminatedExpanded] = useState(false);
  const [mainView, setMainView] = useState<"bracket" | "futures" | "leaderboard">("bracket");
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastPickedKey, setLastPickedKey] = useState<string | null>(null);
  const [compactDesktop, setCompactDesktop] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>("bracket");
  const [mobileSection, setMobileSection] = useState<MobileSection>("South");
  const [mobileRound, setMobileRound] = useState<MobileRegionRound>("FF");
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
  const [majorShiftTargetRound, setMajorShiftTargetRound] = useState<MobileRegionRound>("R64");
  const [staggeredSimRunning, setStaggeredSimRunning] = useState(false);
  const [staggeredSimPaused, setStaggeredSimPaused] = useState(false);
  const [staggeredSimDelayMs, setStaggeredSimDelayMs] = useState(STAGGERED_SIM_DELAY_MS);
  const [welcomeGateOpen, setWelcomeGateOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "true";
  });
  const [showDesktopFirst, setShowDesktopFirst] = useState(false);
  const [walkthroughActive, setWalkthroughActive] = useState(false);
  const [walkthroughStep, setWalkthroughStep] = useState(0);
  const [walkthroughTargetEl, setWalkthroughTargetEl] = useState<HTMLElement | null>(null);
  const [walkthroughTargetRect, setWalkthroughTargetRect] = useState<DOMRect | null>(null);
  const [tooltipPlacement, setTooltipPlacement] = useState<TooltipPlacement>("below");
  const [walkthroughMatchupId, setWalkthroughMatchupId] = useState<string | null>(null);
  const [walkthroughCascadePhase, setWalkthroughCascadePhase] = useState<"idle" | "pick" | "animating" | "done">("idle");
  const [walkthroughCascadeSpotlightRound, setWalkthroughCascadeSpotlightRound] = useState<"R32" | "S16" | "E8" | null>(null);
  const [walkthroughCascadeCaption, setWalkthroughCascadeCaption] = useState<string | null>(null);
  const [walkthroughCascadePathByRound, setWalkthroughCascadePathByRound] = useState<Record<"R32" | "S16" | "E8", Set<string>>>({
    R32: new Set(),
    S16: new Set(),
    E8: new Set(),
  });
  const [walkthroughChangedGameIds, setWalkthroughChangedGameIds] = useState<Set<string>>(new Set());
  const [walkthroughDontShowAgain, setWalkthroughDontShowAgain] = useState(true);
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
  const [resetModalConfig, setResetModalConfig] = useState<ResetModalConfig | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [saveStatus, setSaveStatus] = useState<null | "saving" | "saved" | "error">(null);
  const [saveErrorText, setSaveErrorText] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [myBracketsOpen, setMyBracketsOpen] = useState(false);
  const [userBrackets, setUserBrackets] = useState<SavedBracket[]>([]);
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  const [promoCTAVisible, setPromoCTAVisible] = useState(false);
  const [promoShown, setPromoShown] = useState(false);
  const [manuallyExpandedRounds, setManuallyExpandedRounds] = useState<ManualRoundExpansionState>({});
  const [topHalfManuallyExpanded, setTopHalfManuallyExpanded] = useState(false);
  const [bottomHalfManuallyExpanded, setBottomHalfManuallyExpanded] = useState(false);
  const [shareToastVisible, setShareToastVisible] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [shareExporting, setShareExporting] = useState<ShareFormat | null>(null);
  const [chaosScoreChanged, setChaosScoreChanged] = useState(false);
  const [showChaosModal, setShowChaosModal] = useState(false);
  const [showCompletionCelebration, setShowCompletionCelebration] = useState(false);
  const [completionCelebrationData, setCompletionCelebrationData] = useState<CompletionCelebrationData | null>(null);
  const [statsModalGameId, setStatsModalGameId] = useState<string | null>(null);
  const [showFirstFourModal, setShowFirstFourModal] = useState(false);
  const [staggeredChaosTotal, setStaggeredChaosTotal] = useState(0);
  const [staggeredLastGameChaos, setStaggeredLastGameChaos] = useState<number | null>(null);
  const [staggeredLastGameLabel, setStaggeredLastGameLabel] = useState("");
  const [staggeredGamesResolved, setStaggeredGamesResolved] = useState(0);
  const [staggeredTotalGames, setStaggeredTotalGames] = useState(URL_EXPECTED_GAME_COUNT);
  const [probPopup, setProbPopup] = useState<ProbabilityPopupState | null>(null);
  const [simResult, setSimResult] = useState<SimulationOutput>({
    futures: [],
    gameWinProbs: {},
    likelihoodApprox: 0,
    likelihoodSimulation: 0,
  });
  const [chaosDistribution, setChaosDistribution] = useState<SimulationOutput["chaosDistribution"] | null>(null);

  const simulationCacheRef = useRef<Map<string, SimulationOutput>>(new Map());
  const previousFuturesRef = useRef<SimulationOutput["futures"] | null>(null);
  const previousGameWinProbsRef = useRef<SimulationOutput["gameWinProbs"] | null>(null);
  const mobileFlashTimeoutRef = useRef<number | null>(null);
  const mobileDeltaTimeoutRef = useRef<number | null>(null);
  const firstPickNudgeTimeoutRef = useRef<number | null>(null);
  const pendingPickMetaRef = useRef<{ isFirstPick: boolean; section: MobileSection; round: MobileRegionRound | null } | null>(null);
  const pendingMajorShiftTargetRef = useRef<MobileRegionRound>("R64");
  const picksSinceLastNudgeRef = useRef(0);
  const staggeredTimeoutRef = useRef<number | null>(null);
  const staggeredStepsRef = useRef<Array<{ gameId: string; winnerId: string }>>([]);
  const staggeredIndexRef = useRef(0);
  const staggeredDelayRef = useRef(STAGGERED_SIM_DELAY_MS);
  const simGeneratedGameIdsRef = useRef<Set<string>>(new Set());
  const walkthroughAdvanceTimerRef = useRef<number | null>(null);
  const walkthroughResolveTokenRef = useRef(0);
  const contextualHintTimerRef = useRef<number | null>(null);
  const copyLinkTimerRef = useRef<number | null>(null);
  const saveStatusTimerRef = useRef<number | null>(null);
  const promoCTATimerRef = useRef<number | null>(null);
  const firstFourAutoShownRef = useRef(false);
  const shareToastTimerRef = useRef<number | null>(null);
  const shareStoryRef = useRef<HTMLDivElement | null>(null);
  const shareTwitterRef = useRef<HTMLDivElement | null>(null);
  const suppressHashSyncRef = useRef(true);
  const chaosScoreTimerRef = useRef<number | null>(null);
  const previousChaosScoreRef = useRef<number | null>(null);
  const chaosScoreSourceRef = useRef<"manual" | "staggered_sim" | "instant_sim">("manual");
  const previousStaggeredRunningRef = useRef(false);
  const previousTopHalfCollapsedRef = useRef(false);
  const previousBottomHalfCollapsedRef = useRef(false);
  const previousTopHalfCompleteRef = useRef(false);
  const previousBottomHalfCompleteRef = useRef(false);
  const walkthroughBeforeTeamOddsRef = useRef<Map<string, Map<string, number>>>(new Map());
  const walkthroughCascadeTimerRef = useRef<number | null>(null);
  const walkthroughCascadeStepTimersRef = useRef<number[]>([]);

  const { games, sanitized } = useMemo(
    () => resolveGames(lockedPicks, customProbByGame),
    [lockedPicks, customProbByGame]
  );
  const possibleWinners = useMemo(() => possibleWinnersByGame(sanitized), [sanitized]);
  const walkthroughMatchup = useMemo(
    () => (walkthroughMatchupId ? games.find((game) => game.id === walkthroughMatchupId) ?? null : null),
    [games, walkthroughMatchupId]
  );

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
    if (typeof window === "undefined") return;
    if (!isMobile) {
      setShowDesktopFirst(false);
      setWelcomeGateOpen(window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "true");
      return;
    }

    // Mobile now uses the same 5-step walkthrough after the desktop-first gate.
    setWelcomeGateOpen(window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "true");
    setWalkthroughActive(false);
    const desktopFirstSeen = window.localStorage.getItem(DESKTOP_FIRST_SEEN_KEY) === "1";
    setShowDesktopFirst(!desktopFirstSeen);
  }, [isMobile]);

  useEffect(() => {
    if (!hasSeenFirstPickNudge || typeof window === "undefined") return;
    window.sessionStorage.setItem(FIRST_PICK_NUDGE_SESSION_KEY, "1");
  }, [hasSeenFirstPickNudge]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(HINTS_STORAGE_KEY, JSON.stringify(hintsShown));
  }, [hintsShown]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ODDS_FORMAT_STORAGE_KEY, displayMode);
  }, [displayMode]);

  const refreshUserBrackets = async () => {
    if (!user) {
      setUserBrackets([]);
      return;
    }
    const { data } = await getUserBrackets(user.id);
    setUserBrackets(data);
  };

  useEffect(() => {
    refreshUserBrackets();
  }, [user]);

  useEffect(() => {
    if (isAuthenticated) setAuthModalOpen(false);
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && promoCTAVisible) setPromoCTAVisible(false);
  }, [isAuthenticated, promoCTAVisible]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const rawHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    if (!rawHash) {
      suppressHashSyncRef.current = false;
      return;
    }

    const decoded = decodeBracketState(rawHash);
    if (!decoded) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      suppressHashSyncRef.current = false;
      return;
    }

    setLockedPicks(decoded);
    trackEvent("shared_bracket_loaded", {
      total_picks: Object.keys(decoded).length,
    });
    suppressHashSyncRef.current = false;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || suppressHashSyncRef.current) return;
    if (Object.keys(sanitized).length === 0) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      return;
    }

    const encoded = encodeBracketState(sanitized);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${encoded}`);
  }, [sanitized]);

  useEffect(() => {
    if (isMobile) return;
    if (mainView !== "futures") return;
    trackEvent("futures_opened", {
      source: "desktop",
    });
  }, [isMobile, mainView]);

  const clearOnboardingVisualArtifacts = useCallback(() => {
    document
      .querySelectorAll<HTMLElement>('.eg-region-card.bracket-region h2')
      .forEach((heading) => {
        const regionName = heading.textContent?.trim().toLowerCase();
        if (regionName !== ONBOARDING_UPSET_REGION.toLowerCase()) return;
        const regionCard = heading.closest<HTMLElement>(".eg-region-card.bracket-region");
        if (!regionCard) return;
        regionCard.querySelectorAll<HTMLElement>(".eg-game-card[data-game-id]").forEach((gameEl) => {
          const gameId = gameEl.getAttribute("data-game-id");
          if (!gameId) return;
          const rows = simResult.gameWinProbs[gameId] ?? [];
          const probByTeam = new Map(rows.map((row) => [row.teamId, row.prob]));
          gameEl.querySelectorAll<HTMLElement>(".odds-value[data-team-id]").forEach((oddsEl) => {
            const teamId = oddsEl.dataset.teamId ?? "";
            const prob = probByTeam.get(teamId);
            if (prob === undefined) return;
            oddsEl.textContent = formatOddsDisplay(prob, displayMode).primary;
          });
        });
      });

    document.querySelectorAll<HTMLElement>(".team-row--fading-out, .team-row--removed").forEach((el) => {
      el.classList.remove("team-row--fading-out", "team-row--removed", "cascade-row-dimmed");
      el.style.display = "";
      el.style.opacity = "";
      el.style.maxHeight = "";
      el.style.paddingTop = "";
      el.style.paddingBottom = "";
      el.style.marginTop = "";
      el.style.marginBottom = "";
      el.style.removeProperty("--florida-fade-duration");
    });
    document.querySelectorAll<HTMLElement>(".eg-round-col").forEach((el) => {
      el.classList.remove("cascade-spotlight", "cascade-dimmed", "cascade-dimmed-soft", "cascade-r64-muted");
      el.style.opacity = "";
    });
    document.querySelectorAll<HTMLElement>(".eg-region-card").forEach((el) => {
      el.classList.remove("cascade-region-dimmed");
      el.style.opacity = "";
    });
    document.querySelectorAll<HTMLElement>(".eg-game-node").forEach((el) => {
      el.classList.remove("cascade-nonpath-dim");
      el.style.opacity = "";
    });
    document.querySelectorAll<HTMLElement>(".odds-value").forEach((el) => {
      el.classList.remove("odds-cascading", "odds-settled", "team-odds--flash-green", "team-odds--flash-red");
    });
    // Reset overflow-x on scroll containers (set to auto during cascade scrolling)
    document.querySelectorAll<HTMLElement>(".eg-region-scroll").forEach((el) => {
      el.style.overflowX = "";
    });
  }, [displayMode, simResult.gameWinProbs]);

  const resetUpsetStepState = useCallback(() => {
    applyLockedPicksUpdate(resetRegionPicks(lockedPicks, ONBOARDING_UPSET_REGION));
    walkthroughCascadeStepTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    walkthroughCascadeStepTimersRef.current = [];
    if (walkthroughCascadeTimerRef.current !== null) {
      window.clearTimeout(walkthroughCascadeTimerRef.current);
      walkthroughCascadeTimerRef.current = null;
    }
    clearOnboardingVisualArtifacts();
    setWalkthroughCascadeSpotlightRound(null);
    setWalkthroughCascadeCaption(null);
    setWalkthroughChangedGameIds(new Set());
    setWalkthroughCascadePhase("pick");
  }, [clearOnboardingVisualArtifacts, lockedPicks]);

  const closeWalkthrough = () => {
    if (walkthroughAdvanceTimerRef.current !== null) {
      window.clearTimeout(walkthroughAdvanceTimerRef.current);
      walkthroughAdvanceTimerRef.current = null;
    }
    if (walkthroughCascadeTimerRef.current !== null) {
      window.clearTimeout(walkthroughCascadeTimerRef.current);
      walkthroughCascadeTimerRef.current = null;
    }
    walkthroughCascadeStepTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    walkthroughCascadeStepTimersRef.current = [];
    clearOnboardingVisualArtifacts();
    setWalkthroughActive(false);
    setWalkthroughStep(0);
    setWalkthroughTargetEl(null);
    setWalkthroughTargetRect(null);
    setWalkthroughMatchupId(null);
    setWalkthroughCascadePhase("idle");
    setWalkthroughCascadeSpotlightRound(null);
    setWalkthroughCascadeCaption(null);
    setWalkthroughCascadePathByRound({ R32: new Set(), S16: new Set(), E8: new Set() });
    setWalkthroughChangedGameIds(new Set());
    document.querySelectorAll(".futures-row--onboarding-highlight").forEach((el) => {
      el.classList.remove("futures-row--onboarding-highlight");
    });
    if (walkthroughDontShowAgain) {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    } else {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "false");
    }
    setWelcomeGateOpen(false);
  };

  const maybeShowPromoCTA = () => {
    if (typeof window === "undefined") return;
    if (authLoading || isAuthenticated || promoShown) return;
    if (window.localStorage.getItem(PROMO_DISMISSED_KEY)) return;
    if (promoCTATimerRef.current !== null) window.clearTimeout(promoCTATimerRef.current);
    promoCTATimerRef.current = window.setTimeout(() => {
      setPromoCTAVisible(true);
      setPromoShown(true);
      promoCTATimerRef.current = null;
    }, 800);
  };

  const handlePromoDismiss = () => {
    setPromoCTAVisible(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PROMO_DISMISSED_KEY, "1");
    }
  };

  const handlePromoSignUp = () => {
    setPromoCTAVisible(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PROMO_DISMISSED_KEY, "1");
    }
    setAuthModalOpen(true);
  };

  const completeWalkthrough = () => {
    trackEvent("onboarding_completed");
    closeWalkthrough();
    maybeShowPromoCTA();
  };

  const skipWalkthrough = () => {
    trackEvent("onboarding_skipped", {
      skipped_at_step: walkthroughStep + 1,
    });
    closeWalkthrough();
    maybeShowPromoCTA();
  };

  const startWalkthrough = (opts?: { replay?: boolean }) => {
    trackEvent("onboarding_started", {
      replay: Boolean(opts?.replay),
    });
    const targetMatchupId = findOnboardingUpsetMatchupId(games);
    if (opts?.replay) {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "false");
      setHintsShown(DEFAULT_HINTS_SHOWN);
      // Replay keeps the bracket state, but resets the Step 1 matchup only.
      if (targetMatchupId && lockedPicks[targetMatchupId]) {
        const nextLocks = { ...lockedPicks };
        delete nextLocks[targetMatchupId];
        applyLockedPicksUpdate(nextLocks);
      }
      setMainView("bracket");
      window.scrollTo({ top: 0, behavior: "smooth" });
      window.setTimeout(() => {
        setWelcomeGateOpen(false);
        setWalkthroughStep(0);
        setWalkthroughTargetEl(null);
        setWalkthroughTargetRect(null);
        setWalkthroughMatchupId(targetMatchupId);
        setWalkthroughCascadePhase("pick");
        setWalkthroughCascadeSpotlightRound(null);
        setWalkthroughCascadeCaption(null);
        setWalkthroughCascadePathByRound(getOnboardingPathByRound(targetMatchupId));
        setWalkthroughDontShowAgain(true);
        setWalkthroughChangedGameIds(new Set());
        setWalkthroughActive(true);
      }, 0);
      return;
    }
    setWelcomeGateOpen(false);
    setWalkthroughStep(0);
    setWalkthroughTargetEl(null);
    setWalkthroughTargetRect(null);
    setWalkthroughMatchupId(targetMatchupId);
    setWalkthroughCascadePhase("pick");
    setWalkthroughCascadeSpotlightRound(null);
    setWalkthroughCascadeCaption(null);
    setWalkthroughCascadePathByRound(getOnboardingPathByRound(targetMatchupId));
    setWalkthroughDontShowAgain(true);
    setWalkthroughChangedGameIds(new Set());
    walkthroughBeforeTeamOddsRef.current = new Map();
    setWalkthroughActive(true);
  };

  const handleDismissDesktopFirst = () => {
    setShowDesktopFirst(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DESKTOP_FIRST_SEEN_KEY, "1");
    }
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
    let statPoints: Array<{ x: number; y: number; label: string }> = [];
    let lastHeavyDrawAt = 0;
    const heavyFrameIntervalMs = 1000 / 24;

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

      statPoints = [];
      for (let y = 28; y < height; y += 52) {
        for (let x = 18; x < width; x += 94) {
          statPoints.push({
            x,
            y,
            label: `${randomInt(10, 99)}.${randomInt(0, 9)}%`,
          });
        }
      }
    };

    const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
    const randomFloat = (min: number, max: number) => Math.random() * (max - min) + min;

    const drawStatsLayer = (time: number) => {
      statCtx.clearRect(0, 0, width, height);
      statCtx.globalAlpha = 0.14;
      statCtx.fillStyle = "rgba(236, 209, 132, 0.36)";
      statCtx.font = "11px 'Space Grotesk', sans-serif";
      for (const point of statPoints) {
        const pulse = 0.5 + 0.5 * Math.sin((time * 0.00045) + point.x * 0.004 + point.y * 0.002);
        statCtx.globalAlpha = 0.08 + pulse * 0.09;
        statCtx.fillText(point.label, point.x, point.y);
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

      if (time - lastHeavyDrawAt >= heavyFrameIntervalMs) {
        drawStatsLayer(time);
        drawTextLayer();
        lastHeavyDrawAt = time;
      }
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
    let idleHandle: number | null = null;

    if (existing) {
      setSimResult(existing);
      setIsUpdating(false);
      return undefined;
    }

    const updateTimer = window.setTimeout(() => {
      if (!active) return;
      setIsUpdating(true);
    }, 20);

    const run = () => {
      if (!active) return;
      const result = runSimulation(sanitized, simRuns, customProbByGame);
      simulationCacheRef.current.set(key, result);
      setSimResult(result);
      setIsUpdating(false);
    };

    const scheduleSimulation = () => {
      const w = window as Window & {
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
        cancelIdleCallback?: (handle: number) => void;
      };
      if (w.requestIdleCallback) {
        idleHandle = w.requestIdleCallback(
          () => {
            run();
          },
          { timeout: 350 }
        );
        return;
      }
      idleHandle = window.setTimeout(run, 150);
    };

    scheduleSimulation();

    return () => {
      active = false;
      window.clearTimeout(updateTimer);
      if (idleHandle !== null) {
        const w = window as Window & { cancelIdleCallback?: (handle: number) => void };
        if (w.cancelIdleCallback) {
          w.cancelIdleCallback(idleHandle);
        } else {
          window.clearTimeout(idleHandle);
        }
      }
    };
  }, [sanitized, simRuns, customProbByGame]);

  useEffect(() => {
    let active = true;
    let idleHandle: number | null = null;

    const computeDistribution = () => {
      if (!active) return;
      const distribution =
        runSimulation({}, CHAOS_DISTRIBUTION_SIM_RUNS, {}, { trackChaosDistribution: true }).chaosDistribution ?? null;
      if (active) setChaosDistribution(distribution);
    };

    const w = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (w.requestIdleCallback) {
      idleHandle = w.requestIdleCallback(() => computeDistribution(), { timeout: 700 });
    } else {
      idleHandle = window.setTimeout(computeDistribution, 250);
    }

    return () => {
      active = false;
      if (idleHandle !== null) {
        if (w.cancelIdleCallback) w.cancelIdleCallback(idleHandle);
        else window.clearTimeout(idleHandle);
      }
    };
  }, []);

  useEffect(() => {
    const previous = previousFuturesRef.current;
    previousFuturesRef.current = simResult.futures;
    if (!previous) return;

    const previousMap = new Map(previous.map((row) => [row.teamId, row.champProb]));
    const previousRowMap = new Map(previous.map((row) => [row.teamId, row]));
    const changed = new Set<string>();
    const changedDeltaKeys = new Set<string>();
    for (const row of simResult.futures) {
      const prev = previousMap.get(row.teamId);
      if (prev === undefined) continue;
      if (Math.abs(prev - row.champProb) > 0.000001) {
        changed.add(row.teamId);
      }
      const previousRow = previousRowMap.get(row.teamId);
      if (!previousRow) continue;
      for (const metric of FUTURES_METRIC_KEYS) {
        const previousProb = getMetricProb(previousRow, metric);
        const nextProb = getMetricProb(row, metric);
        if (Math.abs(previousProb - nextProb) > 0.000001) {
          changedDeltaKeys.add(`${row.teamId}-${metric}`);
        }
      }
    }

    if (changed.size > 0 || changedDeltaKeys.size > 0) {
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

  const preTournamentBaseline = useMemo(() => runSimulation({}, simRuns), [simRuns]);
  const baselineByTeamId = useMemo(
    () => new Map(preTournamentBaseline.futures.map((row) => [row.teamId, row])),
    [preTournamentBaseline.futures]
  );

  const pushUndo = (current: LockedPicks) => {
    setUndoStack((prev) => [...prev, current]);
  };

  const gameById = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);
  const statsModalGame = statsModalGameId ? gameById.get(statsModalGameId) ?? null : null;

  const openMatchupStats = (game: ResolvedGame) => {
    if (!game.teamAId || !game.teamBId) return;
    setStatsModalGameId(game.id);
  };

  const shareCardComputedData = useMemo<ShareCardData>(() => {
    const finalGamesById = new Map(finalRounds(games).map((game) => [game.id, game]));
    const leftSemi = finalGamesById.get("F4-Left-0") ?? null;
    const rightSemi = finalGamesById.get("F4-Right-0") ?? null;
    const championshipGame = Array.from(finalGamesById.values()).find((game) => game.round === "CHAMP") ?? null;
    const championTeamId = championshipGame?.winnerId ?? null;
    const championTeam = championTeamId ? teamsById.get(championTeamId) ?? null : null;
    const championBaseline = championTeam ? baselineByTeamId.get(championTeam.id)?.champProb ?? null : null;
    const championFuturesRow = championTeam ? simResult.futures.find((row) => row.teamId === championTeam.id) : null;
    const champion: ShareChampionTeam | null = championTeam
      ? {
          id: championTeam.id,
          seed: seedLabel(championTeam),
          name: championTeam.name,
          logoUrl: teamLogoUrl(championTeam),
          champProbLabel: toImpliedLabel(championFuturesRow?.champProb ?? 0),
          baselineProb: championBaseline,
          flavor: getChampionFlavor(championBaseline),
        }
      : null;
    const f4Participants = [leftSemi?.teamAId, leftSemi?.teamBId, rightSemi?.teamAId, rightSemi?.teamBId]
      .filter((teamId): teamId is string => Boolean(teamId));

    const f4Teams: ShareFinalFourTeam[] = f4Participants
      .map((teamId) => {
        const team = teamsById.get(teamId);
        if (!team) return null;
        const futuresRow = simResult.futures.find((row) => row.teamId === team.id);
        const champProb = futuresRow?.champProb ?? 0;
        return {
          id: team.id,
          seed: seedLabel(team),
          name: team.name,
          logoUrl: teamLogoUrl(team),
          champProbLabel: toImpliedLabel(champProb),
          isChampion: championTeamId === team.id,
        };
      })
      .filter((team): team is ShareFinalFourTeam => Boolean(team));

    const pickRows = games
      .filter((game) => Boolean(game.winnerId && game.teamAId && game.teamBId))
      .map((game) => {
        const winnerId = game.winnerId as string;
        const winnerIsA = winnerId === game.teamAId;
        const winnerTeam = teamsById.get(winnerId) ?? null;
        const loserTeam = teamsById.get(winnerIsA ? (game.teamBId as string) : (game.teamAId as string)) ?? null;
        const modelProbA = getModelGameWinProb(game, game.teamAId as string);
        const winnerWinProb = modelProbA === null ? null : winnerIsA ? modelProbA : 1 - modelProbA;
        if (!winnerTeam || !loserTeam || winnerWinProb === null) return null;
        return {
          winnerSeed: seedLabel(winnerTeam),
          winnerName: winnerTeam.name,
          loserSeed: seedLabel(loserTeam),
          loserName: loserTeam.name,
          winProb: winnerWinProb,
        };
      })
      .filter((row): row is { winnerSeed: string; winnerName: string; loserSeed: string; loserName: string; winProb: number } => Boolean(row))
      .sort((a, b) => a.winProb - b.winProb);

    const boldestPicks: ShareBoldPick[] = pickRows.slice(0, 3).map((row) => ({
      winnerSeed: row.winnerSeed,
      winnerName: row.winnerName,
      loserSeed: row.loserSeed,
      loserName: row.loserName,
      winProbPct: Math.round(row.winProb * 100),
    }));

    const totalPicks = Math.min(URL_EXPECTED_GAME_COUNT, Object.keys(sanitized).length);
    const chaosScoreValue = computeChaosScoreFromGames(games) ?? 0;
    const chaosLabelData = getChaosLabel(chaosScoreValue, totalPicks) ?? { label: "Chalk", emoji: "📋" };
    const bracketLikelihood = simResult.likelihoodSimulation > 0 ? toOneInX(simResult.likelihoodSimulation) : null;

    return {
      champion,
      f4Teams,
      boldestPicks,
      totalPicks,
      chaosScore: chaosScoreValue,
      chaosLabel: chaosLabelData.label,
      chaosEmoji: chaosLabelData.emoji,
      bracketLikelihood,
    };
  }, [baselineByTeamId, games, sanitized, simResult.futures, simResult.likelihoodSimulation]);

  const pickCount = useMemo(() => {
    const count = games.filter(
      (game) => game.round !== "FF" && Boolean(game.winnerId && game.teamAId && game.teamBId)
    ).length;
    return Math.min(URL_EXPECTED_GAME_COUNT, count);
  }, [games]);

  const chaosScore = useMemo(() => computeChaosScoreFromGames(games), [games]);
  const submittedBracketCount = useMemo(
    () => userBrackets.filter((bracket) => Boolean(bracket.submitted_at)).length,
    [userBrackets]
  );
  const submissionsLocked = useMemo(() => userBrackets.some((bracket) => bracket.is_locked), [userBrackets]);
  const submissionLimitReached = submittedBracketCount >= 25;
  const canSubmitBrackets = isAuthenticated && !submissionsLocked && !submissionLimitReached;
  const pickedChaosGameIds = useMemo(() => getPickedChaosGameIds(games), [games]);
  const chaosPercentile = useMemo(() => {
    if (chaosScore === null || pickedChaosGameIds.length === 0 || !chaosDistribution) return null;
    return getChaosScorePercentileForPickedGames(chaosScore, pickedChaosGameIds, chaosDistribution);
  }, [chaosDistribution, chaosScore, pickedChaosGameIds]);
  const chaosScaleInvertedPct = useMemo(() => {
    if (chaosScore === null) return 0;
    const clampedPct = Math.min(100, Math.max(0, (chaosScore / 60) * 100));
    return 100 - clampedPct;
  }, [chaosScore]);
  const chaosLabelData = useMemo(() => getChaosLabel(chaosScore, pickCount), [chaosScore, pickCount]);
  const chaosPillLevel = useMemo(() => {
    const label = chaosLabelData?.label.toLowerCase() ?? "";
    if (label.includes("chaos")) return "chaos";
    if (label.includes("upset")) return "upset";
    if (label.includes("balanced")) return "balanced";
    if (label.includes("mild")) return "mild";
    return "chalk";
  }, [chaosLabelData]);

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

  const sanitizeCustomProbByParticipants = (
    prevLocks: LockedPicks,
    nextLocks: LockedPicks,
    currentCustom: CustomProbByGame
  ): CustomProbByGame => {
    if (Object.keys(currentCustom).length === 0) return currentCustom;

    const prevResolved = resolveGames(prevLocks).games;
    const nextResolved = resolveGames(nextLocks).games;
    const prevById = new Map(prevResolved.map((game) => [game.id, game]));
    const nextById = new Map(nextResolved.map((game) => [game.id, game]));

    let changed = false;
    const nextCustom: CustomProbByGame = {};

    for (const [gameId, rawProb] of Object.entries(currentCustom)) {
      if (typeof rawProb !== "number" || !Number.isFinite(rawProb)) continue;

      const nextGame = nextById.get(gameId);
      if (!nextGame || !nextGame.teamAId || !nextGame.teamBId) {
        changed = true;
        continue;
      }

      const prevGame = prevById.get(gameId);
      const participantsChanged =
        !prevGame ||
        prevGame.teamAId !== nextGame.teamAId ||
        prevGame.teamBId !== nextGame.teamBId;

      if (participantsChanged) {
        changed = true;
        continue;
      }

      nextCustom[gameId] = rawProb;
    }

    return changed ? nextCustom : currentCustom;
  };

  const applyLockedPicksUpdate = (nextRawLocks: LockedPicks) => {
    const nextSanitizedLocks = sanitizeLockedPicks(nextRawLocks);
    const nextCustomProbByGame = sanitizeCustomProbByParticipants(lockedPicks, nextSanitizedLocks, customProbByGame);

    if (nextCustomProbByGame !== customProbByGame) {
      setCustomProbByGame(nextCustomProbByGame);
      if (probPopup && !Object.prototype.hasOwnProperty.call(nextCustomProbByGame, probPopup.gameId)) {
        setProbPopup(null);
      }
    }

    setLockedPicks(nextSanitizedLocks);
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
    if (walkthroughActive && currentWalkthroughStep?.id === "upset-pick" && walkthroughCascadePhase === "pick") {
      const pickedTeam = teamsById.get(teamId);
      const isForcedUpsetPick =
        game.id === walkthroughMatchupId &&
        Boolean(
          pickedTeam &&
            (pickedTeam.name === ONBOARDING_UPSET_WINNER ||
              (pickedTeam.seedLabel === "15" && pickedTeam.region === ONBOARDING_UPSET_REGION))
        );
      if (!isForcedUpsetPick) return;
      setWalkthroughCascadePathByRound(getOnboardingPathByRound(game.id));
      walkthroughBeforeTeamOddsRef.current = new Map(
        gameTemplates
          .filter((tmpl) => tmpl.region === "South" && (tmpl.round === "R32" || tmpl.round === "S16" || tmpl.round === "E8"))
          .map((tmpl) => [
            tmpl.id,
            new Map((simResult.gameWinProbs[tmpl.id] ?? []).map((row) => [row.teamId, row.prob])),
          ])
      );
      setWalkthroughCascadePhase("animating");
    }
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
    chaosScoreSourceRef.current = "manual";
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

    const wasComplete = Object.keys(sanitizeLockedPicks(lockedPicks)).length === URL_EXPECTED_GAME_COUNT;
    const nextResolved = resolveGames(next, customProbByGame).games;
    const nowComplete = nextResolved.every((resolvedGame) => Boolean(resolvedGame.winnerId));
    if (!wasComplete && nowComplete && game.round === "CHAMP") {
      const champion = nextResolved.find((resolvedGame) => resolvedGame.round === "CHAMP");
      const championName = champion?.winnerId ? teamsById.get(champion.winnerId)?.name ?? "Your champion" : "Your champion";
      const completedChaosScore = computeChaosScoreFromGames(nextResolved);
      const chaosLabelData = getChaosLabel(completedChaosScore, URL_EXPECTED_GAME_COUNT) ?? { label: "Chalk", emoji: "📋" };
      setCompletionCelebrationData({
        championName,
        chaosLabel: chaosLabelData.label,
        chaosEmoji: chaosLabelData.emoji,
      });
      setShowCompletionCelebration(true);
    }

    applyLockedPicksUpdate(next);
  };

  const handleRandomizeFirstFour = () => {
    const unresolved = playInGames.filter((game) => !game.winnerId && game.teamAId && game.teamBId);
    if (unresolved.length === 0) return;
    cancelStaggeredSim();
    chaosScoreSourceRef.current = "manual";
    pendingPickMetaRef.current = null;
    setFirstPickNudgeVisible(false);
    setMajorShiftNudgeVisible(false);
    closeProbabilityPopup(true);
    pushUndo(lockedPicks);
    const nextLocks: LockedPicks = { ...lockedPicks };
    for (const game of unresolved) {
      if (!game.teamAId || !game.teamBId) continue;
      const probA = getGameWinProb(game, game.teamAId, simResult.gameWinProbs) ?? getModelGameWinProb(game, game.teamAId) ?? 0.5;
      const winnerId = Math.random() < probA ? game.teamAId : game.teamBId;
      nextLocks[game.id] = winnerId;
    }
    setLastPickedKey(`ff-batch:${Date.now()}`);
    applyLockedPicksUpdate(nextLocks);
    trackEvent("first_four_randomized", {
      games_randomized: unresolved.length,
    });
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
    chaosScoreSourceRef.current = "manual";
    if (undoStack.length === 0) return;
    pendingPickMetaRef.current = null;
    setFirstPickNudgeVisible(false);
    setMajorShiftNudgeVisible(false);
    closeProbabilityPopup(true);
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    applyLockedPicksUpdate(previous);
  };

  const onUndoGame = (gameId: string) => {
    if (!lockedPicks[gameId]) return;
    cancelStaggeredSim();
    chaosScoreSourceRef.current = "manual";
    pendingPickMetaRef.current = null;
    setFirstPickNudgeVisible(false);
    setMajorShiftNudgeVisible(false);
    closeProbabilityPopup(true);
    simGeneratedGameIdsRef.current.delete(gameId);
    pushUndo(lockedPicks);
    const next = { ...lockedPicks };
    delete next[gameId];
    applyLockedPicksUpdate(next);
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
    chaosScoreSourceRef.current = "manual";
    closeProbabilityPopup(true);
    simGeneratedGameIdsRef.current.delete(game.id);
    pushUndo(lockedPicks);
    setLastPickedKey(`${game.id}:${teamId}`);
    applyLockedPicksUpdate({ ...lockedPicks, [game.id]: teamId });
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
    chaosScoreSourceRef.current = "manual";
    setManuallyExpandedRounds({});
    setTopHalfManuallyExpanded(false);
    setBottomHalfManuallyExpanded(false);
    setShowCompletionCelebration(false);
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
    chaosScoreSourceRef.current = "manual";
    pendingPickMetaRef.current = null;
    setFirstPickNudgeVisible(false);
    setMajorShiftNudgeVisible(false);
    closeProbabilityPopup(true);
    pushUndo(lockedPicks);
    for (const game of games) {
      if (game.region === region) simGeneratedGameIdsRef.current.delete(game.id);
    }
    applyLockedPicksUpdate(resetRegionPicks(lockedPicks, region));
    setManuallyExpandedRounds((prev) => {
      const next: ManualRoundExpansionState = {};
      for (const [key, value] of Object.entries(prev)) {
        if (!key.startsWith(`${region}-`) && value) {
          next[key as keyof ManualRoundExpansionState] = true;
        }
      }
      return next;
    });
    if (region === "South" || region === "West") {
      setTopHalfManuallyExpanded(false);
    } else {
      setBottomHalfManuallyExpanded(false);
    }
  };

  const onRequestResetAll = () => {
    setResetModalConfig({
      title: "Reset Bracket",
      message: "Clear all picks and custom odds? This cannot be undone.",
      confirmLabel: "Clear All",
      onConfirm: onResetAll,
    });
  };

  const onRequestResetRegion = (region: Region) => {
    setResetModalConfig({
      title: `Reset ${region}`,
      message: `Clear all picks in ${region}? This cannot be undone.`,
      confirmLabel: "Clear Region",
      onConfirm: () => onResetRegion(region),
    });
  };

  const onSaveBracket = async () => {
    if (!isAuthenticated || !user) {
      window.sessionStorage.setItem("pendingBracketSave", JSON.stringify(serializePicks(sanitized)));
      setAuthModalOpen(true);
      return;
    }

    if (submissionsLocked) {
      setSaveStatus("error");
      setSaveErrorText("Submissions are locked at tip-off.");
      return;
    }
    if (submissionLimitReached) {
      setSaveStatus("error");
      setSaveErrorText("Submission limit reached (25/25)");
      return;
    }

    setSaveStatus("saving");
    const defaultName = submittedBracketCount === 0 ? "My Bracket" : `Bracket #${Math.min(25, submittedBracketCount + 1)}`;
    const { error } = await saveBracket(user.id, sanitized, defaultName, null, chaosScore ?? 0, { submit: true });
    if (error) {
      setSaveStatus("error");
      setSaveErrorText((error as { message?: string })?.message ?? "Save failed");
      if (saveStatusTimerRef.current !== null) window.clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = window.setTimeout(() => {
        setSaveStatus(null);
        setSaveErrorText(null);
        saveStatusTimerRef.current = null;
      }, 3000);
      return;
    }
    await refreshUserBrackets();
    setSaveStatus("saved");
    setSaveErrorText(null);
    if (saveStatusTimerRef.current !== null) window.clearTimeout(saveStatusTimerRef.current);
    saveStatusTimerRef.current = window.setTimeout(() => {
      setSaveStatus(null);
      saveStatusTimerRef.current = null;
    }, 2000);
  };

  const onLoadSavedBracket = (bracket: SavedBracket) => {
    const picks = sanitizeLockedPicks(deserializePicks(bracket.picks));
    cancelStaggeredSim();
    chaosScoreSourceRef.current = "manual";
    pendingPickMetaRef.current = null;
    setFirstPickNudgeVisible(false);
    setMajorShiftNudgeVisible(false);
    pushUndo(lockedPicks);
    simGeneratedGameIdsRef.current.clear();
    setProbPopup(null);
    setShowCompletionCelebration(false);
    setCustomProbByGame({});
    setLockedPicks(picks);
    setMainView("bracket");
    setMobileTab("bracket");
    window.scrollTo({ top: 0, behavior: "smooth" });
    trackEvent("saved_bracket_loaded", {
      bracket_id: bracket.id,
      picks_count: Object.keys(picks).length,
    });
  };

  const onBracketRenamed = () => {
    const leaderboardVisible = isMobile ? mobileTab === "leaderboard" : mainView === "leaderboard";
    if (!leaderboardVisible) return;
    setLeaderboardRefreshKey((value) => value + 1);
  };

  const onCopyShareLink = async () => {
    if (typeof window === "undefined") return;
    const shareUrl = window.location.href;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = shareUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    setLinkCopied(true);
    trackEvent("bracket_link_copied", {
      total_picks: Object.keys(sanitized).length,
      bracket_complete: Object.keys(sanitized).length === URL_EXPECTED_GAME_COUNT,
    });

    if (copyLinkTimerRef.current !== null) {
      window.clearTimeout(copyLinkTimerRef.current);
    }
    copyLinkTimerRef.current = window.setTimeout(() => {
      setLinkCopied(false);
      copyLinkTimerRef.current = null;
    }, 2500);
  };

  const onCompletionSave = async () => {
    if (!isAuthenticated) {
      await onSaveBracket();
      return;
    }
    await onSaveBracket();
    setShowCompletionCelebration(false);
  };

  const onCloseShareModal = () => {
    if (shareExporting) return;
    setShareModalVisible(false);
  };

  const onExportShareFormat = async (format: ShareFormat) => {
    if (shareExporting || shareCardComputedData.totalPicks === 0) return;
    const targetRef = format === "story" ? shareStoryRef.current : shareTwitterRef.current;
    if (!targetRef) return;

    const width = format === "story" ? 1080 : 1200;
    const height = format === "story" ? 1920 : 630;
    const filename = format === "story" ? "my-bracket-lab-story.png" : "my-bracket-lab.png";

    setShareExporting(format);
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));

    try {
      const canvas = await html2canvas(targetRef, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        allowTaint: false,
        width,
        height,
        windowWidth: width,
        windowHeight: height,
        logging: false,
      });

      const link = document.createElement("a");
      link.download = filename;
      link.href = canvas.toDataURL("image/png");
      link.click();

      trackEvent("bracket_image_exported", {
        format,
        total_picks: shareCardComputedData.totalPicks,
        chaos_score: shareCardComputedData.chaosScore.toFixed(2),
        champion: shareCardComputedData.champion?.name ?? null,
      });

      setShareToastVisible(true);
      if (shareToastTimerRef.current !== null) window.clearTimeout(shareToastTimerRef.current);
      shareToastTimerRef.current = window.setTimeout(() => {
        setShareToastVisible(false);
        shareToastTimerRef.current = null;
      }, 3000);

      setShareModalVisible(false);
    } finally {
      setShareExporting(null);
    }
  };

  useEffect(() => {
    const previous = previousChaosScoreRef.current;
    if (chaosScore === null) {
      previousChaosScoreRef.current = null;
      return;
    }
    if (previous !== null && previous !== chaosScore) {
      setChaosScoreChanged(true);
      if (chaosScoreTimerRef.current !== null) window.clearTimeout(chaosScoreTimerRef.current);
      chaosScoreTimerRef.current = window.setTimeout(() => {
        setChaosScoreChanged(false);
        chaosScoreTimerRef.current = null;
      }, 300);
      if (!staggeredSimRunning) {
        const chaosLabel = getChaosLabel(chaosScore, pickCount);
        trackEvent("chaos_score_updated", {
          score: chaosScore.toFixed(2),
          label: chaosLabel?.label ?? null,
          decided_count: pickCount,
          source: chaosScoreSourceRef.current,
        });
      }
    }
    previousChaosScoreRef.current = chaosScore;
  }, [chaosScore, pickCount, staggeredSimRunning]);

  useEffect(() => {
    const wasRunning = previousStaggeredRunningRef.current;
    if (
      wasRunning &&
      !staggeredSimRunning &&
      staggeredStepsRef.current.length > 0 &&
      staggeredIndexRef.current >= staggeredStepsRef.current.length
    ) {
      const finalScore = computeChaosScoreFromGames(games) ?? 0;
      const finalLabel = getChaosLabel(finalScore, pickCount);
      trackEvent("staggered_sim_completed", {
        chaos_score: finalScore.toFixed(2),
        total_games: staggeredTotalGames,
        chaos_label: finalLabel?.label ?? null,
      });
    }
    previousStaggeredRunningRef.current = staggeredSimRunning;
  }, [games, pickCount, staggeredSimRunning, staggeredTotalGames]);

  const onChaosPillTap = () => {
    if (chaosScore === null) return;
    setShowChaosModal(true);
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
    chaosScoreSourceRef.current = "instant_sim";
    pendingPickMetaRef.current = null;
    setFirstPickNudgeVisible(false);
    setMajorShiftNudgeVisible(false);
    closeProbabilityPopup(true);
    pushUndo(lockedPicks);
    setTopHalfManuallyExpanded(false);
    setBottomHalfManuallyExpanded(false);
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
    chaosScoreSourceRef.current = "staggered_sim";
    pendingPickMetaRef.current = null;
    setFirstPickNudgeVisible(false);
    setMajorShiftNudgeVisible(false);
    closeProbabilityPopup(true);
    const baseLocks = getUserLockedPicks(lockedPicks);
    const steps = generateSimulatedBracketSteps(baseLocks, ["South", "East", "West", "Midwest"], customProbByGame);
    if (steps.length === 0) {
      simGeneratedGameIdsRef.current = new Set();
      return;
    }

    pushUndo(baseLocks);
    setTopHalfManuallyExpanded(false);
    setBottomHalfManuallyExpanded(false);
    setStaggeredChaosTotal(computeChaosScoreFromGames(resolveGames(baseLocks).games) ?? 0);
    setStaggeredLastGameChaos(null);
    setStaggeredLastGameLabel("");
    setStaggeredGamesResolved(Object.keys(baseLocks).length);
    setStaggeredTotalGames(URL_EXPECTED_GAME_COUNT);
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
      setLockedPicks((prev) => {
        const nextLocks = sanitizeLockedPicks({ ...prev, [step.gameId]: step.winnerId });
        const resolved = resolveGames(nextLocks).games.find((game) => game.id === step.gameId);
        if (resolved && resolved.teamAId && resolved.teamBId) {
          const modelProbA = getModelGameWinProb(resolved, resolved.teamAId);
          if (modelProbA !== null) {
            const winnerProb = step.winnerId === resolved.teamAId ? modelProbA : 1 - modelProbA;
            const gameChaos = computeGameChaos(winnerProb);
            setStaggeredLastGameChaos(gameChaos);
            const teamA = teamsById.get(resolved.teamAId)?.name ?? "Team A";
            const teamB = teamsById.get(resolved.teamBId)?.name ?? "Team B";
            setStaggeredLastGameLabel(`${teamA} vs ${teamB}`);
            setStaggeredChaosTotal((prevTotal) => prevTotal + gameChaos);
            setStaggeredGamesResolved((prevCount) => prevCount + 1);
          }
        }
        return nextLocks;
      });
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
      setLockedPicks((prev) => {
        const nextLocks = sanitizeLockedPicks({ ...prev, [step.gameId]: step.winnerId });
        const resolved = resolveGames(nextLocks).games.find((game) => game.id === step.gameId);
        if (resolved && resolved.teamAId && resolved.teamBId) {
          const modelProbA = getModelGameWinProb(resolved, resolved.teamAId);
          if (modelProbA !== null) {
            const winnerProb = step.winnerId === resolved.teamAId ? modelProbA : 1 - modelProbA;
            const gameChaos = computeGameChaos(winnerProb);
            setStaggeredLastGameChaos(gameChaos);
            const teamA = teamsById.get(resolved.teamAId)?.name ?? "Team A";
            const teamB = teamsById.get(resolved.teamBId)?.name ?? "Team B";
            setStaggeredLastGameLabel(`${teamA} vs ${teamB}`);
            setStaggeredChaosTotal((prevTotal) => prevTotal + gameChaos);
            setStaggeredGamesResolved((prevCount) => prevCount + 1);
          }
        }
        return nextLocks;
      });
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
      if (copyLinkTimerRef.current !== null) {
        window.clearTimeout(copyLinkTimerRef.current);
      }
      if (saveStatusTimerRef.current !== null) {
        window.clearTimeout(saveStatusTimerRef.current);
      }
      if (promoCTATimerRef.current !== null) {
        window.clearTimeout(promoCTATimerRef.current);
      }
      if (shareToastTimerRef.current !== null) {
        window.clearTimeout(shareToastTimerRef.current);
      }
      if (chaosScoreTimerRef.current !== null) {
        window.clearTimeout(chaosScoreTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!shareModalVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (shareExporting) return;
      setShareModalVisible(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shareModalVisible, shareExporting]);

  useEffect(() => {
    if (!probPopup) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".prob-popup")) return;
      if (target.closest(".matchup-edit-icon")) return;
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

  const isRoundComplete = (region: Region, round: RegionalRound): boolean => {
    const roundGames = gamesByRegionAndRound(games, region, round);
    return roundGames.length > 0 && roundGames.every((game) => Boolean(game.winnerId));
  };

  const isRoundVisuallyCollapsed = (region: Region, round: RegionalRound): boolean => {
    if (round === "E8") return false;
    if (!isRoundComplete(region, round)) return false;
    const key = `${region}-${round}` as const;
    return !Boolean(manuallyExpandedRounds[key]);
  };

  const toggleRoundExpansion = (region: Region, round: "R64" | "R32" | "S16") => {
    const key = `${region}-${round}` as const;
    const currentlyExpanded = Boolean(manuallyExpandedRounds[key]);
    const nextExpanded = !currentlyExpanded;
    setManuallyExpandedRounds((prev) => ({ ...prev, [key]: nextExpanded }));
    trackEvent(nextExpanded ? "collapsed_round_expanded" : "collapsed_round_recollapsed", {
      region,
      round,
    });
  };

  const isHalfComplete = (half: "top" | "bottom"): boolean => {
    const regions = half === "top" ? BRACKET_HALVES[0].regions : BRACKET_HALVES[1].regions;
    return regions.every((region) =>
      (["FF", "R64", "R32", "S16", "E8"] as const).every((round) => {
        const roundGames = gamesByRegionAndRound(games, region, round);
        return roundGames.length > 0 && roundGames.every((game) => Boolean(game.winnerId));
      })
    );
  };

  const topHalfComplete = isHalfComplete("top");
  const bottomHalfComplete = isHalfComplete("bottom");
  const topHalfVisuallyCollapsed = topHalfComplete && !topHalfManuallyExpanded;
  const bottomHalfVisuallyCollapsed = bottomHalfComplete && !bottomHalfManuallyExpanded;

  const setHalfRoundExpansion = (half: "top" | "bottom", expanded: boolean) => {
    const regions = half === "top" ? BRACKET_HALVES[0].regions : BRACKET_HALVES[1].regions;
    setManuallyExpandedRounds((prev) => {
      const next = { ...prev };
      for (const region of regions) {
        (["R64", "R32", "S16"] as const).forEach((round) => {
          const key = `${region}-${round}` as const;
          next[key] = expanded;
        });
      }
      return next;
    });
  };

  const handleExpandHalf = (half: "top" | "bottom") => {
    if (half === "top") {
      setTopHalfManuallyExpanded(true);
    } else {
      setBottomHalfManuallyExpanded(true);
    }
    trackEvent("bracket_half_expanded", { half });
  };

  const handleCollapseHalf = (half: "top" | "bottom") => {
    if (half === "top") {
      setTopHalfManuallyExpanded(false);
    } else {
      setBottomHalfManuallyExpanded(false);
    }
    setHalfRoundExpansion(half, false);
  };

  useEffect(() => {
    if (!topHalfComplete && topHalfManuallyExpanded) {
      setTopHalfManuallyExpanded(false);
    }
    if (!bottomHalfComplete && bottomHalfManuallyExpanded) {
      setBottomHalfManuallyExpanded(false);
    }
  }, [bottomHalfComplete, bottomHalfManuallyExpanded, topHalfComplete, topHalfManuallyExpanded]);

  useEffect(() => {
    if (!previousTopHalfCompleteRef.current && topHalfComplete) {
      setTopHalfManuallyExpanded(false);
    }
    previousTopHalfCompleteRef.current = topHalfComplete;
  }, [topHalfComplete]);

  useEffect(() => {
    if (!previousBottomHalfCompleteRef.current && bottomHalfComplete) {
      setBottomHalfManuallyExpanded(false);
    }
    previousBottomHalfCompleteRef.current = bottomHalfComplete;
  }, [bottomHalfComplete]);

  useEffect(() => {
    if (!previousTopHalfCollapsedRef.current && topHalfVisuallyCollapsed) {
      trackEvent("bracket_half_collapsed", { half: "top" });
    }
    if (!previousBottomHalfCollapsedRef.current && bottomHalfVisuallyCollapsed) {
      trackEvent("bracket_half_collapsed", { half: "bottom" });
    }
    previousTopHalfCollapsedRef.current = topHalfVisuallyCollapsed;
    previousBottomHalfCollapsedRef.current = bottomHalfVisuallyCollapsed;
  }, [topHalfVisuallyCollapsed, bottomHalfVisuallyCollapsed]);

  const finalGames = finalRounds(games);
  const playInGames = useMemo(() => games.filter((game) => game.round === "FF"), [games]);
  const decidedPlayInCount = useMemo(
    () => playInGames.filter((game) => Boolean(game.winnerId)).length,
    [playInGames]
  );
  const allPlayInDecided = playInGames.length === 0 || decidedPlayInCount === playInGames.length;
  const onboardingFlowReady = !showDesktopFirst && !walkthroughActive;
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
  const liveOddsTopContenders = useMemo(() => {
    return [...preTournamentBaseline.futures]
      .sort((a, b) => b.champProb - a.champProb)
      .slice(0, 20)
      .map((row) => {
        const team = teamsById.get(row.teamId);
        return {
          id: row.teamId,
          logoUrl: team ? teamLogoUrl(team) : fallbackLogo(row.teamId),
          shortName: team ? mobileShortName(team.name) : row.teamId,
          titleOdds: formatOddsDisplay(row.champProb, displayMode).primary,
          titleImpliedPct: toImpliedLabel(row.champProb),
        };
      });
  }, [displayMode, preTournamentBaseline.futures]);

  useEffect(() => {
    if (!onboardingFlowReady || allPlayInDecided || firstFourAutoShownRef.current) return;
    setShowFirstFourModal(true);
    firstFourAutoShownRef.current = true;
  }, [allPlayInDecided, onboardingFlowReady]);

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
  const walkthroughDisplayStep = useMemo(() => {
    if (!currentWalkthroughStep) return null;

    if (currentWalkthroughStep.id === "upset-pick") {
      return {
        ...currentWalkthroughStep,
        heading: "Pick the upset.",
        body: "Tap #15 Merrimack to knock off #2 Florida. Then watch what happens to every team in the South.",
        ctaText: "Pick a team",
      };
    }

    if (currentWalkthroughStep.id === "bracket-ripple") {
      return {
        ...currentWalkthroughStep,
        heading: "Every pick does this.",
        body: "You just saw one upset reshape an entire region. Now imagine 63 picks — each one sending ripples across the whole tournament. That's what Bracket Lab shows you.",
      };
    }

    if (currentWalkthroughStep.id === "futures-panel") {
      return {
        ...currentWalkthroughStep,
        body: "Notice how Merrimack appears and Florida drops. Red/green deltas show exactly how much your upset shifted each team. Scroll to see the pre-tournament baseline.",
      };
    }

    return currentWalkthroughStep;
  }, [currentWalkthroughStep, walkthroughCascadePhase]);
  const walkthroughCtaLabel =
    currentWalkthroughStep?.id === "upset-pick"
      ? "Pick a team"
      : currentWalkthroughStep?.ctaText ?? "Next →";
  const isWalkthroughStepCentered = Boolean(currentWalkthroughStep?.centered);
  const walkthroughCtaBlockedByCascade =
    currentWalkthroughStep?.id === "upset-pick" &&
    (walkthroughCascadePhase === "pick" || walkthroughCascadePhase === "animating");
  const walkthroughCtaDisabled = walkthroughCtaBlockedByCascade;

  useEffect(() => {
    if (!walkthroughActive || currentWalkthroughStep?.id !== "upset-pick" || walkthroughCascadePhase !== "animating") return;
    walkthroughCascadeStepTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    walkthroughCascadeStepTimersRef.current = [];
    const floridaMatchup = walkthroughMatchupId
      ? document.querySelector<HTMLElement>(`.eg-game-card[data-game-id="${walkthroughMatchupId}"]`)
      : null;
    floridaMatchup?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    const afterMap = new Map<string, Map<string, number>>(
      gameTemplates
        .filter((tmpl) => tmpl.region === "South" && (tmpl.round === "R32" || tmpl.round === "S16" || tmpl.round === "E8"))
        .map((tmpl) => [tmpl.id, new Map((simResult.gameWinProbs[tmpl.id] ?? []).map((row) => [row.teamId, row.prob]))])
    );
    const changed = new Set<string>();
    afterMap.forEach((rowMap, gameId) => {
      const beforeRows = walkthroughBeforeTeamOddsRef.current.get(gameId) ?? new Map<string, number>();
      const teamIds = new Set([...beforeRows.keys(), ...rowMap.keys()]);
      for (const teamId of teamIds) {
        const before = beforeRows.get(teamId) ?? 0;
        const after = rowMap.get(teamId) ?? 0;
        if (Math.abs(before - after) > 1e-6) {
          changed.add(gameId);
          break;
        }
      }
    });
    setWalkthroughChangedGameIds(changed);
    document.querySelectorAll<HTMLElement>(".odds-value").forEach((el) => el.classList.remove("odds-cascading"));
    const formatAnimatedOdds = (prob: number) => formatOddsDisplay(prob, displayMode).primary;
    // Keep old values visible through the onboarding sequence until each round animates.
    changed.forEach((gameId) => {
      const gameEl = document.querySelector<HTMLElement>(`.eg-game-card[data-game-id="${gameId}"]`);
      if (!gameEl) return;
      const beforeRows = walkthroughBeforeTeamOddsRef.current.get(gameId) ?? new Map<string, number>();
      gameEl.querySelectorAll<HTMLElement>(".odds-value").forEach((oddsEl) => {
        const teamId = oddsEl.dataset.teamId ?? "";
        const fromVal = beforeRows.get(teamId);
        if (fromVal === undefined) return;
        oddsEl.textContent = formatAnimatedOdds(fromVal);
      });
    });
    const animateOddsValue = (el: HTMLElement, fromVal: number, toVal: number, duration = 600) => {
      el.classList.remove("team-odds--flash-green", "team-odds--flash-red");
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = fromVal + (toVal - fromVal) * eased;
        el.textContent = formatAnimatedOdds(current);
        if (progress < 1) {
          window.requestAnimationFrame(tick);
        } else {
          el.textContent = formatAnimatedOdds(toVal);
          el.classList.add("odds-settled");
          if (toVal > fromVal + 1e-6) el.classList.add("team-odds--flash-green");
          if (toVal < fromVal - 1e-6) el.classList.add("team-odds--flash-red");
          window.setTimeout(() => el.classList.remove("odds-settled"), 350);
          window.setTimeout(() => el.classList.remove("team-odds--flash-green", "team-odds--flash-red"), 900);
        }
      };
      window.requestAnimationFrame(tick);
    };
    const loserName = ONBOARDING_UPSET_LOSER;
    const steps: Array<{
      round: "R32" | "S16" | "E8";
      spotlightAt: number;
      fadeAt: number;
      fadeMs: number;
      oddsAt: number;
      preCaption: string;
      postCaption: string;
    }> = [
      {
        round: "R32",
        spotlightAt: 1100,
        fadeAt: 1600,
        fadeMs: 1200,
        oddsAt: 3300,
        preCaption: "Florida was projected here. Now they're gone.",
        postCaption: "The remaining teams just absorbed Florida's odds.",
      },
      {
        round: "S16",
        spotlightAt: 5600,
        fadeAt: 6100,
        fadeMs: 1000,
        oddsAt: 7500,
        preCaption: "Now watch the Sweet 16.",
        postCaption: "Connecticut and Purdue just got a much easier path.",
      },
      {
        round: "E8",
        spotlightAt: 9500,
        fadeAt: 9900,
        fadeMs: 800,
        oddsAt: 11000,
        preCaption: "The Elite Eight too.",
        postCaption: "Every team's path to the Final Four just changed.",
      },
    ];

    const spotlightAndScroll = (round: "R32" | "S16" | "E8", caption: string) => {
      setWalkthroughCascadeSpotlightRound(round);
      setWalkthroughCascadeCaption(caption);
      window.requestAnimationFrame(() => {
        const southRegion = Array.from(document.querySelectorAll<HTMLElement>(".eg-region-card.bracket-region")).find((regionCard) =>
          regionCard.querySelector("h2")?.textContent?.trim().toLowerCase().includes("south")
        );
        if (!southRegion) return;
        const targetCol = southRegion.querySelector<HTMLElement>(`.eg-round-col[data-round="${ROUND_TO_DATA_ATTR[round]}"]`);
        if (!targetCol) return;

        // Temporarily enable scrolling on the scroll container (normally overflow-x: hidden)
        const scrollContainer =
          targetCol.closest<HTMLElement>(".eg-region-scroll") ??
          southRegion.closest<HTMLElement>(".eg-region-scroll") ??
          null;
        if (scrollContainer) {
          scrollContainer.style.overflowX = "auto";
        }

        targetCol.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      });
    };

    // Pre-scroll to R32 area before cascade spotlight begins
    const preScrollTimer = window.setTimeout(() => {
      const southRegion = Array.from(document.querySelectorAll<HTMLElement>(".eg-region-card.bracket-region")).find((regionCard) =>
        regionCard.querySelector("h2")?.textContent?.trim().toLowerCase().includes("south")
      );
      if (southRegion) {
        const r32Col = southRegion.querySelector<HTMLElement>(`.eg-round-col[data-round="${ROUND_TO_DATA_ATTR["R32"]}"]`);
        if (r32Col) {
          const scrollContainer = r32Col.closest<HTMLElement>(".eg-region-scroll");
          if (scrollContainer) scrollContainer.style.overflowX = "auto";
          r32Col.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        }
      }
    }, 400);
    walkthroughCascadeStepTimersRef.current.push(preScrollTimer);

    steps.forEach((step) => {
      const spotlightTimer = window.setTimeout(() => {
        spotlightAndScroll(step.round, step.preCaption);
      }, step.spotlightAt);
      walkthroughCascadeStepTimersRef.current.push(spotlightTimer);

      const fadeTimer = window.setTimeout(() => {
        const pathGames = walkthroughCascadePathByRound[step.round];
        pathGames.forEach((gameId) => {
          const gameEl = document.querySelector<HTMLElement>(`.eg-game-card[data-game-id="${gameId}"]`);
          if (!gameEl) return;
          gameEl.querySelectorAll<HTMLElement>(`[data-team-name="${loserName}"]`).forEach((row) => {
            row.style.setProperty("--florida-fade-duration", `${step.fadeMs}ms`);
            row.classList.add("team-row--fading-out");
            window.setTimeout(() => {
              row.classList.add("team-row--removed");
            }, step.fadeMs);
          });
        });
      }, step.fadeAt);
      walkthroughCascadeStepTimersRef.current.push(fadeTimer);

      const oddsTimer = window.setTimeout(() => {
        setWalkthroughCascadeCaption(step.postCaption);
        setWalkthroughCascadeSpotlightRound(step.round);
        changed.forEach((gameId) => {
          if (!gameId.includes(`-${step.round}-`)) return;
          const gameEl = document.querySelector<HTMLElement>(`.eg-game-card[data-game-id="${gameId}"]`);
          if (!gameEl) return;
          const beforeRows = walkthroughBeforeTeamOddsRef.current.get(gameId) ?? new Map<string, number>();
          const afterRows = afterMap.get(gameId) ?? new Map<string, number>();
          gameEl.querySelectorAll<HTMLElement>(".odds-value").forEach((oddsEl) => {
            const teamId = oddsEl.dataset.teamId ?? "";
            const fromVal = beforeRows.get(teamId);
            const toVal = afterRows.get(teamId);
            if (fromVal === undefined || toVal === undefined) return;
            oddsEl.classList.add("odds-cascading");
            animateOddsValue(oddsEl, fromVal, toVal, 600);
            window.setTimeout(() => oddsEl.classList.remove("odds-cascading"), 1000);
          });
        });
      }, step.oddsAt);
      walkthroughCascadeStepTimersRef.current.push(oddsTimer);
    });

    const finalizeTimer = window.setTimeout(() => {
      setWalkthroughCascadeSpotlightRound(null);
      setWalkthroughCascadeCaption("One upset. The entire South reshaped.");
    }, 12700);
    walkthroughCascadeStepTimersRef.current.push(finalizeTimer);

    const hideCaptionTimer = window.setTimeout(() => {
      // Clear all imperative DOM artifacts before advancing to bracket-ripple step
      clearOnboardingVisualArtifacts();
      setWalkthroughCascadeCaption(null);
      setWalkthroughCascadeSpotlightRound(null);
      setWalkthroughCascadePhase("done");
      setWalkthroughStep((prev) => (prev < 2 ? 2 : prev));
    }, 14700);
    walkthroughCascadeStepTimersRef.current.push(hideCaptionTimer);
  }, [
    currentWalkthroughStep?.id,
    displayMode,
    simResult.gameWinProbs,
    walkthroughActive,
    walkthroughCascadePhase,
    walkthroughCascadePathByRound,
    walkthroughMatchupId,
  ]);

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
        case "hook":
        case "ready":
          return null;
        case "upset-pick": {
          if (walkthroughCascadePhase !== "pick") {
            if (isMobile) return document.querySelector<HTMLElement>(".m-card");
            return southRegion;
          }
          const targetId = walkthroughMatchupId ?? findOnboardingUpsetMatchupId(games);
          if (isMobile) {
            return document.querySelector<HTMLElement>(`.m-card[data-game-id="${targetId}"]`);
          }
          return document.querySelector<HTMLElement>(`.eg-game-card[data-game-id="${targetId}"]`);
        }
        case "bracket-ripple": {
          if (isMobile) return document.querySelector<HTMLElement>(".m-card");
          const pathR32 = Array.from(walkthroughCascadePathByRound.R32)[0];
          const pathS16 = Array.from(walkthroughCascadePathByRound.S16)[0];
          return (
            (pathR32 ? document.querySelector<HTMLElement>(`.eg-game-card[data-game-id="${pathR32}"]`) : null) ??
            (pathS16 ? document.querySelector<HTMLElement>(`.eg-game-card[data-game-id="${pathS16}"]`) : null) ??
            southRegion?.querySelector<HTMLElement>(".lane-r32 .eg-game-card, .lane-s16 .eg-game-card") ??
            null
          );
        }
        case "futures-panel": {
          if (isMobile) {
            return document.querySelector<HTMLElement>(".mobile-futures-view");
          }
          return document.querySelector<HTMLElement>(".futures-full");
        }
        default:
          return null;
      }
    };

    const runPreAction = () => {
      if (!isMobile) {
        if (currentWalkthroughStep.id === "hook") {
          const targetId = walkthroughMatchupId ?? findOnboardingUpsetMatchupId(games);
          const target = document.querySelector<HTMLElement>(`.eg-game-card[data-game-id="${targetId}"]`);
          target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        }
        if (currentWalkthroughStep.id === "futures-panel") {
          setMainView("futures");
          window.setTimeout(() => {
            const merrimackRow = document.querySelector<HTMLElement>(`.ft-card[data-team-name="${ONBOARDING_UPSET_WINNER}"]`);
            const floridaRow = document.querySelector<HTMLElement>(`.ft-card[data-team-name="${ONBOARDING_UPSET_LOSER}"]`);
            const target = merrimackRow ?? floridaRow;
            target?.scrollIntoView({ behavior: "smooth", block: "center" });
            merrimackRow?.classList.add("futures-row--onboarding-highlight");
            floridaRow?.classList.add("futures-row--onboarding-highlight");
          }, 350);
        }
        if (currentWalkthroughStep.id === "ready") {
          if (walkthroughMatchupId && lockedPicks[walkthroughMatchupId]) {
            const nextLocks = { ...lockedPicks };
            delete nextLocks[walkthroughMatchupId];
            applyLockedPicksUpdate(nextLocks);
          }
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        return;
      }
      if (currentWalkthroughStep.id === "upset-pick") {
        setMobileTab("bracket");
        setMobileSection("South");
        setMobileRound("R64");
      }
      if (currentWalkthroughStep.id === "bracket-ripple") {
        setMobileTab("bracket");
        setMobileSection("South");
        setMobileRound("R32");
      }
      if (currentWalkthroughStep.id === "futures-panel") {
        setMobileTab("futures");
      }
      if (currentWalkthroughStep.id === "ready") {
        if (walkthroughMatchupId && lockedPicks[walkthroughMatchupId]) {
          const nextLocks = { ...lockedPicks };
          delete nextLocks[walkthroughMatchupId];
          applyLockedPicksUpdate(nextLocks);
        }
        setMobileTab("bracket");
        setMobileSection("South");
        setMobileRound("R64");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    };

    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const resolveTarget = async () => {
      runPreAction();
      const maxAttempts = 15;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (cancelled || token !== walkthroughResolveTokenRef.current) return;
        if (currentWalkthroughStep.centered) {
          setWalkthroughTargetEl(null);
          setWalkthroughTargetRect(null);
          return;
        }
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
  }, [
    currentWalkthroughStep,
    isMobile,
    lockedPicks,
    mobileRound,
    mobileSection,
    walkthroughActive,
    walkthroughCascadePhase,
    walkthroughCascadePathByRound,
    walkthroughMatchup,
    walkthroughMatchupId,
  ]);

  useEffect(() => {
    if (!walkthroughActive || !walkthroughTargetEl) return;
    let raf = 0;
    const update = () => {
      if (!walkthroughTargetEl) return;
      setWalkthroughTargetRect(walkthroughTargetEl.getBoundingClientRect());
    };
    const schedule = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(update);
    };
    const resizeObserver = new ResizeObserver(() => schedule());
    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(walkthroughTargetEl);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [walkthroughActive, walkthroughTargetEl]);

  useEffect(() => {
    const targetId = walkthroughMatchupId ?? findOnboardingUpsetMatchupId(games);
    const target =
      (targetId ? document.querySelector<HTMLElement>(`.eg-game-card[data-game-id="${targetId}"]`) : null) ??
      (targetId ? document.querySelector<HTMLElement>(`.m-card[data-game-id="${targetId}"]`) : null);
    if (!target) return;
    const shouldPulse = walkthroughActive && currentWalkthroughStep?.id === "upset-pick" && walkthroughCascadePhase === "pick";
    target.classList.toggle("matchup-highlight-pulse", shouldPulse);
    return () => target.classList.remove("matchup-highlight-pulse");
  }, [currentWalkthroughStep?.id, games, walkthroughActive, walkthroughCascadePhase, walkthroughMatchupId]);

  useEffect(() => {
    const clearSpotlight = () => {
      document.querySelectorAll<HTMLElement>(".wt-spotlight-target").forEach((el) => {
        el.classList.remove("wt-spotlight-target");
      });
    };

    const suppressSpotlight =
      (currentWalkthroughStep?.id === "upset-pick" && walkthroughCascadePhase === "animating") ||
      currentWalkthroughStep?.id === "bracket-ripple";

    if (!walkthroughActive || !walkthroughTargetEl || suppressSpotlight) {
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
  }, [currentWalkthroughStep?.id, walkthroughActive, walkthroughCascadePhase, walkthroughTargetEl]);

  useEffect(() => {
    if (currentWalkthroughStep?.id === "futures-panel") return;
    document.querySelectorAll(".futures-row--onboarding-highlight").forEach((el) => {
      el.classList.remove("futures-row--onboarding-highlight");
    });
  }, [currentWalkthroughStep?.id]);

  useEffect(() => {
    if (!walkthroughActive || !walkthroughTargetRect) return;
    if (currentWalkthroughStep?.id === "futures-panel" && !isMobile) {
      setTooltipPlacement("left");
      return;
    }
    if (isMobile) {
      setTooltipPlacement("below");
      return;
    }
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
  }, [currentWalkthroughStep?.id, isMobile, walkthroughActive, walkthroughTargetRect]);

  useEffect(() => {
    if (!walkthroughActive) return;
    const onNavigate = () => {
      setWalkthroughActive(false);
      setWalkthroughStep(0);
      setWalkthroughTargetEl(null);
      setWalkthroughTargetRect(null);
      setWalkthroughMatchupId(null);
    };
    window.addEventListener("popstate", onNavigate);
    return () => window.removeEventListener("popstate", onNavigate);
  }, [walkthroughActive]);

  useEffect(() => {
    if (!welcomeGateOpen || walkthroughActive) return;
    if (isMobile && showDesktopFirst) return;
    startWalkthrough();
  }, [isMobile, showDesktopFirst, startWalkthrough, walkthroughActive, welcomeGateOpen]);

  useEffect(() => {
    const inWalkthroughSession = welcomeGateOpen || walkthroughActive;
    if (!inWalkthroughSession) return;
    const handleWalkthroughKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      skipWalkthrough();
    };
    document.addEventListener("keydown", handleWalkthroughKeydown);
    return () => document.removeEventListener("keydown", handleWalkthroughKeydown);
  }, [welcomeGateOpen, walkthroughActive, skipWalkthrough]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "f" || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;
      event.preventDefault();
      setMainView((prev) => (prev === "futures" ? "bracket" : "futures"));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isMobile) {
        if (mobileTab !== "futures") return;
        setMobileTab("bracket");
        return;
      }
      if (mainView !== "futures") return;
      setMainView("bracket");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobile, mainView, mobileTab]);

  useEffect(() => {
    if (welcomeGateOpen) {
      document.body.classList.add("og-onboarding-open");
    } else {
      document.body.classList.remove("og-onboarding-open");
    }
    return () => document.body.classList.remove("og-onboarding-open");
  }, [welcomeGateOpen]);

  useEffect(() => {
    if (!walkthroughActive) {
      const topValue = Math.abs(parseInt(document.body.style.top || "0", 10));
      document.body.classList.remove("walkthrough-active");
      document.body.style.top = "";
      if (topValue > 0) window.scrollTo(0, topValue);
      return;
    }
    const scrollY = window.scrollY;
    document.body.style.top = `-${scrollY}px`;
    document.body.classList.add("walkthrough-active");
    return () => {
      const topValue = Math.abs(parseInt(document.body.style.top || "0", 10));
      document.body.classList.remove("walkthrough-active");
      document.body.style.top = "";
      window.scrollTo(0, topValue);
    };
  }, [walkthroughActive]);

  useEffect(() => {
    document.body.classList.remove("walkthrough-step-make-pick");
    if (walkthroughActive && currentWalkthroughStep?.id === "upset-pick") {
      document.body.classList.add("walkthrough-step-make-pick");
    }
    return () => document.body.classList.remove("walkthrough-step-make-pick");
  }, [walkthroughActive, currentWalkthroughStep?.id]);

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
  }, [isMobile, mainView]);

  const toolbar = (
    <div className="eg-main-actions toolbar">
      <button
        onClick={onUndo}
        disabled={undoStack.length === 0}
        className="eg-btn toolbar-btn--undo"
        style={!isMobile && mainView === "leaderboard" ? { display: "none" } : undefined}
      >
        Undo
      </button>
      <button
        onClick={onRequestResetAll}
        className="eg-btn toolbar-btn--reset"
        style={!isMobile && mainView === "leaderboard" ? { display: "none" } : undefined}
      >
        Reset All
      </button>
      {!isMobile ? (
        <button
          onClick={() => setMainView((prev) => (prev === "futures" ? "bracket" : "futures"))}
          className={`eg-btn toolbar-btn--futures ${mainView === "futures" ? "toolbar-btn--futures-active" : ""}`}
          style={!isMobile && mainView === "leaderboard" ? { display: "none" } : undefined}
        >
          <span className="futures-btn-icon">📊</span>
          <span className="futures-btn-label">Futures</span>
          {pickCount > 0 ? <span className="futures-btn-badge">{pickCount}</span> : null}
        </button>
      ) : null}
      <button
        onClick={onModelSim}
        className="eg-btn toolbar-btn--instant"
        style={!isMobile && mainView === "leaderboard" ? { display: "none" } : undefined}
      >
        Instant Sim
      </button>
      <button
        onClick={onModelSimStaggered}
        className="eg-btn toolbar-btn--staggered"
        disabled={staggeredSimRunning}
        style={!isMobile && mainView === "leaderboard" ? { display: "none" } : undefined}
      >
        {staggeredSimRunning ? "Staggered Sim Running..." : "Staggered Sim"}
      </button>
      <button
        onClick={onSaveBracket}
        className="eg-btn toolbar-btn--save toolbar-btn--save-action"
        disabled={saveStatus === "saving" || (isAuthenticated && !canSubmitBrackets)}
        title={
          !isAuthenticated
            ? "Sign in to submit your bracket"
            : submissionsLocked
              ? "Submissions locked at tip-off"
              : submissionLimitReached
                ? "Submission limit reached (25/25)"
                : `Submitted: ${submittedBracketCount}/25`
        }
        style={!isMobile && mainView === "leaderboard" ? { display: "none" } : undefined}
      >
        {saveStatus === "saving"
          ? "Submitting..."
          : saveStatus === "saved"
            ? "✓ Submitted"
            : saveStatus === "error"
              ? (saveErrorText?.includes("25")
                  ? "Submission limit reached (25/25)"
                  : saveErrorText?.toLowerCase().includes("locked")
                    ? "Submissions locked"
                    : "Error — try again")
              : `Submit Bracket ${isAuthenticated ? `(${submittedBracketCount}/25)` : ""}`}
      </button>
      {playInGames.length > 0 ? (
        <button
          onClick={() => setShowFirstFourModal(true)}
          className="eg-btn toolbar-btn--firstfour"
          style={!isMobile && mainView === "leaderboard" ? { display: "none" } : undefined}
        >
          First Four {allPlayInDecided ? "✓" : `(${decidedPlayInCount}/${playInGames.length})`}
        </button>
      ) : null}
      {isAuthenticated ? (
        <button
          onClick={() => setMyBracketsOpen(true)}
          className="eg-btn toolbar-btn--mybrackets"
          style={!isMobile && mainView === "leaderboard" ? { display: "none" } : undefined}
        >
          My Brackets
        </button>
      ) : null}
      {isMobile ? (
        <button
          onClick={() => setMobileTab("leaderboard")}
          className="eg-btn toolbar-btn--leaderboard"
        >
          🏆 Leaderboard
        </button>
      ) : (
        <button
          onClick={() => setMainView((prev) => (prev === "leaderboard" ? "bracket" : "leaderboard"))}
          className={`eg-btn toolbar-btn--leaderboard ${mainView === "leaderboard" ? "toolbar-btn--active-view" : ""}`}
        >
          {mainView === "leaderboard" ? "← Bracket" : "🏆 Leaderboard"}
        </button>
      )}
      <button
        onClick={onCopyShareLink}
        className="eg-btn copy-link-btn toolbar-btn--copy"
        data-copied={linkCopied ? "true" : "false"}
        aria-label="Copy shareable bracket link"
        style={!isMobile && mainView === "leaderboard" ? { display: "none" } : undefined}
      >
        {linkCopied ? "✓ Copied!" : "Copy Link"}
      </button>
      {staggeredSimRunning ? (
        <button
          onClick={onToggleStaggeredPause}
          className="eg-btn toolbar-btn--staggered-toggle"
          aria-label={staggeredSimPaused ? "Resume staggered simulation" : "Pause staggered simulation"}
          title={staggeredSimPaused ? "Resume staggered simulation" : "Pause staggered simulation"}
          style={!isMobile && mainView === "leaderboard" ? { display: "none" } : undefined}
        >
          {staggeredSimPaused ? "▶" : "⏸"}
        </button>
      ) : null}
      {staggeredSimRunning ? (
        <div
          className="eg-stagger-controls toolbar-btn--stagger-controls"
          style={!isMobile && mainView === "leaderboard" ? { display: "none" } : undefined}
        >
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
      <div
        className="odds-mode-toggle toolbar-btn--odds"
        style={!isMobile && mainView === "leaderboard" ? { display: "none" } : undefined}
      >
        <button
          className={`odds-mode-btn ${displayMode === "american" ? "odds-mode-btn--active" : ""}`}
          onClick={() => {
            showContextualHint(
              "toggle",
              "Switch between American odds (+300) and implied win probability (25.0%) across the entire product.",
              ".odds-mode-toggle",
              4000
            );
            trackEvent("odds_mode_toggled", {
              from: displayMode,
              to: "american",
            });
            setDisplayMode("american");
          }}
          aria-label="Show American odds"
        >
          +/-
        </button>
        <button
          className={`odds-mode-btn ${displayMode === "implied" ? "odds-mode-btn--active" : ""}`}
          onClick={() => {
            showContextualHint(
              "toggle",
              "Switch between American odds (+300) and implied win probability (25.0%) across the entire product.",
              ".odds-mode-toggle",
              4000
            );
            trackEvent("odds_mode_toggled", {
              from: displayMode,
              to: "implied",
            });
            setDisplayMode("implied");
          }}
          aria-label="Show implied percentage"
        >
          %
        </button>
      </div>
      {!isMobile && chaosScore !== null ? (
        <div
          className={`chaos-score-wrap ${chaosScoreChanged ? "chaos-score-pill--changed" : ""}`}
        >
          <button
            type="button"
            className="chaos-pill"
            data-level={chaosPillLevel}
            title={`Chaos Score: ${chaosScore.toFixed(1)} across ${pickCount} games. Higher = more unlikely bracket.`}
            onClick={onChaosPillTap}
          >
            <span className="chaos-pill-emoji">{chaosLabelData?.emoji ?? "📋"}</span>
            <span className="chaos-pill-label">{chaosLabelData?.label ?? "Chalk"}</span>
            <span className="chaos-pill-score">{chaosScore.toFixed(1)}</span>
            {chaosPercentile !== null ? <span className="chaos-pill-pct">Top {Math.max(1, Math.round(100 - chaosPercentile))}%</span> : null}
          </button>
        </div>
      ) : null}
      {isAuthenticated && submissionsLocked ? (
        <div className="bracket-lock-banner" style={!isMobile && mainView === "leaderboard" ? { display: "none" } : undefined}>
          🔒 Submissions locked at tip-off. Tournament is live — check the leaderboard.
        </div>
      ) : null}
    </div>
  );

  const chaosTrackerBar =
    staggeredSimRunning ? (
      <div className="chaos-tracker-bar">
        <div className="chaos-tracker-left">
          <span className="chaos-tracker-title">CHAOS SCORE</span>
          <span className="chaos-tracker-total">{staggeredChaosTotal.toFixed(1)}</span>
        </div>
        <div className="chaos-tracker-center">
          {staggeredLastGameChaos !== null ? (
            <span className="chaos-tracker-last-game" key={`${staggeredGamesResolved}-${staggeredLastGameLabel}`}>
              +{staggeredLastGameChaos.toFixed(2)}
              <span className="chaos-tracker-game-label">{staggeredLastGameLabel}</span>
            </span>
          ) : null}
        </div>
        <div className="chaos-tracker-right">
          <span className="chaos-tracker-count">
            {staggeredGamesResolved}/{staggeredTotalGames}
          </span>
          <span className="chaos-tracker-count-label">games</span>
        </div>
      </div>
    ) : null;

  const mobileChaosBadge =
    chaosScore !== null ? (
      <button
        type="button"
        className={`chaos-pill chaos-pill--mobile ${chaosScoreChanged ? "chaos-score-pill--changed" : ""}`}
        data-level={chaosPillLevel}
        title={`Chaos Score: ${chaosScore.toFixed(1)} across ${pickCount} games. Higher = more unlikely bracket.`}
        onClick={onChaosPillTap}
      >
        <span className="chaos-pill-emoji">{chaosLabelData?.emoji ?? "📋"}</span>
        <span className="chaos-pill-label">{chaosLabelData?.label ?? "Chalk"}</span>
        <span className="chaos-pill-score">{chaosScore.toFixed(1)}</span>
        {chaosPercentile !== null ? (
          <span className="chaos-pill-pct">Top {Math.max(1, Math.round(100 - chaosPercentile))}%</span>
        ) : null}
      </button>
    ) : null;

  const championGame = games.find((game) => game.round === "CHAMP");
  const championPickId = championGame?.winnerId ?? null;
  const finalFourPickIds = new Set(
    games
      .filter((game) => game.round === "E8" && game.winnerId)
      .map((game) => game.winnerId as string)
  );
  const futuresViewRows = useMemo(
    () =>
      simResult.futures
        .map((row) => {
          const team = teamsById.get(row.teamId);
          if (!team) return null;
          const baseline = baselineByTeamId.get(row.teamId);
          const champDelta = row.champProb - (baseline?.champProb ?? 0);
          return {
            row,
            team,
            baseline,
            champDelta,
            isEliminated: row.champProb <= 0.000001,
            isChampionPick: championPickId === row.teamId,
            isFinalFourPick: finalFourPickIds.has(row.teamId),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    [simResult.futures, baselineByTeamId, championPickId, finalFourPickIds]
  );

  const championPickTeam = championPickId ? teamsById.get(championPickId) ?? null : null;
  const championPickRow = championPickId ? simResult.futures.find((row) => row.teamId === championPickId) ?? null : null;
  const finalFourPickTeams = games
    .filter((game) => game.round === "E8")
    .map((game) => (game.winnerId ? teamsById.get(game.winnerId) ?? null : null));
  const estimatedChalkScore =
    pickCount === 0 || chaosScore === null
      ? 100
      : Math.max(0, Math.min(100, Math.round((1 - chaosScore / Math.max(1, pickCount)) * 100)));
  const displayedPickCount = Math.min(pickCount, URL_EXPECTED_GAME_COUNT);
  const futuresOddsLabel = (prob: number): string => {
    if (displayMode === "american" && prob <= 0) return "0%";
    return formatOddsDisplay(prob, displayMode).primary;
  };

  const futuresMovers = useMemo(() => {
    const withDelta = futuresViewRows
      .filter((entry) => hasMeaningfulDelta(computeDelta(entry.row.champProb, entry.baseline?.champProb ?? 0, displayMode), displayMode));

    const gainers = [...withDelta]
      .filter((entry) => entry.champDelta > 0)
      .sort((a, b) => b.champDelta - a.champDelta)
      .slice(0, 5);
    const losers = [...withDelta]
      .filter((entry) => entry.champDelta < 0)
      .sort((a, b) => a.champDelta - b.champDelta)
      .slice(0, 5);
    return { gainers, losers };
  }, [displayMode, futuresViewRows]);

  const pickTeamIds = useMemo(() => {
    const ids = new Set<string>();
    if (championPickId) ids.add(championPickId);
    for (const team of finalFourPickTeams) {
      if (team?.id) ids.add(team.id);
    }
    return ids;
  }, [championPickId, finalFourPickTeams]);

  const moverIds = useMemo(
    () => new Set<string>([...futuresMovers.gainers, ...futuresMovers.losers].map((entry) => entry.team.id)),
    [futuresMovers.gainers, futuresMovers.losers]
  );

  const topContenders = useMemo(() => {
    return futuresViewRows
      .filter((entry) => !entry.isEliminated)
      .filter((entry) => !pickTeamIds.has(entry.team.id))
      .filter((entry) => !moverIds.has(entry.team.id))
      .sort((a, b) => b.row.champProb - a.row.champProb)
      .slice(0, 12);
  }, [futuresViewRows, moverIds, pickTeamIds]);

  const topContenderIds = useMemo(() => new Set(topContenders.map((entry) => entry.team.id)), [topContenders]);

  const fieldRows = useMemo(() => {
    return futuresViewRows
      .filter((entry) => !entry.isEliminated)
      .filter((entry) => !pickTeamIds.has(entry.team.id))
      .filter((entry) => !moverIds.has(entry.team.id))
      .filter((entry) => !topContenderIds.has(entry.team.id))
      .sort((a, b) => b.row.champProb - a.row.champProb);
  }, [futuresViewRows, moverIds, pickTeamIds, topContenderIds]);

  const eliminatedRows = useMemo(
    () =>
      futuresViewRows
        .filter((entry) => entry.isEliminated)
        .sort((a, b) => a.team.name.localeCompare(b.team.name)),
    [futuresViewRows]
  );

  const futuresContent = (
    <div className="futures-full">
      <div className="futures-header">
        <div className="futures-header-left">
          <h2 className="futures-title">FUTURES</h2>
          <span className="futures-subtitle">How your picks shift every team&apos;s odds</span>
        </div>
        <button
          className="ft-back-btn"
          type="button"
          onClick={() => {
            if (isMobile) setMobileTab("bracket");
            else setMainView("bracket");
          }}
        >
          ← Back to Bracket
        </button>
      </div>

      {isUpdating ? <p className="eg-updating">Updating…</p> : null}
      <div className="ft-stats-bar">
        <div className="ft-stat">
          <span className="ft-stat-value">{displayedPickCount}/63</span>
          <span className="ft-stat-label">PICKS</span>
        </div>
        <div className="ft-stat-divider" />
        <div className="ft-stat">
          <span className="ft-stat-value">{estimatedChalkScore}%</span>
          <span className="ft-stat-label">CHALK</span>
        </div>
        <div className="ft-stat-divider" />
        <div className="ft-stat">
          <span className="ft-stat-value">{toImpliedLabel(simResult.likelihoodSimulation)}</span>
          <span className="ft-stat-label">LIKELIHOOD</span>
        </div>
      </div>

      {!championPickTeam && finalFourPickTeams.every((team) => !team) ? (
        <section className="ft-section">
          <div className="ft-picks-empty-compact">
            <span className="ft-picks-empty-label">YOUR PICKS</span>
            <span className="ft-picks-empty-text">Champion and Final Four will appear here as you pick.</span>
          </div>
        </section>
      ) : (
        <section className="ft-section ft-section--picks">
          <div className="ft-section-header">
            <h3 className="ft-section-title">YOUR PICKS</h3>
          </div>
          <div className="ft-picks-grid">
            {championPickTeam ? (
              <article className="ft-pick-card ft-pick-card--champion">
              <span className="ft-pick-card-badge">👑 YOUR CHAMPION</span>
              <div className="ft-pick-card-main">
                <TeamLogo
                  teamName={championPickTeam.name}
                  src={teamLogoUrl(championPickTeam)}
                  className="ft-pick-card-logo ft-pick-card-logo--lg"
                  teamSeed={seedLabel(championPickTeam)}
                />
                <div className="ft-pick-card-info">
                  <span className="ft-pick-card-seed">#{seedLabel(championPickTeam)} · {championPickTeam.region}</span>
                  <span className="ft-pick-card-name">{championPickTeam.name}</span>
                </div>
              </div>
              <div className="ft-pick-card-odds">
                <span className="ft-pick-card-odds-value">{futuresOddsLabel(championPickRow?.champProb ?? 0)}</span>
                <span className="ft-pick-card-odds-label">TITLE</span>
              </div>
              {championPickRow ? (
                (() => {
                  const championDelta = computeDelta(championPickRow.champProb, baselineByTeamId.get(championPickRow.teamId)?.champProb ?? 0, displayMode);
                  if (!hasMeaningfulDelta(championDelta, displayMode)) return null;
                  return (
                    <span className={championDelta > 0 ? "ft-delta--up" : "ft-delta--down"}>
                      {championDelta > 0 ? "▲" : "▼"}
                      {formatDelta(Math.abs(championDelta), displayMode)}
                    </span>
                  );
                })()
              ) : null}
              </article>
            ) : (
              <article className="ft-pick-card ft-pick-card--champion ft-pick-card--empty">
              <span className="ft-pick-card-badge-muted">CHAMPION</span>
              <span className="ft-pick-card-empty-text">Not yet picked</span>
              </article>
            )}
            <div className="ft-f4-row">
              {[0, 1, 2, 3].map((idx) => {
                const team = finalFourPickTeams[idx];
                if (!team) {
                  return (
                    <article key={`f4-empty-${idx}`} className="ft-pick-card ft-pick-card--f4 ft-pick-card--empty">
                      <span className="ft-pick-card-empty-text">?</span>
                    </article>
                  );
                }
                const teamRow = futuresViewRows.find((entry) => entry.team.id === team.id);
                const isChampion = championPickId === team.id;
                const shownProb = isChampion ? teamRow?.row.champProb ?? 0 : teamRow?.row.final4Prob ?? 0;
                return (
                  <article key={`${team.id}-${idx}`} className="ft-pick-card ft-pick-card--f4">
                    <span className="ft-pick-card-badge-muted">F4 · {team.region}</span>
                    <div className="ft-pick-card-main">
                      <TeamLogo teamName={team.name} src={teamLogoUrl(team)} className="ft-pick-card-logo" teamSeed={seedLabel(team)} />
                      <div className="ft-pick-card-info">
                        <span className="ft-pick-card-seed">#{seedLabel(team)}</span>
                        <span className="ft-pick-card-name ft-pick-card-name--sm">{team.name}</span>
                      </div>
                    </div>
                    <div className="ft-pick-card-odds">
                      <span className="ft-pick-card-odds-value ft-pick-card-odds-value--sm">
                        {futuresOddsLabel(shownProb)}
                      </span>
                      <span className="ft-pick-card-odds-label">{isChampion ? "TITLE" : "F4"}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {futuresMovers.gainers.length > 0 || futuresMovers.losers.length > 0 ? (
        <section className="ft-section ft-section--movers">
          <div className="ft-section-header">
            <h3 className="ft-section-title">BIGGEST MOVERS</h3>
            <span className="ft-section-subtitle">How your picks shifted the landscape</span>
          </div>
          <div className="ft-movers-grid">
            <div className="ft-movers-col">
              <span className="ft-movers-col-label ft-movers-col-label--up">▲ GAINING</span>
              {futuresMovers.gainers.map((entry) => {
                const delta = computeDelta(entry.row.champProb, entry.baseline?.champProb ?? 0, displayMode);
                return (
                  <div key={`gainer-${entry.team.id}`} className="ft-mover-row">
                    <TeamLogo teamName={entry.team.name} src={teamLogoUrl(entry.team)} className="ft-mover-logo" teamSeed={seedLabel(entry.team)} />
                    <span className="ft-mover-seed">#{seedLabel(entry.team)}</span>
                    <span className="ft-mover-name">{entry.team.name}</span>
                    <span className="ft-mover-odds">{futuresOddsLabel(entry.row.champProb)}</span>
                    <span className="ft-delta--up">▲{formatDelta(Math.abs(delta), displayMode)}</span>
                  </div>
                );
              })}
            </div>
            <div className="ft-movers-divider" />
            <div className="ft-movers-col">
              <span className="ft-movers-col-label ft-movers-col-label--down">▼ DROPPING</span>
              {futuresMovers.losers.map((entry) => {
                const delta = computeDelta(entry.row.champProb, entry.baseline?.champProb ?? 0, displayMode);
                return (
                  <div key={`loser-${entry.team.id}`} className="ft-mover-row">
                    <TeamLogo teamName={entry.team.name} src={teamLogoUrl(entry.team)} className="ft-mover-logo" teamSeed={seedLabel(entry.team)} />
                    <span className="ft-mover-seed">#{seedLabel(entry.team)}</span>
                    <span className="ft-mover-name">{entry.team.name}</span>
                    <span className="ft-mover-odds">{futuresOddsLabel(entry.row.champProb)}</span>
                    <span className="ft-delta--down">▼{formatDelta(Math.abs(delta), displayMode)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {topContenders.length > 0 ? (
        <section className="ft-section">
          <div className="ft-section-header">
            <h3 className="ft-section-title">TOP CONTENDERS</h3>
          </div>
          <div className="ft-contenders-grid">
            {topContenders.map((entry) => {
              const delta = computeDelta(entry.row.champProb, entry.baseline?.champProb ?? 0, displayMode);
              return (
                <article key={`contender-${entry.team.id}`} className="ft-contender-card">
                  <div className="ft-contender-left">
                    <TeamLogo teamName={entry.team.name} src={teamLogoUrl(entry.team)} className="ft-contender-logo" teamSeed={seedLabel(entry.team)} />
                    <div className="ft-contender-info">
                      <span className="ft-contender-seed">#{seedLabel(entry.team)} · {entry.team.region}</span>
                      <span className="ft-contender-name">{entry.team.name}</span>
                    </div>
                  </div>
                  <div className="ft-contender-right">
                    <span className="ft-contender-odds">{futuresOddsLabel(entry.row.champProb)}</span>
                    {hasMeaningfulDelta(delta, displayMode) ? (
                      <span className={delta > 0 ? "ft-delta--up" : "ft-delta--down"}>
                        {delta > 0 ? "▲" : "▼"}
                        {formatDelta(Math.abs(delta), displayMode)}
                      </span>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {fieldRows.length > 0 ? (
        <section className="ft-section">
          <button type="button" className="ft-section-toggle" onClick={() => setFuturesFieldExpanded((prev) => !prev)}>
            <h3 className="ft-section-title">THE FIELD</h3>
            <span className="ft-section-count">{fieldRows.length} teams</span>
            <span className="ft-section-chevron">{futuresFieldExpanded ? "▾" : "▸"}</span>
          </button>
          {futuresFieldExpanded ? (
            <div className="ft-field-list">
              {fieldRows.map((entry) => (
                <article key={`field-${entry.team.id}`} className="ft-field-row">
                  <TeamLogo teamName={entry.team.name} src={teamLogoUrl(entry.team)} className="ft-field-logo" teamSeed={seedLabel(entry.team)} />
                  <span className="ft-field-seed">#{seedLabel(entry.team)}</span>
                  <span className="ft-field-name">{entry.team.name}</span>
                  <span className="ft-field-odds">{futuresOddsLabel(entry.row.champProb)}</span>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {eliminatedRows.length > 0 ? (
        <section className="ft-section">
          <button
            type="button"
            className="ft-section-toggle"
            onClick={() => setFuturesEliminatedExpanded((prev) => !prev)}
          >
            <h3 className="ft-section-title">ELIMINATED</h3>
            <span className="ft-section-count">{eliminatedRows.length} teams</span>
            <span className="ft-section-chevron">{futuresEliminatedExpanded ? "▾" : "▸"}</span>
          </button>
          {futuresEliminatedExpanded ? (
            <div className="ft-eliminated-list">
              {eliminatedRows.map((entry) => (
                <span key={`elim-${entry.team.id}`} className="ft-eliminated-name">
                  <span className="ft-eliminated-x">✗</span> {entry.team.name}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="ft-footer">
        <div className="ft-footer-likelihood">
          <span className="ft-footer-label">YOUR BRACKET LIKELIHOOD</span>
          <span className="ft-footer-value">{toImpliedLabel(simResult.likelihoodSimulation)}</span>
          <span className="ft-footer-approx">(approx {toImpliedLabel(simResult.likelihoodApprox)})</span>
        </div>
        <p className="ft-footer-explainer">
          Odds shown are conditioned on your picks. Make a pick in the bracket to see how every team&apos;s odds shift.
        </p>
      </div>
    </div>
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
              <span className="beta-badge">BETA</span>
            </a>
            <div className="og-top-nav-tabs">
              <a
                className="og-top-nav-link"
                href="https://oddsgods.net/blog"
                target="_blank"
                rel="noopener noreferrer"
              >
                Blog
              </a>
              <a className="og-top-nav-link" href="/god-rankings.html" target="_blank" rel="noopener noreferrer">
                Odds Gods Rankings
              </a>
            </div>
            <div className="og-top-nav-auth">
              {authLoading ? (
                <span className="nav-auth-loading">...</span>
              ) : isAuthenticated ? (
                <div className="nav-user-info">
                  <span className="nav-user-name">{profile?.display_name || user?.email || "User"}</span>
                  <button className="nav-signout-btn" onClick={() => signOut()}>
                    Sign out
                  </button>
                </div>
              ) : (
                <button className="nav-signin-btn" onClick={() => setAuthModalOpen(true)}>
                  Log in / Sign up
                </button>
              )}
            </div>
          </div>
          <div className="og-top-nav-mobile">
            <div className="nav-left">
              <a className="og-mobile-logo-link" href={LANDING_URL} aria-label="Odds Gods home">
                <img className="nav-logo-icon nav-logo" src="/logo-icon.png?v=20260225" alt="Odds Gods" />
              </a>
              <span className="nav-product-title nav-wordmark">ODDS GODS</span>
              <span className="beta-badge nav-beta">BETA</span>
            </div>
            <div className="nav-right">
              <a className="og-top-nav-link" href="https://oddsgods.net/blog" target="_blank" rel="noopener noreferrer">
                Blog
              </a>
              <a className="og-top-nav-link" href="/god-rankings.html" target="_blank" rel="noopener noreferrer">
                Rankings
              </a>
              {isAuthenticated ? (
                <>
                  <span className="nav-user-name nav-user-name--mobile">{profile?.display_name || user?.email || "User"}</span>
                  <button className="nav-signout-btn nav-signout-btn--mobile nav-auth-btn" onClick={() => signOut()}>
                    Sign out
                  </button>
                </>
              ) : (
                <button className="nav-signin-btn nav-signin-btn--mobile nav-auth-btn" onClick={() => setAuthModalOpen(true)}>
                  Log in
                </button>
              )}
            </div>
          </div>
        </nav>
        {!isMobile ? (
          <div className="live-odds-band">
            <LiveOddsStrip
              topContenders={liveOddsTopContenders}
              justChangedIds={liveOddsChangedIds}
              displayMode={displayMode}
              onOpenFutures={() => setMainView("futures")}
            />
          </div>
        ) : null}
        <header className={`eg-header ${isMobile ? "mobile-hidden" : ""}`}>
          <h1>The Bracket Lab</h1>
          <p className="eg-subtitle">
            March Madness what-if odds. Click picks to update futures in real time based on your picks.
          </p>
        </header>
        {isMobile ? (
          <section className="eg-mobile-shell">
            <div className="mobile-toolbar-wrapper">{toolbar}</div>
            {chaosTrackerBar}
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
                      onOpenMatchupStats={openMatchupStats}
                      mobileChaosBadge={mobileChaosBadge}
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
                      onOpenMatchupStats={openMatchupStats}
                      mobileChaosBadge={mobileChaosBadge}
                    />
                  )}
                </div>
              </>
            ) : mobileTab === "futures" ? (
              <div className="mobile-futures-view">{futuresContent}</div>
            ) : (
              <div className="mobile-futures-view">
                <LeaderboardFullWidth
                  isVisible={mobileTab === "leaderboard"}
                  refreshKey={leaderboardRefreshKey}
                />
              </div>
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
          <section className="eg-layout">
            <div className="eg-main-panel">
              {toolbar}
              {chaosTrackerBar}
              <div className="eg-bracket-stack" style={{ display: mainView === "bracket" ? undefined : "none" }}>
                <div style={{ display: topHalfVisuallyCollapsed ? "block" : "none" }}>
                  <CollapsedHalfSummary
                    half="top"
                    games={games}
                    onExpand={() => handleExpandHalf("top")}
                  />
                </div>
                <section
                  className="eg-bracket-section top-half"
                  data-half-expanded={topHalfManuallyExpanded ? "true" : "false"}
                  style={{ display: topHalfVisuallyCollapsed ? "none" : undefined }}
                >
                  <div className="eg-section-head">
                    <h2>Top Half Bracket</h2>
                    <p>· {regionSections[0][0]} + {regionSections[0][1]}</p>
                    {topHalfComplete ? (
                      <button className="half-section-collapse-btn" onClick={() => handleCollapseHalf("top")}>
                        Collapse ↑
                      </button>
                    ) : null}
                  </div>
                  <div className="eg-region-scroll">
                    <div className="eg-region-grid bracket-style">
                      {regionSections[0].map((region) => (
                        <RegionBracket
                          key={`${region}-top`}
                          region={region}
                          games={games}
                          gameWinProbs={simResult.gameWinProbs}
                          possibleWinners={possibleWinners}
                          onPick={onPick}
                          lastPickedKey={lastPickedKey}
                          onResetRegion={onRequestResetRegion}
                          inverted={invertedRegions.has(region)}
                          displayMode={displayMode}
                          onOpenProbabilityPopup={openProbabilityPopup}
                          onOpenMatchupStats={openMatchupStats}
                          onUnavailableRoundClick={onUnavailableRoundClick}
                          onToggleRoundExpansion={toggleRoundExpansion}
                          isRoundComplete={isRoundComplete}
                          isRoundVisuallyCollapsed={isRoundVisuallyCollapsed}
                          walkthroughChangedGameIds={walkthroughChangedGameIds}
                          walkthroughChangedOddsVisible={walkthroughActive && (currentWalkthroughStep?.id === "bracket-ripple" || currentWalkthroughStep?.id === "futures-panel")}
                          walkthroughCascadeSpotlightRound={
                            walkthroughActive && currentWalkthroughStep?.id === "upset-pick" && walkthroughCascadePhase === "animating"
                              ? walkthroughCascadeSpotlightRound
                              : null
                          }
                          walkthroughCascadePathByRound={walkthroughCascadePathByRound}
                        />
                      ))}
                    </div>
                  </div>
                </section>

                <div style={{ display: bottomHalfVisuallyCollapsed ? "block" : "none" }}>
                  <CollapsedHalfSummary
                    half="bottom"
                    games={games}
                    onExpand={() => handleExpandHalf("bottom")}
                  />
                </div>
                <section
                  className="eg-bracket-section bottom-half"
                  data-half-expanded={bottomHalfManuallyExpanded ? "true" : "false"}
                  style={{ display: bottomHalfVisuallyCollapsed ? "none" : undefined }}
                >
                  <div className="eg-section-head">
                    <h2>Bottom Half Bracket</h2>
                    <p>· {regionSections[1][0]} + {regionSections[1][1]}</p>
                    {bottomHalfComplete ? (
                      <button className="half-section-collapse-btn" onClick={() => handleCollapseHalf("bottom")}>
                        Collapse ↑
                      </button>
                    ) : null}
                  </div>
                  <div className="eg-region-scroll">
                    <div className="eg-region-grid bracket-style">
                      {regionSections[1].map((region) => (
                        <RegionBracket
                          key={`${region}-bottom`}
                          region={region}
                          games={games}
                          gameWinProbs={simResult.gameWinProbs}
                          possibleWinners={possibleWinners}
                          onPick={onPick}
                          lastPickedKey={lastPickedKey}
                          onResetRegion={onRequestResetRegion}
                          inverted={invertedRegions.has(region)}
                          displayMode={displayMode}
                          onOpenProbabilityPopup={openProbabilityPopup}
                          onOpenMatchupStats={openMatchupStats}
                          onUnavailableRoundClick={onUnavailableRoundClick}
                          onToggleRoundExpansion={toggleRoundExpansion}
                          isRoundComplete={isRoundComplete}
                          isRoundVisuallyCollapsed={isRoundVisuallyCollapsed}
                          walkthroughChangedGameIds={walkthroughChangedGameIds}
                          walkthroughChangedOddsVisible={walkthroughActive && (currentWalkthroughStep?.id === "bracket-ripple" || currentWalkthroughStep?.id === "futures-panel")}
                          walkthroughCascadeSpotlightRound={
                            walkthroughActive && currentWalkthroughStep?.id === "upset-pick" && walkthroughCascadePhase === "animating"
                              ? walkthroughCascadeSpotlightRound
                              : null
                          }
                          walkthroughCascadePathByRound={walkthroughCascadePathByRound}
                        />
                      ))}
                    </div>
                  </div>
                </section>

                <section className="eg-finals-card bracket-finals">
                  <h2 className="ff-section-header">Final Four & Championship</h2>
                  <div className="ff-championship-section">
                    <FinalsSemifinalCard
                      game={leftSemi}
                      regions={regionSections[0]}
                      gameWinProbs={simResult.gameWinProbs}
                      possibleWinners={possibleWinners}
                      futuresRows={simResult.futures}
                      displayMode={displayMode}
                      regionLabel={`${regionSections[0][0]} + ${regionSections[0][1]}`}
                      lastPickedKey={lastPickedKey}
                      onPick={onPick}
                    />
                    <FinalsChampionshipCard
                      game={titleGame}
                      gameWinProbs={simResult.gameWinProbs}
                      possibleWinners={possibleWinners}
                      futuresRows={simResult.futures}
                      displayMode={displayMode}
                      lastPickedKey={lastPickedKey}
                      onPick={onPick}
                    />
                    <FinalsSemifinalCard
                      game={rightSemi}
                      regions={regionSections[1]}
                      gameWinProbs={simResult.gameWinProbs}
                      possibleWinners={possibleWinners}
                      futuresRows={simResult.futures}
                      displayMode={displayMode}
                      regionLabel={`${regionSections[1][0]} + ${regionSections[1][1]}`}
                      lastPickedKey={lastPickedKey}
                      onPick={onPick}
                    />
                  </div>
                </section>
              </div>
              <div style={{ display: mainView === "leaderboard" ? undefined : "none" }}>
                <LeaderboardFullWidth
                  isVisible={mainView === "leaderboard"}
                  refreshKey={leaderboardRefreshKey}
                  onClose={() => setMainView("bracket")}
                />
              </div>
              <div style={{ display: mainView === "futures" ? undefined : "none" }}>{futuresContent}</div>
            </div>
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

      <ConfirmResetModal
        visible={Boolean(resetModalConfig)}
        title={resetModalConfig?.title ?? ""}
        message={resetModalConfig?.message ?? ""}
        confirmLabel={resetModalConfig?.confirmLabel ?? "Confirm"}
        onConfirm={resetModalConfig?.onConfirm ?? (() => {})}
        onCancel={() => setResetModalConfig(null)}
      />

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />

      <MyBracketsModal
        isOpen={myBracketsOpen}
        onClose={() => setMyBracketsOpen(false)}
        onLoadBracket={onLoadSavedBracket}
        onRenameSuccess={onBracketRenamed}
        currentPicks={sanitized}
        currentChaosScore={chaosScore ?? 0}
      />

      {statsModalGame ? (
        <MatchupStatsModal
          game={statsModalGame}
          onClose={() => setStatsModalGameId(null)}
        />
      ) : null}

      {showChaosModal && chaosScore !== null ? (
        <div className="chaos-modal-overlay" onClick={() => setShowChaosModal(false)}>
          <div className="chaos-modal" onClick={(event) => event.stopPropagation()}>
            <div className="chaos-modal-header">
              <span>CHAOS SCORE</span>
              <button onClick={() => setShowChaosModal(false)} aria-label="Close chaos explainer">
                ✕
              </button>
            </div>
            <div className="chaos-modal-score">
              <span className="chaos-number">{chaosScore.toFixed(1)}</span>
              <span className="chaos-label-lg">
                {getChaosLabel(chaosScore, pickCount)?.emoji ?? "📋"} {getChaosLabel(chaosScore, pickCount)?.label ?? "Chalk"}
              </span>
            </div>
            <div className="chaos-scale">
              <div className="chaos-scale-bar">
                <div className="chaos-scale-fill" style={{ width: `${chaosScaleInvertedPct}%` }} />
                <div className="chaos-scale-marker" style={{ left: `${chaosScaleInvertedPct}%` }} />
              </div>
              <div className="chaos-scale-labels">
                <span>🧊 Chalk</span>
                <span>⚡ Balanced</span>
                <span>🔥 Chaos</span>
              </div>
            </div>
            <p className="chaos-desc">
              Your Chaos Score sums -ln(model win probability) across your picked winners. Higher means a more upset-heavy bracket.
            </p>
            {chaosPercentile !== null && pickCount === URL_EXPECTED_GAME_COUNT ? (
              <p className="chaos-pct">
                More upset-heavy than <strong>{Math.round(chaosPercentile)}%</strong> of simulated full brackets.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {showCompletionCelebration && completionCelebrationData ? (
        <BracketCompletionCelebration
          championName={completionCelebrationData.championName}
          chaosLabel={completionCelebrationData.chaosLabel}
          chaosEmoji={completionCelebrationData.chaosEmoji}
          onSave={onCompletionSave}
          onClose={() => setShowCompletionCelebration(false)}
        />
      ) : null}

      <PromoCTA
        visible={promoCTAVisible}
        onDismiss={handlePromoDismiss}
        onSignUp={handlePromoSignUp}
      />

      {walkthroughActive && walkthroughCascadePhase === "animating" && walkthroughCascadeCaption ? (
        <div className="cascade-caption">{walkthroughCascadeCaption}</div>
      ) : null}

      {walkthroughActive &&
      walkthroughDisplayStep &&
      !(currentWalkthroughStep?.id === "upset-pick" && walkthroughCascadePhase === "animating") &&
      (isWalkthroughStepCentered || Boolean(walkthroughTargetRect)) ? (
        <Suspense fallback={null}>
          <SpotlightWalkthrough
            step={walkthroughDisplayStep}
            stepIndex={walkthroughStep}
            targetRect={walkthroughTargetRect}
            placement={tooltipPlacement}
            ctaDisabled={walkthroughCtaDisabled}
            ctaLabel={walkthroughCtaLabel}
            centered={isWalkthroughStepCentered}
            dontShowAgain={walkthroughDontShowAgain}
            onDontShowAgainChange={setWalkthroughDontShowAgain}
            onAdvance={() => {
              if (walkthroughCtaDisabled) return;
              const highlighted = walkthroughMatchup;
              const pickedTeamId = highlighted?.id ? sanitized[highlighted.id] ?? null : null;
              const pickedTeam = pickedTeamId ? teamsById.get(pickedTeamId) ?? null : null;
              const opponentTeam =
                highlighted && pickedTeamId && highlighted.teamAId && highlighted.teamBId
                  ? teamsById.get(highlighted.teamAId === pickedTeamId ? highlighted.teamBId : highlighted.teamAId) ?? null
                  : null;
              trackEvent("onboarding_step_completed", {
                step: walkthroughStep + 1,
                matchup_id: highlighted?.id ?? null,
                picked_team: pickedTeamId,
                was_upset: Boolean(pickedTeam && opponentTeam && pickedTeam.seed > opponentTeam.seed),
              });
              if (currentWalkthroughStep.id === "ready") {
                completeWalkthrough();
                return;
              }
              setWalkthroughStep((prev) => Math.min(prev + 1, WALKTHROUGH_STEPS.length - 1));
            }}
            onBack={() => {
              if (currentWalkthroughStep?.id === "bracket-ripple") {
                // Full region reset: clears simGeneratedGameIds, expanded rounds, etc.
                onResetRegion(ONBOARDING_UPSET_REGION);
                // Also clear cascade timers/visual artifacts and reset cascade phase
                resetUpsetStepState();
                setWalkthroughStep(1);
                return;
              }
              setWalkthroughStep((prev) => Math.max(0, prev - 1));
            }}
            onSkip={() => skipWalkthrough()}
          />
        </Suspense>
      ) : null}

      {showDesktopFirst && isMobile ? <DesktopFirstModal onDismiss={handleDismissDesktopFirst} /> : null}

      {showFirstFourModal && onboardingFlowReady ? (
        <FirstFourModal
          playInGames={playInGames}
          gameWinProbs={simResult.gameWinProbs}
          onPick={(gameId, teamId) => {
            const playInGame = gameById.get(gameId);
            if (!playInGame || !teamId) return;
            onPick(playInGame, teamId);
          }}
          onRandomize={handleRandomizeFirstFour}
          onClose={() => setShowFirstFourModal(false)}
        />
      ) : null}

      {activeHint ? (
        <ContextualHint
          message={activeHint.message}
          rect={activeHint.rect}
          onDismiss={() => setActiveHint(null)}
        />
      ) : null}

      {shareToastVisible ? <div className="share-toast">Image saved! Share it on social media.</div> : null}

      {shareModalVisible ? (
        <>
          <div className="share-card-renderers" aria-hidden="true">
            <StoryShareCard cardRef={shareStoryRef} data={shareCardComputedData} />
            <TwitterShareCard cardRef={shareTwitterRef} data={shareCardComputedData} />
          </div>

          <div className="share-modal-overlay" onClick={onCloseShareModal}>
            <div className="share-modal" onClick={(event) => event.stopPropagation()}>
              <div className="share-modal-header">
                <span className="share-modal-title">Share Your Bracket</span>
                <button className="share-modal-close" onClick={onCloseShareModal} disabled={Boolean(shareExporting)}>
                  ✕
                </button>
              </div>

              <div className="share-modal-options">
                <button
                  className="share-format-btn"
                  onClick={() => void onExportShareFormat("story")}
                  disabled={Boolean(shareExporting)}
                >
                  <span className="share-format-icon">📱</span>
                  <span className="share-format-label">Story / Text</span>
                  <span className="share-format-size">1080×1920</span>
                </button>
                <button
                  className="share-format-btn"
                  onClick={() => void onExportShareFormat("twitter")}
                  disabled={Boolean(shareExporting)}
                >
                  <span className="share-format-icon">🐦</span>
                  <span className="share-format-label">Twitter / Link</span>
                  <span className="share-format-size">1200×630</span>
                </button>
              </div>

              {shareExporting ? (
                <div className="share-modal-loading">
                  <span>Generating image...</span>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function PromoCTA({
  visible,
  onDismiss,
  onSignUp,
}: {
  visible: boolean;
  onDismiss: () => void;
  onSignUp: () => void;
}) {
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <div className="promo-cta-backdrop" onClick={onDismiss}>
      <div className="promo-cta" onClick={(event) => event.stopPropagation()}>
        <button className="promo-cta-close" onClick={onDismiss}>
          ✕
        </button>
        <div className="promo-cta-trophy">🏆</div>
        <h3 className="promo-cta-title">Win $100</h3>
        <p className="promo-cta-body">
          Submit your bracket and compete against everyone on our leaderboard. The most accurate bracket wins $100
          after the championship.
        </p>
        <p className="promo-cta-detail">Free to enter. Up to 25 brackets per account.</p>
        <button className="promo-cta-button" onClick={onSignUp}>
          Sign up &amp; save my bracket
        </button>
        <button className="promo-cta-skip" onClick={onDismiss}>
          Maybe later
        </button>
      </div>
    </div>
  );
}

function FirstFourModal({
  playInGames,
  gameWinProbs,
  onPick,
  onRandomize,
  onClose,
}: {
  playInGames: ResolvedGame[];
  gameWinProbs: SimulationOutput["gameWinProbs"];
  onPick: (gameId: string, teamId: string | null) => void;
  onRandomize: () => void;
  onClose: () => void;
}) {
  const allDecided = playInGames.every((game) => Boolean(game.winnerId));
  const decidedCount = playInGames.filter((game) => Boolean(game.winnerId)).length;

  return (
    <div className="ff-modal-overlay" onClick={onClose}>
      <div className="ff-modal" onClick={(event) => event.stopPropagation()}>
        <div className="ff-modal-header">
          <div>
            <h2 className="ff-modal-title">First Four</h2>
            <p className="ff-modal-subtitle">
              {allDecided
                ? "All play-in games decided. These winners advance to the Round of 64."
                : "Pick the winners of each play-in game to set the Round of 64 field."}
            </p>
          </div>
          {!allDecided ? (
            <button className="ff-randomize-btn" onClick={onRandomize}>
              🎲 Pick for me
            </button>
          ) : null}
          <button className="ff-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="ff-modal-games">
          {playInGames.map((game) => (
            <FirstFourGameCard
              key={game.id}
              game={game}
              gameWinProbs={gameWinProbs}
              onPick={(teamId) => onPick(game.id, teamId)}
            />
          ))}
        </div>

        <div className="ff-modal-footer">
          <button
            className={`ff-modal-done ${allDecided ? "ff-modal-done--ready" : "ff-modal-done--partial"}`}
            onClick={allDecided ? onClose : undefined}
          >
            {allDecided ? "Continue to Bracket →" : `${decidedCount}/${playInGames.length} decided`}
          </button>
        </div>
      </div>
    </div>
  );
}

function FirstFourGameCard({
  game,
  gameWinProbs,
  onPick,
}: {
  game: ResolvedGame;
  gameWinProbs: SimulationOutput["gameWinProbs"];
  onPick: (teamId: string) => void;
}) {
  const teamA = game.teamAId ? teamsById.get(game.teamAId) ?? null : null;
  const teamB = game.teamBId ? teamsById.get(game.teamBId) ?? null : null;
  if (!teamA || !teamB) return null;

  const probA = getGameWinProb(game, teamA.id, gameWinProbs) ?? getModelGameWinProb(game, teamA.id) ?? 0.5;
  const probB = 1 - probA;
  const winner = game.winnerId;

  return (
    <div className="ff-game-card">
      <div className="ff-game-header">
        <span className="ff-game-label">PLAY-IN · {(teamA.region || "").toUpperCase()}</span>
        <span className="ff-game-seed">Seed {seedLabel(teamA).replace(/[ab]$/i, "")}</span>
      </div>

      <div className="ff-game-matchup">
        <button
          type="button"
          className={`ff-team-btn ${winner === teamA.id ? "ff-team-btn--winner" : ""} ${winner && winner !== teamA.id ? "ff-team-btn--loser" : ""}`}
          onClick={() => onPick(teamA.id)}
        >
          <div className="ff-team-info">
            <span className="ff-team-seed">{seedLabel(teamA)}</span>
            <TeamLogo teamName={teamA.name} src={teamLogoUrl(teamA)} className="ff-team-logo" teamSeed={seedLabel(teamA)} />
            <span className="ff-team-name">{teamA.name}</span>
          </div>
          <span className="ff-team-pct">{(probA * 100).toFixed(1)}%</span>
          {winner === teamA.id ? <span className="ff-team-check">✓</span> : null}
        </button>

        <span className="ff-vs">vs</span>

        <button
          type="button"
          className={`ff-team-btn ${winner === teamB.id ? "ff-team-btn--winner" : ""} ${winner && winner !== teamB.id ? "ff-team-btn--loser" : ""}`}
          onClick={() => onPick(teamB.id)}
        >
          <div className="ff-team-info">
            <span className="ff-team-seed">{seedLabel(teamB)}</span>
            <TeamLogo teamName={teamB.name} src={teamLogoUrl(teamB)} className="ff-team-logo" teamSeed={seedLabel(teamB)} />
            <span className="ff-team-name">{teamB.name}</span>
          </div>
          <span className="ff-team-pct">{(probB * 100).toFixed(1)}%</span>
          {winner === teamB.id ? <span className="ff-team-check">✓</span> : null}
        </button>
      </div>

      {winner ? <div className="ff-game-result">{winner === teamA.id ? teamA.name : teamB.name} advances to R64</div> : null}
    </div>
  );
}

function BracketCompletionCelebration({
  championName,
  chaosLabel,
  chaosEmoji,
  onSave,
  onClose,
}: {
  championName: string;
  chaosLabel: string;
  chaosEmoji: string;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="completion-overlay" onClick={onClose}>
      <div className="completion-card" onClick={(event) => event.stopPropagation()}>
        <div className="completion-particles" aria-hidden="true">
          {Array.from({ length: 20 }).map((_, index) => (
            <span
              key={`completion-particle-${index}`}
              className="completion-particle"
              style={{
                left: `${(index * 11) % 100}%`,
                animationDelay: `${(index % 5) * 0.2}s`,
                animationDuration: `${2 + (index % 4) * 0.5}s`,
              }}
            />
          ))}
        </div>
        <span className="completion-trophy">🏆</span>
        <h2 className="completion-headline">Your bracket is set.</h2>
        <p className="completion-champ">{championName} wins it all.</p>
        <p className="completion-chaos">
          {chaosEmoji} {chaosLabel}
        </p>

        <div className="completion-actions">
          <button className="completion-btn-primary" onClick={onSave}>
            Submit Bracket
          </button>
          <button className="completion-btn-secondary" onClick={onClose}>
            Keep editing
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareTeamLogo({
  seed,
  name,
  logoUrl,
  size,
  className = "",
}: {
  seed: string;
  name: string;
  logoUrl: string;
  size: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed || !logoUrl) {
    return (
      <div className={`share-logo-fallback ${className}`.trim()} style={{ width: size, height: size }}>
        <span>{seed}</span>
      </div>
    );
  }

  return (
    <img
      className={`share-logo ${className}`.trim()}
      src={logoUrl}
      alt={name}
      loading="lazy"
      crossOrigin="anonymous"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

function StoryShareCard({
  cardRef,
  data,
}: {
  cardRef: { current: HTMLDivElement | null };
  data: ShareCardData;
}) {
  return (
    <div ref={cardRef} className="share-story-card">
      <div className="share-story-bg-glow" />
      <header className="share-story-header">
        <span className="share-brand">ODDS GODS</span>
        <span className="share-product-name">The Bracket Lab</span>
      </header>

      <div className="share-amber-rule" />

      <section className="share-story-champion">
        <span className="share-section-label">CHAMPION</span>
        {data.champion ? (
          <>
            <div className="share-champion-logo-wrap">
              <ShareTeamLogo
                seed={data.champion.seed}
                name={data.champion.name}
                logoUrl={data.champion.logoUrl}
                size={120}
              />
            </div>
            <span className="share-champion-name">
              <span className="share-champion-seed">{data.champion.seed}</span> {data.champion.name}
            </span>
            <span className="share-champion-odds">CHAMP: {data.champion.champProbLabel}</span>
            <span className="share-champion-flavor">{data.champion.flavor}</span>
          </>
        ) : (
          <span className="share-champion-placeholder">Pick a champion to unlock this card.</span>
        )}
      </section>

      <section className="share-story-section">
        <span className="share-section-label">FINAL FOUR</span>
        <div className="share-f4-grid">
          {data.f4Teams.map((team) => (
            <div key={`story-f4-${team.id}`} className={`share-f4-card ${team.isChampion ? "share-f4-card--champion" : ""}`}>
              <ShareTeamLogo seed={team.seed} name={team.name} logoUrl={team.logoUrl} size={40} />
              <div className="share-f4-text">
                <span className="share-f4-team-name">
                  {team.seed} {team.name}
                </span>
                <span className="share-f4-odds">CHAMP: {team.champProbLabel}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="share-story-section">
        <span className="share-section-label">BOLDEST PICKS</span>
        <div className="share-upset-list">
          {data.boldestPicks.map((pick, index) => (
            <div key={`story-upset-${index}-${pick.winnerName}`} className="share-upset-row">
              <span className="share-upset-winner">
                {pick.winnerSeed} {pick.winnerName}
              </span>
              <span className="share-upset-over"> over </span>
              <span className="share-upset-loser">
                {pick.loserSeed} {pick.loserName}
              </span>
              <span className="share-upset-prob">{pick.winProbPct}%</span>
            </div>
          ))}
        </div>
      </section>

      <div className="share-amber-rule" />

      <section className="share-story-stats">
        <span className="share-stat-pill" style={{ color: getChaosColor(data.chaosScore, data.totalPicks) }}>
          {data.chaosScore.toFixed(1)} {data.chaosEmoji} {data.chaosLabel}
        </span>
        <span className="share-stat-pill">{data.totalPicks}/{gameTemplates.length} Picks</span>
      </section>

      <footer className="share-story-footer">
        <span className="share-tagline">Every pick changes everything.</span>
        <span className="share-url">bracket.oddsgods.net</span>
      </footer>
    </div>
  );
}

function TwitterShareCard({
  cardRef,
  data,
}: {
  cardRef: { current: HTMLDivElement | null };
  data: ShareCardData;
}) {
  return (
    <div ref={cardRef} className="share-twitter-card">
      <header className="share-twitter-header">
        <span className="share-brand">ODDS GODS</span>
        <span className="share-product-name">The Bracket Lab</span>
      </header>

      <div className="share-twitter-main">
        <section className="share-twitter-champion">
          <span className="share-section-label">CHAMPION</span>
          {data.champion ? (
            <>
              <ShareTeamLogo
                seed={data.champion.seed}
                name={data.champion.name}
                logoUrl={data.champion.logoUrl}
                size={84}
              />
              <span className="share-twitter-champ-name">
                {data.champion.seed} {data.champion.name}
              </span>
              <span className="share-twitter-champ-odds">CHAMP: {data.champion.champProbLabel}</span>
              <span className="share-champion-flavor">{data.champion.flavor}</span>
            </>
          ) : (
            <span className="share-champion-placeholder">Pick a champion to unlock this card.</span>
          )}
        </section>

        <section className="share-twitter-f4">
          <span className="share-section-label">FINAL FOUR</span>
          <div className="share-twitter-f4-list">
            {data.f4Teams.map((team) => (
              <div key={`twitter-f4-${team.id}`} className={`share-twitter-f4-row ${team.isChampion ? "share-f4-card--champion" : ""}`}>
                <ShareTeamLogo seed={team.seed} name={team.name} logoUrl={team.logoUrl} size={28} />
                <span className="share-twitter-f4-name">
                  {team.seed} {team.name}
                </span>
                <span className="share-twitter-f4-odds">{team.champProbLabel}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="share-twitter-bottom">
        {data.boldestPicks[0] ? (
          <span className="share-twitter-boldest">
            BOLDEST: {data.boldestPicks[0].winnerSeed} {data.boldestPicks[0].winnerName} over {data.boldestPicks[0].loserSeed}{" "}
            {data.boldestPicks[0].loserName} ({data.boldestPicks[0].winProbPct}%)
          </span>
        ) : null}
        <span className="share-stat-pill" style={{ color: getChaosColor(data.chaosScore, data.totalPicks) }}>
          {data.chaosScore.toFixed(1)} {data.chaosEmoji} {data.chaosLabel}
        </span>
      </section>

      <footer className="share-twitter-footer">
        <span className="share-tagline">Every pick changes everything.</span>
        <span className="share-url">bracket.oddsgods.net</span>
      </footer>
    </div>
  );
}

function mobileShortName(name: string) {
  const abbreviation = abbreviationForTeam(name);
  if (abbreviation && abbreviation !== name) return abbreviation;
  const words = name.split(" ");
  return words.length > 2 ? words[words.length - 1] : name;
}

function seedLabel(team: NonNullable<ReturnType<typeof teamsById.get>>) {
  return team.seedLabel ?? String(team.seed);
}

const TEAM_STAT_LABELS: Record<TeamStatKey, string> = {
  rank_POM: "KenPom Rank",
  rank_MAS: "Massey Rank",
  rank_WLK: "Whitlock Rank",
  rank_MOR: "Moore Rank",
  elo_sos: "Odds Gods Elo SOS",
  elo_last: "OddsGods Elo",
  avg_net_rtg: "Net Rating",
  avg_off_rtg: "Offensive Rating",
  elo_trend: "OddsGods Elo Trend",
  avg_def_rtg: "Defensive Rating",
  last5_Margin: "Last 5 Margin",
  rank_BIH: "Bihl Rank",
  rank_NET: "NET Rank",
};

const LOWER_IS_BETTER_STATS = new Set<TeamStatKey>([
  "rank_POM",
  "rank_MAS",
  "rank_WLK",
  "rank_MOR",
  "rank_BIH",
  "avg_def_rtg",
  "rank_NET",
]);

const TEAM_STAT_DESCRIPTIONS: Record<TeamStatKey, string> = {
  rank_POM: "KenPom rankings (tempo adjusted efficiency rating).",
  rank_MAS:
    "Massey rankings. We use the ranking differences from the best-performing team-strength set to help compute win probability.",
  rank_WLK:
    "Whitlock rankings. Computer generated power ranking system assigning a numerical strength to each team based on game results and strength of schedule.",
  rank_MOR:
    "Moore rankings. A rating algorithm that evaluates teams using statistical game data to estimate relative performance.",
  elo_sos:
    "Mean of opponents' pre-game Elo across all games this season. OddsGods created SOS metric that prioritizes opponent strength at the time of each game.",
  elo_last:
    "OddsGods custom built Elo system. Continuous rating that carries across seasons and updates after every game based on opponent quality, season phase, and conference context.",
  avg_net_rtg: "Offensive rating minus defensive rating. Overall efficiency margin per 100 possessions.",
  avg_off_rtg: "Offensive rating. 100 * points / possessions.",
  elo_trend:
    "OddsGods Elo trend. Slope of a linear regression line fit to a team's season Elo history, representing average Elo points gained or lost per game.",
  avg_def_rtg: "Defensive rating. 100 * opponent points / opponent possessions.",
  last5_Margin: "Rolling 5-game mean of scoring margin.",
  rank_BIH: "Bihl rankings. Rating system producing strength scores based on game outcomes and strength of schedule.",
  rank_NET:
    "Official NCAA metric used by the selection committee. Combines game result, strength of schedule, net efficiency, and scoring margin.",
};

const IMPORTANCE_HELP_TEXT =
  "Importance% shows how much each stat influences the model's picks. The higher the percentage, the more that stat tends to move and influence predictions.";

const formatStatValue = (value: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toFixed(1);
  if (Number.isInteger(value)) return `${value}`;
  if (Math.abs(value) < 1) return value.toFixed(4);
  return value.toFixed(2);
};

const formatDiffValue = (value: number): string => {
  const abs = Math.abs(value);
  if (Number.isInteger(abs)) return `${abs}`;
  if (abs < 1) return abs.toFixed(4);
  return abs.toFixed(2);
};

const differenceForStat = (teamAName: string, teamAValue: number | null, teamBName: string, teamBValue: number | null, key: TeamStatKey): string => {
  if (teamAValue === null || teamBValue === null) return "—";
  if (teamAValue === teamBValue) return "Even";

  const lowerIsBetter = LOWER_IS_BETTER_STATS.has(key);
  const aBetter = lowerIsBetter ? teamAValue < teamBValue : teamAValue > teamBValue;
  const betterName = aBetter ? teamAName : teamBName;
  const delta = aBetter ? teamBValue - teamAValue : teamAValue - teamBValue;
  return `${betterName} +${formatDiffValue(delta)}`;
};

function getRegionRoundStatus(games: ResolvedGame[], region: Region, round: MobileRegionRound) {
  const roundGames = gamesByRegionAndRound(games, region, round);
  if (roundGames.every((game) => game.winnerId)) return "complete" as const;
  if (roundGames.some((game) => game.winnerId)) return "in-progress" as const;
  return "available" as const;
}

function getRegionRoundMode(games: ResolvedGame[], region: Region, round: MobileRegionRound): "interactive" | "probabilistic" {
  if (round === "FF") return "interactive";
  const previousRound: Record<Exclude<MobileRegionRound, "FF">, MobileRegionRound> = {
    R64: "FF",
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
  for (const round of ["FF", "R64", "R32", "S16", "E8"] as const) {
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
      <button
        className={`mobile-tab ${activeTab === "leaderboard" ? "active" : ""}`}
        onClick={() => onTabChange("leaderboard")}
      >
        <span className="mobile-tab-icon">🏆</span>
        <span className="mobile-tab-label">Leaders</span>
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
  onOpenMatchupStats,
  mobileChaosBadge,
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
  onOpenMatchupStats: (game: ResolvedGame) => void;
  mobileChaosBadge?: React.ReactNode;
}) {
  const roundOrder: Array<{ id: MobileRegionRound; label: string }> = [
    { id: "FF", label: "FF" },
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
        FF: "R64",
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
      {mobileChaosBadge}
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
            <span>These odds update live as you make picks. Tap FF/R64 to continue picking.</span>
            <button onClick={() => onRoundChange("FF")}>Back to picks →</button>
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
            onOpenMatchupStats={onOpenMatchupStats}
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
  onOpenMatchupStats,
  mobileChaosBadge,
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
  onOpenMatchupStats: (game: ResolvedGame) => void;
  mobileChaosBadge?: React.ReactNode;
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
      {mobileChaosBadge}
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
              onOpenMatchupStats={onOpenMatchupStats}
            />
          ))
        : null}
      {activeRound === "CHAMP" && titleGame ? (
        titleGame.winnerId ? (
          <MobileChampionshipCelebrationCard game={titleGame} onUndoPick={onUndoPick} />
        ) : (
          <MobileMatchupCard
            game={titleGame}
            displayMode={displayMode}
            onPick={handlePickForRound}
            onSwitchPick={onSwitchPick}
            onUndoPick={onUndoPick}
            onEditProb={onEditProb}
            onOpenMatchupStats={onOpenMatchupStats}
          />
        )
      ) : null}
      {activeRound === "WIN" ? <MobileChampionCard titleGame={titleGame} /> : null}
    </>
  );
}

function DesktopFirstModal({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="dfm-overlay">
      <div className="dfm-card">
        <div className="dfm-icon">💻</div>
        <h2 className="dfm-headline">Quick heads up.</h2>
        <p className="dfm-body">
          BracketLab was built for the big screen. You can absolutely use it here, but the full bracket view,
          probability editor, and real-time odds cascades are way better on desktop.
        </p>
        <p className="dfm-sub">Grab your laptop when you can. You won&apos;t regret it.</p>
        <button className="dfm-btn" onClick={onDismiss}>
          Got it - continue on mobile
        </button>
      </div>
    </div>
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

function MobileChampionshipCelebrationCard({
  game,
  onUndoPick,
}: {
  game: ResolvedGame;
  onUndoPick: (gameId: string) => void;
}) {
  const winnerTeam = game.winnerId ? teamsById.get(game.winnerId) ?? null : null;
  const loserTeam =
    game.winnerId && game.teamAId && game.teamBId
      ? teamsById.get(game.winnerId === game.teamAId ? game.teamBId : game.teamAId) ?? null
      : null;
  if (!winnerTeam || !loserTeam) return null;

  return (
    <div className="championship-card championship-card--celebration">
      <ChampionConfetti />
      <div className="championship-card-inner">
        <div className="championship-trophy">🏆</div>
        <TeamLogo
          teamName={winnerTeam.name}
          src={teamLogoUrl(winnerTeam)}
          className="championship-logo"
          sizePx={64}
          teamSeed={seedLabel(winnerTeam)}
        />
        <h2 className="championship-team-name">{winnerTeam.name}</h2>
        <div className="championship-badge">NCAA CHAMPION</div>
        <span className="championship-seed">#{seedLabel(winnerTeam)} seed</span>
      </div>
      <div className="championship-runner-up">
        defeated #{seedLabel(loserTeam)} {loserTeam.name}
      </div>
      <div className="m-card-footer">
        <span className="m-winner-label">Champion selected</span>
        <button className="m-undo-btn" onClick={() => onUndoPick(game.id)}>
          Undo
        </button>
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
  onOpenMatchupStats,
}: {
  game: ResolvedGame;
  displayMode: OddsDisplayMode;
  onPick: (game: ResolvedGame, teamId: string) => void;
  onSwitchPick: (game: ResolvedGame, teamId: string) => void;
  onUndoPick: (gameId: string) => void;
  onEditProb: (game: ResolvedGame, anchorEl: HTMLElement) => void;
  onOpenMatchupStats: (game: ResolvedGame) => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const teamA = game.teamAId ? teamsById.get(game.teamAId) ?? null : null;
  const teamB = game.teamBId ? teamsById.get(game.teamBId) ?? null : null;
  if (!teamA || !teamB) return null;

  const probA = getGameWinProb(game, teamA.id) ?? 0;
  const probB = getGameWinProb(game, teamB.id) ?? 0;
  const isPicked = Boolean(game.winnerId);
  const isEdited = game.customProbA !== null;
  const teamAOdds = formatOddsDisplay(probA, displayMode).primary;
  const teamBOdds = formatOddsDisplay(probB, displayMode).primary;
  const dataSeeds = `${Math.min(teamA.seed, teamB.seed)}-${Math.max(teamA.seed, teamB.seed)}`;

  return (
    <div className={`m-card ${isPicked ? "m-card--picked" : ""}`} ref={cardRef} data-game-id={game.id} data-seeds={dataSeeds}>
      <button
        type="button"
        className="matchup-stats-icon matchup-stats-icon--mobile"
        onClick={(event) => {
          event.stopPropagation();
          onOpenMatchupStats(game);
        }}
        title="View matchup stats"
        aria-label="View matchup stats"
      >
        ⓘ
      </button>
      <button
        className={`m-team ${game.winnerId === teamA.id ? "m-team--winner" : ""} ${
          game.winnerId && game.winnerId !== teamA.id ? "m-team--loser" : ""
        }`}
        data-team-name={teamA.name}
        data-team-seed={seedLabel(teamA)}
        onClick={() => {
          if (!isPicked) onPick(game, teamA.id);
          if (isPicked && game.winnerId !== teamA.id) onSwitchPick(game, teamA.id);
        }}
      >
        <span className="m-seed">{seedLabel(teamA)}</span>
        <TeamLogo teamName={teamA.name} src={teamLogoUrl(teamA)} />
        <span className="m-name">{teamA.name}</span>
        <div className="m-stats">
          <span className="m-prob">{toImpliedLabel(probA)}</span>
          <span className={`m-odds ${isEdited ? "m-odds--edited" : ""}`}>{teamAOdds}</span>
        </div>
      </button>

      <div className="m-vs">vs</div>

      <button
        className={`m-team ${game.winnerId === teamB.id ? "m-team--winner" : ""} ${
          game.winnerId && game.winnerId !== teamB.id ? "m-team--loser" : ""
        }`}
        data-team-name={teamB.name}
        data-team-seed={seedLabel(teamB)}
        onClick={() => {
          if (!isPicked) onPick(game, teamB.id);
          if (isPicked && game.winnerId !== teamB.id) onSwitchPick(game, teamB.id);
        }}
      >
        <span className="m-seed">{seedLabel(teamB)}</span>
        <TeamLogo teamName={teamB.name} src={teamLogoUrl(teamB)} />
        <span className="m-name">{teamB.name}</span>
        <div className="m-stats">
          <span className="m-prob">{toImpliedLabel(probB)}</span>
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
  const isMobileViewport = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
  const mobileTeams = topContenders.slice(0, 5);
  const desktopTeams = topContenders;
  const loopingTeams = [...desktopTeams, ...desktopTeams];
  return (
    <div className="live-odds-strip">
      {isMobileViewport ? <span className="live-odds-strip-label">Title</span> : null}
      <div className={isMobileViewport ? "live-odds-strip-chips" : "live-odds-inner"}>
        {(isMobileViewport ? mobileTeams : loopingTeams).map((team, index) => (
          <div key={`${team.id}-${index}`} className={`live-odds-item ${justChangedIds.has(team.id) ? "live-odds-chip--changed" : ""}`}>
            <span className="team-abbr">{team.shortName}</span>
            <span className="odds-val">{displayMode === "implied" ? team.titleImpliedPct : team.titleOdds}</span>
          </div>
        ))}
      </div>
      {isMobileViewport ? (
        <button className="live-odds-strip-expand" onClick={onOpenFutures}>
          All →
        </button>
      ) : null}
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
                <span className="m-seed">{seedLabel(row.team)}</span>
                <TeamLogo teamName={row.team.name} src={teamLogoUrl(row.team)} className="m-logo-sm" teamSeed={seedLabel(row.team)} />
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

function RoundColumnHeader({
  round,
  visuallyCollapsed,
  onToggle,
}: {
  round: "R64" | "R32" | "S16";
  visuallyCollapsed: boolean;
  onToggle: () => void;
}) {
  const abbreviation = round === "R64" ? "R64" : round === "R32" ? "R32" : "S16";
  const fullLabel = round === "R64" ? "Round of 64" : round === "R32" ? "Round of 32" : "Sweet 16";

  if (visuallyCollapsed) {
    return (
      <button type="button" className="round-col-header round-col-header--collapsed" onClick={onToggle}>
        <span className="round-col-header-abbrev">{abbreviation}</span>
        <span className="round-col-header-edit-btn">Edit</span>
      </button>
    );
  }

  return (
    <div className="round-col-header">
      <p className="eg-round-label">{fullLabel}</p>
      <button type="button" className="round-col-header-done-btn" onClick={onToggle}>
        Done
      </button>
    </div>
  );
}

function CollapsedHalfSummary({
  half,
  games,
  onExpand,
}: {
  half: "top" | "bottom";
  games: ResolvedGame[];
  onExpand: () => void;
}) {
  const regions = half === "top" ? BRACKET_HALVES[0].regions : BRACKET_HALVES[1].regions;
  const label = half === "top" ? "Top Half Bracket" : "Bottom Half Bracket";
  const winners = regions
    .map((region) => {
      const e8Game = gamesByRegionAndRound(games, region, "E8")[0];
      if (!e8Game?.winnerId) return null;
      return teamsById.get(e8Game.winnerId) ?? null;
    })
    .filter((team): team is NonNullable<typeof team> => Boolean(team));

  return (
    <div className="half-collapsed-bar">
      <div className="half-collapsed-left">
        <span className="half-collapsed-label">{label}</span>
        <span className="half-collapsed-check">✓ Complete</span>
      </div>
      <div className="half-collapsed-teams">
        {winners.map((team) => (
            <div key={`${half}-${team.id}`} className="half-collapsed-team">
              <TeamLogo teamName={team.name} src={teamLogoUrl(team)} className="half-collapsed-logo" teamSeed={seedLabel(team)} />
              <span className="half-collapsed-name">
                {seedLabel(team)} {team.name}
              </span>
              <span className="half-collapsed-region">{team.region}</span>
            </div>
        ))}
        <span className="half-collapsed-arrow">→ Final Four</span>
      </div>
      <button type="button" className="half-collapsed-expand-btn" onClick={onExpand}>
        Expand ↓
      </button>
    </div>
  );
}

function FinalsSemifinalCard({
  game,
  regions,
  gameWinProbs,
  possibleWinners,
  futuresRows,
  displayMode,
  regionLabel,
  lastPickedKey,
  onPick,
}: {
  game: ResolvedGame | null;
  regions: Region[];
  gameWinProbs: SimulationOutput["gameWinProbs"];
  possibleWinners: Record<string, Set<string>>;
  futuresRows: SimulationOutput["futures"];
  displayMode: OddsDisplayMode;
  regionLabel: string;
  lastPickedKey: string | null;
  onPick: (game: ResolvedGame, teamId: string | null) => void;
}) {
  const futuresByTeamId = useMemo(() => new Map(futuresRows.map((row) => [row.teamId, row])), [futuresRows]);
  const showdownFinalists = useMemo(() => {
    if (!game) return [];
    return getGameRowsForDisplay(game, gameWinProbs, possibleWinners).filter(
      (candidate) => candidate.team.id === game.teamAId || candidate.team.id === game.teamBId
    );
  }, [game, gameWinProbs, possibleWinners]);
  const ranked = useMemo(
    () =>
      Array.from(teamsById.values())
        .filter((team) => regions.includes(team.region))
        .map((team) => ({
          team,
          prob: futuresByTeamId.get(team.id)?.titleGameProb ?? 0,
        }))
        .filter((entry) => entry.prob > 0)
        .sort((a, b) => (b.prob !== a.prob ? b.prob - a.prob : a.team.seed - b.team.seed)),
    [futuresByTeamId, regions]
  );
  const semifinalReady = Boolean(game?.teamAId && game?.teamBId);

  return (
    <div className="ff-semifinal-card semifinal-panel">
      <div className="semifinal-header">
        <span className="semifinal-label">Semifinal</span>
        <span className="semifinal-regions">{regionLabel}</span>
      </div>
      {semifinalReady && game && showdownFinalists.length === 2 ? (
        <ShowdownCard
          game={game}
          finalists={showdownFinalists}
          displayMode={displayMode}
          lastPickedKey={lastPickedKey}
          onPick={(teamId) => onPick(game, teamId)}
        />
      ) : (
        <div className="ff-panel ff-panel--ranking">
          <div className="ff-panel-subheader">CHAMPIONSHIP ODDS</div>
          <div className="ff-ranking-list">
            {ranked.map(({ team, prob }) => {
              const locked = prob >= 1;
              return (
                <div key={team.id} className={`ff-ranking-row ${locked ? "ff-ranking-row--locked" : ""}`}>
                  <div className="ff-ranking-row-left">
                    <span className="ff-ranking-seed">{seedLabel(team)}</span>
                    <TeamLogo
                      src={teamLogoUrl(team)}
                      teamName={team.name}
                      teamSeed={seedLabel(team)}
                      className="ff-ranking-logo"
                    />
                    <span className="ff-ranking-name">{team.name}</span>
                  </div>
                  <div className="ff-ranking-row-right">
                    <span className={`ff-ranking-prob ${locked ? "ff-ranking-prob--locked" : ""}`}>
                      {locked ? "✓ Locked" : formatOddsDisplay(prob, displayMode).primary}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FinalsChampionshipCard({
  game,
  futuresRows,
  gameWinProbs,
  possibleWinners,
  displayMode,
  lastPickedKey,
  onPick,
}: {
  game: ResolvedGame | null;
  futuresRows: SimulationOutput["futures"];
  gameWinProbs: SimulationOutput["gameWinProbs"];
  possibleWinners: Record<string, Set<string>>;
  displayMode: OddsDisplayMode;
  lastPickedKey: string | null;
  onPick: (game: ResolvedGame, teamId: string | null) => void;
}) {
  const futuresByTeamId = useMemo(() => new Map(futuresRows.map((row) => [row.teamId, row])), [futuresRows]);
  const showdownFinalists = useMemo(() => {
    if (!game) return [];
    return getGameRowsForDisplay(game, gameWinProbs, possibleWinners).filter(
      (candidate) => candidate.team.id === game.teamAId || candidate.team.id === game.teamBId
    );
  }, [game, gameWinProbs, possibleWinners]);
  const ranked = useMemo(
    () =>
      Array.from(teamsById.values())
        .map((team) => ({
          team,
          prob: futuresByTeamId.get(team.id)?.champProb ?? 0,
        }))
        .filter((entry) => entry.prob > 0)
        .sort((a, b) => (b.prob !== a.prob ? b.prob - a.prob : a.team.seed - b.team.seed)),
    [futuresByTeamId]
  );
  const winnerTeam = game?.winnerId ? teamsById.get(game.winnerId) ?? null : null;
  const loserTeam =
    game?.winnerId && game.teamAId && game.teamBId
      ? teamsById.get(game.winnerId === game.teamAId ? game.teamBId : game.teamAId) ?? null
      : null;

  return (
    <div className="championship-container championship-panel">
      <div className="championship-header">
        <span className="championship-trophy">🏆</span>
        <span className="championship-label">National Championship</span>
      </div>
      {game && winnerTeam && loserTeam ? (
        <div className="championship-card championship-card--celebration">
          <ChampionConfetti />
          <div className="championship-card-inner">
            <div className="championship-trophy">🏆</div>
            <TeamLogo
              teamName={winnerTeam.name}
              src={teamLogoUrl(winnerTeam)}
              className="championship-logo"
              sizePx={80}
              teamSeed={seedLabel(winnerTeam)}
            />
            <h2 className="championship-team-name">{winnerTeam.name}</h2>
            <div className="championship-badge">NCAA CHAMPION</div>
            <span className="championship-seed">#{seedLabel(winnerTeam)} seed</span>
          </div>
          <button
            type="button"
            className="championship-runner-up"
            onClick={() => onPick(game, loserTeam.id)}
            title={`Switch pick to ${loserTeam.name}`}
          >
            defeated #{seedLabel(loserTeam)} {loserTeam.name}
            <span className="championship-switch-hint">tap to switch pick</span>
          </button>
        </div>
      ) : game && showdownFinalists.length === 2 ? (
        <ShowdownCard
          game={game}
          finalists={showdownFinalists}
          displayMode={displayMode}
          lastPickedKey={lastPickedKey}
          onPick={(teamId) => onPick(game, teamId)}
        />
      ) : (
        <div className="ff-panel ff-panel--championship-ranking">
          <div className="ff-panel-subheader">TITLE ODDS</div>
          <div className="ff-ranking-list">
            {ranked.map(({ team, prob }) => {
              const locked = prob >= 1;
              return (
                <div key={team.id} className={`ff-ranking-row ${locked ? "ff-ranking-row--locked" : ""}`}>
                  <div className="ff-ranking-row-left">
                    <span className="ff-ranking-seed">{seedLabel(team)}</span>
                    <TeamLogo
                      src={teamLogoUrl(team)}
                      teamName={team.name}
                      teamSeed={seedLabel(team)}
                      className="ff-ranking-logo"
                    />
                    <span className="ff-ranking-name">{team.name}</span>
                  </div>
                  <div className="ff-ranking-row-right">
                    <span className={`ff-ranking-prob ${locked ? "ff-ranking-prob--locked" : ""}`}>
                      {locked ? "✓ Locked" : formatOddsDisplay(prob, displayMode).primary}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ChampionConfetti() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      color: string;
      rotation: number;
      rotationSpeed: number;
      gravity: number;
      opacity: number;
      decay: number;
      shape: "rect" | "circle";
    }> = [];
    const particleCount = 80;
    const colors = [
      "rgba(184, 125, 24, 1)",
      "rgba(184, 125, 24, 0.70)",
      "rgba(240, 230, 208, 0.90)",
      "rgba(240, 230, 208, 0.50)",
      "rgba(255, 200, 60, 0.80)",
    ];

    for (let i = 0; i < particleCount; i += 1) {
      particles.push({
        x: canvas.width / 2,
        y: canvas.height * 0.3,
        vx: (Math.random() - 0.5) * 8,
        vy: -(Math.random() * 6 + 2),
        size: Math.random() * 4 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12,
        gravity: 0.12 + Math.random() * 0.06,
        opacity: 1,
        decay: 0.008 + Math.random() * 0.008,
        shape: Math.random() > 0.5 ? "rect" : "circle",
      });
    }

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;

      particles.forEach((p) => {
        if (p.opacity <= 0) return;
        alive = true;

        p.x += p.vx;
        p.vy += p.gravity;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;
        p.opacity -= p.decay;
        p.vx *= 0.99;

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        if (p.shape === "rect") {
          ctx.fillRect(-p.size / 2, -p.size, p.size, p.size * 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });

      if (alive) {
        raf = window.requestAnimationFrame(draw);
      }
    };

    const startTimer = window.setTimeout(() => {
      raf = window.requestAnimationFrame(draw);
    }, 200);

    return () => {
      window.clearTimeout(startTimer);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} className="championship-confetti-canvas" />;
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
  onOpenMatchupStats,
  onUnavailableRoundClick,
  onToggleRoundExpansion,
  isRoundComplete,
  isRoundVisuallyCollapsed,
  walkthroughChangedGameIds,
  walkthroughChangedOddsVisible,
  walkthroughCascadeSpotlightRound,
  walkthroughCascadePathByRound,
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
  onOpenMatchupStats: (game: ResolvedGame) => void;
  onUnavailableRoundClick: (round: ResolvedGame["round"]) => void;
  onToggleRoundExpansion: (region: Region, round: "R64" | "R32" | "S16") => void;
  isRoundComplete: (region: Region, round: RegionalRound) => boolean;
  isRoundVisuallyCollapsed: (region: Region, round: RegionalRound) => boolean;
  walkthroughChangedGameIds: Set<string>;
  walkthroughChangedOddsVisible: boolean;
  walkthroughCascadeSpotlightRound: "R32" | "S16" | "E8" | null;
  walkthroughCascadePathByRound: Record<"R32" | "S16" | "E8", Set<string>>;
}) {
  const rounds = (inverted ? [...regionRounds].reverse() : [...regionRounds]).filter((round) => round !== "FF");
  const gamesById = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);
  const collapseByRound = useMemo(() => {
    return {
      R64: isRoundVisuallyCollapsed(region, "R64"),
      R32: isRoundVisuallyCollapsed(region, "R32"),
      S16: isRoundVisuallyCollapsed(region, "S16"),
      E8: false,
    } as Record<"R64" | "R32" | "S16" | "E8", boolean>;
  }, [isRoundVisuallyCollapsed, region]);

  const gridStateClasses = [
    collapseByRound.R64 ? "r64-collapsed" : "",
    collapseByRound.R32 ? "r32-collapsed" : "",
    collapseByRound.S16 ? "s16-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const shortRoundLabel: Record<ResolvedGame["round"], string> = {
    FF: "FF",
    R64: "R64",
    R32: "R32",
    S16: "S16",
    E8: "E8",
    F4: "F4",
    CHAMP: "CHAMP",
  };
  const roundDataValue: Record<ResolvedGame["round"], string> = {
    FF: "FF",
    R64: "64",
    R32: "32",
    S16: "16",
    E8: "8",
    F4: "4",
    CHAMP: "2",
  };

  return (
    <section
      className={`eg-region-card bracket-region ${inverted ? "region-inverted" : ""} ${
        walkthroughCascadeSpotlightRound && region !== ONBOARDING_UPSET_REGION ? "cascade-region-dimmed" : ""
      }`}
    >
      <div className="eg-region-head">
        <h2>{region}</h2>
        <button className="eg-mini-btn" onClick={() => onResetRegion(region)}>
          Reset Region
        </button>
      </div>

      <div className={`eg-round-grid bracket-grid ${gridStateClasses}`}>
        {rounds.map((round) => {
          const roundGames = gamesByRegionAndRound(games, region, round);
          const isCascadeRound = round === "R32" || round === "S16" || round === "E8";
          const regionCascadeActive = Boolean(walkthroughCascadeSpotlightRound && region === ONBOARDING_UPSET_REGION);
          const activeCascade = Boolean(regionCascadeActive && isCascadeRound);
          const currentRoundRank = round === "R32" ? 1 : round === "S16" ? 2 : round === "E8" ? 3 : 0;
          const spotlightRoundRank =
            walkthroughCascadeSpotlightRound === "R32"
              ? 1
              : walkthroughCascadeSpotlightRound === "S16"
                ? 2
                : walkthroughCascadeSpotlightRound === "E8"
                  ? 3
                  : 0;
          const cascadeColClass = activeCascade
            ? round === walkthroughCascadeSpotlightRound
              ? "cascade-spotlight"
              : currentRoundRank < spotlightRoundRank
                ? "cascade-dimmed-soft"
                : "cascade-dimmed"
            : regionCascadeActive && round === "R64"
              ? "cascade-r64-muted"
              : "";
          const collapsed =
            round === "R64" || round === "R32" || round === "S16" || round === "E8"
              ? Boolean(collapseByRound[round])
              : false;
          const e8Game = round === "E8" ? roundGames[0] : null;
          const e8Confirmed = Boolean(e8Game?.teamAId && e8Game?.teamBId);
          return (
            <div
              key={`${region}-${round}`}
              className={`eg-round-col lane-${round.toLowerCase()} ${collapsed ? "eg-round-col--collapsed" : ""} ${round === "E8" && e8Confirmed ? "eg-round-col--e8" : ""} ${round === "E8" && !e8Confirmed ? "eg-round-col--e8-pending" : ""} ${cascadeColClass}`}
              data-region={region}
              data-round={roundDataValue[round]}
            >
              <div className="eg-round-col-content">
                {(round === "R64" || round === "R32" || round === "S16") && isRoundComplete(region, round) ? (
                  <RoundColumnHeader
                    round={round}
                    visuallyCollapsed={collapsed}
                    onToggle={() => onToggleRoundExpansion(region, round)}
                  />
                ) : (
                  <p className="eg-round-label">{collapsed ? shortRoundLabel[round] : gameRoundLabel[round]}</p>
                )}
                <div className="eg-games-lane">
                  {roundGames.map((game, idx) => {
                    const topPercent = ((idx + 0.5) / Math.max(1, roundGames.length)) * 100;
                    const nodeStyle = { top: `${topPercent}%` } as React.CSSProperties;
                    const isPathGame = isCascadeRound ? walkthroughCascadePathByRound[round].has(game.id) : false;
                    const cascadeNodeClass = activeCascade && round === walkthroughCascadeSpotlightRound
                      ? isPathGame
                        ? ""
                        : "cascade-nonpath-dim"
                      : "";
                    return (
                      <div key={game.id} className={`eg-game-node ${cascadeNodeClass}`} style={nodeStyle}>
                        <GameCard
                          game={game}
                          collapsed={collapsed}
                          gameWinProbs={gameWinProbs}
                          possibleWinners={possibleWinners}
                          gamesById={gamesById}
                          onPick={onPick}
                          lastPickedKey={lastPickedKey}
                          displayMode={displayMode}
                          onOpenProbabilityPopup={onOpenProbabilityPopup}
                          onOpenMatchupStats={onOpenMatchupStats}
                          onUnavailableRoundClick={onUnavailableRoundClick}
                          highlightOddsChanged={walkthroughChangedOddsVisible && walkthroughChangedGameIds.has(game.id)}
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
  gamesById,
  onPick,
  lastPickedKey,
  displayMode,
  onOpenProbabilityPopup,
  onOpenMatchupStats,
  onUnavailableRoundClick,
  highlightOddsChanged,
}: {
  game: ResolvedGame;
  collapsed?: boolean;
  gameWinProbs: SimulationOutput["gameWinProbs"];
  possibleWinners: Record<string, Set<string>>;
  gamesById: Map<string, ResolvedGame>;
  onPick: (game: ResolvedGame, teamId: string | null) => void;
  lastPickedKey: string | null;
  displayMode: OddsDisplayMode;
  onOpenProbabilityPopup: (game: ResolvedGame, anchorEl: HTMLElement) => void;
  onOpenMatchupStats: (game: ResolvedGame) => void;
  onUnavailableRoundClick?: (round: ResolvedGame["round"]) => void;
  highlightOddsChanged?: boolean;
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
  const [showChaosTooltip, setShowChaosTooltip] = useState(false);
  const teamAName = game.teamAId ? teamsById.get(game.teamAId)?.name ?? "Team A" : "Team A";
  const teamBName = game.teamBId ? teamsById.get(game.teamBId)?.name ?? "Team B" : "Team B";
  const teamASeed = game.teamAId ? teamsById.get(game.teamAId)?.seed ?? null : null;
  const teamBSeed = game.teamBId ? teamsById.get(game.teamBId)?.seed ?? null : null;
  const dataSeeds =
    teamASeed !== null && teamBSeed !== null
      ? `${Math.min(teamASeed, teamBSeed)}-${Math.max(teamASeed, teamBSeed)}`
      : undefined;
  const modelProbA = game.teamAId ? getModelGameWinProb(game, game.teamAId) : null;
  const chaosPreview =
    game.teamAId && game.teamBId && modelProbA !== null
      ? {
          teamAChaos: computeGameChaos(modelProbA),
          teamBChaos: computeGameChaos(1 - modelProbA),
          earnedChaos:
            game.winnerId === game.teamAId
              ? computeGameChaos(modelProbA)
              : game.winnerId === game.teamBId
                ? computeGameChaos(1 - modelProbA)
                : null,
        }
      : null;
  const playInAttachment = useMemo(() => {
    if (game.round !== "R64" || !game.sourceGameIds) return null;
    const [sourceA, sourceB] = game.sourceGameIds;
    const ffA = sourceA ? gamesById.get(sourceA) ?? null : null;
    const ffB = sourceB ? gamesById.get(sourceB) ?? null : null;
    if (ffA && ffA.round === "FF") return { side: "A" as const, ffGame: ffA };
    if (ffB && ffB.round === "FF") return { side: "B" as const, ffGame: ffB };
    return null;
  }, [game.round, game.sourceGameIds, gamesById]);

  if (collapsed) {
    const compactTeams = [game.teamAId, game.teamBId]
      .map((teamId) => (teamId ? teamsById.get(teamId) ?? null : null))
      .filter((team): team is NonNullable<typeof team> => Boolean(team));

    return (
      <article
        className={`eg-game-card round-${game.round.toLowerCase()} collapsed`}
        data-game-id={game.id}
        data-matchup-id={game.id}
        data-region={game.region}
        data-round={game.round}
        data-seeds={dataSeeds}
        onMouseEnter={() => setShowChaosTooltip(true)}
        onMouseLeave={() => setShowChaosTooltip(false)}
      >
        <div className="bracket-cell--compact">
          {game.teamAId && game.teamBId && !game.winnerId ? (
            <button
              type="button"
              className={`matchup-edit-icon matchup-edit-btn--compact ${game.customProbA !== null ? "is-edited" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenProbabilityPopup(game, event.currentTarget);
              }}
              title="Edit odds"
              aria-label="Edit matchup probability"
            >
              ✎
            </button>
          ) : null}
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
        {showChaosTooltip && chaosPreview ? (
          <div className="chaos-tooltip">
            {chaosPreview.earnedChaos !== null ? (
              <span className="chaos-tooltip-earned">+{chaosPreview.earnedChaos.toFixed(2)} chaos</span>
            ) : (
              <>
                <div className="chaos-tooltip-row">
                  <span className="chaos-tooltip-team">{teamAName}</span>
                  <span className="chaos-tooltip-pts">+{chaosPreview.teamAChaos.toFixed(2)}</span>
                </div>
                <div className="chaos-tooltip-row">
                  <span className="chaos-tooltip-team">{teamBName}</span>
                  <span className="chaos-tooltip-pts">+{chaosPreview.teamBChaos.toFixed(2)}</span>
                </div>
              </>
            )}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <article
      className={`eg-game-card round-${game.round.toLowerCase()}`}
      data-game-id={game.id}
      data-matchup-id={game.id}
      data-region={game.region}
      data-round={game.round}
      data-seeds={dataSeeds}
      onMouseEnter={() => setShowChaosTooltip(true)}
      onMouseLeave={() => setShowChaosTooltip(false)}
    >
      {game.teamAId && game.teamBId ? (
        <button
          type="button"
          className="matchup-stats-icon"
          onClick={(event) => {
            event.stopPropagation();
            onOpenMatchupStats(game);
          }}
          title="View matchup stats"
          aria-label="View matchup stats"
        >
          ⓘ
        </button>
      ) : null}
      <div className="eg-game-list">
        {useShowdownCard ? (
          <ShowdownCard
            game={game}
            finalists={finalistRows}
            displayMode={displayMode}
            lastPickedKey={lastPickedKey}
            onPick={(teamId) => onPick(game, teamId)}
          />
        ) : rows.length > 0 ? (
          game.round === "R64" ? (
            (() => {
              const feedSide = playInAttachment?.side ?? null;
              const ffPending = Boolean(playInAttachment && !playInAttachment.ffGame.winnerId);
              const rowById = new Map(rows.map((candidate) => [candidate.team.id, candidate]));
              const renderTeamRow = (candidate: CandidateRow, rowIndex: number) => {
                const team = candidate.team!;
                const canPick =
                  game.teamAId !== null &&
                game.teamBId !== null &&
                (team.id === game.teamAId || team.id === game.teamBId);
              return (
                <TeamRow
                  key={`${game.id}-${team.id}`}
                  label={team.name}
                  seed={seedLabel(team)}
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
                  canEditProb={game.teamAId !== null && game.teamBId !== null}
                  showEditIcon={rowIndex === 0}
                  teamId={team.id}
                  oddsChanged={Boolean(highlightOddsChanged)}
                  onOpenProbEditor={(anchorEl) => onOpenProbabilityPopup(game, anchorEl)}
                  onPick={() => onPick(game, canPick ? team.id : null)}
                />
              );
              };

              if (ffPending && feedSide && playInAttachment) {
                const oppositeTeamId = feedSide === "A" ? game.teamBId : game.teamAId;
                const oppositeRow = oppositeTeamId ? rowById.get(oppositeTeamId) : undefined;
                const pendingTeamA = playInAttachment.ffGame.teamAId ? teamsById.get(playInAttachment.ffGame.teamAId) ?? null : null;
                const pendingTeamB = playInAttachment.ffGame.teamBId ? teamsById.get(playInAttachment.ffGame.teamBId) ?? null : null;
                const pendingSeed = (pendingTeamA ? seedLabel(pendingTeamA) : pendingTeamB ? seedLabel(pendingTeamB) : "--").replace(
                  /[ab]$/i,
                  ""
                );
                const pendingText =
                  pendingTeamA && pendingTeamB
                    ? `${abbreviationForTeam(pendingTeamA.name)} / ${abbreviationForTeam(pendingTeamB.name)}`
                    : "TBD / TBD";
                const pendingRow = (
                  <div key={`${game.id}-pending-playin`} className="eg-team-row bracket-team-row--playin-pending">
                    <span className="team-seed">{pendingSeed}</span>
                    <span className="team-name-wrap">
                      <span className="team-name">{pendingText}</span>
                    </span>
                    <span className="team-odds-wrap">
                      <span className="team-odds">---%</span>
                    </span>
                  </div>
                );

                if (!oppositeRow) return [pendingRow];
                return feedSide === "A"
                  ? [pendingRow, renderTeamRow(oppositeRow, 1)]
                  : [renderTeamRow(oppositeRow, 0), pendingRow];
              }

              return rows.map((candidate, rowIndex) => renderTeamRow(candidate, rowIndex));
            })()
          ) : (
            <div
              className={`eg-compact-grid round-${game.round.toLowerCase()} density-${compactDensity}`}
              style={{ gridTemplateColumns: `repeat(${compactColumns}, minmax(0, 1fr))` }}
            >
              {rows.map((candidate, rowIndex) => {
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
                    className={`eg-compact-chip matchup-row ${game.winnerId ? "matchup-row--picked" : ""} ${selected ? "selected" : ""} ${lastPickedKey === `${game.id}:${team.id}` ? "fresh-pick" : ""} ${outcome === "win" ? "result-win" : ""} ${outcome === "loss" ? "result-loss" : ""} ${game.customProbA !== null ? "matchup-cell--edited" : ""}`}
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
                    <span className="chip-seed">{seedLabel(team)}</span>
                    {showLogo ? (
                      <TeamHoverAnchor teamName={team.name} logoSrc={teamLogoUrl(team)} className="team-logo-cell">
                        <TeamLogo teamName={team.name} src={teamLogoUrl(team)} />
                      </TeamHoverAnchor>
                    ) : null}
                    <TeamHoverAnchor teamName={team.name} logoSrc={teamLogoUrl(team)}>
                      <AdaptiveTeamLabel className={`chip-code ${showLogo ? "" : "no-logo"}`} fullName={teamLabel} />
                    </TeamHoverAnchor>
                    <span className="chip-odds-wrap">
                      {game.teamAId && game.teamBId && rowIndex === 0 && !game.winnerId ? (
                        <span
                          role="button"
                          tabIndex={0}
                          className={`matchup-edit-icon ${game.customProbA !== null ? "is-edited" : ""}`}
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
                      ) : null}
                      <span className="chip-odds">
                      {outcome ? (
                        <span className={`outcome-badge ${outcome}`}>{outcome === "win" ? "✓" : "✕"}</span>
                      ) : (
                        <>
                          <span
                            className={`chip-prob odds-value ${game.customProbA !== null ? "edited-prob" : ""} ${
                              highlightOddsChanged ? "odds-value--changed" : ""
                            }`}
                            data-team-id={team.id}
                          >
                            {primary}
                          </span>
                          {secondary ? <span className="chip-sub">{secondary}</span> : null}
                        </>
                      )}
                      </span>
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
              editedProb={false}
              canEditProb={false}
              showEditIcon={false}
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
              showEditIcon={false}
              onPick={() => {}}
            />
          </>
        )}
      </div>
      {showChaosTooltip && chaosPreview ? (
        <div className="chaos-tooltip">
          {chaosPreview.earnedChaos !== null ? (
            <span className="chaos-tooltip-earned">+{chaosPreview.earnedChaos.toFixed(2)} chaos</span>
          ) : (
            <>
              <div className="chaos-tooltip-row">
                <span className="chaos-tooltip-team">{teamAName}</span>
                <span className="chaos-tooltip-pts">+{chaosPreview.teamAChaos.toFixed(2)}</span>
              </div>
              <div className="chaos-tooltip-row">
                <span className="chaos-tooltip-team">{teamBName}</span>
                <span className="chaos-tooltip-pts">+{chaosPreview.teamBChaos.toFixed(2)}</span>
              </div>
            </>
          )}
        </div>
      ) : null}
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
      data-team-name={`${seedLabel(team)} ${team.name}`}
      title={`${seedLabel(team)} ${team.name}`}
    >
      <span className="compact-seed">{seedLabel(team)}</span>
      <TeamLogo teamName={team.name} src={teamLogoUrl(team)} className="compact-logo" teamSeed={seedLabel(team)} />
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
  onPick: (teamId: string | null) => void;
}) {
  const roundClass = game.round === "CHAMP" ? "round-champ" : game.round === "F4" ? "round-f4" : "round-e8";
  const roundLabel = game.round === "CHAMP" ? "National Championship" : game.round === "F4" ? "Final Four" : "Elite 8";
  const decided = Boolean(game.lockedByUser && game.winnerId);
  const isMobileViewport = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
  const showdownLogoSize =
    game.round === "CHAMP"
      ? isMobileViewport
        ? 52
        : 88
      : game.round === "F4"
        ? isMobileViewport
          ? 48
          : 80
        : isMobileViewport
          ? 40
          : 64;

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
                onClick={() => onPick(team.id)}
                title={`Chance to advance from this game: ${(candidate.prob * 100).toFixed(1)}%`}
              >
                <span className="eg-showdown-seed">#{seedLabel(team)}</span>
                <ShowdownTeamLogo
                  teamName={team.name}
                  src={teamLogoUrl(team)}
                  sizePx={showdownLogoSize}
                  teamSeed={seedLabel(team)}
                />
                <span className="eg-showdown-name">{showdownTeamName(team.name)}</span>
                <span className="eg-showdown-odds odds-value" data-team-id={team.id}>
                  {decided
                    ? formatOddsDisplay(outcome === "win" ? 1 : 0, displayMode).primary
                    : primary}
                </span>
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
  showEditIcon,
  teamId,
  oddsChanged,
  onOpenProbEditor,
  onPick,
}: {
  label: string;
  seed: string | number | null;
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
  showEditIcon: boolean;
  teamId?: string;
  oddsChanged?: boolean;
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
      className={`eg-team-row matchup-row ${canEditProb ? "" : "matchup-row--picked"} ${compact ? "compact" : ""} ${selected ? "selected" : ""} ${freshPick ? "fresh-pick" : ""} ${outcome === "win" ? "result-win" : ""} ${outcome === "loss" ? "result-loss" : ""} ${editedProb ? "matchup-cell--edited" : ""}`}
      data-team-name={teamName ?? label}
      data-team-seed={seed !== null ? String(seed) : ""}
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
      <span className="team-seed" aria-label={seed !== null ? `Seed ${String(seed)}` : "Seed unavailable"}>
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
        {canEditProb && onOpenProbEditor && showEditIcon && !outcome ? (
          <span
            role="button"
            tabIndex={0}
            className={`matchup-edit-icon ${editedProb ? "is-edited" : ""}`}
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
        ) : null}
        {outcome ? (
            <span className={`outcome-badge ${outcome}`}>{outcome === "win" ? "✓" : "✕"}</span>
        ) : (
          <span className="team-odds-stack">
            <span
              className={`team-odds odds-value ${editedProb ? "edited-prob" : ""} ${oddsChanged ? "odds-value--changed" : ""}`}
              data-team-id={teamId ?? ""}
            >
              {formatted.primary}
            </span>
            {formatted.secondary ? <span className="team-odds-sub">{formatted.secondary}</span> : null}
          </span>
        )}
      </span>
    </button>
  );
}

function TeamLogo({
  teamName,
  src,
  className,
  sizePx,
  teamSeed,
}: {
  teamName: string;
  src: string;
  className?: string;
  sizePx?: number;
  teamSeed?: string | number | null;
}) {
  const [failed, setFailed] = useState(false);
  const sizeStyle = sizePx ? { width: `${sizePx}px`, height: `${sizePx}px`, objectFit: "contain" as const } : undefined;

  if (failed || !src) {
    return (
      <span className={className ? `team-logo team-logo-fallback ${className}` : "team-logo team-logo-fallback"} style={sizeStyle}>
        <span className="team-logo-fallback-seed">{teamSeed ?? "?"}</span>
      </span>
    );
  }

  return (
    <img
      className={className ? `team-logo ${className}` : "team-logo"}
      src={src}
      alt={`${teamName} logo`}
      loading="lazy"
      style={sizeStyle}
      onError={() => setFailed(true)}
    />
  );
}

function ShowdownTeamLogo({
  teamName,
  src,
  sizePx,
  teamSeed,
}: {
  teamName: string;
  src: string;
  sizePx: number;
  teamSeed?: string | number | null;
}) {
  const size = `${sizePx}px`;

  return (
    <span
      className="eg-showdown-logo-wrap"
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        maxWidth: size,
        maxHeight: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <TeamLogo
        className="eg-showdown-logo-img"
        teamName={teamName}
        src={src}
        sizePx={sizePx}
        teamSeed={teamSeed}
      />
    </span>
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
              <TeamLogo className="team-hover-logo" teamName={teamName} src={logoSrc} />
              <span className="team-hover-name">{fullTeamName(teamName)}</span>
            </span>,
            document.body
          )
        : null}
    </span>
  );
}

function MatchupStatsModal({ game, onClose }: { game: ResolvedGame; onClose: () => void }) {
  const teamA = game.teamAId ? teamsById.get(game.teamAId) ?? null : null;
  const teamB = game.teamBId ? teamsById.get(game.teamBId) ?? null : null;
  const [activeStatDescription, setActiveStatDescription] = useState<TeamStatKey | "importance" | null>(null);
  if (!teamA || !teamB) return null;

  const statsA = TEAM_STATS_2026[teamA.name] ?? null;
  const statsB = TEAM_STATS_2026[teamB.name] ?? null;

  return (
    <div className="matchup-stats-overlay" onClick={onClose}>
      <div className="matchup-stats-modal" onClick={(event) => event.stopPropagation()}>
        <div className="matchup-stats-head">
          <h3>Matchup Stats</h3>
          <button className="matchup-stats-close" onClick={onClose} aria-label="Close matchup stats">
            ✕
          </button>
        </div>
        <p className="matchup-stats-sub">
          {seedLabel(teamA)} {teamA.name} vs {seedLabel(teamB)} {teamB.name}
        </p>
        <div className="matchup-stats-table-wrap">
          <table className="matchup-stats-table">
            <thead>
              <tr>
                <th>Stat</th>
                <th>{teamA.name}</th>
                <th>{teamB.name}</th>
                <th>Difference</th>
                <th className="matchup-stats-th-help">
                  <span>Importance %</span>
                  <button
                    type="button"
                    className="matchup-stat-help-btn"
                    aria-label="About Importance percent"
                    onClick={() => setActiveStatDescription((prev) => (prev === "importance" ? null : "importance"))}
                  >
                    ⓘ
                  </button>
                  {activeStatDescription === "importance" ? (
                    <div className="matchup-stat-help-popover matchup-stat-help-popover--header">{IMPORTANCE_HELP_TEXT}</div>
                  ) : null}
                </th>
              </tr>
            </thead>
            <tbody>
              {TEAM_STAT_ORDER.map((key) => {
                const aValue = statsA?.[key] ?? null;
                const bValue = statsB?.[key] ?? null;
                return (
                  <tr key={key}>
                    <td className="matchup-stat-name-cell">
                      <span>{TEAM_STAT_LABELS[key]}</span>
                      <button
                        type="button"
                        className="matchup-stat-help-btn"
                        aria-label={`About ${TEAM_STAT_LABELS[key]}`}
                        onClick={() =>
                          setActiveStatDescription((prev) => (prev === key ? null : key))
                        }
                      >
                        ⓘ
                      </button>
                      {activeStatDescription === key ? (
                        <div className="matchup-stat-help-popover">{TEAM_STAT_DESCRIPTIONS[key]}</div>
                      ) : null}
                    </td>
                    <td>{formatStatValue(aValue)}</td>
                    <td>{formatStatValue(bValue)}</td>
                    <td>{differenceForStat(teamA.name, aValue, teamB.name, bValue, key)}</td>
                    <td>{TEAM_STAT_IMPORTANCE[key]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
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
        <span className="prob-popup-team-name">{seedLabel(teamA)} {teamA.name}</span>
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
        <span className="prob-popup-team-name">{seedLabel(teamB)} {teamB.name}</span>
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

function ConfirmResetModal({
  visible,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!visible) return;
    cancelRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && visible) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel, visible]);

  if (!visible) return null;

  return createPortal(
    <div className="reset-modal-overlay" onClick={onCancel}>
      <div className="reset-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="reset-modal-header">
          <span className="reset-modal-title">{title}</span>
        </div>
        <p className="reset-modal-message">{message}</p>
        <div className="reset-modal-actions">
          <button ref={cancelRef} className="reset-modal-btn reset-modal-btn--cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="reset-modal-btn reset-modal-btn--confirm"
            onClick={() => {
              onConfirm();
              onCancel();
            }}
          >
            {confirmLabel}
          </button>
        </div>
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
  ctaDisabled,
  ctaLabel,
  centered,
  dontShowAgain,
  onDontShowAgainChange,
  onAdvance,
  onBack,
  onSkip,
}: {
  step: WalkthroughStepConfig;
  stepIndex: number;
  targetRect: DOMRect | null;
  placement: TooltipPlacement;
  ctaDisabled: boolean;
  ctaLabel: string;
  centered: boolean;
  dontShowAgain: boolean;
  onDontShowAgainChange: (next: boolean) => void;
  onAdvance: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const ctaRef = useRef<HTMLButtonElement | null>(null);
  const [tooltipPlacement, setTooltipPlacement] = useState(placement);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const stepLabels = ["Hook", "Upset", "Ripple", "Futures", "Ready"];
  const fallbackRect = new DOMRect(window.innerWidth / 2 - 1, window.innerHeight / 2 - 1, 2, 2);
  const effectiveTargetRect = targetRect ?? fallbackRect;
  const padded = {
    top: Math.max(8, effectiveTargetRect.top - 8),
    left: Math.max(8, effectiveTargetRect.left - 8),
    width: effectiveTargetRect.width + 16,
    height: effectiveTargetRect.height + 16,
  };

  useEffect(() => {
    if (!ctaDisabled) {
      ctaRef.current?.focus();
      return;
    }
    const skipBtn = tooltipRef.current?.querySelector<HTMLButtonElement>(".walkthrough-skip-link");
    skipBtn?.focus();
  }, [ctaDisabled, step.id]);

  useEffect(() => {
    if (!tooltipRef.current) return;
    const tooltipEl = tooltipRef.current;
    const focusables = Array.from(
      tooltipEl.querySelectorAll<HTMLElement>("button, a, [href], [tabindex]:not([tabindex='-1'])")
    ).filter((el) => !el.hasAttribute("disabled"));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (first) first.focus();
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !first || !last) return;
      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    tooltipEl.addEventListener("keydown", handleTab);
    return () => tooltipEl.removeEventListener("keydown", handleTab);
  }, [step.id, ctaDisabled]);

  useLayoutEffect(() => {
    const tooltipEl = tooltipRef.current;
    if (!tooltipEl) return;
    const isMobile = window.innerWidth <= 767;
    if (centered) {
      setTooltipPlacement("below");
      setTooltipStyle({});
      return;
    }
    if (isMobile) {
      setTooltipPlacement("bottom-sheet");
      setTooltipStyle({
        left: 0,
        right: 0,
        top: "auto",
        bottom: 0,
      });
      return;
    }
    const MARGIN = 12;
    const EDGE_PADDING = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tw = tooltipEl.offsetWidth;
    const th = tooltipEl.offsetHeight;
    let nextPlacement = placement;
    let top = padded.top + padded.height + MARGIN;
    let left = padded.left + Math.min(24, padded.width / 4);

    if (nextPlacement === "above") {
      top = padded.top - th - MARGIN;
      left = padded.left;
    } else if (nextPlacement === "left") {
      top = padded.top;
      left = padded.left - tw - MARGIN;
    } else if (nextPlacement === "right") {
      top = padded.top;
      left = padded.left + padded.width + MARGIN;
    }

    if (top + th > vh - EDGE_PADDING) {
      if (nextPlacement === "below") {
        top = padded.top - th - MARGIN;
        nextPlacement = "above";
      } else {
        top = vh - th - EDGE_PADDING;
      }
    }
    if (top < EDGE_PADDING) top = EDGE_PADDING;

    if (left + tw > vw - EDGE_PADDING) {
      if (nextPlacement === "right") {
        left = padded.left - tw - MARGIN;
        nextPlacement = "left";
      } else {
        left = vw - tw - EDGE_PADDING;
      }
    }
    if (left < EDGE_PADDING) left = EDGE_PADDING;

    setTooltipPlacement(nextPlacement);
    setTooltipStyle({ top, left });
  }, [centered, placement, padded.height, padded.left, padded.top, padded.width, step.id]);

  useEffect(() => {
    const tooltipEl = tooltipRef.current;
    if (!tooltipEl) return;
    tooltipEl.style.opacity = "0";
    tooltipEl.style.transform = "translateY(6px)";
    const timer = window.setTimeout(() => {
      tooltipEl.style.opacity = "1";
      tooltipEl.style.transform = "translateY(0)";
    }, 180);
    return () => window.clearTimeout(timer);
  }, [step.id]);

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const shadeStyles = centered
    ? {
        top: { left: 0, top: 0, width: viewportWidth, height: viewportHeight },
        left: { left: 0, top: 0, width: 0, height: 0 },
        right: { left: 0, top: 0, width: 0, height: 0 },
        bottom: { left: 0, top: 0, width: 0, height: 0 },
      }
    : {
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
      {!centered ? (
        <div
          className="walkthrough-cutout"
          style={{
            top: `${padded.top}px`,
            left: `${padded.left}px`,
            width: `${padded.width}px`,
            height: `${padded.height}px`,
          }}
        />
      ) : null}
      <div
        className={`walkthrough-tooltip ${centered ? "walkthrough-tooltip--centered" : ""} placement-${tooltipPlacement}`}
        ref={tooltipRef}
        style={tooltipStyle}
      >
        <p className="walkthrough-step-label">STEP {stepIndex + 1} OF {WALKTHROUGH_STEPS.length}</p>
        <h3>{step.heading}</h3>
        <p>{step.body}</p>
        {step.id === "ready" ? (
          <label className="onboarding-checkbox-label">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(event) => onDontShowAgainChange(event.target.checked)}
            />
            <span>Don&apos;t show this again</span>
          </label>
        ) : null}
        <div className="walkthrough-dots" aria-hidden="true">
          {WALKTHROUGH_STEPS.map((_, i) => (
            <span key={i} className={i === stepIndex ? "active" : ""} data-label={stepLabels[i] ?? `Step ${i + 1}`} />
          ))}
        </div>
        <div className="walkthrough-actions">
          {stepIndex > 0 ? (
            <button type="button" className="walkthrough-skip-link walkthrough-back-btn" onClick={onBack}>
              ← Back
            </button>
          ) : null}
          <button
            type="button"
            className={`walkthrough-cta-btn ${ctaDisabled || step.id === "upset-pick" ? "walkthrough-cta-btn--disabled" : ""}`}
            ref={ctaRef}
            onClick={onAdvance}
            disabled={ctaDisabled || step.id === "upset-pick"}
          >
            {step.id === "upset-pick" ? "Pick a team" : ctaLabel}
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
