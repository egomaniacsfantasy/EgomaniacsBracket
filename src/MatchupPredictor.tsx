import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { TEAM_STAT_IMPORTANCE, TEAM_STAT_ORDER, TEAM_STATS_2026, type TeamStatKey } from "./data/teamStats2026";
import { teams as bracketTeams } from "./data/teams";
import { teamLogoUrl } from "./lib/logo";
import { getMappedEspnLogoPath } from "./lib/logoMap";
import { formatOddsDisplay } from "./lib/odds";
import type { OddsDisplayMode } from "./types";

let getMatchupProbFn: ((a: number, b: number, loc: "N" | "H" | "A") => number | null) | null = null;
let getTeamIdxFn: ((id: number) => number) | null = null;
let predictorTeamsCache: ReadonlyArray<{ id: number; name: string; conf: string }> | null = null;
let loadingPromise: Promise<void> | null = null;

type TeamOption = { id: number; name: string; conf: string };
type VenueCode = "N" | "H" | "A";

const bracketTeamByName = new Map(bracketTeams.map((team) => [team.name, team]));
const PREDICTOR_LIGHTNING_DECORATIONS = [
  { src: "/assets/lightning/lightning_bolt_1.png", className: "pred-lightning-deco pred-lightning-deco--tl" },
  { src: "/assets/lightning/lightning_strike_horizontal.png", className: "pred-lightning-deco pred-lightning-deco--tr" },
  { src: "/assets/lightning/lightning_bolt_5.png", className: "pred-lightning-deco pred-lightning-deco--mr" },
  { src: "/assets/lightning/lightning_bolt_7.png", className: "pred-lightning-deco pred-lightning-deco--bl" },
  { src: "/assets/lightning/lightning_bolt_3.png", className: "pred-lightning-deco pred-lightning-deco--br" },
] as const;

async function loadPredictorData(): Promise<void> {
  if (predictorTeamsCache) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = import("./data/matchupPredictor").then((mod) => {
    getMatchupProbFn = mod.getMatchupProb;
    getTeamIdxFn = mod.getTeamIdx;
    predictorTeamsCache = mod.PREDICTOR_TEAMS;
  });
  return loadingPromise;
}

const TEAM_STAT_LABELS: Record<TeamStatKey, string> = {
  rank_POM: "KenPom Rank",
  rank_MAS: "Massey Rank",
  rank_WLK: "Whitlock Rank",
  rank_MOR: "Moore Rank",
  elo_sos: "Odds Gods Elo SOS",
  elo_last: "Odds Gods Elo",
  avg_net_rtg: "Net Rating",
  avg_off_rtg: "Offensive Rating",
  elo_trend: "Odds Gods Elo Trend",
  avg_def_rtg: "Defensive Rating",
  last5_Margin: "Last 5 Margin",
  rank_BIH: "Bihl Rank",
  rank_NET: "NET Rank",
};

const LOWER_IS_BETTER = new Set<TeamStatKey>([
  "rank_POM",
  "rank_MAS",
  "rank_WLK",
  "rank_MOR",
  "rank_BIH",
  "avg_def_rtg",
  "rank_NET",
]);

const TEAM_STAT_DOT_COUNTS: Record<TeamStatKey, number> = (() => {
  const ranked = [...TEAM_STAT_ORDER].sort(
    (a, b) => Number.parseFloat(TEAM_STAT_IMPORTANCE[b]) - Number.parseFloat(TEAM_STAT_IMPORTANCE[a])
  );
  return Object.fromEntries(
    ranked.map((key, index) => [key, 5 - Math.round((index / Math.max(1, ranked.length - 1)) * 4)])
  ) as Record<TeamStatKey, number>;
})();

const conferenceLabel = (conf: string): string => conf.replace(/_/g, " ").toUpperCase();

const predictorTeamLogo = (teamName: string): string | null => {
  const bracketTeam = bracketTeamByName.get(teamName);
  if (bracketTeam) return teamLogoUrl(bracketTeam);
  return getMappedEspnLogoPath(teamName);
};

const formatStatValue = (value: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toFixed(1);
  if (Number.isInteger(value)) return `${value}`;
  if (Math.abs(value) < 1) return value.toFixed(4);
  return value.toFixed(2);
};

function PredictorTeamMark({
  teamName,
  fallbackLabel,
  size,
}: {
  teamName: string | null;
  fallbackLabel: string;
  size: "hero" | "selector" | "mini";
}) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [teamName]);

  const src = teamName ? predictorTeamLogo(teamName) : null;
  const showImage = Boolean(src && !imageFailed && !src.includes("placehold.co"));

  if (showImage) {
    return (
      <img
        className={`pred-team-mark pred-team-mark--${size}`}
        src={src ?? ""}
        alt=""
        aria-hidden="true"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span className={`pred-team-mark pred-team-mark--${size} pred-team-mark--placeholder`} aria-hidden="true">
      {fallbackLabel}
    </span>
  );
}

