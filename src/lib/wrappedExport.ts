import type { WrappedData } from "./wrappedData";
import { ordinal } from "./wrappedData";

// ---------------------------------------------------------------------------
// Canvas dimensions
// ---------------------------------------------------------------------------
const W = 1080;
// Scale factor: mockup designed at ~360x640, canvas is 3x
const S = 3;
// Vertical padding (mockup units) above and below content
const V_PAD = 30;

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

function getWrappedLineCount(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): number {
  const words = text.split(" ");
  let line = "";
  let count = 1;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      count++;
      line = word;
    } else {
      line = test;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

export async function exportWrappedCard(data: WrappedData): Promise<void> {
  await ensureFontsLoaded();

  const canvas = document.createElement("canvas");
  canvas.width = W;
  // Temporary height — renderCard will calculate the real height
  canvas.height = 1920;
  const ctx = canvas.getContext("2d")!;

  const logos = await preloadLogos(data);

  const contentHeight = renderCard(ctx, data, logos);

  // Trim canvas to actual content height
  const trimmedCanvas = document.createElement("canvas");
  trimmedCanvas.width = W;
  trimmedCanvas.height = contentHeight;
  const trimCtx = trimmedCanvas.getContext("2d")!;
  trimCtx.drawImage(canvas, 0, 0);

  return new Promise<void>((resolve, reject) => {
    trimmedCanvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error("Failed to create blob"));
          return;
        }

        const file = new File([blob], "bracket-wrapped.png", { type: "image/png" });

        // Try native share first (works on iOS, Android, macOS Safari, Chrome)
        if (navigator.share) {
          try {
            await navigator.share({
              files: [file],
              title: "My Bracket Wrapped",
              text: "Check out my March Madness bracket on bracket.oddsgods.net",
            });
            resolve();
            return;
          } catch (e) {
            if ((e as Error).name === "AbortError") {
              resolve();
              return;
            }
            // Share not supported for files — fall through
          }
        }

        // Fallback: try clipboard
        if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": blob }),
            ]);
            resolve();
            return;
          } catch {
            // Fall through to download
          }
        }

        // Final fallback: download
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "bracket-wrapped.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        resolve();
      },
      "image/png",
      1.0
    );
  });
}

// ---------------------------------------------------------------------------
// Canvas rendering
// ---------------------------------------------------------------------------

