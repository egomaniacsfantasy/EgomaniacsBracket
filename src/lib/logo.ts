import type { Team } from "../types";

const ESPN_LOGO_BASE = "https://a.espncdn.com/i/teamlogos/mens-college-basketball/500";
const ESPN_FALLBACK_LOGO = "https://a.espncdn.com/i/teamlogos/ncaa/500/default-team-logo.png";

export const fallbackLogo = (_name?: string): string => ESPN_FALLBACK_LOGO;

/**
 * Single source for logo URLs. Teams resolve from ESPN team ids.
 */
export const getTeamLogoUrl = (team: Team): string => {
  if (team.espnId) {
    return `${ESPN_LOGO_BASE}/${team.espnId}.png`;
  }
  return ESPN_FALLBACK_LOGO;
};

// Backward-compatible alias for existing imports.
export const teamLogoUrl = getTeamLogoUrl;
