import { useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { getUserGroups, type UserGroup } from "./groupStorage";
import { captureError } from "./lib/errorMonitoring";

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
    try {
      const { data, error } = await getUserGroups(user.id);
      if (error) {
        captureError("groups_hub_load", error);
      }
      setGroups(data);
    } catch (error) {
      captureError("groups_hub_load", error);
      setGroups([]);
    } finally {
      setLoading(false);
    }
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
          <div className="groups-empty">
            <div className="groups-empty-icon">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 8C12 8 6 8 6 14V22C6 22 6 28 12 28" stroke="rgba(184,125,24,0.5)" strokeWidth="2" strokeLinecap="round" fill="none"/>
                <path d="M36 8C36 8 42 8 42 14V22C42 22 42 28 36 28" stroke="rgba(184,125,24,0.5)" strokeWidth="2" strokeLinecap="round" fill="none"/>
                <circle cx="19" cy="20" r="3" fill="rgba(184,125,24,0.4)"/>
                <path d="M13 30C13 26.5 15.5 24 19 24C22.5 24 25 26.5 25 30" stroke="rgba(184,125,24,0.4)" strokeWidth="1.5" fill="none"/>
                <circle cx="29" cy="20" r="3" fill="rgba(184,125,24,0.4)"/>
                <path d="M23 30C23 26.5 25.5 24 29 24C32.5 24 35 26.5 35 30" stroke="rgba(184,125,24,0.4)" strokeWidth="1.5" fill="none"/>
              </svg>
            </div>
            <h3 className="groups-empty-title">Compete with friends</h3>
            <p className="groups-empty-body">
              Create a private group, invite your crew, and see who actually knows March Madness.
            </p>
            <div className="groups-empty-actions">
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
                  <span className="groups-hub-card-emoji">{g.emoji ?? "👥"}</span>
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
    try {
      const { data, error } = await getUserGroups(user.id);
      if (error) {
        captureError("groups_hub_inline_load", error);
      }
      setGroups(data);
    } catch (error) {
      captureError("groups_hub_inline_load", error);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return (
      <div className="groups-empty" style={{ padding: "48px 24px" }}>
        <div className="groups-empty-icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 8C12 8 6 8 6 14V22C6 22 6 28 12 28" stroke="rgba(184,125,24,0.5)" strokeWidth="2" strokeLinecap="round" fill="none"/>
            <path d="M36 8C36 8 42 8 42 14V22C42 22 42 28 36 28" stroke="rgba(184,125,24,0.5)" strokeWidth="2" strokeLinecap="round" fill="none"/>
            <circle cx="19" cy="20" r="3" fill="rgba(184,125,24,0.4)"/>
            <path d="M13 30C13 26.5 15.5 24 19 24C22.5 24 25 26.5 25 30" stroke="rgba(184,125,24,0.4)" strokeWidth="1.5" fill="none"/>
            <circle cx="29" cy="20" r="3" fill="rgba(184,125,24,0.4)"/>
            <path d="M23 30C23 26.5 25.5 24 29 24C32.5 24 35 26.5 35 30" stroke="rgba(184,125,24,0.4)" strokeWidth="1.5" fill="none"/>
          </svg>
        </div>
        <h3 className="groups-empty-title">Sign in to use Groups</h3>
        <p className="groups-empty-body">Create or join groups to compete with friends</p>
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
      <div className="groups-empty" style={{ padding: "48px 24px" }}>
        <div className="groups-empty-icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 8C12 8 6 8 6 14V22C6 22 6 28 12 28" stroke="rgba(184,125,24,0.5)" strokeWidth="2" strokeLinecap="round" fill="none"/>
            <path d="M36 8C36 8 42 8 42 14V22C42 22 42 28 36 28" stroke="rgba(184,125,24,0.5)" strokeWidth="2" strokeLinecap="round" fill="none"/>
            <circle cx="19" cy="20" r="3" fill="rgba(184,125,24,0.4)"/>
            <path d="M13 30C13 26.5 15.5 24 19 24C22.5 24 25 26.5 25 30" stroke="rgba(184,125,24,0.4)" strokeWidth="1.5" fill="none"/>
            <circle cx="29" cy="20" r="3" fill="rgba(184,125,24,0.4)"/>
            <path d="M23 30C23 26.5 25.5 24 29 24C32.5 24 35 26.5 35 30" stroke="rgba(184,125,24,0.4)" strokeWidth="1.5" fill="none"/>
          </svg>
        </div>
        <h3 className="groups-empty-title">Compete with friends</h3>
        <p className="groups-empty-body">
          Create a private group, invite your crew, and see who actually knows March Madness.
        </p>
        <div className="groups-empty-actions">
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
            <span className="groups-hub-card-emoji">{g.emoji ?? "👥"}</span>
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
