import { useEffect, useState } from "react";
import { ExpandedRankings } from "./rankings/ExpandedRankings";
import { StandaloneFooter } from "./SiteChrome";
import { TopNavBar } from "./TopNavBar";
import "./index.css";

export function RankingsPage() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const handleChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  return (
    <div className="eg-shell">
      <div className="bg-glow" aria-hidden="true" />
      <div className="bg-shape bg-top" aria-hidden="true" />
      <div className="bg-shape bg-bottom" aria-hidden="true" />
      <main className="eg-app eg-page-shell">
        <TopNavBar
          activeView="rankings"
          authLoading={false}
          isAuthenticated={false}
          showBeta
          onSelectBracket={() => window.location.assign("/")}
          onSelectLeaderboard={() => window.location.assign("/")}
          onSelectConferences={() => window.location.assign("/")}
          onSelectRankings={() => window.location.assign("/rankings")}
          onSelectPredictor={() => window.location.assign("/predictor")}
          onSignIn={() => window.location.assign("/")}
          onSignOut={() => {}}
        />
        <div className="tool-page-body">
          <ExpandedRankings displayMode="implied" isMobile={isMobile} />
        </div>
        <StandaloneFooter />
      </main>
    </div>
  );
}