function PredictorBackground() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const ambientCanvasRef = useRef<HTMLCanvasElement>(null);
  const textCanvasRef = useRef<HTMLCanvasElement>(null);
  const boltCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    const ambientCanvas = ambientCanvasRef.current;
    const textCanvas = textCanvasRef.current;
    const boltCanvas = boltCanvasRef.current;
    const section = scene?.parentElement;
    if (
      !(scene instanceof HTMLDivElement) ||
      !(section instanceof HTMLElement) ||
      !(ambientCanvas instanceof HTMLCanvasElement) ||
      !(textCanvas instanceof HTMLCanvasElement) ||
      !(boltCanvas instanceof HTMLCanvasElement)
    ) {
      return;
    }

    const ambientCtx = ambientCanvas.getContext("2d");
    const textCtx = textCanvas.getContext("2d");
    const boltCtx = boltCanvas.getContext("2d");
    if (!ambientCtx || !textCtx || !boltCtx) return;

    type BackgroundRect = { x: number; y: number; w: number; h: number };
    type BackgroundFragment = {
      category: string;
      text: string;
      x: number;
      y: number;
      size: number;
      baseOpacity: number;
      currentOpacity: number;
      maxOpacity: number;
      fontType: "mono" | "serif";
      rotation: number;
      litUntil: number;
    };
    type BoltBranch = { points: Array<[number, number]>; width: number };
    type ActiveBolt = { main: Array<[number, number]>; branches: BoltBranch[]; alpha: number };

    const categoryPools = {
      odds: [
        "-110", "+3300", "-450", "+220", "-175", "+550", "EVEN", "-3040", "+1400",
        "-800", "+290", "-115", "+6500", "-2200", "+380", "-330", "+4500", "-650",
        "+105", "-190", "+180", "-240", "+3300", "-1800",
      ],
      lines: [
        "DUKE ML -110", "HOU -450", "UK +220", "O/U 148.5", "NOVA -3.5",
        "KU ML -175", "BAMA +7", "OU 151.0", "TENN -330", "AUB +14.5",
        "ILL ML +310", "UCONN -6.5", "MSU +3 -108", "UF +380", "UNC -1.5",
      ],
      implied: [
        "45.3 WIN%", "61.2%", "28.6% IMP", "73.4%", "19.2% IMP",
        "50.0%", "88.1%", "33.3%", "12.8% TITLE", "67.9%", "7.4% IMP", "94.2%",
      ],
      basketball: [
        "KP #4", "AdjEM 28.4", "AdjO 118.2", "AdjD 89.4", "BPI 94.3",
        "67.8 eFG%", "38.4 3P%", "NET #12", "SEED 1", "T-Rank 8",
        "Barttorvik 3", "ELO 1842", "SOS .614", "72.4 PPG", "58.2 OPP",
        "+14.2 NET", "31.8 PACE", "103.4 ORTG", "22-6 SU", "18-10 ATS",
        "BARTHAG .942", "WAB +4.2", "LUCK +0.038",
      ],
      roman: [
        "XIV", "XLVIII", "IX", "MMXXV", "XCIX", "IV", "LXIII", "LVII",
        "XXXII", "XVI", "XLII", "LI", "VII", "XCVIII", "MMXXIV", "LXVI",
      ],
      greek: ["Σ", "Δ", "μ", "σ", "π", "Ω", "β", "λ", "φ", "θ"],
      latin: [
        "ALEA IACTA EST", "SORS", "EVENTUS", "PROBABILITAS", "CALCULUS", "FATA",
        "FORTES FORTUNA", "FATA VIAM INVENIENT", "RATIO", "NUMERUS", "CASUS",
      ],
    } as const;

    const categoryStyle = {
      greek: { font: "serif" as const, min: 28, max: 36, base: 0.055, maxOpacity: 0.09 },
      odds: { font: "mono" as const, min: 8, max: 15, base: 0.05, maxOpacity: 0.085 },
      roman: { font: "serif" as const, min: 12, max: 34, base: 0.045, maxOpacity: 0.08 },
      implied: { font: "mono" as const, min: 8, max: 13, base: 0.045, maxOpacity: 0.075 },
      lines: { font: "mono" as const, min: 8, max: 12, base: 0.04, maxOpacity: 0.07 },
      basketball: { font: "mono" as const, min: 8, max: 11, base: 0.038, maxOpacity: 0.068 },
      latin: { font: "serif" as const, min: 7, max: 13, base: 0.035, maxOpacity: 0.06 },
    };

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const legacyReducedMotionQuery = reducedMotionQuery as MediaQueryList & {
      addListener?: (listener: () => void) => void;
      removeListener?: (listener: () => void) => void;
    };
    const FIXED_SEED = 31337;

    let reducedMotion = reducedMotionQuery.matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let noiseTime = 0;
    let lastTs = 0;
    let running = false;
    let ambientRafId = 0;
    let textRafId = 0;
    let boltRafId = 0;
    let boltTimeoutId = 0;
    let resizeTimeoutId = 0;
    let activeBolt: ActiveBolt | null = null;
    let fragments: BackgroundFragment[] = [];
    let safeZones: BackgroundRect[] = [];
    let textNeedsRender = true;
    let illuminationActive = false;
    let resizeObserver: ResizeObserver | null = null;

    const seededRng = (seed: number) => {
      let s = seed % 2147483647;
      if (s <= 0) s += 2147483646;
      return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
      };
    };

    const hash2d = (x: number, y: number) => {
      const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
      return n - Math.floor(n);
    };

    const smoothstep = (value: number) => value * value * (3 - 2 * value);

    const valueNoise2d = (x: number, y: number) => {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const xf = x - x0;
      const yf = y - y0;

      const v00 = hash2d(x0, y0);
      const v10 = hash2d(x0 + 1, y0);
      const v01 = hash2d(x0, y0 + 1);
      const v11 = hash2d(x0 + 1, y0 + 1);

      const u = smoothstep(xf);
      const v = smoothstep(yf);
      const xa = v00 * (1 - u) + v10 * u;
      const xb = v01 * (1 - u) + v11 * u;
      return xa * (1 - v) + xb * v;
    };

    const noise2d = (x: number, y: number) => valueNoise2d(x, y) * 2 - 1;

    const overlapsAny = (rect: BackgroundRect, occupied: BackgroundRect[]) =>
      occupied.some((other) => !(rect.x + rect.w < other.x || other.x + other.w < rect.x || rect.y + rect.h < other.y || other.y + other.h < rect.y));

    const inSafeZone = (rect: BackgroundRect) => safeZones.some((zone) => overlapsAny(rect, [zone]));

    const pickBucket = (rand: number) => {
      if (rand < 0.22) return "left";
      if (rand < 0.44) return "right";
      if (rand < 0.59) return "top";
      if (rand < 0.74) return "bottom";
      return "middle";
    };

    const pickPointInBucket = (bucket: string, rng: () => number) => {
      if (bucket === "left") return { x: width * rng() * 0.12, y: height * rng() };
      if (bucket === "right") return { x: width * (0.88 + rng() * 0.12), y: height * rng() };
      if (bucket === "top") return { x: width * rng(), y: height * rng() * 0.12 };
      if (bucket === "bottom") return { x: width * rng(), y: height * (0.88 + rng() * 0.12) };
      return { x: width * (0.14 + rng() * 0.72), y: height * (0.1 + rng() * 0.8) };
    };

    const measureFragmentRect = (fragment: BackgroundFragment): BackgroundRect => {
      const fontFamily =
        fragment.fontType === "mono"
          ? '"IBM Plex Mono", "SFMono-Regular", Menlo, monospace'
          : '"Instrument Serif", Georgia, serif';
      textCtx.save();
      textCtx.font = `${fragment.size}px ${fontFamily}`;
      const metrics = textCtx.measureText(fragment.text);
      textCtx.restore();
      const widthPx = metrics.width + 5;
      const heightPx = fragment.size + 3;
      return {
        x: fragment.x - 2,
        y: fragment.y - heightPx + 2,
        w: widthPx + 5,
        h: heightPx + 3,
      };
    };

    const buildCategorySequence = (count: number, rng: () => number) => {
      const weighted = [
        "odds", "odds", "lines", "lines", "implied", "implied",
        "basketball", "basketball", "roman", "greek", "latin",
      ] as const;
      return Array.from({ length: count }, () => weighted[Math.floor(rng() * weighted.length)]);
    };

    const fragmentCountForViewport = () => {
      if (width < 768) return 30 + Math.floor(width % 11);
      if (width < 1200) return 55 + Math.floor(width % 16);
      return 80 + Math.floor(width % 21);
    };

    const buildSafeZones = (): BackgroundRect[] => {
      const zones: BackgroundRect[] = [];
      const sectionRect = section.getBoundingClientRect();

      section
        .querySelectorAll(".pred-header, .pred-arena, .pred-venue-wrap, .pred-results, .pred-empty-state, .pred-footer, .pred-status")
        .forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const rect = element.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) return;
          zones.push({
            x: rect.left - sectionRect.left - 28,
            y: rect.top - sectionRect.top - 18,
            w: rect.width + 56,
            h: rect.height + 36,
          });
        });

      zones.push({ x: width * 0.16, y: height * 0.12, w: width * 0.68, h: height * 0.72 });
      zones.push({ x: 0, y: height * 0.28, w: width * 0.18, h: height * 0.34 });
      zones.push({ x: width * 0.82, y: height * 0.22, w: width * 0.18, h: height * 0.38 });
      return zones;
    };

    const createFragments = (): BackgroundFragment[] => {
      const rng = seededRng(FIXED_SEED + width * 31 + height * 17);
      const count = fragmentCountForViewport();
      const sequence = buildCategorySequence(count, rng);
      const occupied: BackgroundRect[] = [];
      const output: BackgroundFragment[] = [];

      let greekCount = 0;
      let romanLargeCount = 0;
      let latinPhraseCount = 0;

      for (let index = 0; index < sequence.length; index += 1) {
        const category = sequence[index];
        const style = categoryStyle[category];
        if (!style) continue;
        if (category === "greek" && greekCount >= 4) continue;
        if (category === "latin" && latinPhraseCount >= 5) continue;

        let placed = false;
        for (let attempt = 0; attempt < 180; attempt += 1) {
          const bucket = pickBucket(rng());
          const point = pickPointInBucket(bucket, rng);
          const text = categoryPools[category][Math.floor(rng() * categoryPools[category].length)];
          const size = style.min + rng() * (style.max - style.min);
          const baseOpacity = Math.min(style.maxOpacity, style.base + rng() * 0.025);
          const rotation = -3 + rng() * 6;
          const fragment: BackgroundFragment = {
            category,
            text,
            x: point.x,
            y: point.y,
            size,
            baseOpacity,
            currentOpacity: baseOpacity,
            maxOpacity: style.maxOpacity,
            fontType: style.font,
            rotation,
            litUntil: 0,
          };
          const rect = measureFragmentRect(fragment);
          if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > width || rect.y + rect.h > height) continue;
          if (inSafeZone(rect) || overlapsAny(rect, occupied)) continue;

          occupied.push(rect);
          output.push(fragment);
          placed = true;
          if (category === "greek") greekCount += 1;
          if (category === "latin" && /\s/.test(text)) latinPhraseCount += 1;
          if (category === "roman" && size >= 28) romanLargeCount += 1;
          if (category === "roman" && romanLargeCount > 4) {
            output.pop();
            occupied.pop();
            romanLargeCount -= 1;
            placed = false;
            continue;
          }
          break;
        }
        if (!placed) continue;
      }

      return output;
    };

    const clearBoltLayer = () => boltCtx.clearRect(0, 0, width, height);

    const renderTextLayer = () => {
      textCtx.clearRect(0, 0, width, height);
      if (!fragments.length) return;

      fragments.forEach((fragment) => {
        const fontFamily =
          fragment.fontType === "mono"
            ? '"IBM Plex Mono", "SFMono-Regular", Menlo, monospace'
            : '"Instrument Serif", Georgia, serif';
        textCtx.save();
        textCtx.translate(fragment.x, fragment.y);
        textCtx.rotate((fragment.rotation * Math.PI) / 180);
        textCtx.globalAlpha = fragment.currentOpacity;
        textCtx.fillStyle = "#f0e6d0";
        textCtx.font = `${fragment.size}px ${fontFamily}`;
        textCtx.textBaseline = "alphabetic";

        if (fragment.fontType === "serif") {
          const chars = fragment.text.split("");
          let cursor = 0;
          const spacing = fragment.size * 0.18;
          chars.forEach((char) => {
            textCtx.fillText(char, cursor, 0);
            cursor += textCtx.measureText(char).width + spacing;
          });
        } else {
          textCtx.fillText(fragment.text, 0, 0);
        }
        textCtx.restore();
      });

      textNeedsRender = false;
    };

    const resizeCanvases = () => {
      dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      width = Math.max(1, Math.floor(section.clientWidth));
      height = Math.max(window.innerHeight, section.scrollHeight);

      [ambientCanvas, textCanvas, boltCanvas].forEach((canvas) => {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      });

      ambientCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      textCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      boltCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      safeZones = buildSafeZones();
      fragments = createFragments();
      textNeedsRender = true;
      renderTextLayer();
    };

    const drawAmbient = (timestamp: number) => {
      if (!running) return;
      if (lastTs === 0) lastTs = timestamp;
      const delta = Math.min(64, timestamp - lastTs);
      lastTs = timestamp;
      noiseTime += delta;

      ambientCtx.clearRect(0, 0, width, height);
      const layers = reducedMotion ? 3 : 4;

      for (let index = 0; index < layers; index += 1) {
        const x = width * (0.3 + 0.4 * noise2d(index * 10.3, noiseTime * 0.0003));
        const y = height * (0.2 + 0.6 * noise2d(index * 10.3 + 100, noiseTime * 0.0002));
        const radius = 320 + 160 * noise2d(index * 10.3 + 200, noiseTime * 0.0004);
        const gradient = ambientCtx.createRadialGradient(x, y, 0, x, y, radius);
        const baseAlpha = reducedMotion ? 0.02 : 0.04;
        const midAlpha = reducedMotion ? 0.01 : 0.02;
        gradient.addColorStop(0, `rgba(180, 140, 40, ${baseAlpha})`);
        gradient.addColorStop(0.4, `rgba(160, 120, 20, ${midAlpha})`);
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

        ambientCtx.fillStyle = gradient;
        ambientCtx.beginPath();
        ambientCtx.ellipse(x, y, radius, radius * 0.6, 0, 0, Math.PI * 2);
        ambientCtx.fill();
      }

      ambientRafId = window.requestAnimationFrame(drawAmbient);
    };

    const stepTextIllumination = () => {
      if (!running || !illuminationActive) return;
      const now = performance.now();
      let stillActive = false;

      fragments.forEach((fragment) => {
        if (fragment.currentOpacity > fragment.baseOpacity) {
          if (now > fragment.litUntil) {
            fragment.currentOpacity *= 0.92;
            if (fragment.currentOpacity < fragment.baseOpacity) {
              fragment.currentOpacity = fragment.baseOpacity;
            } else {
              stillActive = true;
            }
          } else {
            stillActive = true;
          }
        }
      });

      textNeedsRender = true;
      renderTextLayer();
      illuminationActive = stillActive;
      if (illuminationActive) {
        textRafId = window.requestAnimationFrame(stepTextIllumination);
      } else {
        textRafId = 0;
      }
    };

    const generateBolt = (startX: number, startY: number, endX: number, endY: number, roughness = 2.5): Array<[number, number]> => {
      const distance = Math.hypot(endX - startX, endY - startY);
      if (distance < 4) return [[startX, startY], [endX, endY]];

      const midX = (startX + endX) / 2 + (Math.random() - 0.5) * roughness * distance * 0.4;
      const midY = (startY + endY) / 2 + (Math.random() - 0.5) * roughness * distance * 0.2;

      const left = generateBolt(startX, startY, midX, midY, roughness * 0.6);
      const right = generateBolt(midX, midY, endX, endY, roughness * 0.6);
      left.pop();
      return left.concat(right);
    };

    const drawBolt = (points: Array<[number, number]>, alpha: number, widthPx = 1) => {
      if (!points.length) return;

      boltCtx.beginPath();
      boltCtx.moveTo(points[0][0], points[0][1]);
      for (let index = 1; index < points.length; index += 1) {
        boltCtx.lineTo(points[index][0], points[index][1]);
      }

      boltCtx.strokeStyle = `rgba(220, 180, 80, ${alpha * 0.15})`;
      boltCtx.lineWidth = widthPx * 6;
      boltCtx.shadowBlur = 20;
      boltCtx.shadowColor = "rgba(220, 180, 80, 0.3)";
      boltCtx.stroke();

      boltCtx.strokeStyle = `rgba(240, 220, 140, ${alpha * 0.6})`;
      boltCtx.lineWidth = widthPx;
      boltCtx.shadowBlur = 8;
      boltCtx.stroke();

      boltCtx.strokeStyle = `rgba(255, 245, 220, ${alpha * 0.3})`;
      boltCtx.lineWidth = widthPx * 0.4;
      boltCtx.shadowBlur = 0;
      boltCtx.stroke();
    };

    const screenFlash = () => {
      const flash = document.createElement("div");
      flash.className = "pred-lightning-flash";
      scene.appendChild(flash);
      window.setTimeout(() => flash.remove(), 150);
    };

    const illuminateNearbyText = (points: Array<[number, number]>) => {
      if (!fragments.length || !points.length || reducedMotion) return;
      const sampleStep = Math.max(1, Math.floor(points.length / 36));
      let touched = false;

      fragments.forEach((fragment) => {
        let nearBolt = false;
        for (let index = 0; index < points.length; index += sampleStep) {
          const [boltX, boltY] = points[index];
          if (Math.hypot(fragment.x - boltX, fragment.y - boltY) < 180) {
            nearBolt = true;
            break;
          }
        }

        if (nearBolt) {
          const boosted = Math.min(fragment.maxOpacity, fragment.baseOpacity * 3);
          fragment.currentOpacity = Math.max(fragment.currentOpacity, boosted);
          fragment.litUntil = performance.now() + 60;
          touched = true;
        }
      });

      if (touched) {
        illuminationActive = true;
        textNeedsRender = true;
        renderTextLayer();
        if (!textRafId) {
          textRafId = window.requestAnimationFrame(stepTextIllumination);
        }
      }
    };

    const renderBoltFrame = () => {
      if (!running || !activeBolt) return;
      const currentBolt = activeBolt;
      clearBoltLayer();
      drawBolt(currentBolt.main, currentBolt.alpha, 1.2);
      currentBolt.branches.forEach((branch) => {
        drawBolt(branch.points, currentBolt.alpha * 0.6, branch.width);
      });

      currentBolt.alpha -= 0.08;
      if (currentBolt.alpha > 0) {
        boltRafId = window.requestAnimationFrame(renderBoltFrame);
      } else {
        activeBolt = null;
        clearBoltLayer();
      }
    };

    const scheduleNextBolt = () => {
      if (!running || reducedMotion) return;
      const nextDelay = 4500 + Math.random() * 6500;
      boltTimeoutId = window.setTimeout(triggerLightningEvent, nextDelay);
    };

    const triggerLightningEvent = () => {
      if (!running || reducedMotion || document.hidden) return;

      const startFromTop = Math.random() > 0.32;
      const startX = startFromTop ? width * (0.1 + Math.random() * 0.8) : Math.random() > 0.5 ? 0 : width;
      const startY = startFromTop ? 0 : height * (0.12 + Math.random() * 0.48);
      const endX = startX + (Math.random() - 0.5) * width * 0.3;
      const endY = height * (0.3 + Math.random() * 0.5);

      const mainBolt = generateBolt(startX, startY, endX, endY);
      const branches: BoltBranch[] = [];
      const branchCount = 2 + Math.floor(Math.random() * 3);

      for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
        const branchStartIndex = Math.floor(mainBolt.length * (0.3 + Math.random() * 0.4));
        const point = mainBolt[Math.max(0, Math.min(mainBolt.length - 1, branchStartIndex))];
        if (!point) continue;
        const [branchX, branchY] = point;
        const branchEndX = branchX + (Math.random() - 0.5) * 200;
        const branchEndY = branchY + Math.random() * 150;
        branches.push({
          points: generateBolt(branchX, branchY, branchEndX, branchEndY, 1.8),
          width: 0.5 + Math.random() * 0.3,
        });
      }

      activeBolt = { main: mainBolt, branches, alpha: 1 };
      const allBoltPoints = mainBolt.concat(...branches.map((branch) => branch.points));
      illuminateNearbyText(allBoltPoints);
      screenFlash();
      if (boltRafId) window.cancelAnimationFrame(boltRafId);
      boltRafId = window.requestAnimationFrame(renderBoltFrame);
      scheduleNextBolt();
    };

    const stopAnimations = () => {
      running = false;
      if (ambientRafId) window.cancelAnimationFrame(ambientRafId);
      if (textRafId) window.cancelAnimationFrame(textRafId);
      if (boltRafId) window.cancelAnimationFrame(boltRafId);
      if (boltTimeoutId) window.clearTimeout(boltTimeoutId);
      ambientRafId = 0;
      textRafId = 0;
      boltRafId = 0;
      boltTimeoutId = 0;
      lastTs = 0;
      activeBolt = null;
      illuminationActive = false;
      clearBoltLayer();
    };

    const startAnimations = () => {
      if (running) return;
      running = true;
      ambientCanvas.style.opacity = reducedMotion ? "0.5" : "1";
      textCanvas.style.opacity = "1";
      boltCanvas.style.opacity = reducedMotion ? "0" : "1";
      ambientRafId = window.requestAnimationFrame(drawAmbient);
      if (textNeedsRender) renderTextLayer();
      if (!reducedMotion) {
        const firstDelay = 1200 + Math.random() * 2200;
        boltTimeoutId = window.setTimeout(triggerLightningEvent, firstDelay);
      }
    };

    const onResize = () => {
      if (resizeTimeoutId) window.clearTimeout(resizeTimeoutId);
      resizeTimeoutId = window.setTimeout(() => {
        resizeCanvases();
        renderTextLayer();
      }, 140);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stopAnimations();
      } else {
        startAnimations();
      }
    };

    const handleReducedMotionChange = () => {
      reducedMotion = reducedMotionQuery.matches;
      stopAnimations();
      resizeCanvases();
      startAnimations();
    };

    resizeCanvases();
    startAnimations();

    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(section);
    const content = section.querySelector(".pred-content");
    if (content instanceof HTMLElement) {
      resizeObserver.observe(content);
    }

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    if ("addEventListener" in reducedMotionQuery) {
      reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
    } else {
      legacyReducedMotionQuery.addListener?.(handleReducedMotionChange);
    }

    return () => {
      stopAnimations();
      if (resizeTimeoutId) window.clearTimeout(resizeTimeoutId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if ("removeEventListener" in reducedMotionQuery) {
        reducedMotionQuery.removeEventListener("change", handleReducedMotionChange);
      } else {
        legacyReducedMotionQuery.removeListener?.(handleReducedMotionChange);
      }
      scene.querySelectorAll(".pred-lightning-flash").forEach((flash) => flash.remove());
    };
  }, []);

  return (
    <div className="pred-bg-scene" ref={sceneRef} aria-hidden="true">
      <canvas className="pred-lightning-ambient" ref={ambientCanvasRef} />
      <div className="pred-grain" />
      {PREDICTOR_LIGHTNING_DECORATIONS.map((decoration) => (
        <img key={decoration.src} className={decoration.className} src={decoration.src} alt="" />
      ))}
      <canvas className="pred-lightning-text" ref={textCanvasRef} />
      <canvas className="pred-lightning-bolts" ref={boltCanvasRef} />
    </div>
  );
}

