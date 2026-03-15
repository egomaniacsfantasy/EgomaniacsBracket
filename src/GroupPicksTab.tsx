import { useMemo, useState } from "react";
import { gameTemplates } from "./data/bracket";
import { teamsById } from "./data/teams";
import { areAllGroupBracketsLocked, canSeeDetails } from "./groupVisibility";
import type { GroupStanding } from "./groupStorage";
import { resolveGames, type LockedPicks } from "./lib/bracket";
import { teamLogoUrl } from "./lib/logo";
import type { GameTemplate, Region } from "./types";

type RankedStanding = GroupStanding & { groupRank: number };
type RegionTab = "east" | "south" | "west" | "midwest" | "finalfour";
type RegionalRound = "R64" | "R32" | "S16" | "E8";
type FinalFourRound = "FF1" | "FF2" | "champion";
type RoundTab = RegionalRound | FinalFourRound;

type MemberPick = {
  userId: string;
  displayName: string;
  isCurrentUser: boolean;
};

type SlotTeamGroup = {
  teamId: string;
  teamName: string;
  teamSeedLabel: string | null;
  logoUrl: string | null;
  members: MemberPick[];
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

function compareTeams(teamAId: string, teamBId: string) {
  const teamA = teamsById.get(teamAId);
  const teamB = teamsById.get(teamBId);
  const seedDiff = (teamA?.seed ?? Number.MAX_SAFE_INTEGER) - (teamB?.seed ?? Number.MAX_SAFE_INTEGER);
  if (seedDiff !== 0) return seedDiff;
  return (teamA?.name ?? teamAId).localeCompare(teamB?.name ?? teamBId);
}

function getDisplayInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
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
    return `Slot ${template.slot * 2 + 1} vs ${template.slot * 2 + 2}`;
  }
  if (template.round === "S16") {
    return `Sweet 16 • ${template.slot + 1}`;
  }
  if (template.round === "E8") {
    return "Elite 8";
  }
  if (template.round === "F4") {
    return template.id === "F4-Left-0" ? "East vs South" : "West vs Midwest";
  }
  return "Champion";
}

function getGridVariant(regionTab: RegionTab, roundTab: RoundTab) {
  if (regionTab === "finalfour" && roundTab === "champion") return "champion";
  if (regionTab === "finalfour") return "single";
  if (roundTab === "R64") return "r64";
  if (roundTab === "R32") return "r32";
  if (roundTab === "S16") return "s16";
  return "single";
}

function buildSlotTeamGroup(teamId: string, members: MemberPick[]): SlotTeamGroup {
  const team = teamsById.get(teamId);
  return {
    teamId,
    teamName: team?.name ?? teamId,
    teamSeedLabel: team?.seedLabel ?? (team ? String(team.seed) : null),
    logoUrl: team ? teamLogoUrl(team) : null,
    members,
  };
}

