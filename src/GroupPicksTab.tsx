import { useMemo, useState } from "react";
import { GroupBracketViewerSurface } from "./BracketViewer";
import { gameTemplates } from "./data/bracket";
import { teamsById } from "./data/teams";
import { areAllGroupBracketsLocked, canSeeDetails } from "./groupVisibility";
import type { GroupMember, GroupStanding } from "./groupStorage";
import { type LockedPicks } from "./lib/bracket";
import { resolveBracketWithKnownResults } from "./lib/bracketCompletion";
import { teamLogoUrl } from "./lib/logo";
import type { GameTemplate, Region } from "./types";

type RankedStanding = GroupStanding & { groupRank: number };
type PicksViewMode = "brackets" | "compare";
type RegionTab = "east" | "south" | "west" | "midwest" | "finalfour";
type RegionalRound = "R64" | "R32" | "S16" | "E8";
type FinalFourRound = "FF1" | "FF2" | "champion";
type RoundTab = RegionalRound | FinalFourRound;

type MemberPick = {
  userId: string;
  displayName: string;
  isCurrentUser: boolean;
};

type SelectableBracket = {
  bracketId: string;
  displayName: string;
  bracketName: string;
  picks: LockedPicks;
  groupRank: number;
  globalRank: number | null;
  score: number | null;
  correctPicks: number | null;
  possiblePicks: number | null;
  isCurrentUser: boolean;
};

type LockedMemberRow = {
  id: string;
  displayName: string;
  isCurrentUser: boolean;
  submitted: boolean;
  hasBracket: boolean;
  role: "admin" | "member" | null;
};

type SlotTeamGroup = {
  teamId: string;
  teamName: string;
  teamSeedLabel: string | null;
  logoUrl: string | null;
  members: MemberPick[];
  resultState: "default" | "correct" | "incorrect";
};

type SlotCardData = {
  id: string;
  label: string;
  groups: SlotTeamGroup[];
  totalMembers: number;
  isUnanimous: boolean;
};

const REGION_OPTIONS: Array<{ id: RegionTab; label: string }> = [
  { id: "east", label: "East" },
  { id: "south", label: "South" },
  { id: "west", label: "West" },
  { id: "midwest", label: "Midwest" },
  { id: "finalfour", label: "Final Four" },
];

const REGIONAL_ROUNDS: Array<{ id: RegionalRound; label: string }> = [
  { id: "R64", label: "R64" },
  { id: "R32", label: "R32" },
  { id: "S16", label: "S16" },
  { id: "E8", label: "E8" },
];

const FINAL_FOUR_ROUNDS: Array<{ id: FinalFourRound; label: string }> = [
  { id: "FF1", label: "FF1" },
  { id: "FF2", label: "FF2" },
  { id: "champion", label: "Champion" },
];

const REGION_BY_TAB: Record<Exclude<RegionTab, "finalfour">, Region> = {
  east: "East",
  south: "South",
  west: "West",
  midwest: "Midwest",
};

const TEMPLATE_BY_ID = new Map(gameTemplates.map((template) => [template.id, template]));
const SLOT_SEED_MATCHUPS: Array<[number, number]> = [
  [1, 16],
  [8, 9],
  [5, 12],
  [4, 13],
  [6, 11],
  [3, 14],
  [7, 10],
  [2, 15],
];

function normalizeTournamentResults(tournamentResults: unknown) {
  const resultsByGame = new Map<string, string>();

  if (tournamentResults instanceof Map) {
    tournamentResults.forEach((winnerTeamId, matchupId) => {
      if (typeof matchupId !== "string" || typeof winnerTeamId !== "string") return;
      resultsByGame.set(matchupId, winnerTeamId);
    });
    return resultsByGame;
  }

  if (Array.isArray(tournamentResults)) {
    tournamentResults.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const row = entry as {
        matchup_id?: unknown;
        winner_team_id?: unknown;
        winner?: unknown;
        winnerTeamId?: unknown;
      };
      const matchupId = typeof row.matchup_id === "string" ? row.matchup_id : null;
      const winnerTeamId =
        typeof row.winner_team_id === "string"
          ? row.winner_team_id
          : typeof row.winner === "string"
            ? row.winner
            : typeof row.winnerTeamId === "string"
              ? row.winnerTeamId
              : null;
      if (!matchupId || !winnerTeamId) return;
      resultsByGame.set(matchupId, winnerTeamId);
    });
    return resultsByGame;
  }

  if (!tournamentResults || typeof tournamentResults !== "object") {
    return resultsByGame;
  }

  if ("results" in (tournamentResults as Record<string, unknown>)) {
    return normalizeTournamentResults((tournamentResults as { results?: unknown }).results);
  }

  Object.entries(tournamentResults as Record<string, unknown>).forEach(([gameId, value]) => {
    if (typeof value === "string") {
      resultsByGame.set(gameId, value);
      return;
    }

    if (!value || typeof value !== "object") return;
    const row = value as {
      matchup_id?: unknown;
      winner_team_id?: unknown;
      winner?: unknown;
      winnerTeamId?: unknown;
    };
    const matchupId = typeof row.matchup_id === "string" ? row.matchup_id : gameId;
    const winnerTeamId =
      typeof row.winner_team_id === "string"
        ? row.winner_team_id
        : typeof row.winner === "string"
          ? row.winner
          : typeof row.winnerTeamId === "string"
            ? row.winnerTeamId
            : null;
    if (!matchupId || !winnerTeamId) return;
    resultsByGame.set(matchupId, winnerTeamId);
  });

  return resultsByGame;
}

