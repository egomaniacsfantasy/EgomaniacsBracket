import type { Region, Team } from "../types";

type SeedEntry = { seed: number; name: string; bump: number };

const regionSeeds: Record<Region, SeedEntry[]> = {
  East: [
    { seed: 1, name: "Duke", bump: 34 },
    { seed: 2, name: "Alabama", bump: 23 },
    { seed: 3, name: "Wisconsin", bump: 14 },
    { seed: 4, name: "Arizona", bump: 16 },
    { seed: 5, name: "Oregon", bump: 9 },
    { seed: 6, name: "BYU", bump: 6 },
    { seed: 7, name: "Saint Mary's", bump: 3 },
    { seed: 8, name: "Mississippi State", bump: 1 },
    { seed: 9, name: "Baylor", bump: 2 },
    { seed: 10, name: "Vanderbilt", bump: 0 },
    { seed: 11, name: "VCU", bump: 1 },
    { seed: 12, name: "Liberty", bump: -8 },
    { seed: 13, name: "Akron", bump: -11 },
    { seed: 14, name: "Montana", bump: -15 },
    { seed: 15, name: "Robert Morris", bump: -19 },
    { seed: 16, name: "Mount St. Mary's", bump: -24 },
  ],
  West: [
    { seed: 1, name: "Florida", bump: 33 },
    { seed: 2, name: "St. John's", bump: 21 },
    { seed: 3, name: "Texas Tech", bump: 14 },
    { seed: 4, name: "Maryland", bump: 13 },
    { seed: 5, name: "Memphis", bump: 9 },
    { seed: 6, name: "Missouri", bump: 6 },
    { seed: 7, name: "Kansas", bump: 5 },
    { seed: 8, name: "UConn", bump: 2 },
    { seed: 9, name: "Oklahoma", bump: 0 },
    { seed: 10, name: "Arkansas", bump: 2 },
    { seed: 11, name: "Drake", bump: -2 },
    { seed: 12, name: "Colorado State", bump: -7 },
    { seed: 13, name: "Grand Canyon", bump: -11 },
    { seed: 14, name: "UNC Wilmington", bump: -14 },
    { seed: 15, name: "Omaha", bump: -19 },
    { seed: 16, name: "Norfolk State", bump: -25 },
  ],
  South: [
    { seed: 1, name: "Auburn", bump: 35 },
    { seed: 2, name: "Michigan State", bump: 22 },
    { seed: 3, name: "Iowa State", bump: 15 },
    { seed: 4, name: "Texas A&M", bump: 14 },
    { seed: 5, name: "Michigan", bump: 9 },
    { seed: 6, name: "Ole Miss", bump: 6 },
    { seed: 7, name: "Marquette", bump: 4 },
    { seed: 8, name: "Louisville", bump: 1 },
    { seed: 9, name: "Creighton", bump: 3 },
    { seed: 10, name: "New Mexico", bump: 2 },
    { seed: 11, name: "North Carolina", bump: 0 },
    { seed: 12, name: "UC San Diego", bump: -7 },
    { seed: 13, name: "Yale", bump: -11 },
    { seed: 14, name: "Lipscomb", bump: -15 },
    { seed: 15, name: "Bryant", bump: -19 },
    { seed: 16, name: "Alabama State", bump: -24 },
  ],
  Midwest: [
    { seed: 1, name: "Houston", bump: 33 },
    { seed: 2, name: "Tennessee", bump: 23 },
    { seed: 3, name: "Kentucky", bump: 15 },
    { seed: 4, name: "Purdue", bump: 13 },
    { seed: 5, name: "Clemson", bump: 8 },
    { seed: 6, name: "Illinois", bump: 6 },
    { seed: 7, name: "UCLA", bump: 3 },
    { seed: 8, name: "Gonzaga", bump: 1 },
    { seed: 9, name: "Georgia", bump: 0 },
    { seed: 10, name: "Utah State", bump: -1 },
    { seed: 11, name: "Xavier", bump: 1 },
    { seed: 12, name: "McNeese", bump: -7 },
    { seed: 13, name: "High Point", bump: -10 },
    { seed: 14, name: "Troy", bump: -15 },
    { seed: 15, name: "Wofford", bump: -20 },
    { seed: 16, name: "SIU Edwardsville", bump: -24 },
  ],
};

const baseSeedRating = (seed: number): number => {
  const spread = 550;
  return Math.round(2025 - ((seed - 1) / 15) * spread);
};

export const teams: Team[] = (Object.keys(regionSeeds) as Region[]).flatMap((region) =>
  regionSeeds[region].map((entry) => ({
    id: `${region}-${entry.seed}`,
    name: entry.name,
    seed: entry.seed,
    region,
    rating: baseSeedRating(entry.seed) + entry.bump,
  }))
);

export const teamsById = new Map(teams.map((team) => [team.id, team]));
