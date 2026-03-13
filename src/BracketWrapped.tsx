import { useCallback, useEffect, useRef, useState } from "react";
import type { WrappedData } from "./lib/wrappedData";
import { BracketWrappedCard } from "./BracketWrappedCard";
import { trackEvent } from "./lib/analytics";
import { exportWrappedCard } from "./lib/wrappedExport";

interface BracketWrappedProps {
  data: WrappedData;
  onClose: () => void;
}

const TOTAL_SCREENS = 5;
const AUTO_ADVANCE_MS = 10000;

const ROUND_LABELS: Record<string, string> = {
  R64: "R64",
  R32: "R32",
  S16: "SWEET 16",
  E8: "ELITE 8",
  F4: "FINAL FOUR",
  CHAMP: "CHAMPIONSHIP",
};

function formatPercent(prob: number): string {
  const percent = prob * 100;
  const decimals = percent > 0 && percent < 10 ? 1 : 0;
  return `${percent.toFixed(decimals)}%`;
}

function unlikelyRunHeroLine(roundReached: string): string {
  return roundReached === "Champion" ? "to win it all" : `to the ${roundReached}`;
}

function unlikelyRunContextLine(teamName: string, roundReached: string, baselineProb: number): string {
  const destination =
    roundReached === "Champion" ? "winning the title" : `reaching the ${roundReached}`;
  return `Before any picks were made, the model gave ${teamName} a ${formatPercent(baselineProb)} chance of ${destination}.`;
}

