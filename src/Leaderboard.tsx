import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { formatChaosScore, type LeaderboardEntry, getLeaderboard } from "./bracketStorage";

type SortBy = "score" | "chaos" | "correct";

export function LeaderboardFullWidth({
  isVisible = true,
  refreshKey = 0,
  onClose,
}: {
  isVisible?: boolean;
  refreshKey?: number;
  onClose?: () => void;
}) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("score");

  const loadLeaderboard = async () => {
    setLoading(true);
    const { data } = await getLeaderboard(200);
    setEntries(data);
    setLoading(false);
  };

  useEffect(() => {
    if (!isVisible) return;
    void loadLeaderboard();
  }, [isVisible, refreshKey]);

  const sortedEntries = [...entries].sort((a, b) => {
    if (sortBy === "chaos") return Number(b.chaos_score ?? 0) - Number(a.chaos_score ?? 0);
    if (sortBy === "correct") return Number(b.correct_picks ?? 0) - Number(a.correct_picks ?? 0);
    return Number(b.total_score ?? 0) - Number(a.total_score ?? 0);
  });
  const displayEntries = showAll ? sortedEntries : sortedEntries.slice(0, 50);
  const tournamentStarted = entries.some((entry) => Number(entry.total_score ?? 0) > 0);
  const totalBrackets = entries.length;

  return (
    <div className="leaderboard-full-wrapper">
      <div className="leaderboard-full">
      <div className="leaderboard-full-header">
        <div className="leaderboard-header-row">
          <div className="leaderboard-full-title-row">
          <h2 className="leaderboard-full-title">LEADERBOARD</h2>
          <span className="leaderboard-full-count">{totalBrackets} brackets competing</span>
          <button className="leaderboard-full-refresh" onClick={loadLeaderboard} title="Refresh">
            ↻
          </button>
        </div>
          {onClose ? (
            <button className="leaderboard-close-btn" onClick={onClose} aria-label="Close leaderboard">
              ✕
            </button>
          ) : null}
        </div>

        <div className="leaderboard-full-prize">🏆 $100 to the top bracket</div>

        {!tournamentStarted ? (
          <div className="leaderboard-full-pre">
            Tournament hasn&apos;t started yet. Brackets lock when the first game tips off.
          </div>
        ) : null}
      </div>

      <div className="leaderboard-full-sort">
        <span className="leaderboard-full-sort-label">Sort by:</span>
        <button className={`leaderboard-sort-btn ${sortBy === "score" ? "active" : ""}`} onClick={() => setSortBy("score")}>
          Score
        </button>
        <button className={`leaderboard-sort-btn ${sortBy === "chaos" ? "active" : ""}`} onClick={() => setSortBy("chaos")}>
          Chaos
        </button>
        <button className={`leaderboard-sort-btn ${sortBy === "correct" ? "active" : ""}`} onClick={() => setSortBy("correct")}>
          Correct Picks
        </button>
      </div>

      <div className="lb-full-row lb-full-row--header">
        <span className="lb-full-rank">#</span>
        <span className="lb-full-player">Player</span>
        <span className="lb-full-bracket">Bracket</span>
        <span className="lb-full-chaos">Chaos</span>
        <span className="lb-full-score">Score</span>
        <span className="lb-full-correct">Correct</span>
        <span className="lb-full-r64">R64</span>
        <span className="lb-full-r32">R32</span>
        <span className="lb-full-s16">S16</span>
        <span className="lb-full-e8">E8</span>
        <span className="lb-full-f4">F4</span>
        <span className="lb-full-champ">CHAMP</span>
        {tournamentStarted ? <span className="lb-full-max">Max</span> : null}
      </div>

      {loading ? (
        <div className="lb-full-loading">Loading leaderboard...</div>
      ) : displayEntries.length === 0 ? (
        <div className="lb-full-empty">No brackets saved yet. Be the first!</div>
      ) : (
        displayEntries.map((entry, index) => {
          const isCurrentUser = Boolean(user && entry.user_id === user.id);
          const rank = entry.rank ?? index + 1;
          return (
            <div key={entry.bracket_id ?? `${entry.user_id}-${entry.bracket_name}-${index}`} className={`lb-full-row ${isCurrentUser ? "lb-full-row--me" : ""}`}>
              <span className="lb-full-rank">{rank}</span>
              <span className="lb-full-player" title={entry.display_name}>
                {entry.display_name}
                {isCurrentUser ? <span className="lb-full-you">YOU</span> : null}
              </span>
              <span className="lb-full-bracket" title={entry.bracket_name}>
                {entry.bracket_name}
              </span>
              <span className="lb-full-chaos">{formatChaosScore(entry.chaos_score)}</span>
              <span className="lb-full-score">{tournamentStarted ? entry.total_score : "—"}</span>
              <span className="lb-full-correct">{tournamentStarted ? entry.correct_picks : "—"}</span>
              <span className="lb-full-r64">{tournamentStarted ? entry.r64_score ?? 0 : "—"}</span>
              <span className="lb-full-r32">{tournamentStarted ? entry.r32_score ?? 0 : "—"}</span>
              <span className="lb-full-s16">{tournamentStarted ? entry.s16_score ?? 0 : "—"}</span>
              <span className="lb-full-e8">{tournamentStarted ? entry.e8_score ?? 0 : "—"}</span>
              <span className="lb-full-f4">{tournamentStarted ? entry.f4_score ?? 0 : "—"}</span>
              <span className="lb-full-champ">{tournamentStarted ? entry.champ_score ?? 0 : "—"}</span>
              {tournamentStarted ? <span className="lb-full-max">{entry.max_remaining ?? "—"}</span> : null}
            </div>
          );
        })
      )}

      {entries.length > 50 && !showAll ? (
        <button className="lb-full-show-all" onClick={() => setShowAll(true)}>
          Show all {entries.length} brackets
        </button>
      ) : null}

      <div className="leaderboard-full-footer">
        Scoring: 10 / 20 / 40 / 80 / 160 / 320 per round · Max possible: 1920
      </div>
    </div>
    </div>
  );
}

// Backward export to avoid import churn in existing call sites.
export function Leaderboard() {
  return <LeaderboardFullWidth />;
}
