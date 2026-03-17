import { useMemo } from "react";
import type { GroupMember } from "./groupStorage";

function formatJoinedDate(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(parsed));
}

export function GroupMembersTab({
  members,
  currentUserId,
  onSelectBracket,
}: {
  members: GroupMember[];
  currentUserId: string | undefined;
  onSelectBracket?: () => void;
}) {
  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      if (a.user_id === currentUserId && b.user_id !== currentUserId) return -1;
      if (b.user_id === currentUserId && a.user_id !== currentUserId) return 1;
      if (a.role === "admin" && b.role !== "admin") return -1;
      if (b.role === "admin" && a.role !== "admin") return 1;
      if (a.has_submitted_bracket && !b.has_submitted_bracket) return -1;
      if (b.has_submitted_bracket && !a.has_submitted_bracket) return 1;
      return a.display_name.localeCompare(b.display_name);
    });
  }, [currentUserId, members]);

  const submittedCount = members.filter((member) => member.has_submitted_bracket).length;
  const selectedCount = members.filter((member) => member.has_assigned_bracket).length;
  const noBracketCount = members.filter((member) => !member.has_assigned_bracket).length;

  if (members.length === 0) {
    return (
      <div className="gd-locked-state">
        <span className="gd-locked-icon">👥</span>
        <h3>No members loaded</h3>
        <p>We could not load the member list for this group yet.</p>
      </div>
    );
  }

  return (
    <div className="gm-tab">
      <div className="gm-summary-grid">
        <div className="gm-summary-card">
          <span className="gm-summary-label">Members</span>
          <span className="gm-summary-value">{members.length}</span>
        </div>
        <div className="gm-summary-card">
          <span className="gm-summary-label">Submitted</span>
          <span className="gm-summary-value">{submittedCount}</span>
        </div>
        <div className="gm-summary-card">
          <span className="gm-summary-label">No Bracket Yet</span>
          <span className="gm-summary-value">{noBracketCount}</span>
        </div>
      </div>

      <p className="gm-intro">
        {submittedCount} of {members.length} {members.length === 1 ? "member has" : "members have"} a bracket in the standings.
        {selectedCount > submittedCount ? ` ${selectedCount - submittedCount} more ${selectedCount - submittedCount === 1 ? "member has" : "members have"} picked a bracket but not submitted it yet.` : ""}
      </p>

      <div className="gm-list">
        {sortedMembers.map((member) => {
          const isCurrentUser = member.user_id === currentUserId;
          const joinedLabel = formatJoinedDate(member.joined_at);
          const statusLabel = member.has_submitted_bracket
            ? "Submitted"
            : member.has_assigned_bracket
              ? "Bracket Selected"
              : "No Bracket Yet";
          const statusTone = member.has_submitted_bracket
            ? "submitted"
            : member.has_assigned_bracket
              ? "selected"
              : "missing";

          return (
            <div key={member.id} className={`gm-row ${isCurrentUser ? "gm-row--you" : ""}`}>
              <div className="gm-row-main">
                <div className="gm-row-name-line">
                  <span className="gm-row-name">{member.display_name}</span>
                  {isCurrentUser ? <span className="gd-player-you">YOU</span> : null}
                  {member.role === "admin" ? <span className="gm-role-chip">Admin</span> : null}
                </div>

                <div className="gm-row-meta">
                  <span>
                    {member.has_assigned_bracket
                      ? member.bracket_name || "Bracket selected"
                      : "No bracket selected"}
                  </span>
                  {joinedLabel ? <span>Joined {joinedLabel}</span> : null}
                </div>
              </div>

              <div className="gm-row-side">
                <span className={`gm-status gm-status--${statusTone}`}>{statusLabel}</span>
                {!member.has_assigned_bracket && isCurrentUser && onSelectBracket ? (
                  <button
                    className="gm-select-btn"
                    type="button"
                    onClick={onSelectBracket}
                  >
                    Select Bracket
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
