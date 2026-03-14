import { MatchupPredictor } from "./MatchupPredictor";
import { TopNavBar } from "./TopNavBar";
import "./index.css";

export function PredictorPage() {
  return (
    <div className="eg-shell">
      <div className="bg-glow" aria-hidden="true" />
      <div className="bg-shape bg-top" aria-hidden="true" />
      <div className="bg-shape bg-bottom" aria-hidden="true" />
      <main className="eg-app eg-page-shell">
        <TopNavBar
          activeView="predictor"
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
          <MatchupPredictor displayMode="implied" />
        </div>
      </main>
    </div>
  );
}
