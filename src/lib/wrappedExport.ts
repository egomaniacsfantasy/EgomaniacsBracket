import type { WrappedData } from "./wrappedData";

// ---------------------------------------------------------------------------
// Canvas dimensions (Instagram Story format)
// ---------------------------------------------------------------------------
const W = 1080;
const H = 1920;
// Scale factor: mockup designed at ~360x640, canvas is 3x
const S = 3;

// ---------------------------------------------------------------------------
// Colors (hardcoded — no CSS variable access in Canvas)
// ---------------------------------------------------------------------------
const COLORS = {
  bgDeep: "#080603",
  text: "#f0e6d0",
  textDim: "rgba(239,228,207,0.7)",
  textSoft: "rgba(240,230,208,0.4)",
  textFaint: "rgba(240,230,208,0.15)",
  amber: "#b87d18",
  amberHot: "#ffc857",
  amberText: "#e7bf72",
  green: "#4ade80",
  red: "#f87171",
  redHot: "#ff4444",
};

// Fonts
const SERIF = '"Instrument Serif", serif';
const SANS = '"Space Grotesk", sans-serif';

// ---------------------------------------------------------------------------
// Logo preloading
// ---------------------------------------------------------------------------

interface PreloadedLogos {
  champion: HTMLImageElement;
  finalFour: HTMLImageElement[];
  boldestWinner: HTMLImageElement;
  boldestLoser: HTMLImageElement;
  weakestPicked: HTMLImageElement;
  weakestOpponent: HTMLImageElement;
  rippleCasualty: HTMLImageElement;
}

/**
 * Convert an ESPN CDN URL to a local /logos/ path to avoid CORS issues on canvas export.
 * ESPN URLs look like: https://a.espncdn.com/i/teamlogos/ncaa/500/{id}.png
 * Local paths:         /logos/{id}.png
 */
function toLocalLogoUrl(url: string): string {
  const espnMatch = url.match(/espncdn\.com\/i\/teamlogos\/ncaa\/\d+\/(\d+)\.png/);
  if (espnMatch) {
    return `/logos/${espnMatch[1]}.png`;
  }
  return url;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const localUrl = toLocalLogoUrl(url);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => {
      // If local path fails, try original URL
      if (localUrl !== url) {
        const img2 = new Image();
        img2.crossOrigin = "anonymous";
        img2.onload = () => resolve(img2);
        img2.onerror = () => resolve(createFallbackImage());
        img2.src = url;
      } else {
        resolve(createFallbackImage());
      }
    };
    img.src = localUrl;
  });
}

function createFallbackImage(): HTMLImageElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1a1408";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = COLORS.amber;
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", 32, 32);
  const img = new Image();
  img.src = canvas.toDataURL();
  return img;
}

async function preloadLogos(data: WrappedData): Promise<PreloadedLogos> {
  const [champion, ...rest] = await Promise.all([
    loadImage(data.champion.teamLogoUrl),
    ...data.finalFour.map((t) => loadImage(t.teamLogoUrl)),
    loadImage(data.boldestPick.winnerLogoUrl),
    loadImage(data.boldestPick.loserLogoUrl),
    loadImage(data.weakestLink.pickedTeamLogoUrl),
    loadImage(data.weakestLink.opponentTeamLogoUrl),
    loadImage(data.rippleEffect.biggestCasualty.teamLogoUrl),
  ]);

  return {
    champion,
    finalFour: rest.slice(0, 4) as HTMLImageElement[],
    boldestWinner: rest[4],
    boldestLoser: rest[5],
    weakestPicked: rest[6],
    weakestOpponent: rest[7],
    rippleCasualty: rest[8],
  };
}

// ---------------------------------------------------------------------------
// Font loading guarantee
// ---------------------------------------------------------------------------

async function ensureFontsLoaded(): Promise<void> {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }
  try {
    await document.fonts.load('400 48px "Instrument Serif"');
    await document.fonts.load('700 48px "Space Grotesk"');
  } catch {
    // Fonts may already be loaded
  }
}

// ---------------------------------------------------------------------------
// Text wrapping helper
// ---------------------------------------------------------------------------

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): void {
  const words = text.split(" ");
  let line = "";
  let currentY = y;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, currentY);
  }
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

