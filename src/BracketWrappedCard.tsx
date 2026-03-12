import { useState } from "react";
import type { WrappedData } from "./lib/wrappedData";

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

  const { identity, boldestPick, rippleEffect, weakestLink, champion, finalFour, perfectBracketLine, roastText } = data;

  // Collect logos for ghosted background
  const ghostLogos = [
    champion.teamLogoUrl,
    boldestPick.winnerLogoUrl,
    weakestLink.pickedTeamLogoUrl,
    ...finalFour.slice(0, 3).map((t) => t.teamLogoUrl),
  ].filter(Boolean);

  return (
    <div className="bw-card-wrap">
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
                style={{ width: `${Math.max(2, Math.min(98, identity.chaosPercentile))}%` }}
              />
              <div
                className="bw-card-chaos-bar-marker"
                style={{ left: `${Math.max(2, Math.min(98, identity.chaosPercentile))}%` }}
              />
            </div>
          </div>
          <span className="bw-card-chaos-pct">{Math.round(identity.chaosPercentile)}th</span>
        </div>

        {/* 4. Final Four strip */}
        <div className="bw-card-f4-strip">
          <span className="bw-card-f4-label">F4</span>
          {finalFour.map((team) => (
            <div key={team.teamId} className="bw-card-f4-pill">
              <img src={team.teamLogoUrl} alt="" className="bw-card-f4-logo" />
              <span className="bw-card-f4-abbrev">{team.teamAbbrev}</span>
            </div>
          ))}
        </div>

        {/* 5. Bracket line */}
        <div className="bw-card-bracket-line">
          <span className="bw-card-bracket-line-label">YOUR PERFECT BRACKET LINE</span>
          <span className="bw-card-bracket-line-number">{perfectBracketLine}</span>
          <span className="bw-card-bracket-line-sub">good luck with that</span>
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

          {/* Ripple */}
          <div className="bw-card-hl bw-card-hl--ripple">
            <span className="bw-card-hl-emoji">🌊</span>
            <div className="bw-card-hl-info">
              <span className="bw-card-hl-tag bw-card-hl-tag--green">RIPPLE EFFECT</span>
              <span className="bw-card-hl-matchup">
                {rippleEffect.biggestCasualty.teamName}&apos;s title:{" "}
                {rippleEffect.biggestCasualty.baselineChampOdds} to{" "}
                {rippleEffect.biggestCasualty.currentChampOdds}
              </span>
              <span className="bw-card-hl-detail">
                {rippleEffect.causedByPick.description}
              </span>
            </div>
            <div className="bw-card-hl-number-stack">
              <span className="bw-card-hl-number bw-card-hl-number--text">
                {rippleEffect.totalGamesAffected}
              </span>
              <span className="bw-card-hl-number-sub">ODDS SHIFTED</span>
            </div>
          </div>

          {/* Weakest */}
          <div className="bw-card-hl bw-card-hl--weakest">
            <div className="bw-card-hl-logos">
              <img src={weakestLink.pickedTeamLogoUrl} alt="" className="bw-card-hl-logo-front" />
              <img src={weakestLink.opponentTeamLogoUrl} alt="" className="bw-card-hl-logo-back" />
            </div>
            <div className="bw-card-hl-info">
              <span className="bw-card-hl-tag bw-card-hl-tag--amber">WARNING WEAKEST LINK</span>
              <span className="bw-card-hl-matchup">
                #{weakestLink.pickedTeamSeed} {weakestLink.pickedTeamName} over #
                {weakestLink.opponentTeamSeed} {weakestLink.opponentTeamName}
              </span>
              <span className="bw-card-hl-detail">
                {ROUND_LABELS[weakestLink.round] ?? weakestLink.round}{" "}
                {weakestLink.region ?? ""} {(weakestLink.pickedTeamWinProb * 100).toFixed(0)}% win
                prob
              </span>
            </div>
            <span className="bw-card-hl-number bw-card-hl-number--green">
              {weakestLink.improvementMultiplier.toFixed(1)}x
            </span>
          </div>
        </div>

        {/* 7. Roast box */}
        <div className="bw-card-roast">
          <span className="bw-card-roast-quote" aria-hidden="true">
            &ldquo;
          </span>
          <p className="bw-card-roast-text">{roastText}</p>
        </div>

        {/* 8. Footer */}
        <div className="bw-card-footer">
          <span className="bw-card-footer-url">bracket.oddsgods.net</span>
          <span className="bw-card-footer-promo">💰 Best bracket wins $100 💰</span>
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
