import { supabase } from "./supabaseClient";
import type { LockedPicks } from "./lib/bracket";

export type GroupRow = {
  id: string;
  name: string;
  emoji: string;
  invite_code: string;
  created_by: string | null;
  created_at: string;
  is_active: boolean;
  max_members: number;
  settings: Record<string, unknown>;
};

export type GroupMembership = {
  id: string;
  group_id: string;
  user_id: string;
  bracket_id: string | null;
  joined_at: string;
  role: "admin" | "member";
};

export type UserGroup = GroupRow & {
  role: "admin" | "member";
  bracketId: string | null;
  memberCount: number;
  championName: string | null;
  championSeed: number | null;
  championLogoUrl: string | null;
};

export type GroupStanding = {
  group_id: string;
  user_id: string;
  bracket_id: string | null;
  role: string;
  joined_at: string;
  display_name: string;
  bracket_name: string;
  picks: LockedPicks | null;
  is_locked: boolean;
  total_score: number | null;
  correct_picks: number | null;
  possible_picks: number | null;
  max_remaining: number | null;
  r64_score: number | null;
  r32_score: number | null;
  s16_score: number | null;
  e8_score: number | null;
  f4_score: number | null;
  champ_score: number | null;
  global_rank: number | null;
  score_updated_at: string | null;
};

export type GroupMember = {
  id: string;
  user_id: string;
  role: "admin" | "member";
  joined_at: string;
  bracket_id: string | null;
  display_name: string;
  bracket_name: string | null;
  has_assigned_bracket: boolean;
  has_submitted_bracket: boolean;
  is_locked: boolean;
};

const GROUP_QUERY_TIMEOUT_MS = 10000;
const GROUP_COUNTS_QUERY_TIMEOUT_MS = 3500;
const USER_GROUPS_CACHE_PREFIX = "og_user_groups_v1";
const GROUP_STANDINGS_CACHE_PREFIX = "og_group_standings_v1";
const GROUP_MEMBERS_CACHE_PREFIX = "og_group_members_v1";

type CachedValue<T> = {
  savedAt: number;
  value: T;
};

