import { useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { getUserGroups, type UserGroup } from "./groupStorage";

export function GroupsHub({
  isOpen,
  onClose,
  onCreateGroup,
  onJoinGroup,
  onOpenGroup,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  onOpenGroup: (group: UserGroup) => void;
}) {
  const { user } = useAuth();
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && user) {
      loadGroups();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, user]);

  async function loadGroups() {
    if (!user) return;
    setLoading(true);
    const { data } = await getUserGroups(user.id);
    setGroups(data);
    setLoading(false);
  }

  if (!isOpen) return null;

  return (
    <div className="group-modal-overlay" onClick={onClose}>
      <div className="groups-hub-panel" onClick={(e) => e.stopPropagation()}>
        <div className="groups-hub-header">
          <h2 className="groups-hub-title">My Groups</h2>
          <button className="group-modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {loading ? (
          <div className="groups-hub-loading">
            <span className="groups-hub-spinner">Loading groups...</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="groups-hub-empty">
            <span className="groups-hub-empty-icon">👥</span>
            <p className="groups-hub-empty-title">No groups yet</p>
            <p className="groups-hub-empty-subtitle">Create a group and invite friends to compete</p>
            <div className="groups-hub-empty-actions">
              <button className="group-cta-btn" onClick={onCreateGroup}>
                Create a Group
              </button>
              <button className="group-secondary-btn" onClick={onJoinGroup}>
                Join with Code
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="groups-hub-list">
              {groups.map((g) => (
                <button key={g.id} className="groups-hub-card" onClick={() => onOpenGroup(g)}>
                  <div className="groups-hub-card-left">
                    <span className="groups-hub-card-name">{g.name}</span>
                    <span className="groups-hub-card-meta">
                      {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                      {g.role === "admin" && " · Admin"}
                    </span>
                  </div>
                  <span className="groups-hub-card-arrow">→</span>
                </button>
              ))}
            </div>

            <div className="groups-hub-footer">
              <button className="group-cta-btn" onClick={onCreateGroup}>
                + Create Group
              </button>
              <button className="group-secondary-btn" onClick={onJoinGroup}>
                Join with Code
              </button>
              <span className="groups-hub-limit">{groups.length}/10 groups</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function GroupsHubInline({
  onCreateGroup,
  onJoinGroup,
  onOpenGroup,
}: {
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  onOpenGroup: (group: UserGroup) => void;
}) {
  const { user } = useAuth();
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadGroups();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function loadGroups() {
    if (!user) return;
    setLoading(true);
    const { data } = await getUserGroups(user.id);
    setGroups(data);
    setLoading(false);
  }

  if (!user) {
    return (
      <div className="groups-hub-empty" style={{ padding: "48px 24px" }}>
        <span className="groups-hub-empty-icon">👥</span>
        <p className="groups-hub-empty-title">Sign in to use Groups</p>
        <p className="groups-hub-empty-subtitle">Create or join groups to compete with friends</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="groups-hub-loading">
        <span className="groups-hub-spinner">Loading groups...</span>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="groups-hub-empty" style={{ padding: "48px 24px" }}>
        <span className="groups-hub-empty-icon">👥</span>
        <p className="groups-hub-empty-title">No groups yet</p>
        <p className="groups-hub-empty-subtitle">Create a group and invite friends to compete</p>
        <div className="groups-hub-empty-actions">
          <button className="group-cta-btn" onClick={onCreateGroup}>
            Create a Group
          </button>
          <button className="group-secondary-btn" onClick={onJoinGroup}>
            Join with Code
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px" }}>
      <div className="groups-hub-list">
        {groups.map((g) => (
          <button key={g.id} className="groups-hub-card" onClick={() => onOpenGroup(g)}>
            <div className="groups-hub-card-left">
              <span className="groups-hub-card-name">{g.name}</span>
              <span className="groups-hub-card-meta">
                {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                {g.role === "admin" && " · Admin"}
              </span>
            </div>
            <span className="groups-hub-card-arrow">→</span>
          </button>
        ))}
      </div>

      <div className="groups-hub-footer" style={{ borderTop: "none", paddingTop: "12px" }}>
        <button className="group-cta-btn" onClick={onCreateGroup}>
          + Create Group
        </button>
        <button className="group-secondary-btn" onClick={onJoinGroup}>
          Join with Code
        </button>
        <span className="groups-hub-limit">{groups.length}/10 groups</span>
      </div>
    </div>
  );
}
