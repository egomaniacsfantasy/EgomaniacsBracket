import { supabase } from "./supabaseClient";
import { getModelGameWinProb, resolveGames, type LockedPicks } from "./lib/bracket";
import { teamsById } from "./data/teams";

export type LeaderboardFinalFourTeam = {
  name: string;
  seed: number;
  logoUrl: string | null;
};

export type LeaderboardBoldestPick = {
  winner_name: string;
  winner_seed: number;
  loser_name: string;
  loser_seed: number;
  round: string | null;
  upset_magnitude: number | null;
};

export type SavedBracket = {
  id: string;
  user_id: string;
  bracket_name: string;
  picks: LockedPicks;
  chaos_score?: number | null;
  champion_name?: string | null;
  champion_seed?: number | null;
  champion_logo_url?: string | null;
  champion_eliminated?: boolean | null;
  final_four?: LeaderboardFinalFourTeam[] | null;
  boldest_pick?: LeaderboardBoldestPick | null;
  created_at: string;
  updated_at: string;
  is_locked: boolean;
  submitted_at?: string | null;
};

export type LeaderboardEntry = {
  rank?: number | null;
  user_id: string;
  bracket_id: string;
  bracket_name: string;
  display_name: string;
  chaos_score?: number | null;
  champion_name?: string | null;
  champion_seed?: number | null;
  champion_logo_url?: string | null;
  champion_eliminated?: boolean | null;
  final_four?: LeaderboardFinalFourTeam[] | string | null;
  boldest_pick?: LeaderboardBoldestPick | string | null;
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

export const MAX_SUBMITTED_BRACKETS = 10;

type BracketMeta = {
  champion_name: string | null;
  champion_seed: number | null;
  champion_logo_url: string | null;
  champion_eliminated: boolean;
  final_four: LeaderboardFinalFourTeam[];
  boldest_pick: LeaderboardBoldestPick | null;
};

type SaveBracketOptions = {
  submit?: boolean;
  bypassLock?: boolean;
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
  chaosScore?: number | null,
  options: SaveBracketOptions = {}
) {
  const shouldSubmit = options.submit ?? true;
  const serialized = serializePicks(picks);
  const meta = extractBracketMeta(serialized);
  const derivedChaosScore = typeof chaosScore === "number" ? chaosScore : computeChaosScoreForPicks(serialized);
  const normalizedChaosScore = Math.round(derivedChaosScore * 10) / 10;
  const isMissingChaosColumn = (message?: string) => {
    const msg = (message ?? "").toLowerCase();
    return msg.includes("chaos_score") && (msg.includes("column") || msg.includes("schema cache"));
  };
  const isMissingMetaColumn = (message?: string) => {
    const msg = (message ?? "").toLowerCase();
    const fields = ["champion_name", "champion_seed", "champion_logo_url", "champion_eliminated", "final_four", "boldest_pick"];
    return fields.some((field) => msg.includes(field)) && (msg.includes("column") || msg.includes("schema cache"));
  };
  const isMissingSubmissionColumn = (message?: string) => {
    const msg = (message ?? "").toLowerCase();
    return msg.includes("submitted_at") && (msg.includes("column") || msg.includes("schema cache"));
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
  const submittedAt = shouldSubmit ? new Date().toISOString() : null;
  const basePayload = {
    picks: serialized,
    bracket_name: bracketName,
    submitted_at: submittedAt,
    ...meta,
  };

  const buildCandidates = (isUpdate: boolean): Array<Record<string, unknown>> => {
    const withTimestamp = isUpdate ? { updated_at: new Date().toISOString() } : {};
    const all = { ...basePayload, ...withTimestamp, chaos_score: normalizedChaosScore };
    const rounded = { ...basePayload, ...withTimestamp, chaos_score: roundedChaosScore };
    const noMeta = {
      picks: serialized,
      bracket_name: bracketName,
      submitted_at: submittedAt,
      ...withTimestamp,
      chaos_score: normalizedChaosScore,
    };
    const noMetaRounded = {
      picks: serialized,
      bracket_name: bracketName,
      submitted_at: submittedAt,
      ...withTimestamp,
      chaos_score: roundedChaosScore,
    };
    const metaNoChaos = { ...basePayload, ...withTimestamp };
    const legacy = {
      picks: serialized,
      bracket_name: bracketName,
      submitted_at: submittedAt,
      ...withTimestamp,
    };
    const noMetaNoSubmit = {
      picks: serialized,
      bracket_name: bracketName,
      ...withTimestamp,
    };
    const candidates: Array<Record<string, unknown>> = [all];
    if (roundedChaosScore !== normalizedChaosScore) candidates.push(rounded);
    candidates.push(noMeta);
    if (roundedChaosScore !== normalizedChaosScore) candidates.push(noMetaRounded);
    candidates.push(metaNoChaos, legacy, noMetaNoSubmit);
    return candidates;
  };

  const shouldRetry = (message?: string) =>
    isMissingChaosColumn(message) || isMissingMetaColumn(message) || isMissingSubmissionColumn(message) || isChaosTypeMismatch(message);

  if (bracketId) {
    let lastData: unknown = null;
    let lastError: { message?: string } | null = null;
    for (const payload of buildCandidates(true)) {
      const attempt = await supabase
        .from("brackets")
        .update(payload as never)
        .eq("id", bracketId)
        .eq("user_id", userId)
        .select()
        .single();
      if (!attempt.error) {
        return { data: attempt.data as SavedBracket | null, error: null };
      }
      lastData = attempt.data;
      lastError = attempt.error;
      if (!shouldRetry(attempt.error.message)) {
        return { data: lastData as SavedBracket | null, error: attempt.error };
      }
    }
    return { data: lastData as SavedBracket | null, error: lastError };
  }

  if (shouldSubmit) {
    const { count, error: countError } = await supabase
      .from("brackets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("submitted_at", "is", null);
    if (countError && !isMissingSubmissionColumn(countError.message)) return { data: null, error: countError };
    if ((count ?? 0) >= MAX_SUBMITTED_BRACKETS) {
      return { data: null, error: { message: `Maximum of ${MAX_SUBMITTED_BRACKETS} submitted brackets per user.` } };
    }
  }

  let lastData: unknown = null;
  let lastError: { message?: string } | null = null;
  for (const payload of buildCandidates(false)) {
    const attempt = await supabase
      .from("brackets")
      .insert({
        user_id: userId,
        ...payload,
      } as never)
      .select()
      .single();
    if (!attempt.error) {
      return { data: attempt.data as SavedBracket | null, error: null };
    }
    lastData = attempt.data;
    lastError = attempt.error;
    if (!shouldRetry(attempt.error.message)) {
      return { data: lastData as SavedBracket | null, error: attempt.error };
    }
  }
  return { data: lastData as SavedBracket | null, error: lastError };
}

export async function getUserBrackets(userId: string) {
  const withAll = await supabase
    .from("brackets")
    .select("id, user_id, bracket_name, picks, chaos_score, created_at, updated_at, is_locked, submitted_at, champion_name, champion_seed, champion_logo_url, final_four, boldest_pick")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (!withAll.error) {
    return { data: (withAll.data as SavedBracket[] | null) ?? [], error: null };
  }

  const withSubmittedAndChaos = await supabase
    .from("brackets")
    .select("id, user_id, bracket_name, picks, chaos_score, created_at, updated_at, is_locked, submitted_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (!withSubmittedAndChaos.error) {
    return { data: (withSubmittedAndChaos.data as SavedBracket[] | null) ?? [], error: null };
  }

  const withSubmitted = await supabase
    .from("brackets")
    .select("id, user_id, bracket_name, picks, created_at, updated_at, is_locked, submitted_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (!withSubmitted.error) {
    return { data: (withSubmitted.data as SavedBracket[] | null) ?? [], error: null };
  }

  const withChaos = await supabase
    .from("brackets")
    .select("id, user_id, bracket_name, picks, chaos_score, created_at, updated_at, is_locked")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (!withChaos.error) {
    return { data: (withChaos.data as SavedBracket[] | null) ?? [], error: null };
  }

  const { data, error } = await supabase
    .from("brackets")
    .select("id, user_id, bracket_name, picks, created_at, updated_at, is_locked")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  return { data: (data as SavedBracket[] | null) ?? [], error: error ?? withAll.error };
}

export async function setBracketSubmissionStatus(bracketId: string, userId: string, submit: boolean, bypassLock = false) {
  const isMissingSubmissionColumn = (message?: string) => {
    const msg = (message ?? "").toLowerCase();
    return msg.includes("submitted_at") && (msg.includes("column") || msg.includes("schema cache"));
  };
  const { data: bracket, error: existingError } = await supabase
    .from("brackets")
    .select("id, is_locked")
    .eq("id", bracketId)
    .eq("user_id", userId)
    .single();
  if (existingError) return { error: existingError };
  if (!bypassLock && (bracket as { is_locked?: boolean } | null)?.is_locked) {
    return { error: { message: "Submissions are locked at tip-off." } };
  }

  if (submit) {
    const { count, error: countError } = await supabase
      .from("brackets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("submitted_at", "is", null);
    if (countError) {
      if (isMissingSubmissionColumn(countError.message)) return { error: { message: "Submission system is updating. Please retry in 1 minute." } };
      return { error: countError };
    }
    if ((count ?? 0) >= MAX_SUBMITTED_BRACKETS) {
      return { error: { message: `Submission limit reached (${MAX_SUBMITTED_BRACKETS}/${MAX_SUBMITTED_BRACKETS}).` } };
    }
  }

  const { error } = await supabase
    .from("brackets")
    .update({
      submitted_at: submit ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bracketId)
    .eq("user_id", userId);
  if (error && isMissingSubmissionColumn(error.message)) {
    return { error: { message: "Submission system is updating. Please retry in 1 minute." } };
  }
  return { error };
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
  const primary = await supabase
    .from("bracket_scores")
    .select(
      `
      rank,
      total_score,
      correct_picks,
      possible_picks,
      max_remaining,
      r64_score,
      r32_score,
      s16_score,
      e8_score,
      f4_score,
      champ_score,
      bracket_id,
      user_id,
      updated_at,
      brackets!inner(bracket_name, chaos_score, champion_name, champion_seed, champion_logo_url, champion_eliminated, final_four, boldest_pick, submitted_at),
      profiles!inner(display_name)
      `
    )
    .not("brackets.submitted_at", "is", null)
    .order("total_score", { ascending: false })
    .order("correct_picks", { ascending: false })
    .limit(limit);

  if (primary.error) {
    const { data, error } = await supabase
      .from("leaderboard")
      .select("*")
      .limit(limit);
    return { data: (data as LeaderboardEntry[] | null) ?? [], error };
  }

  const mapped = ((primary.data as Array<Record<string, unknown>> | null) ?? []).map((row) => {
    const b = (row.brackets as Record<string, unknown>) ?? {};
    const p = (row.profiles as Record<string, unknown>) ?? {};
    return {
      rank: row.rank as number | null | undefined,
      bracket_id: String(row.bracket_id ?? ""),
      user_id: String(row.user_id ?? ""),
      display_name: String(p.display_name ?? "Anonymous"),
      bracket_name: String(b.bracket_name ?? "Bracket"),
      chaos_score: (b.chaos_score as number | null | undefined) ?? null,
      champion_name: (b.champion_name as string | null | undefined) ?? null,
      champion_seed: (b.champion_seed as number | null | undefined) ?? null,
      champion_logo_url: (b.champion_logo_url as string | null | undefined) ?? null,
      champion_eliminated: Boolean(b.champion_eliminated),
      final_four: (b.final_four as LeaderboardFinalFourTeam[] | string | null | undefined) ?? null,
      boldest_pick: (b.boldest_pick as LeaderboardBoldestPick | string | null | undefined) ?? null,
      total_score: Number(row.total_score ?? 0),
      correct_picks: Number(row.correct_picks ?? 0),
      possible_picks: (row.possible_picks as number | null | undefined) ?? null,
      max_remaining: (row.max_remaining as number | null | undefined) ?? null,
      r64_score: (row.r64_score as number | null | undefined) ?? null,
      r32_score: (row.r32_score as number | null | undefined) ?? null,
      s16_score: (row.s16_score as number | null | undefined) ?? null,
      e8_score: (row.e8_score as number | null | undefined) ?? null,
      f4_score: (row.f4_score as number | null | undefined) ?? null,
      champ_score: (row.champ_score as number | null | undefined) ?? null,
    } satisfies LeaderboardEntry;
  });
  return { data: mapped, error: null };
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

export function extractBracketMeta(picks: LockedPicks): BracketMeta {
  const { games } = resolveGames(picks);
  const champGame = games.find((game) => game.round === "CHAMP");
  const champion = champGame?.winnerId ? teamsById.get(champGame.winnerId) ?? null : null;

  const finalFour = games
    .filter((game) => game.round === "E8")
    .map((game) => (game.winnerId ? teamsById.get(game.winnerId) ?? null : null))
    .filter((team): team is NonNullable<typeof team> => Boolean(team))
    .map((team) => ({
      name: team.name,
      seed: team.seed,
      logoUrl: team.logoUrl ?? null,
    }));

  let boldest: LeaderboardBoldestPick | null = null;
  for (const game of games) {
    if (!game.winnerId || !game.teamAId || !game.teamBId) continue;
    const winner = teamsById.get(game.winnerId);
    const loserId = game.winnerId === game.teamAId ? game.teamBId : game.teamAId;
    const loser = teamsById.get(loserId);
    if (!winner || !loser) continue;
    if (winner.seed <= loser.seed) continue;
    const upsetMagnitude = winner.seed - loser.seed;
    if (!boldest || upsetMagnitude > (boldest.upset_magnitude ?? -1)) {
      boldest = {
        winner_name: winner.name,
        winner_seed: winner.seed,
        loser_name: loser.name,
        loser_seed: loser.seed,
        round: game.round,
        upset_magnitude: upsetMagnitude,
      };
    }
  }

  return {
    champion_name: champion?.name ?? null,
    champion_seed: champion?.seed ?? null,
    champion_logo_url: champion?.logoUrl ?? null,
    champion_eliminated: false,
    final_four: finalFour,
    boldest_pick: boldest,
  };
}
