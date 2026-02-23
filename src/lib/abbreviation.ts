const ABBR_OVERRIDES: Record<string, string> = {
  "Saint Mary's": "Saint Mary's",
  "North Carolina": "UNC",
  "North Carolina State": "NC State",
  "San Diego State": "SDSU",
  "South Dakota State": "SDSU",
  "Florida Atlantic": "FAU",
  "Grand Canyon": "GCU",
  "James Madison": "JMU",
  "Texas A&M": "Texas A&M",
  "Texas Tech": "Texas Tech",
  "Michigan State": "Michigan St.",
  "Mississippi State": "Mississippi St.",
  "Morehead State": "Morehead St.",
  "Washington State": "Washington St.",
  "Long Beach State": "Long Beach St.",
  "Western Kentucky": "WKU",
};

const STOP_WORDS = new Set(["of", "the", "at", "and"]);

export function abbreviationForTeam(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "TBD";
  const override = ABBR_OVERRIDES[trimmed];
  if (override) return override;

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
