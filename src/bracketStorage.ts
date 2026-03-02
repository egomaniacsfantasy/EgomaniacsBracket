import { supabase } from "./supabaseClient";
import { getModelGameWinProb, resolveGames, type LockedPicks } from "./lib/bracket";

export type SavedBracket = {
  id: string;
  user_id: string;
  bracket_name: string;
  picks: LockedPicks;
  chaos_score?: number | null;
  created_at: string;
  updated_at: string;
  is_locked: boolean;
};

export type LeaderboardEntry = {
  rank?: number | null;
  user_id: string;
  bracket_id: string;
  bracket_name: string;
  display_name: string;
  chaos_score?: number | null;
  total_score: number;
  correct_picks: number;
  possible_picks?: number | null;
  max_remaining?: number | null;
  r64_score?: number | null;
  r32_score?: number | null;
  s16_score?: number | null;
  e8_score?: number | null;
  f4_score?: number | null;
  champ_score?: number | null;
};

export function serializePicks(picks: LockedPicks | Map<string, string> | Array<{ id: string; winner?: string | null }>): LockedPicks {
  if (picks instanceof Map) return Object.fromEntries(picks);
  if (Array.isArray(picks)) {
    return picks.reduce<LockedPicks>((acc, matchup) => {
      if (matchup.winner) acc[matchup.id] = matchup.winner;
      return acc;
    }, {});
  }
  return picks ?? {};
}

export function deserializePicks(storedPicks: unknown): LockedPicks {
  if (!storedPicks || typeof storedPicks !== "object") return {};
  const obj = storedPicks as Record<string, unknown>;
  const out: LockedPicks = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
}

export async function saveBracket(
  userId: string,
  picks: LockedPicks,
  bracketName = "My Bracket",
  bracketId: string | null = null,
  chaosScore?: number | null
) {
  const serialized = serializePicks(picks);
  const derivedChaosScore = typeof chaosScore === "number" ? chaosScore : computeChaosScoreForPicks(serialized);
  const normalizedChaosScore = Math.round(derivedChaosScore * 10) / 10;
  const isMissingChaosColumn = (message?: string) => {
    const msg = (message ?? "").toLowerCase();
    return msg.includes("chaos_score") && (msg.includes("column") || msg.includes("schema cache"));
  };
  const isChaosTypeMismatch = (message?: string) => {
    const msg = (message ?? "").toLowerCase();
    return (
      msg.includes("invalid input syntax for type integer") ||
      msg.includes("out of range for type integer") ||
      (msg.includes("chaos_score") && msg.includes("integer"))
    );
  };
  const roundedChaosScore = Math.round(normalizedChaosScore);

  if (bracketId) {
    const withChaos = await supabase
      .from("brackets")
      .update({
        picks: serialized,
        bracket_name: bracketName,
        chaos_score: normalizedChaosScore,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bracketId)
      .eq("user_id", userId)
      .select()
      .single();
    if (!withChaos.error) {
      return { data: withChaos.data as SavedBracket | null, error: withChaos.error };
    }

    if (isChaosTypeMismatch(withChaos.error.message)) {
      const withRoundedChaos = await supabase
        .from("brackets")
      .update({
        picks: serialized,
        bracket_name: bracketName,
        chaos_score: roundedChaosScore,
          updated_at: new Date().toISOString(),
        })
        .eq("id", bracketId)
        .eq("user_id", userId)
        .select()
        .single();
      if (!withRoundedChaos.error) {
        return { data: withRoundedChaos.data as SavedBracket | null, error: null };
      }
    }

    if (!isMissingChaosColumn(withChaos.error.message)) {
      return { data: withChaos.data as SavedBracket | null, error: withChaos.error };
    }

    const { data, error } = await supabase
      .from("brackets")
      .update({
        picks: serialized,
        bracket_name: bracketName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bracketId)
      .eq("user_id", userId)
      .select()
      .single();
    return { data: data as SavedBracket | null, error };
  }

  const withChaos = await supabase
    .from("brackets")
    .insert({
      user_id: userId,
      picks: serialized,
      bracket_name: bracketName,
      chaos_score: normalizedChaosScore,
    })
    .select()
    .single();
  if (!withChaos.error) {
    return { data: withChaos.data as SavedBracket | null, error: withChaos.error };
  }

  if (isChaosTypeMismatch(withChaos.error.message)) {
    const withRoundedChaos = await supabase
      .from("brackets")
      .insert({
        user_id: userId,
        picks: serialized,
        bracket_name: bracketName,
        chaos_score: roundedChaosScore,
      })
      .select()
      .single();
    if (!withRoundedChaos.error) {
      return { data: withRoundedChaos.data as SavedBracket | null, error: null };
    }
  }

  if (!isMissingChaosColumn(withChaos.error.message)) {
    return { data: withChaos.data as SavedBracket | null, error: withChaos.error };
  }

  const { data, error } = await supabase
    .from("brackets")
    .insert({
      user_id: userId,
      picks: serialized,
      bracket_name: bracketName,
    })
    .select()
    .single();

  return { data: data as SavedBracket | null, error };
}

export async function getUserBrackets(userId: string) {
  const withChaos = await supabase
    .from("brackets")
    .select("id, user_id, bracket_name, picks, chaos_score, created_at, updated_at, is_locked")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (!withChaos.error) {
    return { data: (withChaos.data as SavedBracket[] | null) ?? [], error: null };
  }

  if (!withChaos.error.message?.toLowerCase().includes("chaos_score")) {
    return { data: [], error: withChaos.error };
  }

  const { data, error } = await supabase
    .from("brackets")
    .select("id, user_id, bracket_name, picks, created_at, updated_at, is_locked")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  return { data: (data as SavedBracket[] | null) ?? [], error };
}

export async function deleteBracket(bracketId: string, userId: string) {
  const { error } = await supabase
    .from("brackets")
    .delete()
    .eq("id", bracketId)
    .eq("user_id", userId);

  return { error };
}

export async function renameBracket(bracketId: string, userId: string, newName: string) {
  const { error } = await supabase
    .from("brackets")
    .update({ bracket_name: newName, updated_at: new Date().toISOString() })
    .eq("id", bracketId)
    .eq("user_id", userId);

  return { error };
}

export async function getLeaderboard(limit = 50) {
  const { data, error } = await supabase
    .from("leaderboard")
    .select("*")
    .limit(limit);

  return { data: (data as LeaderboardEntry[] | null) ?? [], error };
}

export async function getUserScores(userId: string) {
  const { data, error } = await supabase
    .from("bracket_scores")
    .select("*")
    .eq("user_id", userId);

  return { data: data ?? [], error };
}

export const getChaosTierEmoji = (score: number | null | undefined): string => {
  if (score === null || score === undefined || !Number.isFinite(score)) return "—";
  if (score >= 80) return "🔥";
  if (score >= 60) return "🌪️";
  if (score >= 40) return "⚡";
  if (score >= 20) return "🌊";
  return "🧊";
};

export const formatChaosScore = (score: number | null | undefined): string => {
  if (score === null || score === undefined || !Number.isFinite(score)) return "—";
  return `${getChaosTierEmoji(score)} ${Math.round(score)}`;
};

export function computeChaosScoreForPicks(picks: LockedPicks): number {
  const { games } = resolveGames(picks);
  let total = 0;
  for (const game of games) {
    if (!game.winnerId) continue;
    const winProb = getModelGameWinProb(game, game.winnerId);
    if (winProb === null) continue;
    total += -Math.log(Math.max(1e-12, winProb));
  }
  return Number(total.toFixed(2));
}