function compareTeams(teamAId: string, teamBId: string) {
  const teamA = teamsById.get(teamAId);
  const teamB = teamsById.get(teamBId);
  const seedDiff = (teamA?.seed ?? Number.MAX_SAFE_INTEGER) - (teamB?.seed ?? Number.MAX_SAFE_INTEGER);
  if (seedDiff !== 0) return seedDiff;
  return (teamA?.name ?? teamAId).localeCompare(teamB?.name ?? teamBId);
}

function sortSelectableBrackets(bracketA: SelectableBracket, bracketB: SelectableBracket) {
  if (bracketA.isCurrentUser && !bracketB.isCurrentUser) return -1;
  if (bracketB.isCurrentUser && !bracketA.isCurrentUser) return 1;
  if (bracketA.groupRank !== bracketB.groupRank) return bracketA.groupRank - bracketB.groupRank;
  if (bracketA.globalRank !== null && bracketB.globalRank !== null && bracketA.globalRank !== bracketB.globalRank) {
    return bracketA.globalRank - bracketB.globalRank;
  }
  return bracketA.displayName.localeCompare(bracketB.displayName);
}

function sortLockedMembers(memberA: LockedMemberRow, memberB: LockedMemberRow) {
  if (memberA.isCurrentUser && !memberB.isCurrentUser) return -1;
  if (memberB.isCurrentUser && !memberA.isCurrentUser) return 1;
  if (memberA.role === "admin" && memberB.role !== "admin") return -1;
  if (memberB.role === "admin" && memberA.role !== "admin") return 1;
  if (memberA.submitted && !memberB.submitted) return -1;
  if (memberB.submitted && !memberA.submitted) return 1;
  if (memberA.hasBracket && !memberB.hasBracket) return -1;
  if (memberB.hasBracket && !memberA.hasBracket) return 1;
  return memberA.displayName.localeCompare(memberB.displayName);
}

function sortMemberPicks(memberA: MemberPick, memberB: MemberPick) {
  if (memberA.isCurrentUser && !memberB.isCurrentUser) return -1;
  if (memberB.isCurrentUser && !memberA.isCurrentUser) return 1;
  return memberA.displayName.localeCompare(memberB.displayName);
}

function getSlotTemplates(regionTab: RegionTab, roundTab: RoundTab): GameTemplate[] {
  if (regionTab === "finalfour") {
    const templateId = roundTab === "FF1" ? "F4-Left-0" : roundTab === "FF2" ? "F4-Right-0" : "CHAMP-0";
    const template = TEMPLATE_BY_ID.get(templateId);
    return template ? [template] : [];
  }

  const round = roundTab === "R64" || roundTab === "R32" || roundTab === "S16" || roundTab === "E8" ? roundTab : "R64";
  const region = REGION_BY_TAB[regionTab];
  return gameTemplates
    .filter((template) => template.region === region && template.round === round)
    .sort((templateA, templateB) => templateA.slot - templateB.slot);
}

function getSlotLabel(template: GameTemplate) {
  if (template.round === "R64") {
    const matchup = SLOT_SEED_MATCHUPS[template.slot];
    return matchup ? `${matchup[0]} vs ${matchup[1]}` : `Slot ${template.slot + 1}`;
  }
  if (template.round === "R32") {
    return `R32 · ${template.slot + 1}`;
  }
  if (template.round === "S16") {
    return `S16 · ${template.slot + 1}`;
  }
  if (template.round === "E8") {
    return "Elite 8";
  }
  if (template.id === "F4-Left-0") {
    return "FF1";
  }
  if (template.id === "F4-Right-0") {
    return "FF2";
  }
  return "Champion";
}

