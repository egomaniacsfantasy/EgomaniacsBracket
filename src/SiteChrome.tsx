import type { ReactNode } from "react";

export const LANDING_URL = "https://oddsgods.net";
export const BLOG_URL = "https://blog.oddsgods.net";

type ToolKey = "bracket" | "rankings" | "predictor";

const TOOL_LINKS: Array<{ key: ToolKey; label: string; href: string }> = [
  { key: "bracket", label: "The Bracket Lab", href: "/" },
  { key: "rankings", label: "Power Rankings", href: "/rankings" },
  { key: "predictor", label: "Matchup Predictor", href: "/predictor" },
];

export function ToolNav({
  activeTool,
  showBeta = false,
  desktopAuthSlot,
  mobileAuthSlot,
}: {
  activeTool: ToolKey;
  showBeta?: boolean;
  desktopAuthSlot?: ReactNode;
  mobileAuthSlot?: ReactNode;
}) {
  return (
    <nav className="og-top-nav" aria-label="Odds Gods tools">
      <div className="og-top-nav-desktop">
        <a className="og-top-nav-brand" href={LANDING_URL}>
          <img className="og-top-nav-logo" src="/logo-icon.png?v=20260225" alt="Odds Gods" />
          <span className="odds">ODDS</span> <span className="gods">GODS</span>
          {showBeta ? <span className="beta-badge">BETA</span> : null}
        </a>
        <div className="og-top-nav-tabs">
          <div className={`og-top-nav-dropdown ${activeTool ? "active" : ""}`}>
            <button
              type="button"
              className={`og-top-nav-link og-top-nav-dropdown-trigger ${activeTool ? "active" : ""}`}
              aria-haspopup="menu"
            >
              College Basketball
              <span className="og-top-nav-caret" aria-hidden="true">
                ▾
              </span>
            </button>
            <div className="og-top-nav-dropdown-menu" role="menu" aria-label="College basketball tools">
              {TOOL_LINKS.map((link) => (
                <a
                  key={link.key}
                  className={`og-top-nav-dropdown-item ${activeTool === link.key ? "active" : ""}`}
                  href={link.href}
                  role="menuitem"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
          <a className="og-top-nav-link" href={BLOG_URL} target="_blank" rel="noopener noreferrer">
            Blog
          </a>
        </div>
        {desktopAuthSlot ? <div className="og-top-nav-auth">{desktopAuthSlot}</div> : null}
      </div>

      <div className="og-top-nav-mobile">
        <div className="nav-left">
          <a className="og-mobile-logo-link" href={LANDING_URL} aria-label="Odds Gods home">
            <img className="nav-logo-icon nav-logo" src="/logo-icon.png?v=20260225" alt="Odds Gods" />
          </a>
          <span className="nav-product-title nav-wordmark">ODDS GODS</span>
          {showBeta ? <span className="beta-badge nav-beta">BETA</span> : null}
        </div>
        <div className="nav-right nav-right--links">
          {TOOL_LINKS.map((link) => (
            <a
              key={link.key}
              className={`og-top-nav-link ${activeTool === link.key ? "active" : ""}`}
              href={link.href}
            >
              {link.key === "bracket" ? "Lab" : link.key === "rankings" ? "Ranks" : "Predictor"}
            </a>
          ))}
          <a className="og-top-nav-link" href={BLOG_URL} target="_blank" rel="noopener noreferrer">
            Blog
          </a>
          {mobileAuthSlot}
        </div>
      </div>
    </nav>
  );
}

export function StandaloneFooter() {
  return (
    <footer className="tool-page-footer">
      <a className="footer-wordmark" href={LANDING_URL}>
        <span>ODDS</span> <strong>GODS</strong>
      </a>
      <p>&copy; 2026 Odds Gods · For entertainment purposes only.</p>
      <div className="footer-links">
        {TOOL_LINKS.map((link) => (
          <a key={link.key} href={link.href}>
            {link.label}
          </a>
        ))}
        <a href={BLOG_URL} target="_blank" rel="noopener noreferrer">
          Blog
        </a>
      </div>
    </footer>
  );
}
