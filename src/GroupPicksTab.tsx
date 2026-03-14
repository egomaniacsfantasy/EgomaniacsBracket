import { useMemo, useState } from "react";
import { gameTemplates, regionOrder } from "./data/bracket";
import { teamsById } from "./data/teams";
import { areAllGroupBracketsLocked, canSeeDetails } from "./groupVisibility";
import type { GroupStanding } from "./groupStorage";
import { resolveGames, type LockedPicks } from "./lib/bracket";
import { teamLogoUrl } from "./lib/logo";
import type { GameTemplate } from "./types";

type RankedStanding = GroupStanding & { groupRank: number };

const ROUND_LABELS = [
  { key: "R64", label: "Round of 64" },
  { key: "R32", label: "Round of 32" },
  { key: "S16", label: "Sweet 16" },
  { key: "E8", label: "Elite 8" },
  { key: "F4", label: "Final Four" },
  { key: "CHAMP", label: "Championship" },
] as const;

type RoundKey = (typeof ROUND_LABELS)[number]["key"];

type Voter = {
  userId: string;
  displayName: string;
  isCurrentUser: boolean;
};

type CardTeam = {
  id: string | null;
  name: string;
  seedLabel: string | null;
  logoUrl: string | null;
  variantCount: number;
};

type MatchupCardData = {
  matchupId: string;
  teamA: CardTeam;
  teamB: CardTeam;
  totalVoters: number;
  countA: number;
  countB: number;
  pctA: number;
  pctB: number;
  votersA: Voter[];
  votersB: Voter[];
  isUnanimous: boolean;
  isLoneWolf: boolean;
};

const regionalRoundOrder = new Map(regionOrder.map((region, index) => [region, index]));

function incrementCount(counts: Map<string, number>, teamId: string | null) {
  if (!teamId) return;
  counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
}

function compareTeams(teamAId: string, teamBId: string) {
  const teamA = teamsById.get(teamAId);
  const teamB = teamsById.get(teamBId);
  const seedDiff = (teamA?.seed ?? Number.MAX_SAFE_INTEGER) - (teamB?.seed ?? Number.MAX_SAFE_INTEGER);
  if (seedDiff !== 0) return seedDiff;
  return (teamA?.name ?? teamAId).localeCompare(teamB?.name ?? teamBId);
}

function pickRepresentativeTeamId(
  counts: Map<string, number>,
  fallbackTeamId: string | null,
  excludedTeamId?: string | null,
) {
  const ranked = [...counts.entries()]
    .filter(([teamId]) => teamId !== excludedTeamId)
    .sort((a, b) => b[1] - a[1] || compareTeams(a[0], b[0]));

  if (ranked[0]?.[0]) return ranked[0][0];
  if (fallbackTeamId && fallbackTeamId !== excludedTeamId) return fallbackTeamId;
  return null;
}

function buildCardTeam(teamId: string | null, variantCount: number): CardTeam {
  if (!teamId) {
    return {
      id: null,
      name: "TBD",
      seedLabel: null,
      logoUrl: null,
      variantCount,
    };
  }

  const team = teamsById.get(teamId);
  if (!team) {
    return {
      id: teamId,
      name: teamId,
      seedLabel: null,
      logoUrl: null,
      variantCount,
    };
  }

  return {
    id: team.id,
    name: team.name,
    seedLabel: team.seedLabel ?? String(team.seed),
    logoUrl: teamLogoUrl(team),
    variantCount,
  };
}

function getTeamMeta(team: CardTeam) {
  if (!team.id) return "Awaiting prior pick";
  const details = team.seedLabel ? `#${team.seedLabel} seed` : "Team picked";
  return team.variantCount > 1 ? `${details} · ${team.variantCount} paths` : details;
}

function voteLabel(totalVoters: number) {
  return totalVoters === 1 ? "1 vote" : `${totalVoters} votes`;
}