function getGridVariant(regionTab: RegionTab, roundTab: RoundTab) {
  if (regionTab === "finalfour" && roundTab === "champion") return "champion";
  if (regionTab === "finalfour") return "single";
  if (roundTab === "R64" || roundTab === "R32") return roundTab.toLowerCase();
  if (roundTab === "S16") return "s16";
  return "single";
}

function buildSlotTeamGroup(
  teamId: string,
  members: MemberPick[],
  actualWinnerId: string | null,
): SlotTeamGroup {
  const team = teamsById.get(teamId);
  return {
    teamId,
    teamName: team?.name ?? teamId,
    teamSeedLabel: team?.seedLabel ?? (team?.seed ? String(team.seed) : null),
    logoUrl: team ? teamLogoUrl(team) : null,
    members: [...members].sort(sortMemberPicks),
    resultState: !actualWinnerId ? "default" : actualWinnerId === teamId ? "correct" : "incorrect",
  };
}

function SlotTeamLogo({ group }: { group: SlotTeamGroup }) {
  const [failed, setFailed] = useState(false);

  if (!group.logoUrl || failed) {
    return (
      <span className="grp-sp-team-logo-fallback" aria-hidden="true">
        {(group.teamName || "?").slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={group.logoUrl}
      alt={`${group.teamName} logo`}
      className="grp-sp-team-logo"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function GroupPicksTab({
  standings,
  members = [],
  currentUserId,
  canPreviewHidden = false,
  selectedBracketId: selectedBracketIdProp,
  onSelectedBracketChange,
  tournamentResults,
}: {
  standings: RankedStanding[];
  members?: GroupMember[];
  currentUserId: string | undefined;
  canPreviewHidden?: boolean;
  selectedBracketId?: string | null;
  onSelectedBracketChange?: (bracketId: string | null) => void;
  tournamentResults?: unknown;
}) {
  const [viewMode, setViewMode] = useState<PicksViewMode>("brackets");
  const [selectedBracketIdOverride, setSelectedBracketIdOverride] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<RegionTab>("east");
  const [selectedRound, setSelectedRound] = useState<RoundTab>("R64");

  const allBracketsLocked = areAllGroupBracketsLocked(standings, canPreviewHidden);

  const visibleStandings = useMemo(
    () => standings.filter((entry) => canSeeDetails(entry, currentUserId, canPreviewHidden)),
    [canPreviewHidden, currentUserId, standings],
  );

  const bracketEntries = useMemo(
    () =>
      visibleStandings.filter(
        (entry): entry is RankedStanding & { bracket_id: string; picks: LockedPicks } => Boolean(entry.bracket_id && entry.picks),
      ),
    [visibleStandings],
  );

  const selectableBrackets = useMemo(
    () =>
      bracketEntries
        .map((entry) => ({
          bracketId: entry.bracket_id,
          displayName: entry.display_name,
          bracketName: entry.bracket_name || "Bracket submitted",
          picks: entry.picks,
          groupRank: entry.groupRank,
          globalRank: entry.global_rank,
          score: entry.total_score,
          correctPicks: entry.correct_picks,
          possiblePicks: entry.possible_picks,
          isCurrentUser: entry.user_id === currentUserId,
        }))
        .sort(sortSelectableBrackets),
    [bracketEntries, currentUserId],
  );

  const preferredBracketId =
    selectedBracketIdProp && selectableBrackets.some((entry) => entry.bracketId === selectedBracketIdProp)
      ? selectedBracketIdProp
      : selectedBracketIdOverride && selectableBrackets.some((entry) => entry.bracketId === selectedBracketIdOverride)
        ? selectedBracketIdOverride
        : null;

  const selectedBracketId =
    preferredBracketId ?? (selectableBrackets.find((entry) => entry.isCurrentUser) ?? selectableBrackets[0])?.bracketId ?? null;

  const selectedBracket =
    selectableBrackets.find((entry) => entry.bracketId === selectedBracketId) ?? selectableBrackets[0] ?? null;

  const lockedMembers = useMemo<LockedMemberRow[]>(() => {
    if (members.length > 0) {
      return [...members]
        .map((member) => ({
          id: member.id,
          displayName: member.display_name,
          isCurrentUser: member.user_id === currentUserId,
          submitted: member.has_submitted_bracket,
          hasBracket: member.has_assigned_bracket,
          role: member.role,
        }))
        .sort(sortLockedMembers);
    }

    const fallbackMembers = new Map<string, LockedMemberRow>();
    standings.forEach((entry) => {
      if (fallbackMembers.has(entry.user_id)) return;
      fallbackMembers.set(entry.user_id, {
        id: entry.user_id,
        displayName: entry.display_name,
        isCurrentUser: entry.user_id === currentUserId,
        submitted: Boolean(entry.bracket_id),
        hasBracket: Boolean(entry.bracket_id),
        role: entry.role === "admin" ? "admin" : "member",
      });
    });

    return [...fallbackMembers.values()].sort(sortLockedMembers);
  }, [currentUserId, members, standings]);

  const resolvedBracketEntries = useMemo(
    () =>
      bracketEntries.map((entry) => {
        const { games } = resolveBracketWithKnownResults(entry.picks);
        return {
          entry,
          gamesById: new Map(games.map((game) => [game.id, game])),
        };
      }),
    [bracketEntries],
  );

  const resultsByGame = useMemo(() => normalizeTournamentResults(tournamentResults), [tournamentResults]);

  const slotTemplates = useMemo(() => getSlotTemplates(selectedRegion, selectedRound), [selectedRegion, selectedRound]);

  const slotCards = useMemo<SlotCardData[]>(
    () =>
      slotTemplates.map((template) => {
        const groupsByTeam = new Map<string, MemberPick[]>();
        const actualWinnerId = resultsByGame.get(template.id) ?? null;

        resolvedBracketEntries.forEach(({ entry, gamesById }) => {
          const winnerId = gamesById.get(template.id)?.winnerId;
          if (!winnerId) return;

          const member: MemberPick = {
            userId: entry.user_id,
            displayName: entry.display_name,
            isCurrentUser: entry.user_id === currentUserId,
          };

          const existing = groupsByTeam.get(winnerId);
          if (existing) {
            existing.push(member);
            return;
          }
          groupsByTeam.set(winnerId, [member]);
        });

        const groups = [...groupsByTeam.entries()]
          .map(([teamId, groupMembers]) => buildSlotTeamGroup(teamId, groupMembers, actualWinnerId))
          .sort((groupA, groupB) => {
            const memberDiff = groupB.members.length - groupA.members.length;
            if (memberDiff !== 0) return memberDiff;
            return compareTeams(groupA.teamId, groupB.teamId);
          });

        const totalMembers = groups.reduce((sum, group) => sum + group.members.length, 0);

        return {
          id: template.id,
          label: getSlotLabel(template),
          groups,
          totalMembers,
          isUnanimous:
            groups.length === 1 &&
            totalMembers === resolvedBracketEntries.length &&
            resolvedBracketEntries.length > 1,
        };
      }),
    [currentUserId, resolvedBracketEntries, resultsByGame, slotTemplates],
  );

  const roundOptions = selectedRegion === "finalfour" ? FINAL_FOUR_ROUNDS : REGIONAL_ROUNDS;
  const gridVariant = getGridVariant(selectedRegion, selectedRound);

  if (!allBracketsLocked) {
    return (
      <div className="grp-picks-shell">
        <div className="grp-picks-locked">
          <div className="grp-picks-locked-icon" aria-hidden="true">
            🔒
          </div>
          <h3 className="grp-picks-locked-title">Brackets are hidden until tip-off</h3>
          <p className="grp-picks-locked-copy">
            Once the tournament starts, you&apos;ll be able to view everyone&apos;s bracket and compare picks.
          </p>
        </div>

        <div className="grp-picks-locked-list">
          {lockedMembers.map((member) => (
            <div key={member.id} className="grp-picks-locked-row">
              <span className="grp-picks-locked-name">
                {member.isCurrentUser ? `${member.displayName} (You)` : member.displayName}
              </span>
              <span
                className={[
                  "grp-picks-locked-status",
                  member.submitted ? "grp-picks-locked-status--submitted" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {member.submitted ? "Bracket Locked" : "Not Submitted"}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grp-picks-shell">
      <div className="grp-picks-toggle-bar" role="tablist" aria-label="Picks view mode">
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "brackets"}
          className={`grp-picks-toggle ${viewMode === "brackets" ? "grp-picks-toggle--active" : ""}`}
          onClick={() => setViewMode("brackets")}
        >
          View Brackets
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "compare"}
          className={`grp-picks-toggle ${viewMode === "compare" ? "grp-picks-toggle--active" : ""}`}
          onClick={() => setViewMode("compare")}
        >
          Compare Picks
        </button>
      </div>

      {viewMode === "brackets" ? (
        <div className="grp-picks-brackets-view">
          <div className="grp-picks-member-pills" role="tablist" aria-label="Select member bracket">
            {selectableBrackets.map((bracket) => {
              const label = bracket.isCurrentUser ? "Your Bracket" : bracket.displayName;
              const isActive = bracket.bracketId === selectedBracket?.bracketId;
              return (
                <button
                  key={bracket.bracketId}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={[
                    "grp-picks-member-pill",
                    isActive ? "grp-picks-member-pill--active" : "",
                    bracket.isCurrentUser ? "grp-picks-member-pill--self" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    setSelectedBracketIdOverride(bracket.bracketId);
                    onSelectedBracketChange?.(bracket.bracketId);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {selectedBracket ? (
            <GroupBracketViewerSurface
              bracket={{
                displayName: selectedBracket.displayName,
                bracketName: selectedBracket.bracketName,
                picks: selectedBracket.picks,
                rank: selectedBracket.globalRank ?? selectedBracket.groupRank,
                score: selectedBracket.score,
                correctPicks: selectedBracket.correctPicks,
                possiblePicks: selectedBracket.possiblePicks,
                isCurrentUser: selectedBracket.isCurrentUser,
              }}
              tournamentResults={tournamentResults}
            />
          ) : (
            <div className="grp-picks-empty">
              <div className="grp-picks-empty-icon" aria-hidden="true">
                📋
              </div>
              <p className="grp-picks-empty-copy">No submitted brackets are available to view yet.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="grp-sp-shell">
          <div className="grp-sp-region-row" role="tablist" aria-label="Pick region">
            {REGION_OPTIONS.map((region) => (
              <button
                key={region.id}
                type="button"
                role="tab"
                aria-selected={selectedRegion === region.id}
                className={`grp-sp-pill ${selectedRegion === region.id ? "grp-sp-pill--active" : ""}`}
                onClick={() => {
                  setSelectedRegion(region.id);
                  setSelectedRound(region.id === "finalfour" ? "champion" : "R64");
                }}
              >
                {region.label}
              </button>
            ))}
          </div>

          <div className="grp-sp-round-row" role="tablist" aria-label="Pick round">
            {roundOptions.map((round) => (
              <button
                key={round.id}
                type="button"
                role="tab"
                aria-selected={selectedRound === round.id}
                className={[
                  "grp-sp-pill",
                  "grp-sp-pill--round",
                  selectedRound === round.id ? "grp-sp-pill--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setSelectedRound(round.id)}
              >
                {round.label}
              </button>
            ))}
          </div>

          <div className={`grp-sp-grid grp-sp-grid--${gridVariant}`}>
            {slotCards.map((slotCard) => (
              <article key={slotCard.id} className="grp-sp-card">
                <div className="grp-sp-card-label">{slotCard.label}</div>

                {slotCard.groups.length === 0 ? (
                  <p className="grp-sp-empty">No picks yet.</p>
                ) : (
                  <div className="grp-sp-groups">
                    {slotCard.groups.map((group, index) => (
                      <div key={`${slotCard.id}-${group.teamId}`} className="grp-sp-team-group">
                        {index > 0 ? <div className="grp-sp-divider" /> : null}

                        <div
                          className={[
                            "grp-sp-team-row",
                            group.resultState !== "default" ? `grp-sp-team-row--${group.resultState}` : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <SlotTeamLogo group={group} />
                          <div className="grp-sp-team-copy">
                            <span className="grp-sp-team-name">{group.teamName}</span>
                            {slotCard.isUnanimous ? <span className="grp-sp-unanimous">UNANIMOUS</span> : null}
                          </div>
                          {group.resultState === "correct" ? <span className="grp-sp-team-result grp-sp-team-result--win">✓</span> : null}
                          {group.resultState === "incorrect" ? <span className="grp-sp-team-result grp-sp-team-result--loss">✕</span> : null}
                          {group.teamSeedLabel ? <span className="grp-sp-team-seed">#{group.teamSeedLabel}</span> : null}
                        </div>

                        <div className="grp-sp-chip-row">
                          {group.members.map((member) => (
                            <span
                              key={`${slotCard.id}-${group.teamId}-${member.userId}`}
                              className={`grp-sp-chip ${member.isCurrentUser ? "grp-sp-chip--you" : ""}`}
                            >
                              {member.displayName}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
