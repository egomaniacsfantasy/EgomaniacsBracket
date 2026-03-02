import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { type LeaderboardEntry, getLeaderboard } from "./bracketStorage";

export function Leaderboard() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const loadLeaderboard = async () => {
    setLoading(true);
    const { data } = await getLeaderboard(100);
    setEntries(data);
    setLoading(false);
  };

  useEffect(() => {
    loadLeaderboard();
  }, []);

  const displayEntries = showAll ? entries : entries.slice(0, 20);
  const tournamentStarted = entries.some((entry) => Number(entry.total_score ?? 0) > 0);

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <h3 className="leaderboard-title">LEADERBOARD</h3>
        <button className="leaderboard-refresh" onClick={loadLeaderboard} title="Refresh">
          ↻
        </button>
      </div>

      {!tournamentStarted ? (
        <div className="leaderboard-pre-tourney">
          <p>Tournament hasn&apos;t started yet. Save your bracket to secure your spot!</p>
          <p className="leaderboard-prize">🏆 $100 to the top bracket</p>
        </div>
      ) : null}

      {loading ? (
        <p className="leaderboard-loading">Loading leaderboard...</p>
      ) : entries.length === 0 ? (
        <p className="leaderboard-empty">No brackets saved yet. Be the first!</p>
      ) : (
        <>
          <div className="leaderboard-row leaderboard-row--header">
            <span className="lb-rank">#</span>
            <span className="lb-name">Player</span>
            <span className="lb-bracket">Bracket</span>
            <span className="lb-score">Score</span>
            <span className="lb-correct">Correct</span>
            {tournamentStarted ? <span className="lb-remaining">Max</span> : null}
          </div>

          {displayEntries.map((entry, index) => {
            const isCurrentUser = Boolean(user && entry.user_id === user.id);
            const rank = entry.rank ?? index + 1;
            return (
              <div key={entry.bracket_id ?? `${entry.user_id}-${entry.bracket_name}-${index}`} className={`leaderboard-row ${isCurrentUser ? "leaderboard-row--me" : ""}`}>
                <span className="lb-rank">{rank}</span>
                <span className="lb-name" title={entry.display_name}>
                  {entry.display_name}
                  {isCurrentUser ? <span className="lb-you-badge">YOU</span> : null}
                </span>
                <span className="lb-bracket" title={entry.bracket_name}>
                  {entry.bracket_name}
                </span>
                <span className="lb-score">{tournamentStarted ? entry.total_score : "—"}</span>
                <span className="lb-correct">
                  {tournamentStarted ? `${entry.correct_picks}/${entry.possible_picks ?? 63}` : "—"}
                </span>
                {tournamentStarted ? <span className="lb-remaining">{entry.max_remaining ?? "—"}</span> : null}
              </div>
            );
          })}

          {entries.length > 20 && !showAll ? (
            <button className="leaderboard-show-all" onClick={() => setShowAll(true)}>
              Show all {entries.length} brackets
            </button>
          ) : null}
        </>
      )}

      <div className="leaderboard-footer">
        <p>Scoring: 10 / 20 / 40 / 80 / 160 / 320 per round</p>
        <p>Max possible: 1920</p>
      </div>
    </div>
  );
}

