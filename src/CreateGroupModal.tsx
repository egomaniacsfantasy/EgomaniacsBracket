import { useState } from "react";
import { useAuth } from "./AuthContext";
import { createGroup, joinOwnGroup, type GroupRow } from "./groupStorage";
import { getUserBrackets, type SavedBracket } from "./bracketStorage";

export function CreateGroupModal({
  isOpen,
  onClose,
  onGroupCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onGroupCreated?: (group: GroupRow) => void;
}) {
  const { user } = useAuth();
  const [step, setStep] = useState<"name" | "bracket" | "done">("name");
  const [groupName, setGroupName] = useState("");
  const [brackets, setBrackets] = useState<SavedBracket[]>([]);
  const [selectedBracket, setSelectedBracket] = useState<string | null>(null);
  const [createdGroup, setCreatedGroup] = useState<GroupRow | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleNameSubmit() {
    if (!groupName.trim() || !user) return;
    if (groupName.trim().length > 40) {
      setError("Group name must be 40 characters or fewer.");
      return;
    }
    setError("");
    setLoading(true);

    const { data } = await getUserBrackets(user.id);
    setBrackets(data);
    setLoading(false);

    if (data.length === 0) {
      setError("You need at least one saved bracket to create a group. Save your current bracket first!");
      return;
    }

    setStep("bracket");
  }

  async function handleCreate() {
    if (!selectedBracket || !user) return;
    setLoading(true);
    setError("");

    const { data: group, error: createError } = await createGroup(user.id, groupName.trim());
    if (createError) {
      setError(createError.message || "Failed to create group.");
      setLoading(false);
      return;
    }
    if (!group) {
      setError("Failed to create group.");
      setLoading(false);
      return;
    }

    const { error: joinError } = await joinOwnGroup(group.id, user.id, selectedBracket);
    if (joinError) {
      setError(joinError.message || "Group created but failed to add you. Try joining with the code.");
      setLoading(false);
      return;
    }

    setCreatedGroup(group);
    setStep("done");
    setLoading(false);
    onGroupCreated?.(group);
  }

  function handleCopyCode() {
    if (!createdGroup) return;
    const link = `${window.location.origin}?join=${createdGroup.invite_code}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  function handleCopyCodeOnly() {
    if (!createdGroup) return;
    navigator.clipboard.writeText(createdGroup.invite_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  function handleClose() {
    setStep("name");
    setGroupName("");
    setBrackets([]);
    setSelectedBracket(null);
    setCreatedGroup(null);
    setError("");
    setLoading(false);
    setCopied(false);
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="group-modal-overlay" onClick={handleClose}>
      <div className="group-modal" onClick={(e) => e.stopPropagation()}>
        <button className="group-modal-close-btn" onClick={handleClose}>
          ✕
        </button>

        {step === "name" && (
          <>
            <div className="group-modal-header">
              <span className="group-modal-icon">👥</span>
              <h2 className="group-modal-title">Create a Group</h2>
              <p className="group-modal-subtitle">Compete against friends with your bracket</p>
            </div>

            <div className="group-modal-body">
              <label className="group-input-label">Group Name</label>
              <input
                type="text"
                className="group-input"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Office Pool 2026"
                maxLength={40}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
              />
              <span className="group-input-hint">{groupName.length}/40</span>

              {error && <p className="group-error">{error}</p>}
            </div>

            <button className="group-cta-btn" onClick={handleNameSubmit} disabled={!groupName.trim() || loading}>
              {loading ? "Loading..." : "Next — Pick Your Bracket"}
            </button>
          </>
        )}

        {step === "bracket" && (
          <>
            <div className="group-modal-header">
              <span className="group-modal-icon">🏀</span>
              <h2 className="group-modal-title">Choose Your Bracket</h2>
              <p className="group-modal-subtitle">
                Which bracket do you want to enter into &ldquo;{groupName}&rdquo;?
              </p>
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

              {error && <p className="group-error">{error}</p>}
            </div>

            <div className="group-modal-actions">
              <button className="group-back-btn" onClick={() => setStep("name")}>
                ← Back
              </button>
              <button className="group-cta-btn" onClick={handleCreate} disabled={!selectedBracket || loading}>
                {loading ? "Creating..." : "Create Group"}
              </button>
            </div>
          </>
        )}

        {step === "done" && createdGroup && (
          <>
            <div className="group-modal-header">
              <span className="group-modal-icon">🎉</span>
              <h2 className="group-modal-title">Group Created!</h2>
              <p className="group-modal-subtitle">Share this code with friends to invite them</p>
            </div>

            <div className="group-modal-body group-modal-body--done">
              <div className="group-invite-code-display">
                <span className="group-invite-code-label">INVITE CODE</span>
                <span className="group-invite-code-value">{createdGroup.invite_code}</span>
              </div>

              <button className="group-copy-link-btn" onClick={handleCopyCode}>
                {copied ? "✓ Link Copied!" : "🔗 Copy Invite Link"}
              </button>

              <button className="group-copy-code-btn" onClick={handleCopyCodeOnly}>
                {copied ? "✓ Copied!" : "Copy Code Only"}
              </button>

              <p className="group-invite-hint">Friends can also join at bracket.oddsgods.net with this code.</p>
            </div>

            <button className="group-cta-btn" onClick={handleClose}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
