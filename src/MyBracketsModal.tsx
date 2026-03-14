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
  setBracketSubmissionStatus,
} from "./bracketStorage";
import { gameTemplates } from "./data/bracket";
import type { LockedPicks } from "./lib/bracket";

export function MyBracketsModal({
  isOpen,
  onClose,
  onLoadBracket,
  onRenameSuccess,
  currentPicks,
  currentChaosScore,
}: {
  isOpen: boolean;
  onClose: () => void;
  onLoadBracket: (bracket: SavedBracket) => void;
  onRenameSuccess?: () => void;
  currentPicks: LockedPicks;
  currentChaosScore: number;
}) {
  const totalGames = gameTemplates.length;
  const { user } = useAuth();
  const [brackets, setBrackets] = useState<SavedBracket[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [workingAction, setWorkingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadBrackets = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await getUserBrackets(user.id);
    setBrackets(data);
    setLoading(false);
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
    setWorkingAction(null);
  };

  const handleOverwrite = async (bracketId: string, bracketName: string) => {
    if (!user) return;
    if (!window.confirm(`Overwrite "${bracketName}" with your current picks?`)) return;
    setWorkingAction(`overwrite:${bracketId}`);
    setActionError(null);
    const { error } = await saveBracket(user.id, currentPicks, bracketName, bracketId, currentChaosScore, { submit: true });
    if (error) {
      setActionError((error as { message?: string })?.message ?? "Overwrite failed.");
      setWorkingAction(null);
      return;
    }
    await loadBrackets();
    setWorkingAction(null);
  };

  const handleUnsubmit = async (bracketId: string) => {
    if (!user) return;
    if (!window.confirm("Unsubmit this bracket? You can resubmit until tip-off lock.")) return;
    setWorkingAction(`unsubmit:${bracketId}`);
    setActionError(null);
    const { error } = await setBracketSubmissionStatus(bracketId, user.id, false);
    if (error) {
      setActionError((error as { message?: string })?.message ?? "Unsubmit failed.");
      setWorkingAction(null);
      return;
    }
    await loadBrackets();
    setWorkingAction(null);
  };

  if (!isOpen) return null;

  const submittedCount = brackets.filter((bracket) => Boolean(bracket.submitted_at)).length;
  const submissionsLocked = brackets.some((bracket) => bracket.is_locked);

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
              return (
                <div key={bracket.id} className="my-bracket-card-v2">
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
                          onClick={() => handleOverwrite(bracket.id, bracket.bracket_name)}
                        >
                          Overwrite
                        </button>
                        {bracket.submitted_at ? (
                          <button
                            className="my-bracket-action-secondary"
                            disabled={workingAction !== null}
                            onClick={() => handleUnsubmit(bracket.id)}
                          >
                            Unsubmit
                          </button>
                        ) : null}
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
                        <button className="my-bracket-action-danger" disabled={workingAction !== null} onClick={() => handleDelete(bracket.id)}>
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {submittedCount < 25 && !submissionsLocked ? (
              <button className="my-bracket-new-btn" disabled={workingAction !== null} onClick={handleSaveNew}>
                + Submit current bracket as new ({25 - submittedCount} slot{25 - submittedCount !== 1 ? "s" : ""} remaining)
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
