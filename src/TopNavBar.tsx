import { useEffect, useRef, useState } from "react";

const LANDING_URL = "https://oddsgods.net";

export type TopNavView = "bracket" | "leaderboard" | "groups" | "rankings" | "predictor";

type TopNavBarProps = {
  activeView: TopNavView;
  authLoading?: boolean;
  isAuthenticated: boolean;
  onSelectBracket: () => void;
  onSelectLeaderboard: () => void;
  onSelectGroups?: () => void;
  onSelectRankings: () => void;
  onSelectPredictor: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  showBeta?: boolean;
  userLabel?: string | null;
};

type NavAction = {
  id: TopNavView;
  label: string;
  onSelect: () => void;
};

export function TopNavBar({
  activeView,
  authLoading = false,
  isAuthenticated,
  onSelectBracket,
  onSelectLeaderboard,
  onSelectGroups,
  onSelectRankings,
  onSelectPredictor,
  onSignIn,
  onSignOut,
  showBeta = false,
  userLabel,
}: TopNavBarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);

  const navActions: NavAction[] = [
    { id: "bracket", label: "Bracket", onSelect: onSelectBracket },
    { id: "leaderboard", label: "Leaderboard", onSelect: onSelectLeaderboard },
    ...(onSelectGroups ? [{ id: "groups" as const, label: "Groups", onSelect: onSelectGroups }] : []),
    { id: "rankings", label: "Rankings", onSelect: onSelectRankings },
    { id: "predictor", label: "Predictor", onSelect: onSelectPredictor },
  ];

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (mobileMenuRef.current?.contains(event.target as Node)) return;
      setMobileMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [activeView, authLoading, isAuthenticated, userLabel]);

  const handleMobileSelect = (action: () => void) => {
    action();
    setMobileMenuOpen(false);
  };

  return (
    <nav className="top-nav-bar" aria-label="Bracket navigation">
      <div className="top-nav-bar__brand-wrap">
        <a className="top-nav-bar__brand" href={LANDING_URL} aria-label="Odds Gods home">
          <img className="top-nav-bar__logo" src="/logo-icon.png?v=20260225" alt="Odds Gods" />
          <span className="top-nav-bar__wordmark">Odds Gods</span>
          {showBeta ? <span className="beta-badge">BETA</span> : null}
        </a>
      </div>

      <div className="top-nav-bar__links" role="presentation">
        {navActions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`top-nav-bar__link ${activeView === action.id ? "is-active" : ""}`}
            onClick={action.onSelect}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className="top-nav-bar__actions">
        <div className="top-nav-bar__desktop-auth">
          {authLoading ? (
            <span className="top-nav-bar__status">...</span>
          ) : isAuthenticated ? (
            <>
              {userLabel ? <span className="top-nav-bar__user">{userLabel}</span> : null}
              <button type="button" className="top-nav-bar__link" onClick={onSignOut}>
                Sign Out
              </button>
            </>
          ) : (
            <button type="button" className="top-nav-bar__link" onClick={onSignIn}>
              Sign In
            </button>
          )}
        </div>

        <div className="top-nav-bar__mobile" ref={mobileMenuRef}>
          <button
            type="button"
            className="top-nav-bar__menu-btn"
            aria-expanded={mobileMenuOpen}
            aria-label="Open navigation menu"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
          >
            ☰
          </button>
          {mobileMenuOpen ? (
            <div className="top-nav-bar__mobile-menu" role="menu" aria-label="Bracket navigation menu">
              {navActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={`top-nav-bar__mobile-link ${activeView === action.id ? "is-active" : ""}`}
                  onClick={() => handleMobileSelect(action.onSelect)}
                >
                  {action.label}
                </button>
              ))}
              <div className="top-nav-bar__mobile-divider" />
              {authLoading ? (
                <span className="top-nav-bar__mobile-status">Loading...</span>
              ) : isAuthenticated ? (
                <>
                  {userLabel ? <span className="top-nav-bar__mobile-user">{userLabel}</span> : null}
                  <button
                    type="button"
                    className="top-nav-bar__mobile-link"
                    onClick={() => handleMobileSelect(onSignOut)}
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="top-nav-bar__mobile-link"
                  onClick={() => handleMobileSelect(onSignIn)}
                >
                  Sign In
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
