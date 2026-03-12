import { useCallback, useEffect, useRef, useState } from "react";
import type { WrappedData } from "./lib/wrappedData";
import { BracketWrappedCard } from "./BracketWrappedCard";
import { trackEvent } from "./lib/analytics";
import { exportWrappedCard } from "./lib/wrappedExport";

interface BracketWrappedProps {
  data: WrappedData;
  onClose: () => void;
  onShareCard: () => void;
}

const TOTAL_SCREENS = 5;

const ROUND_LABELS: Record<string, string> = {
  R64: "R64",
  R32: "R32",
  S16: "SWEET 16",
  E8: "ELITE 8",
  F4: "FINAL FOUR",
  CHAMP: "CHAMPIONSHIP",
};

export function BracketWrapped({ data, onClose, onShareCard }: BracketWrappedProps) {
  const [screen, setScreen] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);
  const hasTrackedRef = useRef<Set<number>>(new Set());

  const { identity, boldestPick, rippleEffect, weakestLink, champion, finalFour, perfectBracketLine, roastText } = data;

  // Collect logos for ghosted background
  const ghostLogos = [
    champion.teamLogoUrl,
    boldestPick.winnerLogoUrl,
    boldestPick.loserLogoUrl,
    weakestLink.pickedTeamLogoUrl,
    ...finalFour.slice(0, 2).map((t) => t.teamLogoUrl),
  ].filter(Boolean);

  // Track screen views
  useEffect(() => {
    if (!hasTrackedRef.current.has(screen)) {
      hasTrackedRef.current.add(screen);
      trackEvent("wrapped_screen_viewed", {
        screen: screen + 1,
        chaosLabel: identity.chaosLabel,
      });
    }
  }, [screen, identity.chaosLabel]);

  // Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        trackEvent("wrapped_closed", {
          screen: screen + 1,
          completed: screen === TOTAL_SCREENS - 1,
        });
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, screen]);

  const goNext = useCallback(() => {
    if (screen < TOTAL_SCREENS - 1) {
      setScreen((s) => s + 1);
    } else {
      trackEvent("wrapped_completed", {
        chaosLabel: identity.chaosLabel,
        champion: champion.teamName,
        boldestPick: boldestPick.winnerName,
      });
    }
  }, [screen, identity.chaosLabel, champion.teamName, boldestPick.winnerName]);

  const goPrev = useCallback(() => {
    if (screen > 0) setScreen((s) => s - 1);
  }, [screen]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't navigate if clicking a button or interactive element
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const threshold = rect.width * 0.3;
    if (x < threshold) {
      goPrev();
    } else {
      goNext();
    }
  };

  const handleClose = () => {
    trackEvent("wrapped_closed", {
      screen: screen + 1,
      completed: screen === TOTAL_SCREENS - 1,
    });
    onClose();
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    trackEvent("wrapped_link_copied", {
      chaosLabel: identity.chaosLabel,
      champion: champion.teamName,
    });
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleSaveCard = async () => {
    try {
      await exportWrappedCard(data);
      trackEvent("wrapped_card_saved", {
        chaosLabel: identity.chaosLabel,
        champion: champion.teamName,
      });
    } catch (err) {
      console.error("Failed to export wrapped card:", err);
    }
  };

  return (
    <div className="bw-overlay" onClick={handleClick}>
      {/* Close button */}
      <button
        className="bw-close"
        onClick={(e) => {
          e.stopPropagation();
          handleClose();
        }}
        aria-label="Close"
      >
        ✕
      </button>

      {/* Progress dots */}
      <div className="bw-dots">
        {Array.from({ length: TOTAL_SCREENS }).map((_, i) => (
          <span key={i} className={`bw-dot ${i === screen ? "bw-dot--active" : ""}`} />
        ))}
      </div>

      {/* Ghosted background logos */}
      <div className="bw-ghosts" aria-hidden="true">
        {ghostLogos.map((url, i) => (
          <img
            key={`ghost-${i}`}
            src={url}
            alt=""
            className="bw-ghost-logo"
            style={{
              width: [200, 140, 80, 180, 100, 120][i % 6],
              top: `${[8, 30, 60, 15, 70, 45][i % 6]}%`,
              left: `${[72, 3, 78, 45, 10, 65][i % 6]}%`,
              transform: `rotate(${[-15, 10, -6, 18, -10, 8][i % 6]}deg)`,
              opacity: [0.04, 0.035, 0.055, 0.04, 0.05, 0.03][i % 6],
            }}
          />
        ))}
      </div>

      {/* Screen content — key forces remount for animation */}
      <div className="bw-screen" key={screen}>
        {screen === 0 && <Screen1Identity identity={identity} roastText={roastText} />}
        {screen === 1 && <Screen2Boldest boldestPick={boldestPick} />}
        {screen === 2 && <Screen3Ripple rippleEffect={rippleEffect} />}
        {screen === 3 && <Screen4Weakest weakestLink={weakestLink} />}
        {screen === 4 && (
          <div className="bw-screen5-wrap">
            <BracketWrappedCard data={data} />
            <div className="bw-screen5-actions" onClick={(e) => e.stopPropagation()}>
              <button className="bw-btn bw-btn--primary" onClick={handleSaveCard}>
                Save Card
              </button>
              <button className="bw-btn bw-btn--secondary" onClick={handleCopyLink}>
                {linkCopied ? "Copied!" : "Copy Link"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer (screens 1-4 only) */}
      {screen < 4 ? (
        <div className="bw-footer">
          <span className="bw-footer-url">bracket.oddsgods.net</span>
          <span className="bw-footer-promo">💰 Best bracket wins $100 💰</span>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 1: The Identity
// ---------------------------------------------------------------------------

function Screen1Identity({
  identity,
  roastText,
}: {
  identity: WrappedData["identity"];
  roastText: string;
}) {
  return (
    <div className="bw-content bw-content--identity">
      <span className="bw-pre-label">THE GODS HAVE SPOKEN</span>
      <span className="bw-identity-emoji">{identity.chaosEmoji}</span>
      <h2 className="bw-identity-label">{identity.chaosLabel}</h2>

      <div className="bw-spectrum">
        <div className="bw-spectrum-labels">
          <span>CHALK</span>
          <span>CHAOS</span>
        </div>
        <div className="bw-spectrum-track">
          <div
            className="bw-spectrum-fill"
            style={{ width: `${Math.max(2, Math.min(98, identity.chaosPercentile))}%` }}
          />
          <div
            className="bw-spectrum-marker"
            style={{ left: `${Math.max(2, Math.min(98, identity.chaosPercentile))}%` }}
          />
        </div>
      </div>

      <p className="bw-roast-line">
        You picked {identity.numUpsets} upset{identity.numUpsets !== 1 ? "s" : ""}. The gods have
        taken note.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 2: The Boldest Call
// ---------------------------------------------------------------------------

function Screen2Boldest({ boldestPick }: { boldestPick: WrappedData["boldestPick"] }) {
  return (
    <div className="bw-content bw-content--boldest">
      <span className="bw-heading bw-heading--red">YOUR BOLDEST CALL</span>
      <span className="bw-round-tag bw-round-tag--red">
        {ROUND_LABELS[boldestPick.round] ?? boldestPick.round}
        {boldestPick.region ? ` · ${boldestPick.region.toUpperCase()}` : ""}
      </span>

      <div className="bw-matchup">
        <div className="bw-matchup-team bw-matchup-team--winner">
          <img src={boldestPick.winnerLogoUrl} alt={boldestPick.winnerName} className="bw-matchup-logo bw-matchup-logo--winner" />
          <span className="bw-matchup-name">{boldestPick.winnerName}</span>
          <span className="bw-matchup-seed">#{boldestPick.winnerSeed} seed</span>
        </div>
        <span className="bw-matchup-over">over</span>
        <div className="bw-matchup-team bw-matchup-team--loser">
          <img src={boldestPick.loserLogoUrl} alt={boldestPick.loserName} className="bw-matchup-logo bw-matchup-logo--loser" />
          <span className="bw-matchup-name bw-matchup-name--loser">{boldestPick.loserName}</span>
          <span className="bw-matchup-seed">#{boldestPick.loserSeed} seed</span>
        </div>
      </div>

      <div className="bw-prob-display">
        <span className="bw-prob-number">
          {(boldestPick.winProbability * 100).toFixed(1)}
          <span className="bw-prob-pct">%</span>
        </span>
        <span className="bw-prob-label">chance according to the model</span>
      </div>

      <p className="bw-context-line">
        {boldestPick.simBracketFraction} simulated brackets include this pick.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 3: The Ripple Effect
// ---------------------------------------------------------------------------

function Screen3Ripple({ rippleEffect }: { rippleEffect: WrappedData["rippleEffect"] }) {
  return (
    <div className="bw-content bw-content--ripple">
      <span className="bw-heading bw-heading--amber">YOUR RIPPLE EFFECT</span>
      <span className="bw-big-number">{rippleEffect.totalGamesAffected}</span>
      <span className="bw-big-label">odds shifted by your picks</span>

      <div className="bw-divider" />

      <div className="bw-casualty-card">
        <span className="bw-casualty-label">BIGGEST CASUALTY</span>
        <div className="bw-casualty-row">
          <img
            src={rippleEffect.biggestCasualty.teamLogoUrl}
            alt={rippleEffect.biggestCasualty.teamName}
            className="bw-casualty-logo"
          />
          <div className="bw-casualty-info">
            <span className="bw-casualty-name">{rippleEffect.biggestCasualty.teamName}</span>
            <span className="bw-casualty-odds">
              Title: {rippleEffect.biggestCasualty.baselineChampOdds} to{" "}
              {rippleEffect.biggestCasualty.currentChampOdds}
            </span>
          </div>
          <span className="bw-casualty-delta">
            {rippleEffect.biggestCasualty.deltaPercent > 0 ? "+" : ""}
            {rippleEffect.biggestCasualty.deltaPercent.toFixed(1)}%
          </span>
        </div>
        <p className="bw-casualty-attribution">
          because {rippleEffect.causedByPick.description}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 4: The Weakest Link
// ---------------------------------------------------------------------------

function Screen4Weakest({ weakestLink }: { weakestLink: WrappedData["weakestLink"] }) {
  return (
    <div className="bw-content bw-content--weakest">
      <span className="bw-heading bw-heading--red">WARNING: WEAKEST LINK</span>
      <h2 className="bw-weakest-title">
        This pick is <em>costing</em> you.
      </h2>
      <span className="bw-round-tag">
        {ROUND_LABELS[weakestLink.round] ?? weakestLink.round}
        {weakestLink.region ? ` · ${weakestLink.region.toUpperCase()}` : ""}
      </span>

      <div className="bw-matchup bw-matchup--sm">
        <div className="bw-matchup-team bw-matchup-team--winner">
          <img
            src={weakestLink.pickedTeamLogoUrl}
            alt={weakestLink.pickedTeamName}
            className="bw-matchup-logo bw-matchup-logo--weakest-picked"
          />
          <span className="bw-matchup-name">{weakestLink.pickedTeamName}</span>
          <span className="bw-your-pick-badge">YOUR PICK</span>
        </div>
        <span className="bw-matchup-over">over</span>
        <div className="bw-matchup-team bw-matchup-team--loser">
          <img
            src={weakestLink.opponentTeamLogoUrl}
            alt={weakestLink.opponentTeamName}
            className="bw-matchup-logo bw-matchup-logo--loser"
            style={{ width: 52, height: 52 }}
          />
          <span className="bw-matchup-name bw-matchup-name--loser">
            {weakestLink.opponentTeamName}
          </span>
        </div>
      </div>

      <span className="bw-multiplier">
        {weakestLink.improvementMultiplier.toFixed(1)}x
      </span>
      <span className="bw-multiplier-label">better odds if you flip this one pick</span>

      <p className="bw-context-line">
        The model gives {weakestLink.pickedTeamName} a{" "}
        {(weakestLink.pickedTeamWinProb * 100).toFixed(0)}% chance here.
      </p>
    </div>
  );
}