function SlotTeamLogo({ group }: { group: SlotTeamGroup }) {
  const [failed, setFailed] = useState(false);

  if (!group.logoUrl || failed) {
    return (
      <span className="grp-picks-team-logo-fallback" aria-hidden="true">
        {group.teamSeedLabel ?? "?"}
      </span>
    );
  }

  return (
    <img
      src={group.logoUrl}
      alt={`${group.teamName} logo`}
      className="grp-picks-team-logo"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function GroupPicksTab({
  standings,
  currentUserId,
  canPreviewHidden = false,
}: {
  standings: RankedStanding[];
  currentUserId: string | undefined;
  tournamentStarted: boolean;
  canPreviewHidden?: boolean;
}) {
  const [selectedRegion, setSelectedRegion] = useState<RegionTab>("east");
  const [selectedRound, setSelectedRound] = useState<RoundTab>("R64");

  const allBracketsLocked = areAllGroupBracketsLocked(standings, canPreviewHidden);
  const visibleStandings = useMemo(
    () => standings.filter((entry) => canSeeDetails(entry, currentUserId, canPreviewHidden)),
    [canPreviewHidden, currentUserId, standings],
  );

  const resolvedStandings = useMemo(
    () =>
      visibleStandings.map((entry) => {
        const picks = entry.picks ?? ({} as LockedPicks);
        const { games } = resolveGames(picks);
        return {
          entry,
          gamesById: new Map(games.map((game) => [game.id, game])),
        };
      }),
    [visibleStandings],
  );

  const slotTemplates = useMemo(
    () => getSlotTemplates(selectedRegion, selectedRound),
    [selectedRegion, selectedRound],
  );

  const slotCards = useMemo<SlotCardData[]>(
    () =>
      slotTemplates.map((template) => {
        const groupsByTeam = new Map<string, MemberPick[]>();

        resolvedStandings.forEach(({ entry, gamesById }) => {
          const winnerId = gamesById.get(template.id)?.winnerId;
          if (!winnerId) return;

          const member: MemberPick = {
            userId: entry.user_id,
            displayName: entry.display_name,
            isCurrentUser: entry.user_id === currentUserId,
          };

          const members = groupsByTeam.get(winnerId);
          if (members) {
            members.push(member);
            return;
          }
          groupsByTeam.set(winnerId, [member]);
        });

        const groups = [...groupsByTeam.entries()]
          .map(([teamId, members]) => buildSlotTeamGroup(teamId, members))
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
          isUnanimous: groups.length === 1 && totalMembers > 1,
        };
      }),
    [currentUserId, resolvedStandings, slotTemplates],
  );

  const roundOptions = selectedRegion === "finalfour" ? FINAL_FOUR_ROUNDS : REGIONAL_ROUNDS;
  const gridVariant = getGridVariant(selectedRegion, selectedRound);

  if (!allBracketsLocked) {
    return (
      <div className="gd-locked-state">
        <span className="gd-locked-icon">🔒</span>
        <h3>Picks are hidden until tipoff</h3>
        <p>Once brackets lock, you&apos;ll see how your group&apos;s picks compare - who agreed, who went rogue, and who&apos;s the lone wolf.</p>
      </div>
    );
  }

  return (
    <div className="group-picks grp-picks">
      <div className="grp-picks-region-row" role="tablist" aria-label="Pick region">
        {REGION_OPTIONS.map((region) => (
          <button
            key={region.id}
            type="button"
            role="tab"
            aria-selected={selectedRegion === region.id}
            className={`grp-picks-pill ${selectedRegion === region.id ? "grp-picks-pill--active" : ""}`}
            onClick={() => {
              setSelectedRegion(region.id);
              setSelectedRound(region.id === "finalfour" ? "champion" : "R64");
            }}
          >
            {region.label}
          </button>
        ))}
      </div>

      <div className="grp-picks-round-row" role="tablist" aria-label="Pick round">
        {roundOptions.map((round) => (
          <button
            key={round.id}
            type="button"
            role="tab"
            aria-selected={selectedRound === round.id}
            className={`grp-picks-pill grp-picks-pill--round ${selectedRound === round.id ? "grp-picks-pill--active" : ""}`}
            onClick={() => setSelectedRound(round.id)}
          >
            {round.label}
          </button>
        ))}
      </div>

      <div className={`grp-picks-slot-grid grp-picks-slot-grid--${gridVariant}`}>
        {slotCards.map((slotCard) => (
          <article key={slotCard.id} className="grp-picks-slot-card">
            <div className="grp-picks-slot-label">{slotCard.label}</div>

            {slotCard.groups.length === 0 ? (
              <p className="grp-picks-slot-empty">No picks yet.</p>
            ) : (
              <div className="grp-picks-slot-groups">
                {slotCard.groups.map((group) => (
                  <div key={`${slotCard.id}-${group.teamId}`} className="grp-picks-team-group">
                    <div className="grp-picks-team-row">
                      <SlotTeamLogo group={group} />
                      <span className="grp-picks-team-name">{group.teamName}</span>
                      {slotCard.isUnanimous ? <span className="grp-picks-unanimous">UNANIMOUS</span> : null}
                      {group.teamSeedLabel ? <span className="grp-picks-team-seed">#{group.teamSeedLabel}</span> : null}
                    </div>

                    <div className="grp-picks-member-row">
                      {group.members.map((member) => (
                        <span
                          key={`${slotCard.id}-${group.teamId}-${member.userId}`}
                          className={`grp-picks-member-chip ${member.isCurrentUser ? "grp-picks-member-chip--you" : ""}`}
                        >
                          <span className="grp-picks-member-avatar" aria-hidden="true">
                            {getDisplayInitials(member.displayName)}
                          </span>
                          <span className="grp-picks-member-name">{member.displayName}</span>
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
  );
}
