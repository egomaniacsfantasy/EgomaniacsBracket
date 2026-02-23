const ESPN_ABBREVIATIONS_2026: Record<string, string> = {
  uconn: "CONN",
  "iowa state": "ISU",
  illinois: "ILL",
  auburn: "AUB",
  "san diego state": "SDSU",
  byu: "BYU",
  "washington state": "WSU",
  "florida atlantic": "FAU",
  northwestern: "NU",
  drake: "DRKE",
  duquesne: "DUQ",
  uab: "UAB",
  yale: "YALE",
  "morehead state": "MORE",
  "south dakota state": "SDST",
  stetson: "STET",
  "north carolina": "UNC",
  arizona: "ARIZ",
  baylor: "BAY",
  alabama: "ALA",
  "saint mary's": "SMC",
  clemson: "CLEM",
  dayton: "DAY",
  "mississippi state": "MSST",
  "michigan state": "MSU",
  nevada: "NEV",
  "new mexico": "UNM",
  "grand canyon": "GCU",
  charleston: "COFC",
  colgate: "COLG",
  "long beach state": "LBSU",
  wagner: "WAG",
  houston: "HOU",
  marquette: "MARQ",
  kentucky: "UK",
  duke: "DUKE",
  wisconsin: "WIS",
  "texas tech": "TTU",
  florida: "FLA",
  nebraska: "NEB",
  "texas a&m": "TA&M",
  colorado: "COLO",
  "nc state": "NCSU",
  vermont: "UVM",
  "james madison": "JMU",
  oakland: "OAK",
  "western kentucky": "WKU",
  longwood: "LONG",
  purdue: "PUR",
  tennessee: "TENN",
  creighton: "CREI",
  kansas: "KU",
  gonzaga: "GONZ",
  "south carolina": "SC",
  texas: "TEX",
  "utah state": "USU",
  tcu: "TCU",
  virginia: "UVA",
  oregon: "ORE",
  mcneese: "MCN",
  samford: "SAM",
  akron: "AKR",
  "saint peter's": "SPU",
  "montana state": "MTST",
};

const STOP_WORDS = new Set(["of", "the", "at", "and"]);

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function abbreviationForTeam(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "TBD";

  const exact = ESPN_ABBREVIATIONS_2026[normalizeName(trimmed)];
  if (exact) return exact;

  const cleaned = trimmed.replace(/[^A-Za-z0-9&.' ]+/g, " ").replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 10);
  if (words.length === 2) {
    if (words[0].length <= 4 && words[1].length <= 4) return `${words[0]} ${words[1]}`;
    return `${words[0]} ${words[1].slice(0, 4)}`.trim();
  }

  const significant = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  if (significant.length === 0) return words.map((word) => word[0]).join("").slice(0, 5).toUpperCase();
  return significant.map((word) => word[0]).join("").slice(0, 5).toUpperCase();
}