export function BracketWrapped({ data, onClose }: BracketWrappedProps) {
  const [screen, setScreen] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);
  const hasTrackedRef = useRef<Set<number>>(new Set());
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const { identity, boldestPick, unlikelyRun, championPath, champion, finalFour } = data;

  // Compute scale factor for card frame (desktop only Ã¢â‚¬â€ mobile uses natural sizing)
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  useEffect(() => {
    const updateScale = () => {
      if (window.innerWidth < 768) {
        setScale(1);
        return;
      }
      if (frameRef.current) {
        const fw = frameRef.current.clientWidth;
        const fh = frameRef.current.clientHeight;
        setScale(Math.min(fw / 360, fh / 640));
      }
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  // Collect logos for ghosted background
  const ghostLogos = [
    champion.teamLogoUrl,
    boldestPick.winnerLogoUrl,
    unlikelyRun.teamLogoUrl,
    championPath.championLogoUrl,
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

  // Auto-advance timer (stops on screen 5)
  useEffect(() => {
    if (screen >= TOTAL_SCREENS - 1) return;
    const timer = setTimeout(() => {
      setScreen((s) => s + 1);
    }, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [screen]);

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

  const handleShareCard = async () => {
    try {
      await exportWrappedCard();
      trackEvent("wrapped_card_shared", {
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
        Ã¢Å“â€¢
      </button>

      {/* Card frame */}
      <div className="bw-card-frame" ref={frameRef}>
        <div
          className="bw-card-frame-inner"
          style={isMobile ? undefined : { transform: `scale(${scale})`, transformOrigin: "center center", width: 360, height: 640 }}
        >
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

          {/* Screen content Ã¢â‚¬â€ key forces remount for animation */}
          <div className="bw-screen" key={screen}>
            {screen === 0 && <Screen1Identity identity={identity} />}
            {screen === 1 && <Screen2Boldest boldestPick={boldestPick} />}
            {screen === 2 && <Screen3Unlikely unlikelyRun={unlikelyRun} />}
            {screen === 3 && <Screen4Path championPath={championPath} />}
            {screen === 4 && (
              <div className="bw-screen5-wrap">
                <BracketWrappedCard data={data} />
                <div className="bw-screen5-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="bw-btn bw-btn--primary" onClick={handleShareCard}>
                    Share Card Ã°Å¸â€œÂ¤
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
              <span className="bw-footer-promo">Ã°Å¸â€™Â° Best bracket wins $100 Ã°Å¸â€™Â°</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Navigation arrows */}
      {screen > 0 && (
        <button
          className="bw-nav-arrow bw-nav-arrow--left"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          aria-label="Previous"
        >
          Ã¢â‚¬Â¹
        </button>
      )}
      {screen < TOTAL_SCREENS - 1 && (
        <button
          className="bw-nav-arrow bw-nav-arrow--right"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          aria-label="Next"
        >
          Ã¢â‚¬Âº
        </button>
      )}

      {/* Progress bar */}
      <div className="bw-progress-bar">
        {Array.from({ length: TOTAL_SCREENS }).map((_, i) => (
          <div key={i} className="bw-progress-segment">
            <div
              className={`bw-progress-fill ${i < screen ? "bw-progress-complete" : ""} ${i === screen ? "bw-progress-active" : ""}`}
              style={i === screen && screen < TOTAL_SCREENS - 1 ? { animationDuration: `${AUTO_ADVANCE_MS}ms` } : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 1: The Identity
// ---------------------------------------------------------------------------

function Screen1Identity({
  identity,
}: {
  identity: WrappedData["identity"];
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
        {boldestPick.region ? ` Ã‚Â· ${boldestPick.region.toUpperCase()}` : ""}
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
// Screen 3: The Unlikely Run
// ---------------------------------------------------------------------------

function Screen3Unlikely({ unlikelyRun }: { unlikelyRun: WrappedData["unlikelyRun"] }) {
  return (
    <div className="bw-content bw-content--unlikely">
      <span className="bw-heading bw-heading--amber">UNLIKELY RUN</span>

      <img
        src={unlikelyRun.teamLogoUrl}
        alt={unlikelyRun.teamName}
        className="bw-unlikely-logo"
      />

      <div className="bw-unlikely-team">
        <span className="bw-unlikely-name">{unlikelyRun.teamName}</span>
        <span className="bw-unlikely-seed">#{unlikelyRun.teamSeed} seed</span>
      </div>

      <h2 className="bw-unlikely-round">{unlikelyRunHeroLine(unlikelyRun.roundReached)}</h2>

      <div className="bw-prob-display">
        <span className="bw-prob-number bw-prob-number--amber">
          {formatPercent(unlikelyRun.baselineProb)}
        </span>
        <span className="bw-prob-label">baseline probability</span>
      </div>

      <p className="bw-context-line bw-context-line--unlikely">
        {unlikelyRunContextLine(
          unlikelyRun.teamName,
          unlikelyRun.roundReached,
          unlikelyRun.baselineProb
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 4: The Path of Most Resistance
// ---------------------------------------------------------------------------

function Screen4Path({ championPath }: { championPath: WrappedData["championPath"] }) {
  const probColor = (p: number) => {
    if (p >= 0.75) return "var(--green, #4ade80)";
    if (p >= 0.5) return "#f0e6d0";
    return "var(--red, #f87171)";
  };

  return (
    <div className="bw-content bw-content--path">
      <span className="bw-heading bw-heading--amber">THE PATH OF MOST RESISTANCE</span>

      <div className="bw-path-champion">
        <img
          src={championPath.championLogoUrl}
          alt={championPath.championName}
          className="bw-path-champion-logo"
        />
        <span className="bw-path-champion-name">{championPath.championName}</span>
        <span className="bw-path-champion-seed">#{championPath.championSeed} seed</span>
      </div>

      <div className="bw-path-games">
        {championPath.games.map((game) => {
          const isToughest = game.round === championPath.toughestGame.round;
          return (
            <div
              key={game.round}
              className={`bw-path-row ${isToughest ? "bw-path-row--toughest" : ""}`}
            >
              <span className="bw-path-round">{game.round}</span>
              <img
                src={game.opponentLogoUrl}
                alt={game.opponentName}
                className="bw-path-opp-logo"
              />
              <span className="bw-path-opp">
                <span className="bw-path-vs">vs</span> {game.opponentName}
              </span>
              <span
                className="bw-path-prob"
                style={{ color: probColor(game.winProbability) }}
              >
                {(game.winProbability * 100).toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>

      <div className="bw-prob-display">
        <span className="bw-prob-number bw-prob-number--amber">
          {(championPath.pathProbability * 100).toFixed(1)}
          <span className="bw-prob-pct">%</span>
        </span>
        <span className="bw-prob-label">
          Chance {championPath.championName} wins the championship with this specific path
        </span>
      </div>

      <p className="bw-context-line">
        The model says {championPath.championName}'s toughest test is{" "}
        {championPath.toughestGame.opponentName} in the {championPath.toughestGame.roundLabel}.
      </p>
    </div>
  );
}
