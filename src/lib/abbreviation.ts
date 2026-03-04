import { ESPN_ABBREVIATIONS_2026 } from "./espnAbbreviations";

const STOP_WORDS = new Set(["of", "the", "at", "and"]);

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9' ]+/g, " ")
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
