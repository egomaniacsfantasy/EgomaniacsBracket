import { useState } from "react";

type MobileOnboardingProps = {
  onStartFirstFour: () => void;
};

const SCREEN_COUNT = 3;

export function MobileOnboarding({ onStartFirstFour }: MobileOnboardingProps) {
  const [screen, setScreen] = useState(0);

  const goBack = () => {
    setScreen((prev) => Math.max(0, prev - 1));
  };

  const goForward = () => {
    if (screen >= SCREEN_COUNT - 1) {
      onStartFirstFour();
      return;
    }
    setScreen((prev) => Math.min(SCREEN_COUNT - 1, prev + 1));
  };

  return (
    <div className="mob-overlay" role="dialog" aria-modal="true" aria-labelledby={`mob-headline-${screen}`}>
      {screen > 0 ? (
        <button
          type="button"
          className="mob-hotspot mob-hotspot--left"
          aria-label="Previous onboarding screen"
          onClick={goBack}
        />
      ) : null}
      <button
        type="button"
        className="mob-hotspot mob-hotspot--right"
        aria-label={screen >= SCREEN_COUNT - 1 ? "Start with First Four" : "Next onboarding screen"}
        onClick={goForward}
      />

      <div className="mob-dots" aria-hidden="true">
        {Array.from({ length: SCREEN_COUNT }).map((_, index) => (
          <span
            key={index}
            className={`mob-dot ${screen === index ? "mob-dot--active" : ""}`}
          />
        ))}
      </div>

      {screen === 0 ? (
        <div className="mob-panel mob-panel--intro">
          <img className="mob-logo" src="/logo-icon.png?v=20260225" alt="Odds Gods" />
          <h2 id="mob-headline-0" className="mob-headline">Every pick changes everything.</h2>
          <p className="mob-subhead">
            This isn&apos;t a regular bracket. Pick any outcome and watch the entire tournament reprice in real time.
          </p>
          <div className="mob-hint">Tap to continue</div>
        </div>
      ) : null}

      {screen === 1 ? (
        <div className="mob-panel mob-panel--steps">
          <h2 id="mob-headline-1" className="mob-headline mob-headline--steps">Pick. Watch. React.</h2>
          <div className="mob-step-list">
            <div className="mob-step-row">
              <div className="mob-step-icon" aria-hidden="true">👆</div>
              <div className="mob-step-copy">
                <span className="mob-step-action">TAP</span>
                <span className="mob-step-desc">a team to pick them</span>
              </div>
            </div>
            <div className="mob-step-row">
              <div className="mob-step-icon" aria-hidden="true">🔄</div>
              <div className="mob-step-copy">
                <span className="mob-step-action">ODDS UPDATE</span>
                <span className="mob-step-desc">across the entire bracket</span>
              </div>
            </div>
            <div className="mob-step-row">
              <div className="mob-step-icon" aria-hidden="true">📊</div>
              <div className="mob-step-copy">
                <span className="mob-step-action">SEE THE IMPACT</span>
                <span className="mob-step-desc">in the Futures tab</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {screen === 2 ? (
        <div className="mob-panel mob-panel--ready">
          <h2 id="mob-headline-2" className="mob-headline mob-headline--ready">Start with the First Four.</h2>
          <p className="mob-subhead mob-subhead--ready">
            Pick the 4 play-in games, then fill your bracket region by region.
          </p>
          <button
            type="button"
            className="mob-cta"
            onClick={(event) => {
              event.stopPropagation();
              onStartFirstFour();
            }}
          >
            Let&apos;s go →
          </button>
        </div>
      ) : null}
    </div>
  );
}
