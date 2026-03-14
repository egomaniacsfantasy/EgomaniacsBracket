import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import {
  formatChaosScore,
  MAX_SUBMITTED_BRACKETS,
  type SavedBracket,
  deleteBracket,
  getUserBrackets,
  renameBracket,
  saveBracket,
} from "./bracketStorage";
import { getUserGroups, updateMemberBracket, type UserGroup } from "./groupStorage";
import { gameTemplates } from "./data/bracket";
import type { LockedPicks } from "./lib/bracket";

export function MyBracketsModal({
  isOpen,
  onClose,
  onLoadBracket,
  onRenameSuccess,
  onBracketsChanged,
  currentPicks,
  currentChaosScore,
}: {
  isOpen: boolean;
  onClose: () => void;
  onLoadBracket: (bracket: SavedBracket) => void;
  onRenameSuccess?: () => void;
  onBracketsChanged?: () => void | Promise<void>;
  currentPicks: LockedPicks;
  currentChaosScore: number;
}) {
  const totalGames = gameTemplates.length;
  const { user } = useAuth();
  const [brackets, setBrackets] = useState<SavedBracket[]>([]);
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
  const [bracketGroups, setBracketGroups] = useState<Record<string, UserGroup[]>>({});
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [workingAction, setWorkingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [groupPickerBracketId, setGroupPickerBracketId] = useState<string | null>(null);
  const [groupPickerSavingGroupId, setGroupPickerSavingGroupId] = useState<string | null>(null);
  const [groupPickerError, setGroupPickerError] = useState<string | null>(null);
  const [groupPickerSuccess, setGroupPickerSuccess] = useState<string | null>(null);

  const loadBrackets = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [{ data: bracketData }, { data: groupData }] = await Promise.all([getUserBrackets(user.id), getUserGroups(user.id)]);
      const groupMap = (groupData ?? []).reduce<Record<string, UserGroup[]>>((map, group) => {
        if (!group.bracketId) return map;
        const current = map[group.bracketId] ?? [];
        map[group.bracketId] = [...current, group];
        return map;
      }, {});
      setBrackets(bracketData);
      setUserGroups(groupData ?? []);
      setBracketGroups(groupMap);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !user) return;
    loadBrackets();
  }, [isOpen, user]);

  const handleDelete = async (bracketId: string) => {
    if (!user) return;
    if (!window.confirm("Delete this bracket? This cannot be undone.")) return;
    setWorkingAction(`delete:${bracketId}`);
    setActionError(null);
    await deleteBracket(bracketId, user.id);
    await loadBrackets();
    await onBracketsChanged?.();
    setWorkingAction(null);
  };

  const handleRename = async (bracketId: string) => {
    if (!user || !newName.trim()) return;
    setWorkingAction(`rename:${bracketId}`);
    setActionError(null);
    const { error } = await renameBracket(bracketId, user.id, newName.trim());
    if (error) {
      setWorkingAction(null);
      setActionError((error as { message?: string })?.message ?? "Rename failed.");
      return;
    }
    setEditingName(null);
    setNewName("");
    await loadBrackets();
    await onBracketsChanged?.();
    setWorkingAction(null);
    onRenameSuccess?.();
  };

  const handleSaveNew = async () => {
    if (!user) return;
    setWorkingAction("submit:new");
    setActionError(null);
    const submittedCount = brackets.filter((bracket) => Boolean(bracket.submitted_at)).length;
    const name = submittedCount === 0 ? "My Bracket" : `Bracket #${Math.min(MAX_SUBMITTED_BRACKETS, submittedCount + 1)}`;
    const { error } = await saveBracket(user.id, currentPicks, name, null, currentChaosScore, { submit: true });
    if (error) {
      setActionError((error as { message?: string })?.message ?? "Submit failed.");
      setWorkingAction(null);
      return;
    }
    await loadBrackets();
    await onBracketsChanged?.();
    setWorkingAction(null);
  };

  const openGroupPicker = (bracketId: string) => {
    setGroupPickerBracketId(bracketId);
    setGroupPickerSavingGroupId(null);
    setGroupPickerError(null);
    setGroupPickerSuccess(null);
  };

  const closeGroupPicker = () => {
    setGroupPickerBracketId(null);
    setGroupPickerSavingGroupId(null);
    setGroupPickerError(null);
    setGroupPickerSuccess(null);
  };

  const handleAssignBracketToGroup = async (groupId: string, bracketId: string) => {
    if (!user) return;
    setGroupPickerSavingGroupId(groupId);
    setGroupPickerError(null);
    setGroupPickerSuccess(null);
    const { error } = await updateMemberBracket(groupId, user.id, bracketId);
    if (error) {
      setGroupPickerError((error as { message?: string })?.message ?? "Could not update the group bracket.");
      setGroupPickerSavingGroupId(null);
      return;
    }
    await loadBrackets();
    const bracketName = brackets.find((candidate) => candidate.id === bracketId)?.bracket_name ?? "This bracket";
    const groupName = userGroups.find((candidate) => candidate.id === groupId)?.name ?? "the group";
    setGroupPickerSuccess(`${bracketName} is now active for ${groupName}.`);
    setGroupPickerSavingGroupId(null);
  };

  if (!isOpen) return null;

  const submittedCount = brackets.filter((bracket) => Boolean(bracket.submitted_at)).length;
  const submissionsLocked = brackets.some((bracket) => bracket.is_locked);
  const groupPickerBracket = groupPickerBracketId ? brackets.find((bracket) => bracket.id === groupPickerBracketId) ?? null : null;

  return (
    <div className="auth-modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="my-brackets-modal">
        <button className="auth-modal-close" onClick={onClose}>
          ✕
        </button>
        <h3 className="auth-modal-title">My Brackets</h3>
        <p className="auth-modal-subtitle">
          Submitted {submittedCount}/{MAX_SUBMITTED_BRACKETS} brackets. Load a bracket to view it, or submit your current picks.
        </p>
        {submissionsLocked ? <p className="auth-modal-hint auth-modal-hint--error">Submissions locked at tip-off.</p> : null}
        {actionError ? <p className="auth-modal-hint auth-modal-hint--error">{actionError}</p> : null}

        {loading ? (
          <p className="my-brackets-loading">Loading...</p>
        ) : (
          <div className="my-brackets-list">
            {brackets.map((bracket) => {
              const pickCount = Object.keys(bracket.picks ?? {}).length;
              const completionPct = Math.round((pickCount / totalGames) * 100);
              const isEditing = editingName === bracket.id;
              const assignedGroups = bracketGroups[bracket.id] ?? [];
              return (
                <div
                  key={bracket.id}
                  className={`my-bracket-card-v2${assignedGroups.length > 0 ? " my-bracket-card-v2--grouped" : ""}`}
                >
                  <div className="my-bracket-card-v2-top">
                    {isEditing ? (
                      <div className="my-bracket-rename-v2">
                        <input
                          className="my-bracket-rename-input"
                          value={newName}
                          onChange={(event) => setNewName(event.target.value)}
                          maxLength={30}
                          autoFocus
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void handleRename(bracket.id);
                            if (event.key === "Escape") setEditingName(null);
                          }}
                        />
                        <button className="my-bracket-rename-confirm" onClick={() => void handleRename(bracket.id)}>
                          ✓
                        </button>
                      </div>
                    ) : (
                      <h4 className="my-bracket-name-v2">{bracket.bracket_name}</h4>
                    )}
                    {bracket.is_locked ? <span className="my-bracket-lock-badge">🔒 Locked</span> : null}
                    {!bracket.is_locked && bracket.submitted_at ? <span className="my-bracket-lock-badge">✓ Submitted</span> : null}
                  </div>

                  <div className="my-bracket-stats-row">
                    <div className="my-bracket-stat">
                      <span className="my-bracket-stat-value">{pickCount}/{totalGames}</span>
                      <span className="my-bracket-stat-label">picks</span>
                    </div>
                    <div className="my-bracket-stat">
                      <span className="my-bracket-stat-value">{completionPct}%</span>
                      <span className="my-bracket-stat-label">complete</span>
                    </div>
                    <div className="my-bracket-stat">
                      <span className="my-bracket-stat-value">{formatChaosScore(bracket.chaos_score ?? 0)}</span>
                      <span className="my-bracket-stat-label">chaos</span>
                    </div>
                  </div>

                  <div className="my-bracket-progress-track">
                    <div className="my-bracket-progress-fill" style={{ width: `${completionPct}%` }} />
                  </div>

                  {assignedGroups.length > 0 ? (
                    <div className="my-bracket-group-list" aria-label="Groups using this bracket">
                      {assignedGroups.map((group) => (
                        <span key={group.id} className="my-bracket-group-chip">
                          <span className="my-bracket-group-chip-emoji" aria-hidden="true">
                            {group.emoji ?? "👥"}
                          </span>
                          <span className="my-bracket-group-chip-text">
                            In group: <strong>{group.name}</strong>
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="my-bracket-meta-v2">Updated {new Date(bracket.updated_at).toLocaleDateString()}</div>

                  <div className="my-bracket-actions-v2">
                    <button
                      className="my-bracket-action-primary"
                      disabled={workingAction !== null}
                      onClick={() => {
                        onLoadBracket(bracket);
                        onClose();
                      }}
                    >
                      Load bracket
                    </button>
                    {!bracket.is_locked ? (
                      <>
                        <button
                          className="my-bracket-action-secondary"
                          disabled={workingAction !== null}
                          onClick={() => {
                            setEditingName(bracket.id);
                            setNewName(bracket.bracket_name);
                          }}
                        >
                          Rename
                        </button>
                        {userGroups.length > 0 ? (
                          <button
                            className="my-bracket-action-secondary"
                            disabled={workingAction !== null}
                            onClick={() => openGroupPicker(bracket.id)}
                          >
                            {assignedGroups.length > 0 ? "Change Group Bracket" : "Use in Group"}
                          </button>
                        ) : null}
                        <button className="my-bracket-action-danger" disabled={workingAction !== null} onClick={() => handleDelete(bracket.id)}>
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {submittedCount < MAX_SUBMITTED_BRACKETS && !submissionsLocked ? (
              <button className="my-bracket-new-btn" disabled={workingAction !== null} onClick={handleSaveNew}>
                + Submit current bracket as new ({MAX_SUBMITTED_BRACKETS - submittedCount} slot{MAX_SUBMITTED_BRACKETS - submittedCount !== 1 ? "s" : ""} remaining)
              </button>
            ) : null}
          </div>
        )}
      </div>

      {groupPickerBracket ? (
        <div className="group-modal-overlay" onClick={closeGroupPicker}>
          <div className="group-modal" onClick={(event) => event.stopPropagation()}>
            <button className="group-modal-close-btn" onClick={closeGroupPicker}>
              ✕
            </button>
            <div className="group-modal-header">
              <span className="group-modal-icon">👥</span>
              <h2 className="group-modal-title">Use this bracket in your groups</h2>
              <p className="group-modal-subtitle">
                Choose which group should use <strong>{groupPickerBracket.bracket_name}</strong>.
              </p>
            </div>
            <div className="group-modal-body">
              <div className="group-bracket-list">
                {userGroups.map((group) => {
                  const isCurrent = group.bracketId === groupPickerBracket.id;
                  const currentBracketName = group.bracketId
                    ? brackets.find((candidate) => candidate.id === group.bracketId)?.bracket_name ?? "Another bracket"
                    : null;
                  return (
                    <div key={group.id} className={`group-bracket-option ${isCurrent ? "group-bracket-option--selected" : ""}`}>
                      <div className="group-bracket-option-info">
                        <span className="group-bracket-option-name">
                          <span className="group-assignment-emoji">{group.emoji ?? "👥"}</span>
                          {group.name}
                        </span>
                        <span className="group-bracket-option-meta">
                          {isCurrent ? "Currently using this bracket" : currentBracketName ? `Currently: ${currentBracketName}` : "No bracket selected yet"}
                        </span>
                      </div>
                      <button
                        className="group-assignment-btn"
                        disabled={isCurrent || groupPickerSavingGroupId !== null}
                        onClick={() => void handleAssignBracketToGroup(group.id, groupPickerBracket.id)}
                      >
                        {isCurrent
                          ? "Current"
                          : groupPickerSavingGroupId === group.id
                            ? "Saving..."
                            : "Use This Bracket"}
                      </button>
                    </div>
                  );
                })}
              </div>
              {groupPickerError ? <p className="group-error">{groupPickerError}</p> : null}
              {groupPickerSuccess ? <p className="group-success">{groupPickerSuccess}</p> : null}
            </div>
            <button className="group-secondary-btn group-secondary-btn--full" onClick={closeGroupPicker}>
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
