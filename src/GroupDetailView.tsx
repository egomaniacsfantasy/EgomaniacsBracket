import { useState, useEffect, useMemo } from "react";
import { useAuth } from "./AuthContext";
import { getGroupStandings, leaveGroup, deleteGroup, type GroupStanding, type UserGroup } from "./groupStorage";
import { GroupStandingsTab } from "./GroupStandingsTab";
import { GroupPicksTab } from "./GroupPicksTab";
import { GroupChaosTab } from "./GroupChaosTab";
import { BracketViewer } from "./BracketViewer";

type RankedStanding = GroupStanding & { groupRank: number };

export function GroupDetailView({
  group,
  isOpen,
  onClose,
  tournamentStarted,
  tournamentResults,
}: {
  group: UserGroup | null;
  isOpen: boolean;
  onClose: () => void;
  tournamentStarted: boolean;
  tournamentResults?: unknown;
}) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"standings" | "picks" | "chaos">("standings");
  const [standings, setStandings] = useState<GroupStanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingBracket, setViewingBracket] = useState<{
    bracketId: string;
    displayName: string;
    bracketName: string;
  } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);

  const isAdmin = group?.created_by === user?.id;

  useEffect(() => {
    if (isOpen && group) {
      loadStandings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, group]);

  async function loadStandings() {
    if (!group) return;
    setLoading(true);
    const { data } = await getGroupStandings(group.id);
    setStandings(data);
    setLoading(false);
  }

  function handleCopyInvite() {
    if (!group) return;
    const link = `${window.location.origin}?join=${group.invite_code}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  async function handleLeave() {
    if (!group || !user) return;
    if (!confirm("Leave this group? You can rejoin later with the invite code.")) return;
    await leaveGroup(group.id, user.id);
    onClose();
  }

  async function handleDelete() {
    if (!group) return;
    if (!confirm(`Delete "${group.name}" permanently? All members will be removed. This cannot be undone.`)) return;
    await deleteGroup(group.id);
    onClose();
  }

  const rankedStandings: RankedStanding[] = useMemo(() => {
    const sorted = [...standings].sort((a, b) => {
      if ((b.total_score || 0) !== (a.total_score || 0)) return (b.total_score || 0) - (a.total_score || 0);
      if ((b.correct_picks || 0) !== (a.correct_picks || 0)) return (b.correct_picks || 0) - (a.correct_picks || 0);
      return 0;
    });

    let rank = 1;
    return sorted.map((entry, i) => {
      if (i > 0) {
        const prev = sorted[i - 1];
        if (entry.total_score !== prev.total_score || entry.correct_picks !== prev.correct_picks) {
          rank = i + 1;
        }
      }
      return { ...entry, groupRank: rank };
    });
  }, [standings]);

  const soleLeader = useMemo(() => {
    if (rankedStandings.length === 0) return null;
    const leaders = rankedStandings.filter((s) => s.groupRank === 1);
    return leaders.length === 1 ? leaders[0].user_id : null;
  }, [rankedStandings]);

  if (!isOpen || !group) return null;

  if (viewingBracket) {
    return (
      <BracketViewer
        bracketId={viewingBracket.bracketId}
        displayName={viewingBracket.displayName}
        bracketName={viewingBracket.bracketName}
        onBack={() => setViewingBracket(null)}
        tournamentResults={tournamentResults}
      />
    );
  }

  return (
    <div className="group-detail-overlay">
      <div className="group-detail-header">
        <button className="group-detail-back" onClick={onClose}>
          ← Groups
        </button>

        <div className="group-detail-title-area">
          <h1 className="group-detail-name">{group.name}</h1>
          <span className="group-detail-meta">
            {standings.length} {standings.length === 1 ? "member" : "members"}
          </span>
        </div>

        <div className="group-detail-header-actions">
          <button className="group-invite-btn" onClick={handleCopyInvite}>
            {copied ? "✓ Copied!" : "🔗 Invite"}
          </button>
          <button className="group-settings-btn" onClick={() => setShowSettings(!showSettings)}>
            ⋯
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="group-settings-dropdown">
          <div className="group-settings-code">
            <span className="group-settings-code-label">INVITE CODE</span>
            <span className="group-settings-code-value">{group.invite_code}</span>
          </div>
          {!isAdmin && (
            <button className="group-settings-action group-settings-action--danger" onClick={handleLeave}>
              Leave Group
            </button>
          )}
          {isAdmin && (
            <button className="group-settings-action group-settings-action--danger" onClick={handleDelete}>
              Delete Group
            </button>
          )}
        </div>
      )}

      <div className="group-tab-bar">
        {(["standings", "picks", "chaos"] as const).map((tab) => (
          <button
            key={tab}
            className={`group-tab ${activeTab === tab ? "group-tab--active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "standings" && "🏆 Standings"}
            {tab === "picks" && "🗺️ Picks"}
            {tab === "chaos" && "🌀 Chaos"}
          </button>
        ))}
      </div>

      <div className="group-detail-content">
        {loading ? (
          <div className="group-detail-loading">Loading group data...</div>
        ) : (
          <>
            {activeTab === "standings" && (
              <GroupStandingsTab
                standings={rankedStandings}
                soleLeader={soleLeader}
                currentUserId={user?.id}
                tournamentStarted={tournamentStarted}
                onViewBracket={setViewingBracket}
                onRefresh={loadStandings}
              />
            )}
            {activeTab === "picks" && (
              <GroupPicksTab
                standings={rankedStandings}
                currentUserId={user?.id}
                tournamentStarted={tournamentStarted}
              />
            )}
            {activeTab === "chaos" && (
              <GroupChaosTab standings={rankedStandings} currentUserId={user?.id} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
