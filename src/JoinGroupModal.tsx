import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";
import { getGroupByCode, joinGroup, type GroupRow } from "./groupStorage";
import { getUserBrackets, type SavedBracket } from "./bracketStorage";

export function JoinGroupModal({
  isOpen,
  onClose,
  onGroupJoined,
  initialCode,
  onRequestAuth,
}: {
  isOpen: boolean;
  onClose: () => void;
  onGroupJoined?: (group: GroupRow, hadBracket: boolean) => void;
  initialCode?: string | null;
  onRequestAuth?: () => void;
}) {
  const { user } = useAuth();
  const [step, setStep] = useState<"code" | "bracket" | "done">("code");
  const [code, setCode] = useState(initialCode || "");
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [brackets, setBrackets] = useState<SavedBracket[]>([]);
  const [selectedBracket, setSelectedBracket] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [joinedWithoutBracket, setJoinedWithoutBracket] = useState(false);

  const lookupGroup = useCallback(async (lookupCodeRaw: string) => {
    const lookupCode = lookupCodeRaw.trim().toUpperCase();
    if (!lookupCode || !user) return;
    setLoading(true);
    setError("");

    const { data, error: lookupError } = await getGroupByCode(lookupCode);
    if (lookupError || !data) {
      setError("No group found with that code. Double-check and try again.");
      setLoading(false);
      return;
    }

    setGroup(data);

    const { data: userBrackets } = await getUserBrackets(user.id);
    setBrackets(userBrackets);
    setLoading(false);

    if (userBrackets.length === 0) {
      // No brackets yet — auto-join without a bracket
      const { error: joinError } = await joinGroup(data.invite_code, user.id, null);
      if (joinError) {
        setError(joinError.message);
        return;
      }
      setJoinedWithoutBracket(true);
      setStep("done");
      onGroupJoined?.(data, false);
      return;
    }

    setStep("bracket");
  }, [user, onGroupJoined]);

  // Auto-lookup once user is available (key prop ensures initialCode is baked into state on mount)
  useEffect(() => {
    if (!isOpen || !initialCode || step !== "code" || !user) return;

    const timeoutId = window.setTimeout(() => {
      void lookupGroup(initialCode);
    }, 100);

    return () => window.clearTimeout(timeoutId);
  }, [initialCode, isOpen, lookupGroup, step, user]);

  function handleLookup() {
    if (!user) {
      // Not logged in — request auth first
      onRequestAuth?.();
      return;
    }
    void lookupGroup(code);
  }

  async function handleJoin() {
    if (!selectedBracket || !group || !user) return;
    setLoading(true);
    setError("");

    const { error: joinError } = await joinGroup(group.invite_code, user.id, selectedBracket);
    if (joinError) {
      setError(joinError.message);
      setLoading(false);
      return;
    }

    setJoinedWithoutBracket(false);
    setStep("done");
    setLoading(false);
    onGroupJoined?.(group, true);
  }

  function handleClose() {
    setStep("code");
    setCode("");
    setGroup(null);
    setBrackets([]);
    setSelectedBracket(null);
    setError("");
    setLoading(false);
    setJoinedWithoutBracket(false);
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="group-modal-overlay" onClick={handleClose}>
      <div className="group-modal" onClick={(e) => e.stopPropagation()}>
        <button className="group-modal-close-btn" onClick={handleClose}>
          ✕
        </button>

        {step === "code" && (
          <>
            <div className="group-modal-header">
              <span className="group-modal-icon">🔑</span>
              <h2 className="group-modal-title">Join a Group</h2>
              <p className="group-modal-subtitle">Enter the invite code from your friend</p>
            </div>

            <div className="group-modal-body">
              <label className="group-input-label">INVITE CODE</label>
              <input
                type="text"
                className="group-input group-input--code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. CHAOS26A"
                maxLength={8}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                style={{
                  textAlign: "center",
                  letterSpacing: "0.15em",
                  fontFamily: "var(--font-mono)",
                  fontSize: "20px",
                  fontWeight: 700,
                }}
              />
              {error && <p className="group-error">{error}</p>}
            </div>

            <button
              className="group-cta-btn"
              onClick={handleLookup}
              disabled={code.trim().length < 4 || loading}
            >
              {loading ? "Looking up..." : "Find Group"}
            </button>
          </>
        )}

        {step === "bracket" && group && (
          <>
            <div className="group-modal-header">
              <span className="group-modal-icon">{group.emoji ?? "👥"}</span>
              <h2 className="group-modal-title">{group.name}</h2>
              <p className="group-modal-subtitle">Choose which bracket to enter</p>
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
              <button
                className="group-back-btn"
                onClick={() => {
                  setStep("code");
                  setGroup(null);
                }}
              >
                ← Back
              </button>
              <button className="group-cta-btn" onClick={handleJoin} disabled={!selectedBracket || loading}>
                {loading ? "Joining..." : "Join Group"}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <div className="group-modal-header">
              <span className="group-modal-icon">🎉</span>
              <h2 className="group-modal-title">You&apos;re In!</h2>
              <p className="group-modal-subtitle">
                {joinedWithoutBracket
                  ? `You've joined ${group?.name}! Now fill out your bracket and submit it.`
                  : `You've joined ${group?.name}`}
              </p>
            </div>
            <button className="group-cta-btn" onClick={handleClose}>
              {joinedWithoutBracket ? "Start My Bracket" : "Back to Groups"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
