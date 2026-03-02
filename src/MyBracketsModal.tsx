import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import {
  formatChaosScore,
  type SavedBracket,
  deleteBracket,
  getUserBrackets,
  renameBracket,
  saveBracket,
} from "./bracketStorage";
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
  const { user } = useAuth();
  const [brackets, setBrackets] = useState<SavedBracket[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

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
    await deleteBracket(bracketId, user.id);
    await loadBrackets();
  };

  const handleRename = async (bracketId: string) => {
    if (!user || !newName.trim()) return;
    const { error } = await renameBracket(bracketId, user.id, newName.trim());
    if (error) return;
    setEditingName(null);
    setNewName("");
    await loadBrackets();
    onRenameSuccess?.();
  };

  const handleSaveNew = async () => {
    if (!user) return;
    const name = brackets.length === 0 ? "My Bracket" : `Bracket #${Math.min(25, brackets.length + 1)}`;
    await saveBracket(user.id, currentPicks, name, null, currentChaosScore);
    await loadBrackets();
  };

  const handleOverwrite = async (bracketId: string, bracketName: string) => {
    if (!user) return;
    if (!window.confirm(`Overwrite "${bracketName}" with your current picks?`)) return;
    await saveBracket(user.id, currentPicks, bracketName, bracketId, currentChaosScore);
    await loadBrackets();
  };

  if (!isOpen) return null;

  return (
    <div className="auth-modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="my-brackets-modal">
        <button className="auth-modal-close" onClick={onClose}>
          ✕
        </button>
        <h3 className="auth-modal-title">My Brackets</h3>
        <p className="auth-modal-subtitle">
          {brackets.length}/25 brackets saved. Load a bracket to view it, or save your current picks.
        </p>

        {loading ? (
          <p className="my-brackets-loading">Loading...</p>
        ) : (
          <div className="my-brackets-list">
            {brackets.map((bracket) => {
              const pickCount = Object.keys(bracket.picks ?? {}).length;
              const completionPct = Math.round((pickCount / 63) * 100);
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
                  </div>

                  <div className="my-bracket-stats-row">
                    <div className="my-bracket-stat">
                      <span className="my-bracket-stat-value">{pickCount}/63</span>
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
                          onClick={() => handleOverwrite(bracket.id, bracket.bracket_name)}
                        >
                          Overwrite
                        </button>
                        <button
                          className="my-bracket-action-secondary"
                          onClick={() => {
                            setEditingName(bracket.id);
                            setNewName(bracket.bracket_name);
                          }}
                        >
                          Rename
                        </button>
                        <button className="my-bracket-action-danger" onClick={() => handleDelete(bracket.id)}>
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {brackets.length < 25 ? (
              <button className="my-bracket-new-btn" onClick={handleSaveNew}>
                + Save current bracket as new ({25 - brackets.length} slot{25 - brackets.length !== 1 ? "s" : ""} remaining)
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
