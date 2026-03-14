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

export async function joinGroup(inviteCode: string, userId: string, bracketId: string) {
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
      bracket_id: bracketId,
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
  const { data: memberships, error } = await supabase
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
      )
    `
    )
    .eq("user_id", userId);

  if (error) return { data: [] as UserGroup[], error };

  const rows = ((memberships ?? []) as unknown) as Array<{
    group_id: string;
    role: "admin" | "member";
    bracket_id: string | null;
    groups: GroupRow | GroupRow[] | null;
  }>;

  const normalizedRows = rows
    .map((membership) => {
      const groupValue = Array.isArray(membership.groups)
        ? membership.groups[0] ?? null
        : membership.groups;
      if (!groupValue?.id) return null;
      return {
        ...membership,
        groups: groupValue,
      };
    })
    .filter((membership): membership is {
      group_id: string;
      role: "admin" | "member";
      bracket_id: string | null;
      groups: GroupRow;
    } => Boolean(membership));

  if (normalizedRows.length === 0) {
    return { data: [] as UserGroup[], error: null };
  }

  const groupIds = normalizedRows.map((m) => m.groups.id);

  const { data: counts } = await supabase.from("group_members").select("group_id").in("group_id", groupIds);

  const countMap: Record<string, number> = {};
  (counts ?? []).forEach((c: { group_id: string }) => {
    countMap[c.group_id] = (countMap[c.group_id] || 0) + 1;
  });

  const groups: UserGroup[] = normalizedRows.map((m) => ({
    ...m.groups,
    role: m.role,
    bracketId: m.bracket_id,
    memberCount: countMap[m.groups.id] || 0,
  }));

  return { data: groups, error: null };
}

export async function getGroupStandings(groupId: string) {
  const { data, error } = await supabase.from("group_standings").select("*").eq("group_id", groupId);

  return { data: (data as GroupStanding[] | null) ?? [], error };
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

  return { error };
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
