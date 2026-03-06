import type { GameTemplate, Region, Round, Side } from "../types";
import { teams } from "./teams";

export const regionOrder: Region[] = ["East", "West", "Midwest", "South"];
export const BRACKET_HALVES: Array<{
  id: "halfA" | "halfB";
  side: Side;
  label: string;
  semifinalGameId: "F4-Left-0" | "F4-Right-0";
  regions: [Region, Region];
}> = [
  {
    id: "halfA",
    side: "Left",
    label: "East/South",
    semifinalGameId: "F4-Left-0",
    regions: ["East", "South"],
  },
  {
    id: "halfB",
    side: "Right",
    label: "West/Midwest",
    semifinalGameId: "F4-Right-0",
    regions: ["West", "Midwest"],
  },
];

export const sideRegions: Record<Side, Region[]> = Object.fromEntries(
  BRACKET_HALVES.map((half) => [half.side, [...half.regions]])
) as Record<Side, Region[]>;

const seedMatchups: [number, number][] = [
  [1, 16],
  [8, 9],
  [5, 12],
  [4, 13],
  [6, 11],
  [3, 14],
  [7, 10],
  [2, 15],
];

const rounds: Round[] = ["FF", "R64", "R32", "S16", "E8", "F4", "CHAMP"];
export const roundOrder = rounds;

const regionToSide = (region: Region): Side =>
  BRACKET_HALVES.find((half) => half.regions.includes(region))?.side ?? "Left";

// Derived from teams data — updates automatically when teams.ts is regenerated
const firstFourByRegionSeed: Record<string, string> = {};
const firstFourParticipants: Record<string, [string, string]> = {};
{
  const ffGroups = new Map<string, string[]>();
  for (const team of teams.filter((t) => t.isFirstFour)) {
    const key = `${team.region}-${team.seed}`;
    if (!ffGroups.has(key)) ffGroups.set(key, []);
    ffGroups.get(key)!.push(team.id);
  }
  for (const [key, ids] of ffGroups) {
    if (ids.length === 2) {
      const dashIdx = key.indexOf("-");
      const region = key.slice(0, dashIdx);
      const seedStr = key.slice(dashIdx + 1);
      const ffId = `${region}-FF-${seedStr}`;
      firstFourByRegionSeed[key] = ffId;
      firstFourParticipants[ffId] = [ids[0], ids[1]];
    }
  }
}

const r64EntryForSeed = (
  region: Region,
  seed: number
): { teamId: string | null; sourceGameId: string | null } => {
  const ffGameId = firstFourByRegionSeed[`${region}-${seed}`];
  if (ffGameId) return { teamId: null, sourceGameId: ffGameId };
  return { teamId: `${region}-${seed}`, sourceGameId: null };
};

export const gameTemplates: GameTemplate[] = (() => {
  const games: GameTemplate[] = [];

  for (const region of regionOrder) {
    const side = regionToSide(region);

    // First Four games for seeds with a/b play-ins.
    [11, 16].forEach((seed, idx) => {
      const gameId = firstFourByRegionSeed[`${region}-${seed}`];
      if (!gameId) return;
      const participants = firstFourParticipants[gameId];
      games.push({
        id: gameId,
        round: "FF",
        region,
        side,
        slot: idx,
        sourceGameIds: null,
        initialTeamIds: [participants[0], participants[1]],
      });
    });

    seedMatchups.forEach(([seedA, seedB], slot) => {
      const aEntry = r64EntryForSeed(region, seedA);
      const bEntry = r64EntryForSeed(region, seedB);
      games.push({
        id: `${region}-R64-${slot}`,
        round: "R64",
        region,
        side,
        slot,
        sourceGameIds: [aEntry.sourceGameId, bEntry.sourceGameId],
        initialTeamIds: [aEntry.teamId, bEntry.teamId],
      });
    });

    for (let slot = 0; slot < 4; slot += 1) {
      games.push({
        id: `${region}-R32-${slot}`,
        round: "R32",
        region,
        side,
        slot,
        sourceGameIds: [`${region}-R64-${slot * 2}`, `${region}-R64-${slot * 2 + 1}`],
        initialTeamIds: null,
      });
    }

    for (let slot = 0; slot < 2; slot += 1) {
      games.push({
        id: `${region}-S16-${slot}`,
        round: "S16",
        region,
        side,
        slot,
        sourceGameIds: [`${region}-R32-${slot * 2}`, `${region}-R32-${slot * 2 + 1}`],
        initialTeamIds: null,
      });
    }

    games.push({
      id: `${region}-E8-0`,
      round: "E8",
      region,
      side,
      slot: 0,
      sourceGameIds: [`${region}-S16-0`, `${region}-S16-1`],
      initialTeamIds: null,
    });
  }

  for (const [slot, half] of BRACKET_HALVES.entries()) {
    games.push({
      id: half.semifinalGameId,
      round: "F4",
      region: null,
      side: half.side,
      slot,
      sourceGameIds: [`${half.regions[0]}-E8-0`, `${half.regions[1]}-E8-0`],
      initialTeamIds: null,
    });
  }

  games.push({
    id: "CHAMP-0",
    round: "CHAMP",
    region: null,
    side: null,
    slot: 0,
    sourceGameIds: ["F4-Left-0", "F4-Right-0"],
    initialTeamIds: null,
  });

  return games;
})();

export const templatesById = new Map(gameTemplates.map((g) => [g.id, g]));

export const regionRounds: Round[] = ["FF", "R64", "R32", "S16", "E8"];
