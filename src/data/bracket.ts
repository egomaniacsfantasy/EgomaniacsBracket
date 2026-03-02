import type { GameTemplate, Region, Round, Side } from "../types";

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
    label: "East/West",
    semifinalGameId: "F4-Left-0",
    regions: ["East", "West"],
  },
  {
    id: "halfB",
    side: "Right",
    label: "Midwest/South",
    semifinalGameId: "F4-Right-0",
    regions: ["Midwest", "South"],
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

const firstFourByRegionSeed: Record<string, string> = {
  "South-11": "South-FF-11",
  "South-16": "South-FF-16",
  "Midwest-11": "Midwest-FF-11",
  "Midwest-16": "Midwest-FF-16",
};

const firstFourParticipants: Record<string, [string, string]> = {
  "South-FF-11": ["South-11a", "South-11b"],
  "South-FF-16": ["South-16a", "South-16b"],
  "Midwest-FF-11": ["Midwest-11a", "Midwest-11b"],
  "Midwest-FF-16": ["Midwest-16a", "Midwest-16b"],
};

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
