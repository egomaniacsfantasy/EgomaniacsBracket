import type { Region, Team } from "../types";

type SeedEntry = { seed: number; name: string; bump: number };

const regionSeeds: Record<Region, SeedEntry[]> = {
  East: [
    { seed: 1, name: "UConn", bump: 34 },
    { seed: 2, name: "Iowa State", bump: 20 },
    { seed: 3, name: "Illinois", bump: 10 },
    { seed: 4, name: "Auburn", bump: 16 },
    { seed: 5, name: "San Diego State", bump: 8 },
    { seed: 6, name: "BYU", bump: 7 },
    { seed: 7, name: "Washington State", bump: 2 },
    { seed: 8, name: "Florida Atlantic", bump: -1 },
    { seed: 9, name: "Northwestern", bump: -4 },
    { seed: 10, name: "Drake", bump: 3 },
    { seed: 11, name: "Duquesne", bump: -5 },
    { seed: 12, name: "UAB", bump: -8 },
    { seed: 13, name: "Yale", bump: -11 },
    { seed: 14, name: "Morehead State", bump: -16 },
    { seed: 15, name: "South Dakota State", bump: -19 },
    { seed: 16, name: "Stetson", bump: -24 },
  ],
  West: [
    { seed: 1, name: "North Carolina", bump: 32 },
    { seed: 2, name: "Arizona", bump: 21 },
    { seed: 3, name: "Baylor", bump: 14 },
    { seed: 4, name: "Alabama", bump: 11 },
    { seed: 5, name: "Saint Mary's", bump: 8 },
    { seed: 6, name: "Clemson", bump: 5 },
    { seed: 7, name: "Dayton", bump: 4 },
    { seed: 8, name: "Mississippi State", bump: 0 },
    { seed: 9, name: "Michigan State", bump: 2 },
    { seed: 10, name: "Nevada", bump: 1 },
    { seed: 11, name: "New Mexico", bump: -4 },
    { seed: 12, name: "Grand Canyon", bump: -9 },
    { seed: 13, name: "Charleston", bump: -12 },
    { seed: 14, name: "Colgate", bump: -15 },
    { seed: 15, name: "Long Beach State", bump: -21 },
    { seed: 16, name: "Wagner", bump: -25 },
  ],
  South: [
    { seed: 1, name: "Houston", bump: 35 },
    { seed: 2, name: "Marquette", bump: 20 },
    { seed: 3, name: "Kentucky", bump: 12 },
    { seed: 4, name: "Duke", bump: 16 },
    { seed: 5, name: "Wisconsin", bump: 7 },
    { seed: 6, name: "Texas Tech", bump: 5 },
    { seed: 7, name: "Florida", bump: 3 },
    { seed: 8, name: "Nebraska", bump: 0 },
    { seed: 9, name: "Texas A&M", bump: -1 },
    { seed: 10, name: "Colorado", bump: 2 },
    { seed: 11, name: "NC State", bump: -3 },
    { seed: 12, name: "James Madison", bump: -8 },
    { seed: 13, name: "Vermont", bump: -11 },
    { seed: 14, name: "Oakland", bump: -15 },
    { seed: 15, name: "Western Kentucky", bump: -20 },
    { seed: 16, name: "Longwood", bump: -24 },
  ],
  Midwest: [
    { seed: 1, name: "Purdue", bump: 31 },
    { seed: 2, name: "Tennessee", bump: 23 },
    { seed: 3, name: "Creighton", bump: 15 },
    { seed: 4, name: "Kansas", bump: 14 },
    { seed: 5, name: "Gonzaga", bump: 9 },
    { seed: 6, name: "South Carolina", bump: 4 },
    { seed: 7, name: "Texas", bump: 3 },
    { seed: 8, name: "Utah State", bump: -1 },
    { seed: 9, name: "TCU", bump: -1 },
    { seed: 10, name: "Virginia", bump: 1 },
    { seed: 11, name: "Oregon", bump: 3 },
    { seed: 12, name: "McNeese", bump: -7 },
    { seed: 13, name: "Samford", bump: -10 },
    { seed: 14, name: "Akron", bump: -15 },
    { seed: 15, name: "Saint Peter's", bump: -19 },
    { seed: 16, name: "Montana State", bump: -24 },
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
