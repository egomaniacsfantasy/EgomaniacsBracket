import type { GameTemplate, Region, Round, Side } from "../types";

export const regionOrder: Region[] = ["East", "West", "South", "Midwest"];
export const sideRegions: Record<Side, Region[]> = {
  Left: ["East", "West"],
  Right: ["South", "Midwest"],
};

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

const rounds: Round[] = ["R64", "R32", "S16", "E8", "F4", "CHAMP"];
export const roundOrder = rounds;

const regionToSide = (region: Region): Side =>
  region === "East" || region === "West" ? "Left" : "Right";

export const gameTemplates: GameTemplate[] = (() => {
  const games: GameTemplate[] = [];

  for (const region of regionOrder) {
    const side = regionToSide(region);

    seedMatchups.forEach(([seedA, seedB], slot) => {
      games.push({
        id: `${region}-R64-${slot}`,
        round: "R64",
        region,
        side,
        slot,
        sourceGameIds: null,
        initialTeamIds: [`${region}-${seedA}`, `${region}-${seedB}`],
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

  games.push({
    id: "F4-Left-0",
    round: "F4",
    region: null,
    side: "Left",
    slot: 0,
    sourceGameIds: ["East-E8-0", "West-E8-0"],
    initialTeamIds: null,
  });
  games.push({
    id: "F4-Right-0",
    round: "F4",
    region: null,
    side: "Right",
    slot: 1,
    sourceGameIds: ["South-E8-0", "Midwest-E8-0"],
    initialTeamIds: null,
  });
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

export const regionRounds: Round[] = ["R64", "R32", "S16", "E8"];