/** Renders the card and returns the total canvas height in pixels needed. */
function renderCard(
  ctx: CanvasRenderingContext2D,
  data: WrappedData,
  logos: PreloadedLogos
): number {
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

  const LX = 14;
  const CW = 360 - 28;

  // ==========================================
  // Pre-calculate dynamic heights for vertical centering
  // ==========================================

  // Roast box: measure wrapped text height
  setFont(11, 400, SERIF, "italic");
  const roastLineHeight = s(11 * 1.35);
  const roastMaxWidth = s(CW - 30);
  const roastLines = getWrappedLineCount(ctx, data.roastText, roastMaxWidth);
  const roastTextHeight = roastLines * (11 * 1.35);
  const roastPadding = 18; // 9px top + 9px bottom
  const roastH = roastTextHeight + roastPadding;

  // Bracket line: check if text needs smaller font
  const bracketLineText = data.perfectBracketLine;
  let blFontSize = 36; // Match CSS .bw-card-bracket-line-number font-size
  setFont(blFontSize, 400, SERIF);
  const blMaxWidth = s(CW - 20);
  while (ctx.measureText(bracketLineText).width > blMaxWidth && blFontSize > 18) {
    blFontSize -= 2;
    setFont(blFontSize, 400, SERIF);
  }

  // Sum all content heights (mockup units)
  const topBarH = 12;
  const gap1 = 10; // topbar -> champ
  const champH = 78;
  const gap2 = 6; // champ -> chaos top border
  const chaosH = 24;
  const gap3 = 8; // chaos bottom border -> f4
  const f4H = 22;
  const gap4 = 10; // f4 -> bracket line
  const blLabelH = 10;
  const blNumberH = blFontSize * 1.1;
  const blSubGap = 6;
  const blSubH = 10;
  const blTotalH = blLabelH + blNumberH + blSubGap + blSubH;
  const gap5 = 12; // bracket line -> highlights
  const hlH = 40; // slightly taller to match CSS padding: 6px 8px
  const hlGap = 5; // match CSS .bw-card-hl margin-bottom: 5px
  const highlightsH = hlH * 3 + hlGap * 2;
  const gap6 = 10; // highlights -> roast
  const gap7 = 8; // roast -> footer
  const footerH = 32;

  const totalH = topBarH + gap1 + champH + gap2 + chaosH + gap3 + f4H + gap4
    + blTotalH + gap5 + highlightsH + gap6 + roastH + gap7 + footerH;

  const startY = V_PAD;

  // ==========================================
  // STEP 1: BACKGROUND
  // ==========================================
  ctx.fillStyle = COLORS.bgDeep;
  ctx.fillRect(0, 0, W, 1920);

  // Radial gradients
  drawRadialGradient(180, 115, 234, 112, 184, 125, 24, 0.16);
  drawRadialGradient(306, 544, 108, 64, 255, 200, 87, 0.05);
  drawRadialGradient(36, 320, 90, 48, 248, 113, 113, 0.03);

  // ==========================================
  // STEP 2: GHOST LOGOS (max 0.035 opacity, none below Y=490)
  // ==========================================
  drawGhostLogo(logos.champion, 240, -65, 240, 0.035, 12);
  drawGhostLogo(logos.finalFour[1] || logos.champion, -45, 380, 180, 0.03, -14);
  drawGhostLogo(logos.finalFour[2] || logos.champion, -15, 180, 130, 0.025, 22);
  drawGhostLogo(logos.finalFour[3] || logos.champion, 300, 280, 110, 0.03, -8);
  drawGhostLogo(logos.boldestWinner, 30, 80, 90, 0.02, 30);
  drawGhostLogo(logos.boldestLoser, 40, 340, 70, 0.015, -18);

  // ==========================================
  // STEP 3: CONTENT
  // ==========================================

  let Y = startY;

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
  Y += topBarH + gap1;

  // --- CHAMPION ROW ---
  // CSS: .bw-card-champ-logo 74x74, gap 12px, label 7px/800, name 30px/400 serif, odds 11px/700
  ctx.save();
  ctx.shadowColor = "rgba(184,125,24,0.45)";
  ctx.shadowBlur = s(28);
  ctx.drawImage(logos.champion, s(LX), s(Y), s(74), s(74));
  ctx.restore();

  const champTextX = LX + 74 + 12;

  // CSS: .bw-card-champ-label — 7px, weight 800, letter-spacing 0.22em, color #b87d18
  setFont(7, 800, SANS);
  ctx.fillStyle = COLORS.amber;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("YOUR CHAMPION", s(champTextX), s(Y + 4));

  // CSS: .bw-card-champ-name — 30px Instrument Serif, color #f0e6d0
  setFont(30, 400, SERIF);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(data.champion.teamName, s(champTextX), s(Y + 18));

  // CSS: .bw-card-champ-odds — 11px/700 Space Grotesk, color #e7bf72
  setFont(11, 700, SANS);
  ctx.fillStyle = COLORS.amberText;
  ctx.fillText(`${data.champion.champOdds} to cut the nets`, s(champTextX), s(Y + 52));

  Y += champH + gap2;

  // --- CHAOS STRIP ---
  // CSS: border-top: 1px solid rgba(184,125,24,0.08); padding: 6px 0
  ctx.strokeStyle = "rgba(184,125,24,0.08)";
  ctx.lineWidth = s(1);
  ctx.beginPath();
  ctx.moveTo(s(LX), s(Y));
  ctx.lineTo(s(360 - LX), s(Y));
  ctx.stroke();

  Y += 6;

  // CSS: .bw-card-chaos-emoji 16px, .bw-card-chaos-label 9px/800 #e7bf72
  setFont(16, 400, SANS);
  ctx.fillStyle = COLORS.text;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(data.identity.chaosEmoji, s(LX), s(Y + 10));

  setFont(9, 800, SANS);
  ctx.fillStyle = COLORS.amberText;
  ctx.fillText(data.identity.chaosLabel, s(LX + 22), s(Y + 10));

  // Bar labels + track
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

  // CSS: .bw-card-chaos-pct — 9px/800, color #ffc857
  setFont(9, 800, SANS);
  ctx.fillStyle = COLORS.amberHot;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(ordinal(Math.round(data.identity.chaosPercentile)), s(360 - LX), s(Y + 10));

  Y += chaosH - 6; // back to after the 6px we added

  // Bottom border of chaos strip
  ctx.strokeStyle = "rgba(184,125,24,0.08)";
  ctx.lineWidth = s(1);
  ctx.beginPath();
  ctx.moveTo(s(LX), s(Y));
  ctx.lineTo(s(360 - LX), s(Y));
  ctx.stroke();

  Y += gap3;

  // --- FINAL FOUR STRIP ---
  // CSS: .bw-card-f4-label 7px/800, .bw-card-f4-pill compact with 2px 5px padding
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

    // Measure text width for compact pill sizing (CSS: padding 2px 5px, gap 3px)
    setFont(7, 700, SANS);
    const abbrevWidth = ctx.measureText(team.teamAbbrev).width / S;
    const pillW = 3 + 16 + 3 + abbrevWidth + 5; // paddingL + logo + gap + text + paddingR

    roundRect(f4X, Y + 2, pillW, 18, 4);
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

    f4X += pillW + 3; // 3px gap between pills (CSS gap: 3px)
  }

  Y += f4H + gap4;

  // --- BRACKET LINE ---
  // CSS: .bw-card-bracket-line padding: 8px 0, radial bg
  drawRadialGradient(180, Y + blTotalH / 2, 180, 30, 184, 125, 24, 0.06);

  // Label: CSS .bw-card-bracket-line-label 7px/800 Space Grotesk, letter-spacing 0.25em
  setFont(7, 800, SANS);
  ctx.fillStyle = COLORS.textSoft;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("YOUR PERFECT BRACKET LINE", s(180), s(Y));

  // Number: CSS .bw-card-bracket-line-number — dynamically sized
  setFont(blFontSize, 400, SERIF);
  ctx.fillStyle = COLORS.amberHot;
  ctx.save();
  ctx.shadowColor = "rgba(255,200,87,0.2)";
  ctx.shadowBlur = s(60);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(bracketLineText, s(180), s(Y + blLabelH));
  ctx.restore();

  // Subtitle: ensure it doesn't overlap the number
  const numberBottomY = Y + blLabelH + blNumberH;
  const subY = Math.max(Y + blLabelH + blNumberH, numberBottomY) + blSubGap;

  setFont(8, 400, SERIF, "italic");
  ctx.fillStyle = COLORS.textSoft;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("good luck with that", s(180), s(subY));

  Y += blTotalH + gap5;

  // --- THREE HIGHLIGHT ROWS ---
  // CSS: .bw-card-hl padding: 6px 8px, border-radius: 6px

  // BOLDEST (red left border)
  // CSS: .bw-card-hl--boldest border-left: 3px solid #f87171, bg rgba(248,113,113,0.04)
  roundRect(LX + 3, Y, CW - 3, hlH, 6);
  ctx.fillStyle = "rgba(248,113,113,0.04)";
  ctx.fill();

  ctx.fillStyle = COLORS.red;
  roundRect(LX, Y, 3, hlH, 0);
  ctx.fill();

  // CSS: logos 26x26
  drawLogoWithShadow(logos.boldestWinner, LX + 8, Y + 7, 26, "rgba(0,0,0,0.5)", 4);
  ctx.save();
  ctx.globalAlpha = 0.3;
  try {
    ctx.filter = "grayscale(0.8)";
  } catch {
    // filter not supported
  }
  ctx.drawImage(logos.boldestLoser, s(LX + 26), s(Y + 7), s(26), s(26));
  ctx.filter = "none";
  ctx.restore();

  const hlTextX = LX + 58;

  // CSS: .bw-card-hl-tag 6px/800, .bw-card-hl-tag--red color #f87171
  setFont(6, 800, SANS);
  ctx.fillStyle = COLORS.red;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("BOLDEST PICK", s(hlTextX), s(Y + 6));

  // CSS: .bw-card-hl-matchup 10px/700
  setFont(10, 700, SANS);
  ctx.fillStyle = COLORS.text;
  const boldestMainText = `#${data.boldestPick.winnerSeed} ${data.boldestPick.winnerName} over #${data.boldestPick.loserSeed} ${data.boldestPick.loserName}`;
  ctx.fillText(boldestMainText, s(hlTextX), s(Y + 15));

  // CSS: .bw-card-hl-detail 7px/400
  setFont(7, 400, SANS);
  ctx.fillStyle = COLORS.textSoft;
  ctx.fillText(
    `${data.boldestPick.round} · ${data.boldestPick.region || ""} · ${data.boldestPick.simBracketFraction} brackets`,
    s(hlTextX),
    s(Y + 28)
  );

  // CSS: .bw-card-hl-number--red 24px Instrument Serif, color #ff4444
  setFont(24, 400, SERIF);
  ctx.fillStyle = COLORS.redHot;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `${(data.boldestPick.winProbability * 100).toFixed(1)}%`,
    s(360 - LX - 6),
    s(Y + hlH / 2)
  );

  Y += hlH + hlGap;

  // RIPPLE (green border)
  // CSS: .bw-card-hl--ripple border: 1px solid rgba(74,222,128,0.08), bg rgba(74,222,128,0.03)
  roundRect(LX, Y, CW, hlH, 6);
  ctx.fillStyle = "rgba(74,222,128,0.03)";
  ctx.fill();
  ctx.strokeStyle = "rgba(74,222,128,0.08)";
  ctx.lineWidth = s(1);
  ctx.stroke();

  // CSS: .bw-card-hl-emoji 18px
  setFont(18, 400, SANS);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("\uD83C\uDF0A", s(LX + 18), s(Y + hlH / 2));

  const rlTextX = LX + 38;
  // CSS: .bw-card-hl-tag--green color #4ade80
  setFont(6, 800, SANS);
  ctx.fillStyle = COLORS.green;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("RIPPLE EFFECT", s(rlTextX), s(Y + 6));

  setFont(10, 700, SANS);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(
    `${data.rippleEffect.biggestCasualty.teamName}'s title: ${data.rippleEffect.biggestCasualty.baselineChampOdds} \u2192 ${data.rippleEffect.biggestCasualty.currentChampOdds}`,
    s(rlTextX),
    s(Y + 15)
  );

  setFont(7, 400, SANS);
  ctx.fillStyle = COLORS.textSoft;
  ctx.fillText(data.rippleEffect.causedByPick.description, s(rlTextX), s(Y + 28));

  // CSS: .bw-card-hl-number--text 22px, color #f0e6d0
  setFont(22, 400, SERIF);
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText(String(data.rippleEffect.totalGamesAffected), s(360 - LX - 6), s(Y + 5));
  // CSS: .bw-card-hl-number-sub 6px/700
  setFont(6, 700, SANS);
  ctx.fillStyle = COLORS.textSoft;
  ctx.fillText("ODDS SHIFTED", s(360 - LX - 6), s(Y + 27));

  Y += hlH + hlGap;

  // WEAKEST (dashed border)
  // CSS: .bw-card-hl--weakest border: 1px dashed rgba(248,113,113,0.2)
  roundRect(LX, Y, CW, hlH, 6);
  ctx.fillStyle = "rgba(255,255,255,0.01)";
  ctx.fill();
  ctx.setLineDash([s(4), s(3)]);
  ctx.strokeStyle = "rgba(248,113,113,0.2)";
  ctx.lineWidth = s(1);
  ctx.stroke();
  ctx.setLineDash([]);

  drawLogoWithShadow(logos.weakestPicked, LX + 8, Y + 7, 26, "rgba(0,0,0,0.5)", 4);
  ctx.save();
  ctx.globalAlpha = 0.3;
  try {
    ctx.filter = "grayscale(0.8)";
  } catch {
    // filter not supported
  }
  ctx.drawImage(logos.weakestOpponent, s(LX + 26), s(Y + 7), s(26), s(26));
  ctx.filter = "none";
  ctx.restore();

  // CSS: .bw-card-hl-tag--amber color #b87d18
  setFont(6, 800, SANS);
  ctx.fillStyle = COLORS.amber;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("\u26A0 WEAKEST LINK", s(hlTextX), s(Y + 6));

  setFont(10, 700, SANS);
  ctx.fillStyle = COLORS.text;
  ctx.fillText(
    `#${data.weakestLink.pickedTeamSeed} ${data.weakestLink.pickedTeamName} over #${data.weakestLink.opponentTeamSeed} ${data.weakestLink.opponentTeamName}`,
    s(hlTextX),
    s(Y + 15)
  );

  setFont(7, 400, SANS);
  ctx.fillStyle = COLORS.textSoft;
  ctx.fillText(
    `${data.weakestLink.round} · ${data.weakestLink.region || ""} · flip this one pick`,
    s(hlTextX),
    s(Y + 28)
  );

  // CSS: .bw-card-hl-number--green 20px, color #4ade80
  setFont(20, 400, SERIF);
  ctx.fillStyle = COLORS.green;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `${data.weakestLink.improvementMultiplier.toFixed(1)}x`,
    s(360 - LX - 6),
    s(Y + hlH / 2)
  );

  Y += hlH + gap6;

  // --- ROAST BOX (dynamic height) ---
  // CSS: .bw-card-roast padding: 9px 12px, border-radius: 8px, border: 1px solid rgba(184,125,24,0.1)
  roundRect(LX, Y, CW, roastH, 8);
  const roastGrad = ctx.createLinearGradient(s(LX), s(Y), s(360 - LX), s(Y + roastH));
  roastGrad.addColorStop(0, "rgba(184,125,24,0.06)");
  roastGrad.addColorStop(1, "rgba(184,125,24,0.02)");
  ctx.fillStyle = roastGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(184,125,24,0.1)";
  ctx.lineWidth = s(1);
  ctx.stroke();

  // CSS: .bw-card-roast-quote 32px Instrument Serif, rgba(184,125,24,0.2)
  setFont(32, 400, SERIF);
  ctx.fillStyle = "rgba(184,125,24,0.2)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("\u201C", s(LX + 6), s(Y + 2));

  // CSS: .bw-card-roast-text 11px Instrument Serif italic, rgba(239,228,207,0.7), line-height 1.35, padding-left: 16px
  setFont(11, 400, SERIF, "italic");
  ctx.fillStyle = COLORS.textDim;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  wrapText(ctx, data.roastText, s(LX + 20), s(Y + 9), roastMaxWidth, roastLineHeight);

  Y += roastH + gap7;

  // --- FOOTER ---
  // CSS: .bw-card-footer-url 14px/700, color #f0e6d0
  setFont(14, 700, SANS);
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("bracket.oddsgods.net", s(180), s(Y));

  // CSS: .bw-card-footer-promo 11px/700, color #e7bf72
  setFont(11, 700, SANS);
  ctx.fillStyle = COLORS.amberText;
  ctx.fillText("\uD83D\uDCB0 Best bracket wins $100 \uD83D\uDCB0", s(180), s(Y + 20));

  // Return total pixel height: content ends at Y + footerH, plus bottom padding
  return s(startY + totalH + V_PAD);
}
