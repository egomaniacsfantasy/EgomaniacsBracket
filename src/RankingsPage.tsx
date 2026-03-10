import { useState, useEffect } from "react";
import { ExpandedRankings } from "./rankings/ExpandedRankings";
import "./index.css";

const LANDING_URL = "https://oddsgods.net";

export function RankingsPage() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return (
    <div className="eg-shell">
      <div className="bg-glow" aria-hidden="true" />
      <main className="eg-app">
        <nav className="og-top-nav" aria-label="Odds Gods tools">
          <div className="og-top-nav-desktop">
            <a className="og-top-nav-brand" href={LANDING_URL}>
              <img className="og-top-nav-logo" src="/logo-icon.png?v=20260225" alt="Odds Gods" />
              <span className="odds">ODDS</span> <span className="gods">GODS</span>
            </a>
            <div className="og-top-nav-tabs">
              <a className="og-top-nav-link" href="/">
                The Bracket Lab
              </a>
              <a
                className="og-top-nav-link"
                href={`${LANDING_URL}/blog`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Blog
              </a>
              <a className="og-top-nav-link og-top-nav-link--active" href="/rankings">
                Power Rankings
              </a>
            </div>
          </div>
          <div className="og-top-nav-mobile">
            <div className="nav-left">
              <a className="og-mobile-logo-link" href={LANDING_URL} aria-label="Odds Gods home">
                <img className="nav-logo-icon nav-logo" src="/logo-icon.png?v=20260225" alt="Odds Gods" />
              </a>
              <span className="nav-product-title nav-wordmark">ODDS GODS</span>
            </div>
            <div className="nav-right">
              <a className="og-top-nav-link" href="/">Bracket Lab</a>
              <a
                className="og-top-nav-link"
                href={`${LANDING_URL}/blog`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Blog
              </a>
              <a className="og-top-nav-link og-top-nav-link--active" href="/rankings">
                Rankings
              </a>
            </div>
          </div>
        </nav>

        <ExpandedRankings displayMode="implied" isMobile={isMobile} />

        <footer className="rankings-footer">
          <a className="footer-wordmark" href={LANDING_URL}>
            <span>ODDS</span> <strong>GODS</strong>
          </a>
          <p>&copy; 2026 Odds Gods</p>
          <div className="footer-links">
            <a href="/">Bracket Lab</a>
            <a href={`${LANDING_URL}/blog`}>Blog</a>
          </div>
        </footer>
      </main>
    </div>
  );
}
