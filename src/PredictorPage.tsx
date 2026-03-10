import { useEffect, useState } from "react";
import { MatchupPredictor } from "./MatchupPredictor";
import { StandaloneFooter, ToolNav } from "./SiteChrome";
import "./index.css";

export function PredictorPage() {
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
        <ToolNav activeTool="predictor" />
        <div className="tool-page-body">
          <section className={`tool-page-header ${isMobile ? "tool-page-header--mobile" : ""}`}>
            <p className="tool-page-kicker">College Basketball</p>
            <h1>Matchup Predictor</h1>
            <p className="tool-page-subtitle">
              Select any two D1 teams to simulate a head-to-head matchup.
            </p>
          </section>
          <MatchupPredictor displayMode="implied" />
        </div>
        <StandaloneFooter />
      </main>
    </div>
  );
}
