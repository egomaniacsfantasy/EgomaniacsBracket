import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";
import { getGroupByCode, joinGroup, type GroupRow } from "./groupStorage";
import { getUserBrackets, type SavedBracket } from "./bracketStorage";
import { extractInviteCode, INVITE_CODE_LENGTH } from "./lib/inviteCode";
import { getBracketCompletionSummary } from "./lib/bracketCompletion";

export function JoinGroupModal({
  isOpen,
  onClose,
  onGroupJoined,
  initialCode,
  onRequestAuth,
  isLocked = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  onGroupJoined?: (group: GroupRow, hadBracket: boolean) => void;
  initialCode?: string | null;
  onRequestAuth?: (code?: string) => void;
  isLocked?: boolean;
}) {
  const lockedMessage =
    "Brackets are locked — you can no longer join groups with a new bracket. You can still view groups you're already a member of.";
  const { user } = useAuth();
  const [step, setStep] = useState<"code" | "bracket" | "done">("code");
  const [code, setCode] = useState(extractInviteCode(initialCode));
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [brackets, setBrackets] = useState<SavedBracket[]>([]);
  const [selectedBracket, setSelectedBracket] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [joinedWithoutBracket, setJoinedWithoutBracket] = useState(false);
  const normalizedInitialCode = extractInviteCode(initialCode);

  const lookupGroup = useCallback(async (lookupCodeRaw: string) => {
    const lookupCode = extractInviteCode(lookupCodeRaw);
    if (!lookupCode || !user) return;
    if (isLocked) {
      setError(lockedMessage);
      return;
    }
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
    const completeBrackets = userBrackets.filter((bracket) => getBracketCompletionSummary(bracket.picks ?? {}).isComplete);

    if (completeBrackets.length === 0) {
      // No complete brackets yet — join now and let the user attach one later.
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
  }, [isLocked, lockedMessage, user, onGroupJoined]);

  // Auto-lookup once user is available (key prop ensures initialCode is baked into state on mount)
  useEffect(() => {
    if (!isOpen || !normalizedInitialCode || step !== "code" || !user) return;
    if (isLocked) {
      setError(lockedMessage);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void lookupGroup(normalizedInitialCode);
    }, 100);

    return () => window.clearTimeout(timeoutId);
  }, [isLocked, isOpen, lockedMessage, lookupGroup, normalizedInitialCode, step, user]);

  useEffect(() => {
    if (!isOpen || !isLocked) return;
    setError(lockedMessage);
  }, [isLocked, isOpen, lockedMessage]);

  function handleLookup() {
    if (isLocked) {
      setError(lockedMessage);
      return;
    }
    if (code.trim().length !== INVITE_CODE_LENGTH) {
      setError(`Enter the full ${INVITE_CODE_LENGTH}-character invite code.`);
      return;
    }
    if (!user) {
      // Not logged in — request auth first
      onRequestAuth?.(code);
      return;
    }
    void lookupGroup(code);
  }

  function handleCodePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = extractInviteCode(event.clipboardData.getData("text"));
    if (!pasted) return;
    event.preventDefault();
    setCode(pasted);
  }

  async function handleJoin() {
    if (isLocked) {
      setError(lockedMessage);
      return;
    }
    if (!selectedBracket || !group || !user) return;
    const selected = brackets.find((bracket) => bracket.id === selectedBracket);
    if (!selected) {
      setError("Bracket not found. Please reload and try again.");
      return;
    }
    const completion = getBracketCompletionSummary(selected.picks ?? {});
    if (!completion.isComplete) {
      setError(
        `Complete the full bracket before using it in a group. ${completion.remainingSubmittableGames} required pick${completion.remainingSubmittableGames !== 1 ? "s" : ""} remaining.`
      );
      return;
    }
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
                onChange={(e) => setCode(extractInviteCode(e.target.value))}
                onPaste={handleCodePaste}
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
              disabled={isLocked || code.trim().length !== INVITE_CODE_LENGTH || loading}
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
                {brackets.map((b) => {
                  const completion = getBracketCompletionSummary(b.picks ?? {});
                  return (
                    <button
                      key={b.id}
                      className={`group-bracket-option ${selectedBracket === b.id ? "group-bracket-option--selected" : ""}`}
                      disabled={!completion.isComplete}
                      onClick={() => setSelectedBracket(b.id)}
                    >
                      <div className="group-bracket-option-info">
                        <span className="group-bracket-option-name">{b.bracket_name}</span>
                        <span className="group-bracket-option-meta">
                          {completion.completedGames}/{completion.totalGames} picks
                          {!completion.isComplete
                            ? ` · ${completion.remainingSubmittableGames} required pick${completion.remainingSubmittableGames !== 1 ? "s" : ""} remaining`
                            : ""}
                          {b.is_locked && " · 🔒 Locked"}
                        </span>
                      </div>
                      <div
                        className={`group-bracket-radio ${selectedBracket === b.id ? "group-bracket-radio--checked" : ""}`}
                      />
                    </button>
                  );
                })}
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
              <button className="group-cta-btn" onClick={handleJoin} disabled={isLocked || !selectedBracket || loading}>
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
