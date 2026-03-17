export const INVITE_CODE_LENGTH = 8;

const INVITE_PARAM_PATTERN = /(?:[?&](?:code|join)=)([^&#\s]+)/i;
const INVITE_TOKEN_PATTERN = /\b[A-Z0-9]{8}\b/g;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeBareInviteCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, INVITE_CODE_LENGTH);
}

export function extractInviteCode(rawValue: string | null | undefined): string {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return "";

  const candidates = [raw, safeDecode(raw)];

  for (const candidate of candidates) {
    const paramMatch = candidate.match(INVITE_PARAM_PATTERN);
    if (paramMatch?.[1]) {
      const normalized = normalizeBareInviteCode(paramMatch[1]);
      if (normalized.length === INVITE_CODE_LENGTH) return normalized;
    }

    const normalizedWhole = normalizeBareInviteCode(candidate);
    if (normalizedWhole.length === INVITE_CODE_LENGTH) return normalizedWhole;

    const tokens = candidate.toUpperCase().match(INVITE_TOKEN_PATTERN) ?? [];
    const tokenWithDigit = tokens.find((token) => /\d/.test(token));
    if (tokenWithDigit) return tokenWithDigit;
    if (tokens.length === 1) return tokens[0];
  }

  return normalizeBareInviteCode(raw);
}
