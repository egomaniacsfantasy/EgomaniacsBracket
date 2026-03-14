import { MatchupPredictor } from "./MatchupPredictor";
import { TopNavBar } from "./TopNavBar";
import "./index.css";

export function PredictorPage() {
  return (
    <div className="predictor-standalone-shell">
      <main className="predictor-standalone-main">
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
        <div className="predictor-standalone-body tool-page-body">
          <MatchupPredictor displayMode="implied" />
        </div>
      </main>
    </div>
  );
}
