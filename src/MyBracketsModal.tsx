import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import {
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
  currentPicks,
}: {
  isOpen: boolean;
  onClose: () => void;
  onLoadBracket: (bracket: SavedBracket) => void;
  currentPicks: LockedPicks;
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
    await renameBracket(bracketId, user.id, newName.trim());
    setEditingName(null);
    setNewName("");
    await loadBrackets();
  };

  const handleSaveNew = async () => {
    if (!user) return;
    const name = brackets.length === 0 ? "My Bracket" : brackets.length === 1 ? "Bracket #2" : "Bracket #3";
    await saveBracket(user.id, currentPicks, name);
    await loadBrackets();
  };

  const handleOverwrite = async (bracketId: string, bracketName: string) => {
    if (!user) return;
    if (!window.confirm(`Overwrite "${bracketName}" with your current picks?`)) return;
    await saveBracket(user.id, currentPicks, bracketName, bracketId);
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
          {brackets.length}/3 brackets saved. Load a bracket to view it, or save your current picks.
        </p>

        {loading ? (
          <p className="my-brackets-loading">Loading...</p>
        ) : (
          <div className="my-brackets-list">
            {brackets.map((bracket) => (
              <div key={bracket.id} className="my-bracket-card">
                <div className="my-bracket-card-top">
                  {editingName === bracket.id ? (
                    <div className="my-bracket-rename">
                      <input
                        className="auth-modal-input"
                        value={newName}
                        onChange={(event) => setNewName(event.target.value)}
                        maxLength={30}
                        autoFocus
                        onKeyDown={(event) => event.key === "Enter" && handleRename(bracket.id)}
                      />
                      <button className="my-bracket-rename-save" onClick={() => handleRename(bracket.id)}>
                        Save
                      </button>
                      <button className="my-bracket-rename-cancel" onClick={() => setEditingName(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="my-bracket-name">{bracket.bracket_name}</span>
                      {bracket.is_locked ? <span className="my-bracket-locked">🔒 Locked</span> : null}
                    </>
                  )}
                </div>

                <div className="my-bracket-card-meta">
                  <span>{Object.keys(bracket.picks ?? {}).length} picks</span>
                  <span>Updated {new Date(bracket.updated_at).toLocaleDateString()}</span>
                </div>

                <div className="my-bracket-card-actions">
                  <button
                    className="my-bracket-action-btn"
                    onClick={() => {
                      onLoadBracket(bracket);
                      onClose();
                    }}
                  >
                    Load
                  </button>
                  <button
                    className="my-bracket-action-btn"
                    onClick={() => handleOverwrite(bracket.id, bracket.bracket_name)}
                    disabled={bracket.is_locked}
                  >
                    Overwrite
                  </button>
                  <button
                    className="my-bracket-action-btn"
                    onClick={() => {
                      setEditingName(bracket.id);
                      setNewName(bracket.bracket_name);
                    }}
                    disabled={bracket.is_locked}
                  >
                    Rename
                  </button>
                  <button
                    className="my-bracket-action-btn my-bracket-action-btn--danger"
                    onClick={() => handleDelete(bracket.id)}
                    disabled={bracket.is_locked}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}

            {brackets.length < 3 ? (
              <button className="my-bracket-new-btn" onClick={handleSaveNew}>
                + Save current bracket as new ({3 - brackets.length} slot{3 - brackets.length !== 1 ? "s" : ""} remaining)
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