export async function exportWrappedCard(data: WrappedData): Promise<void> {
  await ensureFontsLoaded();

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const logos = await preloadLogos(data);

  renderCard(ctx, data, logos);

  canvas.toBlob(
    async (blob) => {
      if (!blob) return;

      // Try native share (mobile)
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], "bracket-wrapped.png", { type: "image/png" });
        const shareData = { files: [file] };
        if (navigator.canShare(shareData)) {
          try {
            await navigator.share(shareData);
            return;
          } catch {
            // User cancelled or share failed — fall through to download
          }
        }
      }

      // Fallback: download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bracket-wrapped.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    "image/png",
    1.0
  );
}

// ---------------------------------------------------------------------------
// Canvas rendering
// ---------------------------------------------------------------------------

function renderCard(
  ctx: CanvasRenderingContext2D,
  data: WrappedData,
  logos: PreloadedLogos
): void {
  const s = (v: number) => v * S;

  const setFont = (size: number, weight: number | string, family: string, style = "") => {
    ctx.font = `${style} ${weight} ${s(size)}px ${family}`.trim();
  };

  const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
    const sx = s(x),
      sy = s(y),
      sw = s(w),
      sh = s(h),
      sr = s(r);
    ctx.beginPath();
    ctx.moveTo(sx + sr, sy);
    ctx.lineTo(sx + sw - sr, sy);
    ctx.quadraticCurveTo(sx + sw, sy, sx + sw, sy + sr);
    ctx.lineTo(sx + sw, sy + sh - sr);
    ctx.quadraticCurveTo(sx + sw, sy + sh, sx + sw - sr, sy + sh);
    ctx.lineTo(sx + sr, sy + sh);
    ctx.quadraticCurveTo(sx, sy + sh, sx, sy + sh - sr);
    ctx.lineTo(sx, sy + sr);
    ctx.quadraticCurveTo(sx, sy, sx + sr, sy);
    ctx.closePath();
  };

  const drawLogoWithShadow = (
    img: HTMLImageElement,
    x: number,
    y: number,
    size: number,
    shadowColor = "rgba(0,0,0,0.5)",
    shadowBlur = 12
  ) => {
    ctx.save();
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = s(shadowBlur);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = s(3);
    ctx.drawImage(img, s(x), s(y), s(size), s(size));
    ctx.restore();
  };

  const drawGhostLogo = (
    img: HTMLImageElement,
    x: number,
    y: number,
    size: number,
    opacity: number,
    rotation: number
  ) => {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(s(x + size / 2), s(y + size / 2));
    ctx.rotate((rotation * Math.PI) / 180);
    try {
      ctx.filter = "grayscale(0.5)";
    } catch {
      // ctx.filter not supported in some contexts
    }
    ctx.drawImage(img, s(-size / 2), s(-size / 2), s(size), s(size));
    ctx.filter = "none";
    ctx.restore();
  };

  const drawRadialGradient = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    r: number,
    g: number,
    b: number,
    alpha: number
  ) => {
    ctx.save();
    ctx.translate(s(cx), s(cy));
    ctx.scale(1, ry / rx);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, s(rx));
    grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(s(-rx * 1.5), s(-ry * 1.5), s(rx * 3), s(ry * 3));
    ctx.restore();
  };

  // ==========================================
  // STEP 1: BACKGROUND
  // ==========================================
  ctx.fillStyle = COLORS.bgDeep;
  ctx.fillRect(0, 0, W, H);

  // Radial gradients
  drawRadialGradient(180, 115, 234, 112, 184, 125, 24, 0.16);
  drawRadialGradient(306, 544, 108, 64, 255, 200, 87, 0.05);
  drawRadialGradient(36, 320, 90, 48, 248, 113, 113, 0.03);

  // ==========================================
  // STEP 2: GHOST LOGOS
  // ==========================================
  drawGhostLogo(logos.champion, 300 - 60, -65, 240, 0.055, 12);
  drawGhostLogo(logos.finalFour[1] || logos.champion, -45, 605 - 35, 180, 0.05, -14);
  drawGhostLogo(logos.finalFour[2] || logos.champion, -15, 180, 130, 0.035, 22);
  drawGhostLogo(logos.finalFour[3] || logos.champion, 350 - 10, 480 - 160, 110, 0.04, -8);
  drawGhostLogo(logos.boldestWinner, 30, 80, 90, 0.025, 30);
  drawGhostLogo(logos.boldestLoser, 40, 340, 70, 0.02, -18);

  // ==========================================
  // STEP 3: CONTENT
  // ==========================================

  let Y = 50;
  const LX = 14;
  const CW = 360 - 28;

  // --- TOP BAR ---
  setFont(8, 700, SANS);
  ctx.fillStyle = COLORS.textSoft;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText("BRACKET ", s(LX), s(Y));
  const bracketWidth = ctx.measureText("BRACKET ").width;
  ctx.fillStyle = COLORS.amberText;
  ctx.fillText("WRAPPED", s(LX) + bracketWidth, s(Y));

  // Progress dots
  const dotY = Y + 2;
  for (let i = 0; i < 5; i++) {
    const dx = 360 - 14 - (4 - i) * 9;
    ctx.beginPath();
    ctx.arc(s(dx), s(dotY + 2.5), s(2.5), 0, Math.PI * 2);
    ctx.fillStyle = i === 4 ? COLORS.amber : "rgba(240,230,208,0.12)";
    ctx.fill();
    if (i === 4) {
      ctx.save();
      ctx.shadowColor = "rgba(184,125,24,0.6)";
      ctx.shadowBlur = s(6);
      ctx.beginPath();
      ctx.arc(s(dx), s(dotY + 2.5), s(2.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  Y += 20;

  // --- CHAMPION ROW ---
  ctx.save();
  ctx.shadowColor = "rgba(184,125,24,0.45)";
  ctx.shadowBlur = s(28);
  ctx.drawImage(logos.champion, s(LX), s(Y), s(74), s(74));
  ctx.restore();

  const champTextX = LX + 74 + 12;

  setFont(7, 800, SANS);
  ctx.fillStyle = COLORS.amber;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("YOUR CHAMPION", s(champTextX), s(Y + 4));

  setFont(30, 400, SERIF);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(data.champion.teamName, s(champTextX), s(Y + 18));

  setFont(11, 700, SANS);
  ctx.fillStyle = COLORS.amberText;
  ctx.fillText(`${data.champion.champOdds} to cut the nets`, s(champTextX), s(Y + 52));

  Y += 82;

  // --- CHAOS STRIP ---
  ctx.strokeStyle = "rgba(184,125,24,0.08)";
  ctx.lineWidth = s(1);
  ctx.beginPath();
  ctx.moveTo(s(LX), s(Y));
  ctx.lineTo(s(360 - LX), s(Y));
  ctx.stroke();

  Y += 6;

  setFont(16, 400, SANS);
  ctx.fillStyle = COLORS.text;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(data.identity.chaosEmoji, s(LX), s(Y + 10));

  setFont(9, 800, SANS);
  ctx.fillStyle = COLORS.amberText;
  ctx.fillText(data.identity.chaosLabel, s(LX + 22), s(Y + 10));

  const barLeft = LX + 95;
  const barRight = 360 - LX - 35;
  const barWidth = barRight - barLeft;
  const barY = Y + 5;

  setFont(6, 800, SANS);
  ctx.fillStyle = COLORS.textFaint;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("CHALK", s(barLeft), s(barY));
  ctx.textAlign = "right";
  ctx.fillText("CHAOS", s(barRight), s(barY));

  const barTrackY = barY + 10;
  roundRect(barLeft, barTrackY, barWidth, 5, 3);
  ctx.fillStyle = "rgba(240,230,208,0.06)";
  ctx.fill();

  const pct = Math.max(2, Math.min(98, data.identity.chaosPercentile));
  const fillWidth = barWidth * (pct / 100);
  roundRect(barLeft, barTrackY, fillWidth, 5, 3);
  const barGrad = ctx.createLinearGradient(s(barLeft), 0, s(barLeft + fillWidth), 0);
  barGrad.addColorStop(0, COLORS.amber);
  barGrad.addColorStop(1, COLORS.amberHot);
  ctx.fillStyle = barGrad;
  ctx.fill();

  const markerX = barLeft + fillWidth;
  ctx.beginPath();
  ctx.arc(s(markerX), s(barTrackY + 2.5), s(5.5), 0, Math.PI * 2);
  ctx.fillStyle = COLORS.amberHot;
  ctx.fill();
  ctx.lineWidth = s(2);
  ctx.strokeStyle = COLORS.bgDeep;
  ctx.stroke();

  setFont(9, 800, SANS);
  ctx.fillStyle = COLORS.amberHot;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(`${Math.round(data.identity.chaosPercentile)}th`, s(360 - LX), s(Y + 10));

  Y += 24;

  ctx.strokeStyle = "rgba(184,125,24,0.08)";
  ctx.lineWidth = s(1);
  ctx.beginPath();
  ctx.moveTo(s(LX), s(Y));
  ctx.lineTo(s(360 - LX), s(Y));
  ctx.stroke();

  Y += 8;

  // --- FINAL FOUR STRIP ---
  setFont(7, 800, SANS);
  ctx.fillStyle = COLORS.textFaint;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("F4", s(LX), s(Y + 10));

  let f4X = LX + 22;
  for (let i = 0; i < 4; i++) {
    const team = data.finalFour[i];
    const logo = logos.finalFour[i];
    if (!team || !logo) continue;

    roundRect(f4X, Y + 2, 60, 18, 4);
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    ctx.fill();
    ctx.strokeStyle = "rgba(240,230,208,0.05)";
    ctx.lineWidth = s(1);
    ctx.stroke();

    ctx.drawImage(logo, s(f4X + 3), s(Y + 3), s(16), s(16));

    setFont(7, 700, SANS);
    ctx.fillStyle = COLORS.textDim;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(team.teamAbbrev, s(f4X + 22), s(Y + 11));

    f4X += 64;
  }

  Y += 28;

  // --- BRACKET LINE ---
  drawRadialGradient(180, Y + 20, 180, 30, 184, 125, 24, 0.06);

  setFont(7, 800, SANS);
  ctx.fillStyle = COLORS.textSoft;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("YOUR PERFECT BRACKET LINE", s(180), s(Y));

  setFont(42, 400, SERIF);
  ctx.fillStyle = COLORS.amberHot;
  ctx.save();
  ctx.shadowColor = "rgba(255,200,87,0.2)";
  ctx.shadowBlur = s(60);
  ctx.fillText(data.perfectBracketLine, s(180), s(Y + 12));
  ctx.restore();

  setFont(8, 400, SERIF, "italic");
  ctx.fillStyle = COLORS.textSoft;
  ctx.textAlign = "center";
  ctx.fillText("good luck with that", s(180), s(Y + 56));

  Y += 72;

  // --- THREE HIGHLIGHT ROWS ---
  const hlH = 38;

  // BOLDEST (red left border)
  roundRect(LX + 3, Y, CW - 3, hlH, 6);
  ctx.fillStyle = "rgba(248,113,113,0.04)";
  ctx.fill();

  ctx.fillStyle = COLORS.red;
  roundRect(LX, Y, 3, hlH, 0);
  ctx.fill();

  drawLogoWithShadow(logos.boldestWinner, LX + 8, Y + 6, 26, "rgba(0,0,0,0.5)", 4);
  ctx.save();
  ctx.globalAlpha = 0.3;
  try {
    ctx.filter = "grayscale(0.8)";
  } catch {
    // filter not supported
  }
  ctx.drawImage(logos.boldestLoser, s(LX + 26), s(Y + 6), s(26), s(26));
  ctx.filter = "none";
  ctx.restore();

  const hlTextX = LX + 58;
  setFont(6, 800, SANS);
  ctx.fillStyle = COLORS.red;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("BOLDEST PICK", s(hlTextX), s(Y + 5));

  setFont(10, 700, SANS);
  ctx.fillStyle = COLORS.text;
  const boldestMainText = `#${data.boldestPick.winnerSeed} ${data.boldestPick.winnerName} over #${data.boldestPick.loserSeed} ${data.boldestPick.loserName}`;
  ctx.fillText(boldestMainText, s(hlTextX), s(Y + 14));

  setFont(7, 400, SANS);
  ctx.fillStyle = COLORS.textSoft;
  ctx.fillText(
    `${data.boldestPick.round} · ${data.boldestPick.region || ""} · ${data.boldestPick.simBracketFraction} brackets`,
    s(hlTextX),
    s(Y + 27)
  );

  setFont(24, 400, SERIF);
  ctx.fillStyle = COLORS.redHot;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `${(data.boldestPick.winProbability * 100).toFixed(1)}%`,
    s(360 - LX - 6),
    s(Y + hlH / 2)
  );

  Y += hlH + 4;

  // RIPPLE (green border)
  roundRect(LX, Y, CW, hlH, 6);
  ctx.fillStyle = "rgba(74,222,128,0.03)";
  ctx.fill();
  ctx.strokeStyle = "rgba(74,222,128,0.08)";
  ctx.lineWidth = s(1);
  ctx.stroke();

  setFont(18, 400, SANS);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("\uD83C\uDF0A", s(LX + 18), s(Y + hlH / 2));

  const rlTextX = LX + 38;
  setFont(6, 800, SANS);
  ctx.fillStyle = COLORS.green;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("RIPPLE EFFECT", s(rlTextX), s(Y + 5));

  setFont(10, 700, SANS);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(
    `${data.rippleEffect.biggestCasualty.teamName}'s title: ${data.rippleEffect.biggestCasualty.baselineChampOdds} \u2192 ${data.rippleEffect.biggestCasualty.currentChampOdds}`,
    s(rlTextX),
    s(Y + 14)
  );

  setFont(7, 400, SANS);
  ctx.fillStyle = COLORS.textSoft;
  ctx.fillText(data.rippleEffect.causedByPick.description, s(rlTextX), s(Y + 27));

  setFont(22, 400, SERIF);
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText(String(data.rippleEffect.totalGamesAffected), s(360 - LX - 6), s(Y + 4));
  setFont(6, 700, SANS);
  ctx.fillStyle = COLORS.textSoft;
  ctx.fillText("ODDS SHIFTED", s(360 - LX - 6), s(Y + 26));

  Y += hlH + 4;

  // WEAKEST (dashed border)
  roundRect(LX, Y, CW, hlH, 6);
  ctx.fillStyle = "rgba(255,255,255,0.01)";
  ctx.fill();
  ctx.setLineDash([s(4), s(3)]);
  ctx.strokeStyle = "rgba(248,113,113,0.2)";
  ctx.lineWidth = s(1);
  ctx.stroke();
  ctx.setLineDash([]);

  drawLogoWithShadow(logos.weakestPicked, LX + 8, Y + 6, 26, "rgba(0,0,0,0.5)", 4);
  ctx.save();
  ctx.globalAlpha = 0.3;
  try {
    ctx.filter = "grayscale(0.8)";
  } catch {
    // filter not supported
  }
  ctx.drawImage(logos.weakestOpponent, s(LX + 26), s(Y + 6), s(26), s(26));
  ctx.filter = "none";
  ctx.restore();

  setFont(6, 800, SANS);
  ctx.fillStyle = COLORS.amber;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("\u26A0 WEAKEST LINK", s(hlTextX), s(Y + 5));

  setFont(10, 700, SANS);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(
    `#${data.weakestLink.pickedTeamSeed} ${data.weakestLink.pickedTeamName} over #${data.weakestLink.opponentTeamSeed} ${data.weakestLink.opponentTeamName}`,
    s(hlTextX),
    s(Y + 14)
  );

  setFont(7, 400, SANS);
  ctx.fillStyle = COLORS.textSoft;
  ctx.fillText(
    `${data.weakestLink.round} · ${data.weakestLink.region || ""} · flip this one pick`,
    s(hlTextX),
    s(Y + 27)
  );

  setFont(20, 400, SERIF);
  ctx.fillStyle = COLORS.green;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `${data.weakestLink.improvementMultiplier.toFixed(1)}x`,
    s(360 - LX - 6),
    s(Y + hlH / 2)
  );

  Y += hlH + 8;

  // --- ROAST BOX ---
  const roastH = 58;
  roundRect(LX, Y, CW, roastH, 8);
  const roastGrad = ctx.createLinearGradient(s(LX), s(Y), s(360 - LX), s(Y + roastH));
  roastGrad.addColorStop(0, "rgba(184,125,24,0.06)");
  roastGrad.addColorStop(1, "rgba(184,125,24,0.02)");
  ctx.fillStyle = roastGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(184,125,24,0.1)";
  ctx.lineWidth = s(1);
  ctx.stroke();

  setFont(32, 400, SERIF);
  ctx.fillStyle = "rgba(184,125,24,0.2)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("\u201C", s(LX + 6), s(Y + 2));

  setFont(11, 400, SERIF, "italic");
  ctx.fillStyle = COLORS.textDim;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  wrapText(ctx, data.roastText, s(LX + 20), s(Y + 8), s(CW - 30), s(11 * 1.35));

  Y += roastH + 8;

  // --- FOOTER ---
  setFont(14, 700, SANS);
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("bracket.oddsgods.net", s(180), s(Y));

  setFont(11, 700, SANS);
  ctx.fillStyle = COLORS.amberText;
  ctx.fillText("\uD83D\uDCB0 Best bracket wins $100 \uD83D\uDCB0", s(180), s(Y + 20));
}
