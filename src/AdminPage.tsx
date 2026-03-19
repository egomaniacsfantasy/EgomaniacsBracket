import { useEffect, useMemo, useState } from "react";
import { gameTemplates } from "./data/bracket";
import { teamsById } from "./data/teams";
import { supabase } from "./supabaseClient";
import { useAuth } from "./AuthContext";
import { hasElevatedAccess } from "./groupVisibility";
import { buildScoringResultMap, scoreBracketPicks } from "./lib/bracketScoring";
import { NCAA_KNOWN_SCORING_RESULTS } from "./data/ncaaKnownResults";

const ROUND_TO_INT: Record<string, number> = { R64: 64, R32: 32, S16: 16, E8: 8, F4: 4, CHAMP: 2 };
const TOTAL_GAMES = gameTemplates.length;

type ResultRow = {
  matchup_id: string;
  winner_team_id: string;
  round: number;
  completed_at: string;
};

type MatchupRow = {
  id: string;
  round: number;
  region: string;
  teamA: { id: string; name: string; seed: string } | null;
  teamB: { id: string; name: string; seed: string } | null;
};

type BracketScoreRow = {
  id: string;
  user_id: string;
  picks: Record<string, string> | null;
};

type ScoreAllBracketsResult =
  | {
      ok: true;
      bracketCount: number;
      scoredResultCount: number;
    }
  | {
      ok: false;
      error: string;
    };

async function scoreAndRankAllBrackets(): Promise<ScoreAllBracketsResult> {
  const { data: results, error: resultsError } = await supabase.from("tournament_results").select("*");
  if (resultsError) {
    return { ok: false, error: resultsError.message };
  }

  const resultMap = buildScoringResultMap([...(((results as ResultRow[] | null) ?? [])), ...NCAA_KNOWN_SCORING_RESULTS]);
  const scoredResultCount = Object.keys(resultMap).length;

  const { data: brackets, error: bracketsError } = await supabase.from("brackets").select("id, user_id, picks");
  if (bracketsError) {
    return { ok: false, error: bracketsError.message };
  }

  const typedBrackets = (brackets as BracketScoreRow[] | null) ?? [];
  if (typedBrackets.length === 0) {
    return { ok: true, bracketCount: 0, scoredResultCount };
  }

  const updatedAt = new Date().toISOString();
  const scoreUpdates = typedBrackets.map((bracket) => {
    const score = scoreBracketPicks(bracket.picks ?? {}, resultMap);
    return {
      bracket_id: bracket.id,
      user_id: bracket.user_id,
      total_score: score.totalScore,
      r64_score: score.roundScores[64],
      r32_score: score.roundScores[32],
      s16_score: score.roundScores[16],
      e8_score: score.roundScores[8],
      f4_score: score.roundScores[4],
      champ_score: score.roundScores[2],
      correct_picks: score.correctPicks,
      possible_picks: score.possiblePicks,
      max_remaining: score.maxRemaining,
      updated_at: updatedAt,
    };
  });

  const { error: upsertError } = await supabase.from("bracket_scores").upsert(scoreUpdates);
  if (upsertError) {
    return { ok: false, error: upsertError.message };
  }

  const { error: rankError } = await supabase.rpc("compute_bracket_ranks");
  if (rankError) {
    return { ok: false, error: `Scores saved but rank computation failed: ${rankError.message}` };
  }

  return {
    ok: true,
    bracketCount: typedBrackets.length,
    scoredResultCount,
  };
}

export function AdminPage() {
  const { user, loading } = useAuth();
  const [resultsRefresh, setResultsRefresh] = useState(0);
  const [scoringStatus, setScoringStatus] = useState("");
  const [lockStatus, setLockStatus] = useState("");

  if (loading) {
    return (
      <div style={{ padding: 40, maxWidth: 400, margin: "0 auto", fontFamily: "monospace", color: "#f0e6d0" }}>
        <h2 style={{ color: "#b87d18" }}>Bracket Lab Admin</h2>
        <p style={{ color: "#888" }}>Loading...</p>
      </div>
    );
  }

  if (!hasElevatedAccess(user?.email)) {
    return (
      <div style={{ padding: 40, maxWidth: 400, margin: "0 auto", fontFamily: "monospace", color: "#f0e6d0" }}>
        <h2 style={{ color: "#b87d18" }}>Bracket Lab Admin</h2>
        <p style={{ color: "#888" }}>Not authorized.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 40, maxWidth: 1000, margin: "0 auto", fontFamily: "monospace", color: "#f0e6d0" }}>
      <h2 style={{ color: "#b87d18" }}>Bracket Lab Admin</h2>
      <AdminResultsEntry onResultsChange={() => setResultsRefresh((v) => v + 1)} setScoringStatus={setScoringStatus} />
      <AdminScoringControls scoringStatus={scoringStatus} setScoringStatus={setScoringStatus} />
      <AdminLockControls lockStatus={lockStatus} setLockStatus={setLockStatus} />
      <AdminResultsLog refreshKey={resultsRefresh} />
      <AdminLeaderboardPreview refreshKey={resultsRefresh} />
    </div>
  );
}

