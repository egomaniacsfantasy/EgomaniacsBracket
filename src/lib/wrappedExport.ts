import { toBlob } from "html-to-image";

// ---------------------------------------------------------------------------
// Image → Base64 conversion (prevents CORS failures in SVG foreignObject)
// ---------------------------------------------------------------------------

/**
 * Convert an ESPN CDN URL to a local /logos/ path to avoid CORS issues.
 */
function toLocalLogoUrl(url: string): string {
  const espnMatch = url.match(
    /espncdn\.com\/i\/teamlogos\/ncaa\/\d+\/(\d+)\.png/
  );
  if (espnMatch) {
    return `/logos/${espnMatch[1]}.png`;
  }
  return url;
}

function loadImageAsBase64(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Convert all <img> elements inside a container to inline base64 data URLs.
 * Returns a restore function that puts the original sources back.
 */
async function convertImagesToBase64(
  container: HTMLElement
): Promise<() => void> {
  const imgs = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
  const originals: { img: HTMLImageElement; src: string }[] = [];

  await Promise.all(
    imgs.map(async (img) => {
      if (!img.src || img.src.startsWith("data:")) return;
      const originalSrc = img.src;
      originals.push({ img, src: originalSrc });

      // Try local path first (avoids CORS), then fall back to original URL
      const localUrl = toLocalLogoUrl(originalSrc);
      let base64 = await loadImageAsBase64(localUrl);
      if (!base64 && localUrl !== originalSrc) {
        base64 = await loadImageAsBase64(originalSrc);
      }
      if (base64) {
        img.src = base64;
      }
    })
  );

  return () => {
    for (const { img, src } of originals) {
      img.src = src;
    }
  };
}

/**
 * Wait for all images in a container to be fully loaded.
 */
async function waitForImages(container: HTMLElement): Promise<void> {
  const imgs = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          })
    )
  );
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

/**
 * Export the Bracket Wrapped card by screenshotting the rendered React component.
 * Uses html-to-image (SVG foreignObject) so the browser's own rendering engine
 * handles all CSS — letter-spacing, fonts, layout are pixel-perfect.
 */
export async function exportWrappedCard(): Promise<void> {
  const target = document.getElementById("wrapped-export-target");
  if (!target) {
    console.error("Export target #wrapped-export-target not found");
    return;
  }

  // Convert all images to base64 (critical for foreignObject CORS handling)
  const restoreImages = await convertImagesToBase64(target);

  try {
    // Wait for all images to be fully loaded with new base64 src
    await waitForImages(target);
    // Let the DOM settle after src changes
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const options = {
      pixelRatio: 3,
      backgroundColor: "#080603",
      quality: 1.0,
      cacheBust: true,
    };

    // First pass warms html-to-image's internal cache (known quirk —
    // images often missing on the first render, present on second)
    await toBlob(target, options).catch(() => {});

    // Second pass renders with all images embedded
    const blob = await toBlob(target, options);
    if (!blob) return;

    // Share → clipboard → download fallback chain

    // Try native share (mobile / Mac share sheet)
    if (navigator.share && navigator.canShare) {
      const file = new File([blob], "bracket-wrapped.png", {
        type: "image/png",
      });
      const shareData = { files: [file] };
      if (navigator.canShare(shareData)) {
        try {
          await navigator.share(shareData);
          return;
        } catch {
          // User cancelled or share failed — fall through
        }
      }
    }

    // Fallback: clipboard
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      return;
    } catch {
      // Clipboard not supported or denied — fall through
    }

    // Final fallback: file download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bracket-wrapped.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } finally {
    restoreImages();
  }
}