function TeamSelector({
  slot,
  teams,
  selectedId,
  excludeId,
  onSelect,
}: {
  slot: "A" | "B";
  teams: ReadonlyArray<TeamOption>;
  selectedId: number | null;
  excludeId: number | null;
  onSelect: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(selectedId === null);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const deferredQuery = useDeferredValue(query);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimeoutRef = useRef<number | null>(null);

  const selected = useMemo(
    () => teams.find((team) => team.id === selectedId) ?? null,
    [selectedId, teams]
  );

  useEffect(() => {
    if (selectedId === null) {
      setEditing(true);
    }
  }, [selectedId]);

  const filtered = useMemo(() => {
    const trimmed = deferredQuery.trim().toLowerCase();
    const allowed = teams.filter((team) => team.id !== excludeId);
    if (!trimmed) return allowed.slice(0, 50);
    return allowed
      .filter(
        (team) =>
          team.name.toLowerCase().includes(trimmed) ||
          conferenceLabel(team.conf).toLowerCase().includes(trimmed)
      )
      .slice(0, 50);
  }, [deferredQuery, excludeId, teams]);

  useEffect(() => {
    if (!open) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex((current) => {
      if (filtered.length === 0) return -1;
      if (current >= 0 && current < filtered.length) return current;
      return 0;
    });
  }, [filtered, open]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const revealSearch = () => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setEditing(true);
    setOpen(true);
    setHighlightedIndex(filtered.length > 0 ? 0 : -1);
    setQuery("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const closeSearch = (keepEditing = selectedId === null) => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setOpen(false);
    setHighlightedIndex(-1);
    setQuery("");
    setEditing(keepEditing);
  };

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (containerRef.current?.contains(event.relatedTarget as Node | null)) return;
    blurTimeoutRef.current = window.setTimeout(() => {
      closeSearch(selectedId === null);
    }, 120);
  };

  const handleFocus = () => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setOpen(true);
  };

  const handleSelect = (id: number) => {
    onSelect(id);
    closeSearch(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch(selectedId === null);
      inputRef.current?.blur();
      return;
    }

    if (filtered.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) => (current < 0 ? 0 : Math.min(current + 1, filtered.length - 1)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) => (current <= 0 ? 0 : current - 1));
      return;
    }

    if (event.key === "Enter" && open && highlightedIndex >= 0 && highlightedIndex < filtered.length) {
      event.preventDefault();
      handleSelect(filtered[highlightedIndex].id);
    }
  };

  return (
    <div
      className={`pred-selector-card pred-team-select ${selected ? "pred-team-select--filled" : ""} ${editing ? "pred-selector-card--editing" : ""}`}
      ref={containerRef}
      onBlur={handleBlur}
    >
      <div className="pred-selector-head">
        <span className="pred-selector-kicker">Team {slot}</span>
        {selected && !editing ? (
          <button className="pred-selector-change" type="button" onClick={revealSearch}>
            Change
          </button>
        ) : null}
      </div>

      {selected && !editing ? (
        <div className="pred-selector-body pred-selector-body--selected">
          <PredictorTeamMark teamName={selected.name} fallbackLabel={slot} size="hero" />
          <div className="pred-selector-selected-copy">
            <h3>{selected.name}</h3>
            <p>{conferenceLabel(selected.conf)}</p>
          </div>
        </div>
      ) : (
        <div className="pred-selector-body">
          {selected ? (
            <PredictorTeamMark teamName={selected.name} fallbackLabel={slot} size="selector" />
          ) : (
            <div className="pred-selector-placeholder-mark pred-team-placeholder" aria-hidden="true">
              {slot}
            </div>
          )}
          <div className="pred-selector-search-wrap">
            <input
              ref={inputRef}
              className="pred-search-input pred-team-search"
              type="text"
              value={query}
              placeholder={slot === "A" ? "Who's your team?" : "Who are they facing?"}
              onFocus={handleFocus}
              onKeyDown={handleKeyDown}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
            />
            {open ? (
              <div className="pred-search-dropdown pred-team-dropdown">
                <div className="pred-search-results">
                  {filtered.length === 0 ? (
                    <div className="pred-search-empty">No teams found.</div>
                  ) : (
                    filtered.map((team, index) => (
                      <button
                        key={team.id}
                        className={`pred-search-option ${team.id === selectedId ? "is-selected" : ""} ${index === highlightedIndex ? "is-highlighted" : ""}`}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        onClick={() => handleSelect(team.id)}
                      >
                        <PredictorTeamMark teamName={team.name} fallbackLabel={team.name[0] ?? slot} size="mini" />
                        <span className="pred-search-option-name">{team.name}</span>
                        <span className="pred-search-option-conf">{conferenceLabel(team.conf)}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

const venueTeamLabel = (team: TeamOption | null, fallback: string): string => (team ? `@ ${team.name}` : fallback);

function VenueToggle({
  loc,
  teamA,
  teamB,
  onChange,
}: {
  loc: VenueCode;
  teamA: TeamOption | null;
  teamB: TeamOption | null;
  onChange: (next: VenueCode) => void;
}) {
  const venues: Array<{ code: VenueCode; label: string }> = [
    { code: "H", label: venueTeamLabel(teamA, "Home") },
    { code: "N", label: "Neutral" },
    { code: "A", label: venueTeamLabel(teamB, "Away") },
  ];

  return (
    <div className="pred-venue-wrap">
      <div className="pred-venue-toggle" role="tablist" aria-label="Venue">
        {venues.map((venue) => (
          <button
            key={venue.code}
            className={`pred-venue-btn ${loc === venue.code ? "is-active" : ""}`}
            type="button"
            onClick={() => onChange(venue.code)}
          >
            {venue.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PredictorResults({ teamA, teamB, probA }: { teamA: TeamOption; teamB: TeamOption; probA: number }) {
  const probB = 1 - probA;
  const pctA = (probA * 100).toFixed(1);
  const pctB = (probB * 100).toFixed(1);
  const oddsA = formatOddsDisplay(probA, "american").primary;
  const oddsB = formatOddsDisplay(probB, "american").primary;
  const favoriteIsA = probA >= probB;

  return (
    <section className="pred-results" aria-live="polite">
      <div className="pred-result-card">
        <div className="pred-prob-row">
          <div className="pred-prob-side pred-prob-side--left">
            <PredictorTeamMark teamName={teamA.name} fallbackLabel="A" size="mini" />
            <span className="pred-prob-pct">{pctA}%</span>
          </div>
          <div className="pred-prob-bar" aria-hidden="true">
            <div className="pred-prob-fill" style={{ width: `${probA * 100}%` }} />
          </div>
          <div className="pred-prob-side pred-prob-side--right">
            <span className="pred-prob-pct">{pctB}%</span>
            <PredictorTeamMark teamName={teamB.name} fallbackLabel="B" size="mini" />
          </div>
        </div>

        <div className="pred-odds-grid">
          <article className={`pred-odds-card ${favoriteIsA ? "is-favorite pred-odds-card--favorite" : ""}`}>
            <div className="pred-odds-card-header">
              <PredictorTeamMark teamName={teamA.name} fallbackLabel="A" size="mini" />
              <p className="pred-odds-label">{teamA.name}</p>
            </div>
            <div className="pred-odds-value">{oddsA}</div>
            <p className="pred-odds-meta">{pctA}% win probability</p>
          </article>

          <article className={`pred-odds-card ${!favoriteIsA ? "is-favorite pred-odds-card--favorite" : ""}`}>
            <div className="pred-odds-card-header">
              <PredictorTeamMark teamName={teamB.name} fallbackLabel="B" size="mini" />
              <p className="pred-odds-label">{teamB.name}</p>
            </div>
            <div className="pred-odds-value">{oddsB}</div>
            <p className="pred-odds-meta">{pctB}% win probability</p>
          </article>
        </div>
      </div>

      <div className="pred-stats-card">
        <div className="pred-section-head">
          <p className="pred-section-kicker">Why the model leans this way</p>
          <h2 className="pred-section-title">13-stat comparison</h2>
        </div>
        <StatComparison nameA={teamA.name} nameB={teamB.name} />
      </div>
    </section>
  );
}

function StatComparison({ nameA, nameB }: { nameA: string; nameB: string }) {
  const statsA = TEAM_STATS_2026[nameA] ?? null;
  const statsB = TEAM_STATS_2026[nameB] ?? null;

  if (!statsA && !statsB) return null;

  let statWinsA = 0;
  let statWinsB = 0;

  const statRows = TEAM_STAT_ORDER.map((key) => {
    const valueA = statsA?.[key] ?? null;
    const valueB = statsB?.[key] ?? null;
    const lowerIsBetter = LOWER_IS_BETTER.has(key);
    const dotCount = TEAM_STAT_DOT_COUNTS[key];

    const betterA =
      valueA !== null &&
      valueB !== null &&
      valueA !== valueB &&
      (lowerIsBetter ? valueA < valueB : valueA > valueB);
    const betterB =
      valueA !== null &&
      valueB !== null &&
      valueA !== valueB &&
      (lowerIsBetter ? valueB < valueA : valueB > valueA);

    if (betterA) statWinsA += 1;
    if (betterB) statWinsB += 1;

    return { key, valueA, valueB, dotCount, betterA, betterB };
  });

  return (
    <div className="pred-stats-table" role="table" aria-label={`${nameA} versus ${nameB} stat comparison`}>
      <div className="pred-stats-head" role="row">
        <div className="pred-stats-team pred-stats-team--left" role="columnheader">
          {nameA}
        </div>
        <div className="pred-stats-label" role="columnheader">
          Stat
        </div>
        <div className="pred-stats-team pred-stats-team--right" role="columnheader">
          {nameB}
        </div>
      </div>

      {statRows.map(({ key, valueA, valueB, dotCount, betterA, betterB }) => {
        return (
          <div
            className={`pred-stat-row ${betterA ? "pred-stat-row--a-better" : ""} ${betterB ? "pred-stat-row--b-better" : ""}`}
            key={key}
            role="row"
          >
            <div className={`pred-stat-value pred-stat-value--left ${betterA ? "is-better" : ""}`} role="cell">
              {formatStatValue(valueA)}
            </div>
            <div className="pred-stat-center" role="cell" title={`${TEAM_STAT_IMPORTANCE[key]} model weight`}>
              <div className="pred-stat-name">{TEAM_STAT_LABELS[key]}</div>
              <div className="pred-stat-dots" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => (
                  <span className={`pred-stat-dot ${index < dotCount ? "is-active" : ""}`} key={index} />
                ))}
              </div>
            </div>
            <div className={`pred-stat-value pred-stat-value--right ${betterB ? "is-better" : ""}`} role="cell">
              {formatStatValue(valueB)}
            </div>
          </div>
        );
      })}

      <div className="pred-stat-summary" role="presentation">
        <span className="pred-stat-summary-count">{statWinsA} stats</span>
        <span className="pred-stat-summary-label">Edge</span>
        <span className="pred-stat-summary-count">{statWinsB} stats</span>
      </div>
    </div>
  );
}

export function MatchupPredictor({ displayMode: _displayMode }: { displayMode: OddsDisplayMode }) {
  const [teams, setTeams] = useState<ReadonlyArray<TeamOption> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamAId, setTeamAId] = useState<number | null>(null);
  const [teamBId, setTeamBId] = useState<number | null>(null);
  const [loc, setLoc] = useState<VenueCode>("N");

  useEffect(() => {
    let cancelled = false;
    loadPredictorData()
      .then(() => {
        if (!cancelled) setTeams(predictorTeamsCache);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("Prediction data not available. Run scripts/generate_matchup_predictor.py first.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const teamA = useMemo(() => teams?.find((team) => team.id === teamAId) ?? null, [teamAId, teams]);
  const teamB = useMemo(() => teams?.find((team) => team.id === teamBId) ?? null, [teamBId, teams]);
  const totalMatchups = useMemo(() => {
    if (!teams) return null;
    return (teams.length * (teams.length - 1)) / 2;
  }, [teams]);

  const probA = useMemo(() => {
    if (!teams || !teamA || !teamB) return null;
    const idxA = getTeamIdxFn?.(teamA.id) ?? -1;
    const idxB = getTeamIdxFn?.(teamB.id) ?? -1;
    if (idxA < 0 || idxB < 0) return null;
    return getMatchupProbFn?.(idxA, idxB, loc) ?? null;
  }, [loc, teamA, teamB, teams]);

  return (
    <section className="predictor-page">
      <PredictorBackground />
      <div className="pred-page pred-content">
        <header className="pred-header">
          <p className="pred-kicker">College Basketball</p>
          <h1 className="pred-title">Matchup Predictor</h1>
          <p className="pred-subtitle">Pick any two D1 teams. See who the model likes and why.</p>
        </header>

        {loadError ? (
          <div className="pred-status pred-status--error">{loadError}</div>
        ) : !teams ? (
          <div className="pred-status">Loading prediction data...</div>
        ) : (
          <>
            <div className="pred-arena">
              <TeamSelector slot="A" teams={teams} selectedId={teamAId} excludeId={teamBId} onSelect={setTeamAId} />
              <div className="pred-vs" aria-hidden="true">
                VS
              </div>
              <TeamSelector slot="B" teams={teams} selectedId={teamBId} excludeId={teamAId} onSelect={setTeamBId} />
            </div>

            {teamA && teamB ? <VenueToggle loc={loc} teamA={teamA} teamB={teamB} onChange={setLoc} /> : null}

            {probA !== null && teamA && teamB ? (
              <PredictorResults teamA={teamA} teamB={teamB} probA={probA} />
            ) : (
              <div className="pred-empty-state">
                <div className="pred-empty-icon" aria-hidden="true">
                  ⚡
                </div>
                {teamAId && teamBId ? (
                  <p className="pred-empty-copy">Computing the line...</p>
                ) : (
                  <>
                    <p className="pred-empty-headline">61,000 matchups. Every one has a number.</p>
                    <p className="pred-empty-sub">Pick two teams and see where the model stands.</p>
                  </>
                )}
              </div>
            )}

            <footer className="pred-footer">
              <p className="pred-footer-text">
                {teams.length > 0 && totalMatchups !== null
                  ? `Probabilities from the Odds Gods model · ${teams.length} D1 teams · ${totalMatchups.toLocaleString()} matchups`
                  : "Probabilities from the Odds Gods model"}
              </p>
              <div className="pred-footer-links">
                <a href="/">Bracket Lab</a>
                <a href="/rankings">Rankings</a>
                <a href="mailto:feedback@oddsgods.net?subject=BracketLab%20Bug%20Report">Report a Bug</a>
              </div>
            </footer>
          </>
        )}
      </div>
    </section>
  );
}
