import { useState } from "react";
import { useAuth } from "./AuthContext";
import { createGroup, joinOwnGroup, type GroupRow } from "./groupStorage";
import { GROUP_EMOJIS } from "./constants";

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
  const [step, setStep] = useState<"name" | "done">("name");
  const [groupName, setGroupName] = useState("");
  const [selectedEmoji, setSelectedEmoji] = useState("🏀");
  const [createdGroup, setCreatedGroup] = useState<GroupRow | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCreateGroup() {
    if (!groupName.trim() || !user) return;
    if (groupName.trim().length > 40) {
      setError("Group name must be 40 characters or fewer.");
      return;
    }
    setError("");
    setLoading(true);

    const { data: group, error: createError } = await createGroup(user.id, groupName.trim(), selectedEmoji);
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

    const { error: joinError } = await joinOwnGroup(group.id, user.id, null);
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
    const link = `${window.location.origin}/join.html?code=${createdGroup.invite_code}`;
    const message = `Join my group "${createdGroup.name}" on The Bracket Lab and compete to see who has the best bracket! 🏀\n${link}`;
    navigator.clipboard.writeText(message).then(() => {
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

  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  async function handleNativeShare() {
    if (!createdGroup) return;
    const link = `${window.location.origin}/join.html?code=${createdGroup.invite_code}`;
    try {
      await navigator.share({
        title: `Join ${createdGroup.name} on The Bracket Lab`,
        text: `Join my group "${createdGroup.name}" on The Bracket Lab and compete to see who has the best bracket! 🏀`,
        url: link,
      });
    } catch {
      // User cancelled share sheet — no action needed
    }
  }

  function handleClose() {
    setStep("name");
    setGroupName("");
    setSelectedEmoji("🏀");
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
              <span className="group-modal-icon">{selectedEmoji}</span>
              <h2 className="group-modal-title">Create a Group</h2>
              <p className="group-modal-subtitle">Compete against friends with your bracket</p>
            </div>

            <div className="group-modal-body">
              <label className="group-input-label">Group Emoji</label>
              <div className="group-emoji-grid">
                {GROUP_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={`group-emoji-btn ${selectedEmoji === e ? "group-emoji-btn--selected" : ""}`}
                    onClick={() => setSelectedEmoji(e)}
                  >
                    {e}
                  </button>
                ))}
              </div>

              <label className="group-input-label">Group Name</label>
              <input
                type="text"
                className="group-input"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Office Pool 2026"
                maxLength={40}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
              />
              <span className="group-input-hint">{groupName.length}/40</span>

              {error && <p className="group-error">{error}</p>}
            </div>

            <button className="group-cta-btn" onClick={handleCreateGroup} disabled={!groupName.trim() || loading}>
              {loading ? "Creating..." : "Create Group"}
            </button>
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
              <div className="invite-code-display">
                <span className="invite-code-label">YOUR GROUP CODE</span>
                <span className="invite-code-value">{createdGroup.invite_code}</span>
              </div>

              <div className="invite-actions">
                <button className="invite-copy-btn" onClick={handleCopyCode}>
                  {copied ? "✓ Copied!" : "📋 Copy Invite"}
                </button>
                {canNativeShare && (
                  <button className="invite-share-btn" onClick={handleNativeShare}>
                    📤 Share
                  </button>
                )}
              </div>

              <div className="invite-preview">
                <span className="invite-preview-label">What gets copied:</span>
                <p className="invite-preview-text">
                  {`Join my group "${createdGroup.name}" on The Bracket Lab and compete to see who has the best bracket! 🏀\n${window.location.origin}/join.html?code=${createdGroup.invite_code}`}
                </p>
              </div>

              <p className="group-invite-hint">You can add your bracket from the group page.</p>
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
