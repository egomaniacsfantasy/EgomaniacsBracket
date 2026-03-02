import { useEffect, useMemo, useState } from "react";
import { gameTemplates } from "./data/bracket";
import { teamsById } from "./data/teams";
import { supabase } from "./supabaseClient";

const ADMIN_PASSWORD = "oddsgods2026";
const POINTS: Record<number, number> = { 64: 10, 32: 20, 16: 40, 8: 80, 4: 160, 2: 320 };
const ROUND_TO_INT: Record<string, number> = { R64: 64, R32: 32, S16: 16, E8: 8, F4: 4, CHAMP: 2 };

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
  teamA: { id: string; name: string; seed: number } | null;
  teamB: { id: string; name: string; seed: number } | null;
};

export function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [resultsRefresh, setResultsRefresh] = useState(0);
  const [scoringStatus, setScoringStatus] = useState("");
  const [lockStatus, setLockStatus] = useState("");

  if (!authenticated) {
    return (
      <div style={{ padding: 40, maxWidth: 400, margin: "0 auto", fontFamily: "monospace", color: "#f0e6d0" }}>
        <h2 style={{ color: "#b87d18" }}>BracketLab Admin</h2>
        <input
          type="password"
          placeholder="Admin password"
          value={passwordInput}
          onChange={(event) => setPasswordInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && passwordInput === ADMIN_PASSWORD) setAuthenticated(true);
          }}
          style={{ padding: 10, width: "100%", fontSize: 16, background: "#1a1510", color: "#fff", border: "1px solid #333", borderRadius: 6 }}
        />
        <button
          onClick={() => passwordInput === ADMIN_PASSWORD && setAuthenticated(true)}
          style={{ marginTop: 10, padding: "10px 20px", background: "#b87d18", color: "#000", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: "bold" }}
        >
          Enter
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 40, maxWidth: 1000, margin: "0 auto", fontFamily: "monospace", color: "#f0e6d0" }}>
      <h2 style={{ color: "#b87d18" }}>BracketLab Admin</h2>
      <AdminResultsEntry onResultsChange={() => setResultsRefresh((v) => v + 1)} />
      <AdminScoringControls scoringStatus={scoringStatus} setScoringStatus={setScoringStatus} />
      <AdminLockControls lockStatus={lockStatus} setLockStatus={setLockStatus} />
      <AdminResultsLog refreshKey={resultsRefresh} />
      <AdminLeaderboardPreview refreshKey={resultsRefresh} />
    </div>
  );
}

function AdminResultsEntry({ onResultsChange }: { onResultsChange?: () => void }) {
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
      } else if (template.sourceGameIds) {
        teamAId = winnerByGame[template.sourceGameIds[0]] ?? null;
        teamBId = winnerByGame[template.sourceGameIds[1]] ?? null;
      }

      const teamA = teamAId ? teamsById.get(teamAId) ?? null : null;
      const teamB = teamBId ? teamsById.get(teamBId) ?? null : null;
      output.push({
        id: template.id,
        round: ROUND_TO_INT[template.round],
        region: template.region ?? "Finals",
        teamA: teamA ? { id: teamA.id, name: teamA.name, seed: teamA.seed } : null,
        teamB: teamB ? { id: teamB.id, name: teamB.name, seed: teamB.seed } : null,
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
      onResultsChange?.();
    }
    setSubmitting(null);
  };

  const removeResult = async (matchupId: string) => {
    if (!window.confirm(`Remove result for ${matchupId}?`)) return;
    await supabase.from("tournament_results").delete().eq("matchup_id", matchupId);
    const next = { ...existingResults };
    delete next[matchupId];
    setExistingResults(next);
    buildMatchups(next);
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
    try {
      const { data: results } = await supabase.from("tournament_results").select("*");
      if (!results || results.length === 0) {
        setScoringStatus("No results entered yet.");
        return;
      }
      const resultMap: Record<string, { winner: string; round: number }> = {};
      (results as ResultRow[]).forEach((result) => {
        resultMap[result.matchup_id] = { winner: result.winner_team_id, round: Number(result.round) };
      });

      const { data: brackets } = await supabase.from("brackets").select("id, user_id, picks");
      if (!brackets || brackets.length === 0) {
        setScoringStatus("No brackets to score.");
        return;
      }

      const gamesPerRound: Record<number, number> = { 64: 32, 32: 16, 16: 8, 8: 4, 4: 2, 2: 1 };
      const gamesPlayed = results.length;

      const scoreUpdates = (brackets as Array<{ id: string; user_id: string; picks: Record<string, string> }>).map((bracket) => {
        let totalScore = 0;
        let correctPicks = 0;
        const roundScores: Record<number, number> = { 64: 0, 32: 0, 16: 0, 8: 0, 4: 0, 2: 0 };
        const picks = bracket.picks ?? {};

        for (const [matchupId, pickedWinner] of Object.entries(picks)) {
          const result = resultMap[matchupId];
          if (!result) continue;
          if (pickedWinner === result.winner) {
            const points = POINTS[result.round] ?? 0;
            totalScore += points;
            roundScores[result.round] = (roundScores[result.round] ?? 0) + points;
            correctPicks += 1;
          }
        }

        let maxRemaining = 0;
        for (const [roundStr, totalInRound] of Object.entries(gamesPerRound)) {
          const round = Number(roundStr);
          const playedInRound = (results as ResultRow[]).filter((result) => Number(result.round) === round).length;
          const remainingInRound = totalInRound - playedInRound;
          maxRemaining += Math.max(0, remainingInRound) * (POINTS[round] ?? 0);
        }

        return {
          bracket_id: bracket.id,
          user_id: bracket.user_id,
          total_score: totalScore,
          r64_score: roundScores[64] ?? 0,
          r32_score: roundScores[32] ?? 0,
          s16_score: roundScores[16] ?? 0,
          e8_score: roundScores[8] ?? 0,
          f4_score: roundScores[4] ?? 0,
          champ_score: roundScores[2] ?? 0,
          correct_picks: correctPicks,
          possible_picks: gamesPlayed,
          max_remaining: totalScore + maxRemaining,
          updated_at: new Date().toISOString(),
        };
      });

      const { error: upsertError } = await supabase.from("bracket_scores").upsert(scoreUpdates);
      if (upsertError) {
        setScoringStatus(`Error: ${upsertError.message}`);
        return;
      }

      const { error: rankError } = await supabase.rpc("compute_bracket_ranks");
      if (rankError) {
        setScoringStatus(`Scores saved but rank computation failed: ${rankError.message}`);
        return;
      }

      setScoringStatus(`✓ Scored ${brackets.length} brackets. ${results.length}/63 games entered.`);
    } catch (error) {
      setScoringStatus(`Error: ${(error as Error).message}`);
    }
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
        <p style={{ marginTop: 8, fontSize: 12, color: scoringStatus.startsWith("✓") ? "#b87d18" : "#e85d5d" }}>
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
      <h3 style={{ color: "#b87d18" }}>Results Entered ({results.length}/63)</h3>
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
