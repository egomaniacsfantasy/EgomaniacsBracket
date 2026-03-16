import { useState } from "react";
import type { WrappedData } from "./lib/wrappedData";
import { ordinal } from "./lib/wrappedData";
import { formatAmericanFromProbability } from "./lib/odds";

interface BracketWrappedCardProps {
  data: WrappedData;
  onSaveCard?: () => void;
  onCopyLink?: () => void;
  standalone?: boolean;
  onClose?: () => void;
}

const ROUND_LABELS: Record<string, string> = {
  R64: "R64",
  R32: "R32",
  S16: "Sweet 16",
  E8: "Elite 8",
  F4: "Final Four",
  CHAMP: "Championship",
};

const PATH_GAUNTLET_ROUNDS = ["R64", "R32", "S16", "E8", "F4", "CHAMP"] as const;

function getPathProbTone(prob: number): "safe" | "neutral" | "danger" {
  if (prob >= 0.7) return "safe";
  if (prob >= 0.5) return "neutral";
  return "danger";
}

function formatPercent(prob: number): string {
  const percent = prob * 100;
  const decimals = percent > 0 && percent < 10 ? 1 : 0;
  return `${percent.toFixed(decimals)}%`;
}

export function BracketWrappedCard({
  data,
  onSaveCard,
  onCopyLink,
  standalone,
  onClose,
}: BracketWrappedCardProps) {
  const [linkCopied, setLinkCopied] = useState(false);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    onCopyLink?.();
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const {
    identity,
    boldestPick,
    unlikelyRun,
    championPath,
    champion,
    finalFour,
    bracketOddsDisplay,
    bracketOddsComparison,
  } = data;
  const chaosPercentilePosition = Math.max(2, Math.min(98, identity.chaosPercentile));
  const championPathGamesByRound = new Map(championPath.games.map((game) => [game.round, game]));
  const toughestRoundLabel = championPath.toughestGame.round || championPath.toughestGame.roundLabel;
  const pathAmericanOdds = formatAmericanFromProbability(championPath.pathProbability);

  // Collect logos for ghosted background
  const ghostLogos = [
    champion.teamLogoUrl,
    unlikelyRun.teamLogoUrl,
    boldestPick.winnerLogoUrl,
    championPath.championLogoUrl,
    ...finalFour.slice(0, 2).map((t) => t.teamLogoUrl),
  ].filter(Boolean);

  return (
    <div className={standalone ? "bw-card-wrapper bw-card-wrapper--standalone" : undefined}>
    <div className={`bw-card-wrap${standalone ? " bw-card-wrap--standalone" : ""}`} id="wrapped-export-target">
      {standalone && onClose ? (
        <button className="bw-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      ) : null}

      {/* Ghosted background logos */}
      <div className="bw-card-ghosts" aria-hidden="true">
        {ghostLogos.map((url, i) => (
          <img
            key={`ghost-${i}`}
            src={url}
            alt=""
            className="bw-ghost-logo"
            style={{
              width: [180, 120, 90, 160, 100, 70][i % 6],
              top: `${[5, 25, 55, 10, 65, 40][i % 6]}%`,
              left: `${[70, 5, 75, 40, 15, 60][i % 6]}%`,
              transform: `rotate(${[-12, 8, -5, 15, -8, 10][i % 6]}deg)`,
              opacity: [0.04, 0.035, 0.05, 0.04, 0.055, 0.03][i % 6],
            }}
          />
        ))}
      </div>

      <div className="bw-card-content">
        {/* 1. Top bar */}
        <div className="bw-card-topbar">
          <span className="bw-card-title">
            BRACKET <span className="bw-card-title-accent">WRAPPED</span>
          </span>
          <span className="bw-card-dots">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className={`bw-dot ${i === 4 ? "bw-dot--active" : ""}`} />
            ))}
          </span>
        </div>

        {/* 2. Champion row */}
        <div className="bw-card-champ-row">
          <img
            src={champion.teamLogoUrl}
            alt={champion.teamName}
            className="bw-card-champ-logo"
          />
          <div className="bw-card-champ-text">
            <span className="bw-card-champ-label">YOUR CHAMPION</span>
            <span className="bw-card-champ-name">{champion.teamName}</span>
            <span className="bw-card-champ-odds">
              {champion.champOdds} to cut the nets
            </span>
          </div>
        </div>

        {/* 3. Chaos strip */}
        <div className="bw-card-chaos-strip">
          <div className="bw-card-chaos-left">
            <span className="bw-card-chaos-emoji">{identity.chaosEmoji}</span>
            <span className="bw-card-chaos-label">{identity.chaosLabel}</span>
          </div>
          <div className="bw-card-chaos-bar-wrap">
            <div className="bw-card-chaos-bar-labels">
              <span>CHALK</span>
              <span>CHAOS</span>
            </div>
            <div className="bw-card-chaos-bar-track">
              <div
                className="bw-card-chaos-bar-fill"
                style={{ width: `${chaosPercentilePosition}%` }}
              />
              <div
                className="bw-card-chaos-bar-glow"
                style={{ left: `${chaosPercentilePosition}%` }}
              />
              <div
                className="bw-card-chaos-bar-marker"
                style={{ left: `${chaosPercentilePosition}%` }}
              />
            </div>
          </div>
          <span className="bw-card-chaos-pct">{ordinal(Math.round(identity.chaosPercentile))}</span>
        </div>

        {/* 4. Bracket odds */}
        <div className="bw-card-bracket-line">
          <span className="bw-card-bracket-line-label">ODDS OF YOUR EXACT BRACKET</span>
          <span className="bw-card-bracket-line-number">{bracketOddsDisplay}</span>
          <span className="bw-card-bracket-line-sub">{bracketOddsComparison}</span>
        </div>

        {/* 6. Three highlight rows */}
        <div className="bw-card-highlights">
          {/* Boldest */}
          <div className="bw-card-hl bw-card-hl--boldest">
            <div className="bw-card-hl-logos">
              <img src={boldestPick.winnerLogoUrl} alt="" className="bw-card-hl-logo-front" />
              <img src={boldestPick.loserLogoUrl} alt="" className="bw-card-hl-logo-back" />
            </div>
            <div className="bw-card-hl-info">
              <span className="bw-card-hl-tag bw-card-hl-tag--red">BOLDEST PICK</span>
              <span className="bw-card-hl-matchup">
                #{boldestPick.winnerSeed} {boldestPick.winnerName} over #{boldestPick.loserSeed}{" "}
                {boldestPick.loserName}
              </span>
              <span className="bw-card-hl-detail">
                {ROUND_LABELS[boldestPick.round] ?? boldestPick.round}{" "}
                {boldestPick.region ?? ""} {boldestPick.simBracketFraction} brackets
              </span>
            </div>
            <span className="bw-card-hl-number bw-card-hl-number--red">
              {(boldestPick.winProbability * 100).toFixed(1)}%
            </span>
          </div>

          {/* Unlikely */}
          <div className="bw-card-hl bw-card-hl--unlikely">
            <img
              src={unlikelyRun.teamLogoUrl}
              alt={unlikelyRun.teamName}
              className="bw-card-hl-logo-front bw-card-hl-logo--unlikely"
            />
            <div className="bw-card-hl-info">
              <span className="bw-card-hl-tag bw-card-hl-tag--amber">🏃 UNLIKELY RUN</span>
              <span className="bw-card-hl-matchup">
                #{unlikelyRun.teamSeed} {unlikelyRun.teamName} → {unlikelyRun.roundReached}
              </span>
              <span className="bw-card-hl-detail">baseline odds of reaching this stage</span>
            </div>
            <span className="bw-card-hl-number bw-card-hl-number--amber">
              {formatPercent(unlikelyRun.baselineProb)}
            </span>
          </div>

          {/* The Path */}
          <div className="bw-card-hl bw-card-hl--path">
            <div className="bw-card-path-shell">
              <span className="bw-card-hl-tag bw-card-hl-tag--amber">{"\uD83C\uDFC6"} THE PATH</span>

              <div className="bw-card-path-gauntlet" aria-label={`${championPath.championName} championship gauntlet`}>
                {PATH_GAUNTLET_ROUNDS.map((round) => {
                  const game = championPathGamesByRound.get(round) ?? null;
                  const isToughest =
                    game?.round === championPath.toughestGame.round &&
                    game.opponentName === championPath.toughestGame.opponentName;
                  const probTone = game ? getPathProbTone(game.winProbability) : "neutral";

                  return (
                    <div
                      key={round}
                      className={`bw-card-path-slot${isToughest ? " bw-card-path-slot--toughest" : ""}`}
                    >
                      <span className="bw-card-path-slot-round">{round}</span>
                      <span className="bw-card-path-slot-logo-ring">
                        {game ? (
                          <img
                            src={game.opponentLogoUrl}
                            alt={game.opponentName}
                            className="bw-card-path-slot-logo"
                          />
                        ) : (
                          <span className="bw-card-path-slot-logo-placeholder">-</span>
                        )}
                      </span>
                      <span className={`bw-card-path-slot-prob bw-card-path-slot-prob--${probTone}`}>
                        {game ? formatPercent(game.winProbability) : "--"}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="bw-card-path-callout">
                <span className="bw-card-path-callout-line" aria-hidden="true" />
                <span className="bw-card-path-callout-text">
                  toughest: {championPath.toughestGame.opponentName} · {toughestRoundLabel}
                </span>
              </div>

              <div className="bw-card-path-footer">
                <span className="bw-path-summary-label">Your path odds</span>
                <div className="bw-path-odds-block">
                  <span className="bw-path-odds-value">{pathAmericanOdds}</span>
                  <span className="bw-path-odds-context">to cut down the nets on this path</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Separator line above footer */}
        <div className="bw-card-separator" />

        {/* 7. Footer */}
        <div className="bw-card-footer">
          <span className="bw-card-footer-url">bracket.oddsgods.net</span>
          <span className="bw-card-footer-promo">💰 Best bracket wins $100 💰</span>
        </div>
      </div>
    </div>
    {standalone ? (
      <div className="bw-card-actions">
        {onSaveCard ? (
          <button className="bw-btn bw-btn--primary" onClick={onSaveCard}>
            Share Card 📤
          </button>
        ) : null}
        <button className="bw-btn bw-btn--secondary" onClick={handleCopyLink}>
          {linkCopied ? "Copied!" : "Copy Link"}
        </button>
      </div>
    ) : null}
    </div>
  );
}
