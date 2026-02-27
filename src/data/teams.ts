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

// To update for future tournament years:
// 1) Replace bracket team names/seeds in `regionSeeds`
// 2) Update `ESPN_TEAM_IDS` from ESPN teams API:
//    https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=500
// 3) No logo rendering changes needed elsewhere; logos resolve automatically from espnId.
export const ESPN_TEAM_IDS: Record<string, number> = {
  Akron: 2006,
  Alabama: 333,
  "Alabama State": 2011,
  Arizona: 12,
  Arkansas: 8,
  Auburn: 2,
  Baylor: 239,
  Bryant: 2803,
  BYU: 252,
  Clemson: 228,
  "Colorado State": 36,
  Creighton: 156,
  Drake: 2181,
  Duke: 150,
  Florida: 57,
  Georgia: 61,
  Gonzaga: 2250,
  "Grand Canyon": 2253,
  "High Point": 2272,
  Houston: 248,
  Illinois: 356,
  "Iowa State": 66,
  Kansas: 2305,
  Kentucky: 96,
  Liberty: 2335,
  Lipscomb: 288,
  Louisville: 97,
  Marquette: 269,
  Maryland: 120,
  McNeese: 2377,
  Memphis: 235,
  Michigan: 130,
  "Michigan State": 127,
  "Mississippi State": 344,
  Missouri: 142,
  Montana: 149,
  "Mount St. Mary's": 116,
  "New Mexico": 167,
  "Norfolk State": 2450,
  "North Carolina": 153,
  Oklahoma: 201,
  "Ole Miss": 145,
  Omaha: 2437,
  Oregon: 2483,
  Purdue: 2509,
  "Robert Morris": 2523,
  "Saint Mary's": 2608,
  "SIU Edwardsville": 2565,
  "St. John's": 2599,
  Tennessee: 2633,
  "Texas A&M": 245,
  "Texas Tech": 2641,
  Troy: 2653,
  "UC San Diego": 28,
  UCLA: 26,
  UConn: 41,
  "UNC Wilmington": 350,
  "Utah State": 328,
  Vanderbilt: 238,
  VCU: 2670,
  Wisconsin: 275,
  Wofford: 2747,
  Xavier: 2752,
  Yale: 43,
};

export const teams: Team[] = (Object.keys(regionSeeds) as Region[]).flatMap((region) =>
  regionSeeds[region].map((entry) => {
    const espnId = ESPN_TEAM_IDS[entry.name];
    if (!espnId) {
      throw new Error(`Missing ESPN team id for ${entry.name}`);
    }
    return {
      id: `${region}-${entry.seed}`,
      name: entry.name,
      seed: entry.seed,
      region,
      rating: baseSeedRating(entry.seed) + entry.bump,
      espnId,
    };
  })
);

export const teamsById = new Map(teams.map((team) => [team.id, team]));