function MatchupTeamLogo({ team }: { team: CardTeam }) {
  const [failed, setFailed] = useState(false);

  if (!team.id) {
    return <span className="gp-card-logo-placeholder" aria-hidden="true" />;
  }

  if (failed || !team.logoUrl) {
    return (
      <span className="gp-card-logo-fallback" aria-hidden="true">
        <span className="gp-card-logo-seed">{team.seedLabel ?? "?"}</span>
      </span>
    );
  }

  return (
    <img
      src={team.logoUrl}
      className="gp-card-logo"
      alt={`${team.name} logo`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function MatchupCard({ data }: { data: MatchupCardData }) {
  return (
    <div
      className={[
        "gp-card",
        data.isUnanimous ? "gp-card--unanimous" : "",
        data.isLoneWolf ? "gp-card--lone-wolf" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="gp-card-matchup">
        <div className="gp-card-team gp-card-team--a">
          <MatchupTeamLogo team={data.teamA} />
          <div className="gp-card-team-info">
            <span className="gp-card-team-name">{data.teamA.name}</span>
            <span className="gp-card-team-meta">{getTeamMeta(data.teamA)}</span>
          </div>
        </div>

        <div className="gp-card-vs">
          <span className="gp-card-vs-text">vs</span>
        </div>

        <div className="gp-card-team gp-card-team--b">
          <div className="gp-card-team-info gp-card-team-info--right">
            <span className="gp-card-team-name">{data.teamB.name}</span>
            <span className="gp-card-team-meta">{getTeamMeta(data.teamB)}</span>
          </div>
          <MatchupTeamLogo team={data.teamB} />
        </div>
      </div>

      {data.totalVoters === 0 ? (
        <p className="gp-card-empty">No picks yet.</p>
      ) : (
        <>
          <div className="gp-card-bar-section">
            <div className="gp-card-bar">
              {data.isUnanimous ? (
                <div className="gp-card-bar-unanimous" />
              ) : (
                <>
                  <div className="gp-card-bar-a" style={{ width: `${data.pctA}%` }} />
                  <div className="gp-card-bar-b" style={{ width: `${data.pctB}%` }} />
                </>
              )}
            </div>

            <div className="gp-card-bar-labels">
              <span className="gp-card-pct gp-card-pct--a">{data.pctA}%</span>
              <span className="gp-card-count">{voteLabel(data.totalVoters)}</span>
              <span className="gp-card-pct gp-card-pct--b">{data.pctB}%</span>
            </div>
          </div>

          <div className="gp-card-voters">
            <div className="gp-card-voters-side gp-card-voters-side--a">
              {data.votersA.map((voter) => (
                <span
                  key={`${data.matchupId}-${voter.userId}-a`}
                  className={`gp-voter ${voter.isCurrentUser ? "gp-voter--you" : ""}`}
                >
                  {voter.displayName}
                </span>
              ))}
            </div>

            <div className="gp-card-voters-side gp-card-voters-side--b">
              {data.votersB.map((voter) => (
                <span
                  key={`${data.matchupId}-${voter.userId}-b`}
                  className={`gp-voter ${voter.isCurrentUser ? "gp-voter--you" : ""}`}
                >
                  {voter.displayName}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {data.isLoneWolf && (
        <div className="gp-lone-wolf">
          <span className="gp-lone-wolf-icon">🐺</span>
          <span className="gp-lone-wolf-text">You&apos;re the lone wolf</span>
        </div>
      )}
    </div>
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
  const [expandedRound, setExpandedRound] = useState<RoundKey>("R64");
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

  const matchupsByRound = useMemo(() => {
    const grouped = ROUND_LABELS.reduce(
      (acc, round) => {
        acc[round.key] = [];
        return acc;
      },
      {} as Record<RoundKey, GameTemplate[]>,
    );

    gameTemplates
      .filter((template) => template.round !== "FF")
      .sort((a, b) => {
        const regionDiff =
          (regionalRoundOrder.get(a.region ?? "East") ?? Number.MAX_SAFE_INTEGER) -
          (regionalRoundOrder.get(b.region ?? "East") ?? Number.MAX_SAFE_INTEGER);
        if (regionDiff !== 0) return regionDiff;
        return a.slot - b.slot;
      })
      .forEach((template) => {
        grouped[template.round as RoundKey].push(template);
      });

    return grouped;
  }, []);

  const matchupData = useMemo(() => {
    const data: Record<string, MatchupCardData> = {};

    gameTemplates
      .filter((template) => template.round !== "FF")
      .forEach((template) => {
        const sideATeams = new Map<string, number>();
        const sideBTeams = new Map<string, number>();
        const votersA: Voter[] = [];
        const votersB: Voter[] = [];

        resolvedStandings.forEach(({ entry, gamesById }) => {
          const game = gamesById.get(template.id);
          if (!game) return;

          incrementCount(sideATeams, game.teamAId);
          incrementCount(sideBTeams, game.teamBId);

          if (!game.winnerId) return;

          const voter = {
            userId: entry.user_id,
            displayName: entry.display_name,
            isCurrentUser: entry.user_id === currentUserId,
          };

          if (game.winnerId === game.teamAId) votersA.push(voter);
          if (game.winnerId === game.teamBId) votersB.push(voter);
        });

        const displayTeamAId = pickRepresentativeTeamId(sideATeams, template.initialTeamIds?.[0] ?? null);
        const displayTeamBId = pickRepresentativeTeamId(
          sideBTeams,
          template.initialTeamIds?.[1] ?? null,
          displayTeamAId,
        );
        const countA = votersA.length;
        const countB = votersB.length;
        const totalVoters = countA + countB;
        const pctA = totalVoters > 0 ? Math.round((countA / totalVoters) * 100) : 0;
        const pctB = totalVoters > 0 ? 100 - pctA : 0;
        const currentUserSideCount = votersA.some((voter) => voter.userId === currentUserId)
          ? countA
          : votersB.some((voter) => voter.userId === currentUserId)
            ? countB
            : 0;

        data[template.id] = {
          matchupId: template.id,
          teamA: buildCardTeam(displayTeamAId, sideATeams.size),
          teamB: buildCardTeam(displayTeamBId, sideBTeams.size),
          totalVoters,
          countA,
          countB,
          pctA,
          pctB,
          votersA,
          votersB,
          isUnanimous: totalVoters > 0 && (countA === 0 || countB === 0),
          isLoneWolf: currentUserSideCount === 1 && totalVoters > 1,
        };
      });

    return data;
  }, [currentUserId, resolvedStandings]);

  function getLoneWolfCount(roundKey: RoundKey) {
    return (matchupsByRound[roundKey] ?? []).filter((matchup) => matchupData[matchup.id]?.isLoneWolf).length;
  }

  if (!allBracketsLocked) {
    return (
      <div className="gd-locked-state">
        <span className="gd-locked-icon">🔒</span>
        <h3>Picks are hidden until tipoff</h3>
        <p>Once brackets lock, you&apos;ll see how your group&apos;s picks compare — who agreed, who went rogue, and who&apos;s the lone wolf.</p>
      </div>
    );
  }

  const matchups = matchupsByRound[expandedRound] ?? [];
  const isFewGames = matchups.length <= 8;

  return (
    <div className="group-picks">
      <div className="gp-rounds">
        {ROUND_LABELS.map((round) => {
          const loneWolves = getLoneWolfCount(round.key);
          return (
            <button
              key={round.key}
              type="button"
              className={`gp-round-pill ${expandedRound === round.key ? "gp-round-pill--active" : ""}`}
              onClick={() => setExpandedRound(round.key)}
            >
              {round.label}
              {loneWolves > 0 && <span className="gp-round-badge">{loneWolves}</span>}
            </button>
          );
        })}
      </div>

      <p className="gp-subtitle">See where your group agrees — and where you stand alone.</p>

      <div className={`gp-cards-grid ${isFewGames ? "gp-cards-grid--few" : ""}`}>
        {matchups.map((matchup) => (
          <MatchupCard key={matchup.id} data={matchupData[matchup.id]} />
        ))}
      </div>
    </div>
  );
}