function AdminResultsEntry({
  onResultsChange,
  setScoringStatus,
}: {
  onResultsChange?: () => void;
  setScoringStatus: (status: string) => void;
}) {
  const [allMatchups, setAllMatchups] = useState<MatchupRow[]>([]);
  const [existingResults, setExistingResults] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [filterRound, setFilterRound] = useState(64);

  const rounds = [64, 32, 16, 8, 4, 2];

  const buildMatchups = (resultsMap: Record<string, string>) => {
    const winnerByGame: Record<string, string | null> = {};
    const ordered = [...gameTemplates].sort((a, b) => {
      const rankA = ROUND_TO_INT[a.round];
      const rankB = ROUND_TO_INT[b.round];
      if (rankA !== rankB) return rankB - rankA;
      return a.slot - b.slot;
    });
    const output: MatchupRow[] = [];

    for (const template of ordered) {
      let teamAId: string | null = null;
      let teamBId: string | null = null;
      if (template.initialTeamIds) {
        [teamAId, teamBId] = template.initialTeamIds;
      }
      if (!teamAId && template.sourceGameIds?.[0]) {
        teamAId = winnerByGame[template.sourceGameIds[0]] ?? null;
      }
      if (!teamBId && template.sourceGameIds?.[1]) {
        teamBId = winnerByGame[template.sourceGameIds[1]] ?? null;
      }

      const teamA = teamAId ? teamsById.get(teamAId) ?? null : null;
      const teamB = teamBId ? teamsById.get(teamBId) ?? null : null;
      output.push({
        id: template.id,
        round: ROUND_TO_INT[template.round],
        region: template.region ?? "Finals",
        teamA: teamA ? { id: teamA.id, name: teamA.name, seed: teamA.seedLabel ?? String(teamA.seed) } : null,
        teamB: teamB ? { id: teamB.id, name: teamB.name, seed: teamB.seedLabel ?? String(teamB.seed) } : null,
      });

      winnerByGame[template.id] = resultsMap[template.id] ?? null;
    }
    setAllMatchups(output);
  };

  const loadExistingResults = async () => {
    const { data } = await supabase.from("tournament_results").select("*");
    const map: Record<string, string> = {};
    (data as ResultRow[] | null)?.forEach((row) => {
      map[row.matchup_id] = row.winner_team_id;
    });
    setExistingResults(map);
    buildMatchups(map);
  };

  useEffect(() => {
    void loadExistingResults();
  }, []);

  const filteredMatchups = useMemo(
    () => allMatchups.filter((matchup) => matchup.round === filterRound),
    [allMatchups, filterRound]
  );

  const submitResult = async (matchupId: string, winnerTeamId: string, round: number) => {
    setSubmitting(matchupId);
    const { error } = await supabase.from("tournament_results").upsert({
      matchup_id: matchupId,
      winner_team_id: winnerTeamId,
      round,
      completed_at: new Date().toISOString(),
    });
    if (error) {
      alert(`Error: ${error.message}`);
    } else {
      const next = { ...existingResults, [matchupId]: winnerTeamId };
      setExistingResults(next);
      buildMatchups(next);
      setScoringStatus("Scoring leaderboard...");
      const scoringResult = await scoreAndRankAllBrackets();
      if (!scoringResult.ok) {
        setScoringStatus(`Result saved, but scoring failed: ${scoringResult.error}`);
      } else if (scoringResult.bracketCount === 0) {
        setScoringStatus(`Result saved. No brackets to score yet. ${scoringResult.scoredResultCount}/${TOTAL_GAMES} games entered.`);
      } else {
        setScoringStatus(`Auto-scored ${scoringResult.bracketCount} brackets. ${scoringResult.scoredResultCount}/${TOTAL_GAMES} games entered.`);
      }
      onResultsChange?.();
    }
    setSubmitting(null);
  };

  const removeResult = async (matchupId: string) => {
    if (!window.confirm(`Remove result for ${matchupId}?`)) return;
    const { error } = await supabase.from("tournament_results").delete().eq("matchup_id", matchupId);
    if (error) {
      alert(`Error: ${error.message}`);
      return;
    }
    const next = { ...existingResults };
    delete next[matchupId];
    setExistingResults(next);
    buildMatchups(next);
    setScoringStatus("Scoring leaderboard...");
    const scoringResult = await scoreAndRankAllBrackets();
    if (!scoringResult.ok) {
      setScoringStatus(`Result removed, but scoring failed: ${scoringResult.error}`);
    } else if (scoringResult.bracketCount === 0) {
      setScoringStatus(`Result removed. No brackets to score yet. ${scoringResult.scoredResultCount}/${TOTAL_GAMES} games entered.`);
    } else {
      setScoringStatus(`Auto-scored ${scoringResult.bracketCount} brackets. ${scoringResult.scoredResultCount}/${TOTAL_GAMES} games entered.`);
    }
    onResultsChange?.();
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ color: "#b87d18" }}>Enter Game Results</h3>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {rounds.map((round) => (
          <button
            key={round}
            onClick={() => setFilterRound(round)}
            style={{
              padding: "6px 14px",
              background: filterRound === round ? "#b87d18" : "rgba(255,255,255,0.06)",
              color: filterRound === round ? "#000" : "#f0e6d0",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              fontFamily: "monospace",
              fontWeight: filterRound === round ? "bold" : "normal",
            }}
          >
            {round === 2 ? "CHAMP" : round === 4 ? "F4" : round === 8 ? "E8" : round === 16 ? "S16" : round === 32 ? "R32" : "R64"}
          </button>
        ))}
      </div>

      {filteredMatchups.map((matchup) => {
        const existingWinner = existingResults[matchup.id];
        const canEnter = Boolean(matchup.teamA && matchup.teamB);
        return (
          <div
            key={matchup.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 12px",
              marginBottom: 4,
              background: existingWinner ? "rgba(184,125,24,0.06)" : "rgba(255,255,255,0.02)",
              borderRadius: 6,
              border: `1px solid ${existingWinner ? "rgba(184,125,24,0.20)" : "rgba(255,255,255,0.06)"}`,
            }}
          >
            <span style={{ fontSize: 10, color: "#666", width: 100, flexShrink: 0 }}>{matchup.id}</span>
            <button
              onClick={() => matchup.teamA && submitResult(matchup.id, matchup.teamA.id, matchup.round)}
              disabled={submitting === matchup.id || !canEnter || !matchup.teamA}
              style={{
                flex: 1,
                padding: "8px 12px",
                background: existingWinner === matchup.teamA?.id ? "rgba(184,125,24,0.25)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${existingWinner === matchup.teamA?.id ? "rgba(184,125,24,0.50)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 4,
                color: existingWinner === matchup.teamA?.id ? "#b87d18" : "#f0e6d0",
                fontFamily: "monospace",
                fontSize: 12,
                cursor: canEnter ? "pointer" : "default",
                textAlign: "left",
                opacity: canEnter ? 1 : 0.5,
              }}
            >
              {existingWinner === matchup.teamA?.id ? "✓ " : ""}
              {matchup.teamA ? `${matchup.teamA.seed} ${matchup.teamA.name}` : "TBD"}
            </button>
            <span style={{ color: "#666", fontSize: 11 }}>vs</span>
            <button
              onClick={() => matchup.teamB && submitResult(matchup.id, matchup.teamB.id, matchup.round)}
              disabled={submitting === matchup.id || !canEnter || !matchup.teamB}
              style={{
                flex: 1,
                padding: "8px 12px",
                background: existingWinner === matchup.teamB?.id ? "rgba(184,125,24,0.25)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${existingWinner === matchup.teamB?.id ? "rgba(184,125,24,0.50)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 4,
                color: existingWinner === matchup.teamB?.id ? "#b87d18" : "#f0e6d0",
                fontFamily: "monospace",
                fontSize: 12,
                cursor: canEnter ? "pointer" : "default",
                textAlign: "left",
                opacity: canEnter ? 1 : 0.5,
              }}
            >
              {existingWinner === matchup.teamB?.id ? "✓ " : ""}
              {matchup.teamB ? `${matchup.teamB.seed} ${matchup.teamB.name}` : "TBD"}
            </button>
            {existingWinner ? (
              <button
                onClick={() => removeResult(matchup.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#e85d5d",
                  cursor: "pointer",
                  fontSize: 11,
                  fontFamily: "monospace",
                }}
              >
                undo
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function AdminScoringControls({
  scoringStatus,
  setScoringStatus,
}: {
  scoringStatus: string;
  setScoringStatus: (status: string) => void;
}) {
  const scoreAllBrackets = async () => {
    setScoringStatus("Scoring...");
    const result = await scoreAndRankAllBrackets();
    if (!result.ok) {
      setScoringStatus(`Error: ${result.error}`);
      return;
    }

    if (result.bracketCount === 0) {
      setScoringStatus(`No brackets to score. ${result.scoredResultCount}/${TOTAL_GAMES} games entered.`);
      return;
    }

    setScoringStatus(`Scored ${result.bracketCount} brackets. ${result.scoredResultCount}/${TOTAL_GAMES} games entered.`);
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ color: "#b87d18" }}>Score Brackets</h3>
      <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
        After entering game results above, click this to recalculate all bracket scores and update the leaderboard.
      </p>
      <button
        onClick={scoreAllBrackets}
        style={{
          padding: "12px 24px",
          background: "#b87d18",
          color: "#000",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          fontFamily: "monospace",
          fontWeight: "bold",
          fontSize: 14,
        }}
      >
        Score All Brackets & Update Leaderboard
      </button>
      {scoringStatus ? (
        <p style={{ marginTop: 8, fontSize: 12, color: scoringStatus.startsWith("Error") ? "#e85d5d" : "#b87d18" }}>
          {scoringStatus}
        </p>
      ) : null}
    </div>
  );
}

function AdminLockControls({
  lockStatus,
  setLockStatus,
}: {
  lockStatus: string;
  setLockStatus: (status: string) => void;
}) {
  const lockAllBrackets = async () => {
    if (!window.confirm("Lock ALL brackets? Users will no longer be able to edit. This cannot be undone.")) return;
    setLockStatus("Locking...");
    const { error } = await supabase.rpc("lock_all_brackets");
    if (error) {
      setLockStatus(`Error: ${error.message}`);
    } else {
      setLockStatus("✓ All brackets locked.");
    }
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ color: "#b87d18" }}>Lock Brackets</h3>
      <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
        Lock all brackets when the tournament starts. This prevents any further edits.
      </p>
      <button
        onClick={lockAllBrackets}
        style={{
          padding: "12px 24px",
          background: "#e85d5d",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          fontFamily: "monospace",
          fontWeight: "bold",
          fontSize: 14,
        }}
      >
        🔒 Lock All Brackets
      </button>
      {lockStatus ? (
        <p style={{ marginTop: 8, fontSize: 12, color: lockStatus.startsWith("✓") ? "#b87d18" : "#e85d5d" }}>
          {lockStatus}
        </p>
      ) : null}
    </div>
  );
}

function AdminResultsLog({ refreshKey }: { refreshKey: number }) {
  const [results, setResults] = useState<ResultRow[]>([]);

  useEffect(() => {
    supabase
      .from("tournament_results")
      .select("*")
      .order("completed_at", { ascending: false })
      .then(({ data }) => setResults((data as ResultRow[] | null) ?? []));
  }, [refreshKey]);

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ color: "#b87d18" }}>Results Entered ({results.length}/{TOTAL_GAMES})</h3>
      <div style={{ maxHeight: 220, overflowY: "auto", fontSize: 11, color: "#888" }}>
        {results.map((result) => (
          <div key={result.matchup_id} style={{ padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {result.matchup_id} → <span style={{ color: "#b87d18" }}>{result.winner_team_id}</span>
            <span style={{ marginLeft: 8, color: "#555" }}>{new Date(result.completed_at).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminLeaderboardPreview({ refreshKey }: { refreshKey: number }) {
  const [entries, setEntries] = useState<Array<{ bracket_id: string; rank?: number; display_name: string; total_score: number; correct_picks: number }>>([]);

  useEffect(() => {
    supabase
      .from("leaderboard")
      .select("*")
      .limit(10)
      .then(({ data }) => setEntries((data as typeof entries | null) ?? []));
  }, [refreshKey]);

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ color: "#b87d18" }}>Leaderboard Preview (Top 10)</h3>
      <div style={{ fontSize: 11, color: "#ccc" }}>
        {entries.map((entry, index) => (
          <div key={entry.bracket_id} style={{ padding: "4px 0", display: "flex", gap: 12 }}>
            <span style={{ width: 24 }}>#{entry.rank ?? index + 1}</span>
            <span style={{ flex: 1 }}>{entry.display_name}</span>
            <span style={{ color: "#b87d18", fontWeight: "bold" }}>{entry.total_score ?? 0}</span>
            <span style={{ color: "#888" }}>{entry.correct_picks ?? 0} correct</span>
          </div>
        ))}
      </div>
    </div>
  );
}
