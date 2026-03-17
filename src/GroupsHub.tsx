import { useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { BRACKET_PREDS_2026 } from "./data/bracketPreds2026";
import { teams } from "./data/teams";
import { getUserGroups, type UserGroup } from "./groupStorage";
import { captureError } from "./lib/errorMonitoring";
import { teamLogoUrl } from "./lib/logo";

const GROUP_LIMIT = 10;
const teamsByName = new Map(teams.map((team) => [team.name, team]));

type ChampionPreview = {
  name: string;
  logoUrl: string | null;
  seed: number | null;
  oddsLabel: string | null;
};

function formatChampionOdds(probability: number | null | undefined) {
  if (typeof probability !== "number" || !Number.isFinite(probability)) return null;
  return `${(probability * 100).toFixed(1)}% title odds`;
}

function getChampionPreview(group: UserGroup): ChampionPreview | null {
  const championName = group.championName?.trim();
  if (!championName) return null;

  const team = teamsByName.get(championName);
  return {
    name: championName,
    logoUrl: group.championLogoUrl || (team ? teamLogoUrl(team) : null),
    seed: group.championSeed ?? team?.seed ?? null,
    oddsLabel: formatChampionOdds(BRACKET_PREDS_2026[championName]?.champProb ?? null),
  };
}

function GroupChampionLogo({ preview }: { preview: ChampionPreview }) {
  const [failed, setFailed] = useState(false);

  if (!preview.logoUrl || failed) {
    return (
      <span className="grp-hub-card-champion-fallback" aria-hidden="true">
        {preview.seed ? `#${preview.seed}` : "?"}
      </span>
    );
  }

  return (
    <img
      src={preview.logoUrl}
      alt={`${preview.name} logo`}
      className="grp-hub-card-champion-logo"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function GroupsHub({
  isOpen,
  refreshToken = 0,
  onClose,
  onCreateGroup,
  onJoinGroup,
  onOpenGroup,
}: {
  isOpen: boolean;
  refreshToken?: number;
  onClose: () => void;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  onOpenGroup: (group: UserGroup) => void;
}) {
  const { user } = useAuth();
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    if (!user) {
      setGroups([]);
      setLoading(false);
      setErrorMsg("");
      return;
    }
    void loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, refreshToken, user]);

  async function loadGroups() {
    if (!user) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const { data, error } = await getUserGroups(user.id);
      if (error) {
        captureError("groups_hub_load", error);
        setErrorMsg(error.message || "Groups are taking longer than expected.");
      }
      setGroups(data);
    } catch (error) {
      captureError("groups_hub_load", error);
      setGroups([]);
      setErrorMsg((error as { message?: string })?.message ?? "Groups are taking longer than expected.");
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <section className="grp-hub-screen" aria-labelledby="groups-hub-title">
      <div className="grp-hub-scroll">
        <div className="grp-hub-shell">
          <button className="grp-hub-back" onClick={onClose} type="button">
            ← Bracket
          </button>

          <div className="grp-hub-hero">
            <h1 className="grp-hub-title" id="groups-hub-title">
              Compete with your friends.
            </h1>
            <p className="grp-hub-subtitle">
              Create a group, invite your crew, and see who really knows their stuff - standings, picks, and chaos ratings for your whole squad.
            </p>

            <div className="grp-hub-cta-row">
              <button className="grp-hub-cta" onClick={onCreateGroup} type="button">
                Create Group
              </button>
              <button className="grp-hub-cta grp-hub-cta--secondary" onClick={onJoinGroup} type="button">
                Join with Code
              </button>
            </div>
          </div>

          {errorMsg ? <p className="group-error grp-hub-error">{errorMsg}</p> : null}

          <div className="grp-hub-section-head">
            <span className="grp-hub-section-title">Your Groups</span>
            <span className="grp-hub-section-count">{groups.length} of {GROUP_LIMIT}</span>
          </div>

          {loading ? (
            <div className="groups-hub-loading">
              <span className="groups-hub-spinner">Loading groups...</span>
            </div>
          ) : groups.length === 0 ? (
            <div className="grp-hub-empty">
              <div className="grp-hub-empty-emoji" aria-hidden="true">🏆</div>
              <h2 className="grp-hub-empty-title">No groups yet</h2>
              <p className="grp-hub-empty-body">
                Create a group and share the invite code, or ask a friend for theirs.
              </p>
              <div className="grp-hub-empty-actions">
                <button className="grp-hub-cta grp-hub-cta--compact" onClick={onCreateGroup} type="button">
                  Create Group
                </button>
                <button
                  className="grp-hub-cta grp-hub-cta--secondary grp-hub-cta--compact"
                  onClick={onJoinGroup}
                  type="button"
                >
                  Join with Code
                </button>
              </div>
            </div>
          ) : (
            <div className="grp-hub-grid">
              {groups.map((group) => {
                const championPreview = getChampionPreview(group);
                return (
                  <button key={group.id} className="grp-hub-card" onClick={() => onOpenGroup(group)} type="button">
                    <div className="grp-hub-card-head">
                      <div className="grp-hub-card-title">
                        <span className="grp-hub-card-emoji">{group.emoji ?? "👥"}</span>
                        <span className="grp-hub-card-name">{group.name}</span>
                      </div>
                      <span className="grp-hub-card-members">
                        {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
                      </span>
                    </div>

                    <div className="grp-hub-card-divider" />

                    <div className="grp-hub-card-champion">
                      <span className="grp-hub-card-label">Your Champion</span>
                      {championPreview ? (
                        <div className="grp-hub-card-champion-row">
                          <GroupChampionLogo preview={championPreview} />
                          <div className="grp-hub-card-champion-copy">
                            <span className="grp-hub-card-champion-name">{championPreview.name}</span>
                            {championPreview.oddsLabel ? (
                              <span className="grp-hub-card-champion-odds">{championPreview.oddsLabel}</span>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <span className="grp-hub-card-empty-copy">No champion selected</span>
                      )}
                    </div>

                    <div className="grp-hub-card-foot">
                      <div className="grp-hub-card-foot-left">
                        {group.role === "admin" ? <span className="grp-hub-admin-badge">ADMIN</span> : null}
                      </div>
                      <span className="grp-hub-open">OPEN →</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
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
