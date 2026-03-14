import { useState, useEffect, useMemo } from "react";
import { useAuth } from "./AuthContext";
import { getGroupStandings, leaveGroup, deleteGroup, updateMemberBracket, updateGroup, type GroupStanding, type UserGroup } from "./groupStorage";
import { getUserBrackets, type SavedBracket } from "./bracketStorage";
import { GroupStandingsTab } from "./GroupStandingsTab";
import { GroupPicksTab } from "./GroupPicksTab";
import { GroupChaosTab } from "./GroupChaosTab";
import { BracketViewer } from "./BracketViewer";
import { GROUP_EMOJIS } from "./constants";
import { captureError } from "./lib/errorMonitoring";

type RankedStanding = GroupStanding & { groupRank: number };

export function GroupDetailView({
  group,
  isOpen,
  onClose,
  tournamentStarted,
  tournamentResults,
  onGroupUpdated,
}: {
  group: UserGroup | null;
  isOpen: boolean;
  onClose: () => void;
  tournamentStarted: boolean;
  tournamentResults?: unknown;
  onGroupUpdated?: (updated: { name: string; emoji: string }) => void;
}) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"standings" | "picks" | "chaos">("standings");
  const [standings, setStandings] = useState<GroupStanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingBracket, setViewingBracket] = useState<{
    bracketId: string;
    displayName: string;
    bracketName: string;
  } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);

  // Bracket picker state for members with no bracket
  const [showBracketPicker, setShowBracketPicker] = useState(false);
  const [brackets, setBrackets] = useState<SavedBracket[]>([]);
  const [selectedBracket, setSelectedBracket] = useState<string | null>(null);
  const [bracketPickerLoading, setBracketPickerLoading] = useState(false);
  const [bracketPickerError, setBracketPickerError] = useState("");

  // Edit group state
  const [showEditGroup, setShowEditGroup] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");

  const isAdmin = group?.created_by === user?.id;

  useEffect(() => {
    if (isOpen && group) {
      loadStandings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, group]);

  async function loadStandings() {
    if (!group) return;
    setLoading(true);
    try {
      const { data, error } = await getGroupStandings(group.id);
      if (error) {
        captureError("group_detail_standings_load", error);
      }
      setStandings(data);
    } catch (error) {
      captureError("group_detail_standings_load", error);
      setStandings([]);
    } finally {
      setLoading(false);
    }
  }

  const [showInviteToast, setShowInviteToast] = useState(false);

  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  function handleCopyInvite() {
    if (!group) return;
    const link = `${window.location.origin}/join.html?code=${group.invite_code}`;
    const message = `Join my group "${group.name}" on The Bracket Lab and compete to see who has the best bracket! 🏀\n${link}`;
    navigator.clipboard.writeText(message).then(() => {
      setCopied(true);
      setShowInviteToast(true);
      setTimeout(() => setCopied(false), 2500);
      setTimeout(() => setShowInviteToast(false), 3000);
    });
  }

  async function handleNativeShare() {
    if (!group) return;
    const link = `${window.location.origin}/join.html?code=${group.invite_code}`;
    try {
      await navigator.share({
        title: `Join ${group.name} on The Bracket Lab`,
        text: `Join my group "${group.name}" on The Bracket Lab and compete to see who has the best bracket! 🏀`,
        url: link,
      });
    } catch {
      // User cancelled share sheet — no action needed
    }
  }

  async function handleLeave() {
    if (!group || !user) return;
    if (!confirm("Leave this group? You can rejoin later with the invite code.")) return;
    await leaveGroup(group.id, user.id);
    onClose();
  }

  async function handleDelete() {
    if (!group) return;
    if (!confirm(`Delete "${group.name}" permanently? All members will be removed. This cannot be undone.`)) return;
    await deleteGroup(group.id);
    onClose();
  }

  async function handleOpenBracketPicker() {
    if (!user) return;
    setBracketPickerLoading(true);
    setBracketPickerError("");
    const { data } = await getUserBrackets(user.id);
    setBrackets(data);
    setBracketPickerLoading(false);
    if (data.length === 0) {
      setBracketPickerError("You need at least one saved bracket. Save your current bracket first!");
      return;
    }
    setShowBracketPicker(true);
  }

  function handleOpenEditGroup() {
    if (!group) return;
    setEditName(group.name);
    setEditEmoji(group.emoji ?? "👥");
    setEditError("");
    setShowEditGroup(true);
    setShowSettings(false);
  }

  async function handleSaveGroup() {
    if (!group) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError("Group name cannot be empty.");
      return;
    }
    if (trimmed.length > 40) {
      setEditError("Group name must be 40 characters or fewer.");
      return;
    }
    setEditLoading(true);
    setEditError("");
    const { error } = await updateGroup(group.id, { name: trimmed, emoji: editEmoji });
    if (error) {
      setEditError(error.message || "Failed to update group.");
      setEditLoading(false);
      return;
    }
    setEditLoading(false);
    setShowEditGroup(false);
    onGroupUpdated?.({ name: trimmed, emoji: editEmoji });
  }

  async function handleConfirmBracket() {
    if (!group || !user || !selectedBracket) return;
    setBracketPickerLoading(true);
    const { error } = await updateMemberBracket(group.id, user.id, selectedBracket);
    if (error) {
      setBracketPickerError(error.message || "Failed to set bracket.");
      setBracketPickerLoading(false);
      return;
    }
    setShowBracketPicker(false);
    setSelectedBracket(null);
    setBracketPickerLoading(false);
    await loadStandings();
  }

  const rankedStandings: RankedStanding[] = useMemo(() => {
    const sorted = [...standings].sort((a, b) => {
      if ((b.total_score || 0) !== (a.total_score || 0)) return (b.total_score || 0) - (a.total_score || 0);
      if ((b.correct_picks || 0) !== (a.correct_picks || 0)) return (b.correct_picks || 0) - (a.correct_picks || 0);
      return 0;
    });

    let rank = 1;
    return sorted.map((entry, i) => {
      if (i > 0) {
        const prev = sorted[i - 1];
        if (entry.total_score !== prev.total_score || entry.correct_picks !== prev.correct_picks) {
          rank = i + 1;
        }
      }
      return { ...entry, groupRank: rank };
    });
  }, [standings]);

  const soleLeader = useMemo(() => {
    if (rankedStandings.length === 0) return null;
    const leaders = rankedStandings.filter((s) => s.groupRank === 1);
    return leaders.length === 1 ? leaders[0].user_id : null;
  }, [rankedStandings]);
  const displayedMemberCount = Math.max(group?.memberCount ?? 0, standings.length);

  if (!isOpen || !group) return null;

  if (viewingBracket) {
    return (
      <BracketViewer
        bracketId={viewingBracket.bracketId}
        displayName={viewingBracket.displayName}
        bracketName={viewingBracket.bracketName}
        onBack={() => setViewingBracket(null)}
        tournamentResults={tournamentResults}
      />
    );
  }

  return (
    <div className="group-detail-overlay">
      <div className="group-detail-header">
        <button className="group-detail-back" onClick={onClose}>
          ← Groups
        </button>

        <div className="group-detail-title-area">
          <h1 className="group-detail-name">
            <span className="group-detail-emoji">{group.emoji ?? "👥"}</span>
            {group.name}
          </h1>
          <span className="group-detail-meta">
            {displayedMemberCount} {displayedMemberCount === 1 ? "member" : "members"}
          </span>
        </div>

        <div className="group-detail-header-actions" style={{ position: "relative" }}>
          <button className="group-invite-btn" onClick={handleCopyInvite}>
            {copied ? "✓ Copied!" : "🔗 Invite"}
          </button>
          {canNativeShare && (
            <button className="group-invite-btn" onClick={handleNativeShare}>
              📤
            </button>
          )}
          <button className="group-settings-btn" onClick={() => setShowSettings(!showSettings)}>
            ⋯
          </button>
          {showInviteToast && (
            <div className="invite-toast">
              <span className="invite-toast-check">✓</span>
              <span className="invite-toast-text">Invite message copied to clipboard</span>
            </div>
          )}
        </div>
      </div>

      {showSettings && (
        <div className="group-settings-dropdown">
          <div className="group-settings-code">
            <span className="group-settings-code-label">INVITE CODE</span>
            <span className="group-settings-code-value">{group.invite_code}</span>
          </div>
          {isAdmin && (
            <button className="group-settings-action" onClick={handleOpenEditGroup}>
              ✏️ Edit Group
            </button>
          )}
          {!isAdmin && (
            <button className="group-settings-action group-settings-action--danger" onClick={handleLeave}>
              Leave Group
            </button>
          )}
          {isAdmin && (
            <button className="group-settings-action group-settings-action--danger" onClick={handleDelete}>
              Delete Group
            </button>
          )}
        </div>
      )}

      <div className="group-tab-bar">
        {(["standings", "picks", "chaos"] as const).map((tab) => (
          <button
            key={tab}
            className={`group-tab ${activeTab === tab ? "group-tab--active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "standings" && "🏆 Standings"}
            {tab === "picks" && "🗺️ Picks"}
            {tab === "chaos" && "🌀 Chaos"}
          </button>
        ))}
      </div>

      <div className="group-detail-content">
        {loading ? (
          <div className="group-detail-loading">Loading group data...</div>
        ) : (
          <>
            {activeTab === "standings" && (
              <GroupStandingsTab
                standings={rankedStandings}
                soleLeader={soleLeader}
                currentUserId={user?.id}
                tournamentStarted={tournamentStarted}
                onViewBracket={setViewingBracket}
                onRefresh={loadStandings}
                onSelectBracket={handleOpenBracketPicker}
              />
            )}
            {activeTab === "picks" && (
              <GroupPicksTab
                standings={rankedStandings}
                currentUserId={user?.id}
                tournamentStarted={tournamentStarted}
              />
            )}
            {activeTab === "chaos" && (
              <GroupChaosTab standings={rankedStandings} currentUserId={user?.id} />
            )}
          </>
        )}
      </div>

      {showBracketPicker && (
        <div className="group-modal-overlay" onClick={() => { setShowBracketPicker(false); setSelectedBracket(null); }}>
          <div className="group-modal" onClick={(e) => e.stopPropagation()}>
            <button className="group-modal-close-btn" onClick={() => { setShowBracketPicker(false); setSelectedBracket(null); }}>
              ✕
            </button>
            <div className="group-modal-header">
              <span className="group-modal-icon">🏀</span>
              <h2 className="group-modal-title">Select Your Bracket</h2>
              <p className="group-modal-subtitle">Choose which bracket to enter into this group</p>
            </div>
            <div className="group-modal-body">
              <div className="group-bracket-list">
                {brackets.map((b) => (
                  <button
                    key={b.id}
                    className={`group-bracket-option ${selectedBracket === b.id ? "group-bracket-option--selected" : ""}`}
                    onClick={() => setSelectedBracket(b.id)}
                  >
                    <div className="group-bracket-option-info">
                      <span className="group-bracket-option-name">{b.bracket_name}</span>
                      <span className="group-bracket-option-meta">
                        {Object.keys(b.picks || {}).length} picks
                        {b.is_locked && " · 🔒 Locked"}
                      </span>
                    </div>
                    <div
                      className={`group-bracket-radio ${selectedBracket === b.id ? "group-bracket-radio--checked" : ""}`}
                    />
                  </button>
                ))}
              </div>
              {bracketPickerError && <p className="group-error">{bracketPickerError}</p>}
            </div>
            <button className="group-cta-btn" onClick={handleConfirmBracket} disabled={!selectedBracket || bracketPickerLoading}>
              {bracketPickerLoading ? "Saving..." : "Confirm Bracket"}
            </button>
          </div>
        </div>
      )}

      {showEditGroup && (
        <div className="group-modal-overlay" onClick={() => { setShowEditGroup(false); setEditError(""); }}>
          <div className="group-modal" onClick={(e) => e.stopPropagation()}>
            <button className="group-modal-close-btn" onClick={() => { setShowEditGroup(false); setEditError(""); }}>
              ✕
            </button>
            <div className="group-modal-header">
              <span className="group-modal-icon">{editEmoji}</span>
              <h2 className="group-modal-title">Edit Group</h2>
              <p className="group-modal-subtitle">Update your group's name and emoji</p>
            </div>
            <div className="group-modal-body">
              <label className="group-input-label">Group Emoji</label>
              <div className="group-emoji-grid">
                {GROUP_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={`group-emoji-btn ${editEmoji === e ? "group-emoji-btn--selected" : ""}`}
                    onClick={() => setEditEmoji(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>

              <label className="group-input-label">Group Name</label>
              <input
                type="text"
                className="group-input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="e.g. Office Pool 2026"
                maxLength={40}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleSaveGroup()}
              />
              <span className="group-input-hint">{editName.length}/40</span>

              {editError && <p className="group-error">{editError}</p>}
            </div>
            <button className="group-cta-btn" onClick={handleSaveGroup} disabled={!editName.trim() || editLoading}>
              {editLoading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      {bracketPickerError && !showBracketPicker && (
        <div className="group-bracket-picker-error-toast">
          {bracketPickerError}
        </div>
      )}
    </div>
  );
}