function readCachedValue<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedValue<T> | T;
    if (parsed && typeof parsed === "object" && "value" in parsed) {
      return (parsed as CachedValue<T>).value;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

function writeCachedValue<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    const payload: CachedValue<T> = { value, savedAt: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
}

async function withTimeout<T>(promiseLike: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T>([
      Promise.resolve(promiseLike),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export async function createGroup(userId: string, groupName: string, emoji: string = "👥") {
  const { data: codeData, error: codeError } = await supabase.rpc("generate_invite_code");
  if (codeError) return { data: null, error: codeError };

  const inviteCode = codeData as string;

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .insert({
      name: groupName.trim(),
      emoji,
      invite_code: inviteCode,
      created_by: userId,
    })
    .select()
    .single();

  if (groupError) return { data: null, error: groupError };
  return { data: group as GroupRow, error: null };
}

export async function joinGroup(inviteCode: string, userId: string, bracketId: string | null) {
  const { data: group, error: lookupError } = await supabase
    .from("groups")
    .select("id, name, is_active")
    .eq("invite_code", inviteCode.toUpperCase().trim())
    .single();

  if (lookupError || !group) {
    return { data: null, error: { message: "Group not found. Check the invite code." } };
  }

  const g = group as { id: string; name: string; is_active: boolean };

  if (!g.is_active) {
    return { data: null, error: { message: "This group is no longer active." } };
  }

  const { data: existing } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", g.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return { data: null, error: { message: "You're already in this group." } };
  }

  const { data: membership, error: joinError } = await supabase
    .from("group_members")
    .insert({
      group_id: g.id,
      user_id: userId,
      ...(bracketId ? { bracket_id: bracketId } : {}),
      role: "member",
    })
    .select()
    .single();

  if (joinError) {
    if (joinError.message?.includes("full")) {
      return { data: null, error: { message: "This group is full." } };
    }
    if (joinError.message?.includes("10 groups")) {
      return { data: null, error: { message: "You've reached the 10-group limit." } };
    }
    return { data: null, error: joinError };
  }

  return { data: { ...(membership as GroupMembership), group_name: g.name }, error: null };
}

export async function joinOwnGroup(groupId: string, userId: string, bracketId: string | null) {
  const { data, error } = await supabase
    .from("group_members")
    .insert({
      group_id: groupId,
      user_id: userId,
      bracket_id: bracketId,
      role: "admin",
    })
    .select()
    .single();

  return { data: data as GroupMembership | null, error };
}

export async function getUserGroups(userId: string) {
  const cacheKey = `${USER_GROUPS_CACHE_PREFIX}:${userId}`;
  const cachedGroups = readCachedValue<UserGroup[]>(cacheKey);
  let memberships: unknown = null;
  let membershipsError: { message?: string } | null = null;
  try {
    const result = await withTimeout(
      supabase
        .from("group_members")
        .select(
          `
          group_id,
          role,
          bracket_id,
          groups:group_id (
            id,
            name,
            emoji,
            invite_code,
            created_by,
            created_at
          ),
          brackets:bracket_id (
            champion_name,
            champion_seed,
            champion_logo_url
          )
        `
        )
        .eq("user_id", userId),
      GROUP_QUERY_TIMEOUT_MS,
      "Timed out loading your groups. Please try again."
    );
    memberships = result.data;
    membershipsError = result.error;
  } catch (error) {
    return { data: cachedGroups ?? [], error: { message: (error as Error).message } };
  }

  if (membershipsError) return { data: cachedGroups ?? [], error: membershipsError };

  const rows = ((memberships ?? []) as unknown) as Array<{
    group_id: string;
    role: "admin" | "member";
    bracket_id: string | null;
    groups: GroupRow | GroupRow[] | null;
    brackets:
      | {
          champion_name?: string | null;
          champion_seed?: number | null;
          champion_logo_url?: string | null;
        }
      | Array<{
          champion_name?: string | null;
          champion_seed?: number | null;
          champion_logo_url?: string | null;
        }>
      | null;
  }>;

  const normalizedRows = rows
    .map((membership) => {
      const groupValue = Array.isArray(membership.groups)
        ? membership.groups[0] ?? null
        : membership.groups;
      const bracketValue = Array.isArray(membership.brackets)
        ? membership.brackets[0] ?? null
        : membership.brackets;
      if (!groupValue?.id) return null;
      return {
        ...membership,
        groups: groupValue,
        brackets: bracketValue,
      };
    })
    .filter((membership): membership is {
      group_id: string;
      role: "admin" | "member";
      bracket_id: string | null;
      groups: GroupRow;
      brackets: {
        champion_name?: string | null;
        champion_seed?: number | null;
        champion_logo_url?: string | null;
      } | null;
    } => Boolean(membership));

  if (normalizedRows.length === 0) {
    writeCachedValue(cacheKey, []);
    return { data: [] as UserGroup[], error: null };
  }

  const groupIds = normalizedRows.map((m) => m.groups.id);
  const cachedMemberCounts = Object.fromEntries((cachedGroups ?? []).map((group) => [group.id, group.memberCount]));

  let counts: Array<{ group_id: string }> = [];
  try {
    const countsResult = await withTimeout(
      supabase.from("group_members").select("group_id").in("group_id", groupIds),
      GROUP_COUNTS_QUERY_TIMEOUT_MS,
      "Timed out loading group member counts."
    );
    if (!countsResult.error) {
      counts = (countsResult.data ?? []) as Array<{ group_id: string }>;
    }
  } catch {
    counts = [];
  }

  const countMap: Record<string, number> = {};
  counts.forEach((c: { group_id: string }) => {
    countMap[c.group_id] = (countMap[c.group_id] || 0) + 1;
  });

  const groups: UserGroup[] = normalizedRows.map((m) => ({
    ...m.groups,
    role: m.role,
    bracketId: m.bracket_id,
    memberCount: Math.max(1, countMap[m.groups.id] ?? cachedMemberCounts[m.groups.id] ?? 1),
    championName: m.brackets?.champion_name ?? null,
    championSeed: m.brackets?.champion_seed ?? null,
    championLogoUrl: m.brackets?.champion_logo_url ?? null,
  }));

  writeCachedValue(cacheKey, groups);
  return { data: groups, error: null };
}

export async function getGroupStandings(groupId: string) {
  const cacheKey = `${GROUP_STANDINGS_CACHE_PREFIX}:${groupId}`;
  const cachedStandings = readCachedValue<GroupStanding[]>(cacheKey);

  try {
    const result = await withTimeout(
      supabase.from("group_standings").select("*").eq("group_id", groupId),
      GROUP_QUERY_TIMEOUT_MS,
      "Timed out loading group standings. Please try again."
    );

    if (result.error) {
      return { data: cachedStandings ?? [], error: result.error };
    }

    const standings = (result.data as GroupStanding[] | null) ?? [];
    writeCachedValue(cacheKey, standings);
    return { data: standings, error: null };
  } catch (error) {
    return { data: cachedStandings ?? [], error: { message: (error as Error).message } };
  }
}

export async function getGroupMembers(groupId: string) {
  const cacheKey = `${GROUP_MEMBERS_CACHE_PREFIX}:${groupId}`;
  const cachedMembers = readCachedValue<GroupMember[]>(cacheKey);
  let memberships: unknown = null;
  let membershipsError: { message?: string } | null = null;

  try {
    const result = await withTimeout(
      supabase
        .from("group_members")
        .select(
          `
          id,
          user_id,
          role,
          joined_at,
          bracket_id,
          profiles:user_id (
            display_name
          ),
          brackets:bracket_id (
            bracket_name,
            is_locked,
            submitted_at
          )
        `
        )
        .eq("group_id", groupId),
      GROUP_QUERY_TIMEOUT_MS,
      "Timed out loading group members. Please try again."
    );
    memberships = result.data;
    membershipsError = result.error;
  } catch (error) {
    return { data: cachedMembers ?? [], error: { message: (error as Error).message } };
  }

  if (membershipsError) {
    return { data: cachedMembers ?? [], error: membershipsError };
  }

  const rows = ((memberships ?? []) as unknown[]) as Array<{
    id: string;
    user_id: string;
    role: "admin" | "member";
    joined_at: string;
    bracket_id: string | null;
    profiles: { display_name?: string | null } | Array<{ display_name?: string | null }> | null;
    brackets: {
      bracket_name?: string | null;
      is_locked?: boolean | null;
      submitted_at?: string | null;
    } | Array<{
      bracket_name?: string | null;
      is_locked?: boolean | null;
      submitted_at?: string | null;
    }> | null;
  }>;

  const members = rows.map((membership) => {
    const profileValue = Array.isArray(membership.profiles)
      ? membership.profiles[0] ?? null
      : membership.profiles;
    const bracketValue = Array.isArray(membership.brackets)
      ? membership.brackets[0] ?? null
      : membership.brackets;

    return {
      id: membership.id,
      user_id: membership.user_id,
      role: membership.role,
      joined_at: membership.joined_at,
      bracket_id: membership.bracket_id,
      display_name: String(profileValue?.display_name ?? "Anonymous"),
      bracket_name: bracketValue?.bracket_name ?? null,
      has_assigned_bracket: Boolean(membership.bracket_id),
      has_submitted_bracket: Boolean(bracketValue?.submitted_at),
      is_locked: Boolean(bracketValue?.is_locked),
    } satisfies GroupMember;
  });

  writeCachedValue(cacheKey, members);
  return { data: members, error: null };
}

export async function getGroupByCode(inviteCode: string) {
  const { data, error } = await supabase
    .from("groups")
    .select("id, name, emoji, invite_code, is_active, created_at")
    .eq("invite_code", inviteCode.toUpperCase().trim())
    .single();

  return { data: data as GroupRow | null, error };
}

export async function updateMemberBracket(groupId: string, userId: string, bracketId: string) {
  const { error } = await supabase
    .from("group_members")
    .update({ bracket_id: bracketId })
    .eq("group_id", groupId)
    .eq("user_id", userId);

  if (error) return { data: null, error };

  const { data: groups, error: reloadError } = await getUserGroups(userId);
  if (reloadError) {
    return { data: null, error: reloadError };
  }

  const updatedGroup = groups.find((group) => group.id === groupId) ?? null;
  if (!updatedGroup || updatedGroup.bracketId !== bracketId) {
    return { data: null, error: { message: "Could not update your group bracket. Please try again." } };
  }

  return { data: updatedGroup, error: null };
}

export async function leaveGroup(groupId: string, userId: string) {
  const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);

  return { error };
}

export async function removeMember(groupId: string, targetUserId: string) {
  const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", targetUserId);

  return { error };
}

export async function updateGroup(groupId: string, updates: { name?: string; emoji?: string }) {
  const { data, error } = await supabase
    .from("groups")
    .update(updates)
    .eq("id", groupId)
    .select()
    .single();

  return { data: data as GroupRow | null, error };
}

export async function deleteGroup(groupId: string) {
  const { error } = await supabase.from("groups").delete().eq("id", groupId);

  return { error };
}

export async function getBracketPicks(bracketId: string) {
  const { data, error } = await supabase
    .from("brackets")
    .select("id, bracket_name, picks, is_locked, created_at, updated_at")
    .eq("id", bracketId)
    .single();

  return { data: data as { id: string; bracket_name: string; picks: LockedPicks; is_locked: boolean; created_at: string; updated_at: string } | null, error };
}
