import html2canvas from "html2canvas";

// ---------------------------------------------------------------------------
// Image → Base64 conversion (prevents html2canvas CORS failures)
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

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

/**
 * Export the Bracket Wrapped card by screenshotting the rendered React component.
 * Uses html2canvas to capture #wrapped-export-target directly, guaranteeing
 * the export matches the on-screen card exactly — no dual rendering paths.
 */
export async function exportWrappedCard(): Promise<void> {
  const target = document.getElementById("wrapped-export-target");
  if (!target) {
    console.error("Export target #wrapped-export-target not found");
    return;
  }

  // Step 1: Convert all images to base64 (critical for html2canvas CORS handling)
  const restoreImages = await convertImagesToBase64(target);

  try {
    // Step 2: Capture the rendered component
    const canvas = await html2canvas(target, {
      scale: 3,
      backgroundColor: "#080603",
      useCORS: true,
      allowTaint: false,
      logging: false,
    });

    // Step 3: Convert to blob
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png", 1.0);
    });
    if (!blob) return;

    // Step 4: Share → clipboard → download fallback chain

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
    // Restore original image sources
    restoreImages();
  }
}
