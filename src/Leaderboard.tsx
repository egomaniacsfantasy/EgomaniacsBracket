import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import {
  deleteBracketAsAdmin,
  getChaosTierEmoji,
  getCachedLeaderboard,
  getCachedTournamentResultMap,
  type LeaderboardBoldestPick,
  type LeaderboardEntry,
  getLeaderboard,
  getTournamentResultMap,
} from "./bracketStorage";
import { teams } from "./data/teams";
import { NCAA_TOURNAMENT_COMPLETE } from "./data/ncaaKnownResults";
import { hasElevatedAccess } from "./groupVisibility";
import { resolveBracketWithKnownResults } from "./lib/bracketCompletion";
import { captureError } from "./lib/errorMonitoring";
import {
  formatForecastProbability,
  getForecastHeaderLabel,
  type ForecastOddsFormat,
} from "./lib/forecastDisplay";
import { teamLogoUrl } from "./lib/logo";
import { abbreviationForTeam } from "./lib/abbreviation";
import type { LockedPicks } from "./lib/bracket";
import type { ScoringResult } from "./lib/bracketScoring";
import { computeStandingsForecast, type RankHistogramBin, type StandingsForecastEntry, type StandingsForecastResult } from "./lib/standingsForecast";
import { StandingsForecastHistogram } from "./StandingsForecastHistogram";

type ParsedLeaderboardEntry = LeaderboardEntry & {
  boldestParsed: LeaderboardBoldestPick | null;
};

type LeaderboardSortMode = "odds" | "score";

const WIN_PCT_TIER = {
  CONTENDER: 0.01,
  IN_THE_MIX: 0.001,
} as const;

const WIN_PCT_EMPHASIS = {
  AMBER: 0.01,
  PRIMARY: 0.003,
} as const;

const SORT_FADE_OUT_MS = 100;

const teamsByName = new Map(teams.map((team) => [team.name, team]));
const ADVANCEMENT_LABEL_BY_ROUND: Record<string, string | null> = {
  FF: "R64",
  R64: "R32",
  R32: "S16",
  S16: "E8",
  E8: "F4",
  F4: "CHAMP",
  CHAMP: "CHAMP",
};
const ADVANCEMENT_RANK: Record<string, number> = {
  R64: 1,
  R32: 2,
  S16: 3,
  E8: 4,
  F4: 5,
  CHAMP: 6,
};

type PickDisplay = {
  name: string;
  shortName: string;
  seed: number | null;
  logoUrl: string | null;
  teamId: string | null;
};

type TournamentPickState = "normal" | "eliminated" | "nailed";

function formatBracketScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}`;
}

function formatExpectedPoints(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

function formatExpectedRank(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `#${value.toFixed(1)}`;
}

function compareScoreEntries(left: LeaderboardEntry, right: LeaderboardEntry) {
  const scoreDiff = Number(right.total_score ?? 0) - Number(left.total_score ?? 0);
  if (scoreDiff !== 0) return scoreDiff;
  const rankDiff = Number(left.rank ?? Number.MAX_SAFE_INTEGER) - Number(right.rank ?? Number.MAX_SAFE_INTEGER);
  if (rankDiff !== 0) return rankDiff;
  const correctDiff = Number(right.correct_picks ?? 0) - Number(left.correct_picks ?? 0);
  if (correctDiff !== 0) return correctDiff;
  return left.bracket_id.localeCompare(right.bracket_id);
}

function getWinTier(probability: number | null | undefined) {
  if (typeof probability !== "number" || !Number.isFinite(probability)) return "mix" as const;
  if (probability >= WIN_PCT_TIER.CONTENDER) return "contender" as const;
  if (probability < WIN_PCT_TIER.IN_THE_MIX) return "long-shot" as const;
  return "mix" as const;
}

function getWinTone(probability: number | null | undefined) {
  if (typeof probability !== "number" || !Number.isFinite(probability)) return "muted" as const;
  if (probability >= WIN_PCT_EMPHASIS.AMBER) return "amber" as const;
  if (probability >= WIN_PCT_EMPHASIS.PRIMARY) return "primary" as const;
  return "muted" as const;
}

function parseBoldestPick(value: unknown): LeaderboardBoldestPick | null {
  const raw = typeof value === "string" ? safeJsonParse(value) : value;
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const winnerName = typeof row.winner_name === "string" ? row.winner_name : null;
  const loserName = typeof row.loser_name === "string" ? row.loser_name : null;
  const winnerSeed =
    typeof row.winner_seed === "number"
      ? row.winner_seed
      : typeof row.winner_seed === "string"
        ? Number(row.winner_seed)
        : null;
  const loserSeed =
    typeof row.loser_seed === "number" ? row.loser_seed : typeof row.loser_seed === "string" ? Number(row.loser_seed) : null;
  const upsetMagnitude =
    typeof row.upset_magnitude === "number"
      ? row.upset_magnitude
      : typeof row.upset_magnitude === "string"
        ? Number(row.upset_magnitude)
        : null;
  if (!winnerName || !loserName || !Number.isFinite(winnerSeed ?? NaN) || !Number.isFinite(loserSeed ?? NaN)) return null;
  return {
    winner_name: winnerName,
    winner_seed: Number(winnerSeed),
    loser_name: loserName,
    loser_seed: Number(loserSeed),
    round: typeof row.round === "string" ? row.round : null,
    upset_magnitude: Number.isFinite(upsetMagnitude ?? NaN) ? Number(upsetMagnitude) : null,
  };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildPickDisplay(
  name?: string | null,
  seed?: number | null,
  logoUrl?: string | null
): PickDisplay | null {
  const trimmedName = name?.trim();
  if (!trimmedName) return null;
  const team = teamsByName.get(trimmedName);
  return {
    name: trimmedName,
    shortName: abbreviationForTeam(trimmedName),
    seed: seed ?? team?.seed ?? null,
    logoUrl: logoUrl ?? (team ? teamLogoUrl(team) : null),
    teamId: team?.id ?? null,
  };
}

function getRunnerUpDisplay(entry: LeaderboardEntry): PickDisplay | null {
  if (entry.runner_up_name) {
    return buildPickDisplay(entry.runner_up_name, entry.runner_up_seed, entry.runner_up_logo_url);
  }

  const picks = entry.picks ?? null;
  if (!picks) return null;
  const championId = typeof picks["CHAMP-0"] === "string" ? picks["CHAMP-0"] : null;
  const leftFinalistId = typeof picks["F4-Left-0"] === "string" ? picks["F4-Left-0"] : null;
  const rightFinalistId = typeof picks["F4-Right-0"] === "string" ? picks["F4-Right-0"] : null;
  if (championId && leftFinalistId && rightFinalistId) {
    const runnerUpId =
      championId === leftFinalistId ? rightFinalistId : championId === rightFinalistId ? leftFinalistId : null;
    const runnerUpTeam = runnerUpId ? teams.find((team) => team.id === runnerUpId) : null;
    if (runnerUpTeam) {
      return buildPickDisplay(runnerUpTeam.name, runnerUpTeam.seed, teamLogoUrl(runnerUpTeam));
    }
  }

  const { games } = resolveBracketWithKnownResults(picks);
  const champGame = games.find((game) => game.round === "CHAMP");
  if (!champGame?.winnerId || !champGame.teamAId || !champGame.teamBId) return null;
  const runnerUpId = champGame.winnerId === champGame.teamAId ? champGame.teamBId : champGame.teamAId;
  const runnerUpTeam = teams.find((team) => team.id === runnerUpId);
  if (!runnerUpTeam) return null;
  return buildPickDisplay(runnerUpTeam.name, runnerUpTeam.seed, teamLogoUrl(runnerUpTeam));
}

function getChampionDisplay(entry: LeaderboardEntry): PickDisplay | null {
  const storedChampion = buildPickDisplay(entry.champion_name, entry.champion_seed, entry.champion_logo_url);
  if (storedChampion) return storedChampion;

  const picks = entry.picks ?? null;
  if (!picks) return null;
  const championId = typeof picks["CHAMP-0"] === "string" ? picks["CHAMP-0"] : null;
  if (championId) {
    const championTeam = teams.find((team) => team.id === championId);
    if (championTeam) {
      return buildPickDisplay(championTeam.name, championTeam.seed, teamLogoUrl(championTeam));
    }
  }

  const { games } = resolveBracketWithKnownResults(picks);
  const champGame = games.find((game) => game.round === "CHAMP");
  if (!champGame?.winnerId) return null;
  const championTeam = teams.find((team) => team.id === champGame.winnerId);
  if (!championTeam) return null;
  return buildPickDisplay(championTeam.name, championTeam.seed, teamLogoUrl(championTeam));
}

function getBoldestTargetRound(round: string | null | undefined): string | null {
  if (!round) return null;
  return ADVANCEMENT_LABEL_BY_ROUND[round] ?? null;
}

function buildTournamentState(resultMap: Record<string, ScoringResult>) {
  const actualPicks = Object.fromEntries(
    Object.entries(resultMap).map(([matchupId, result]) => [matchupId, result.winner])
  ) as LockedPicks;
  const { games } = resolveBracketWithKnownResults(actualPicks);
  const eliminatedTeamIds = new Set<string>();
  const advancementByTeamId = new Map<string, number>();

  games.forEach((game) => {
    if (!game.teamAId || !game.teamBId || !game.winnerId) return;
    if (game.teamAId !== game.winnerId) eliminatedTeamIds.add(game.teamAId);
    if (game.teamBId !== game.winnerId) eliminatedTeamIds.add(game.teamBId);

    const advancementLabel = ADVANCEMENT_LABEL_BY_ROUND[game.round];
    if (!advancementLabel) return;
    const advancementRank = ADVANCEMENT_RANK[advancementLabel] ?? 0;
    const existingRank = advancementByTeamId.get(game.winnerId) ?? 0;
    if (advancementRank > existingRank) {
      advancementByTeamId.set(game.winnerId, advancementRank);
    }
  });

  return { eliminatedTeamIds, advancementByTeamId };
}

function getPickEliminationState(
  pick: PickDisplay | null,
  tournamentState: ReturnType<typeof buildTournamentState> | null
): TournamentPickState {
  if (!pick?.teamId || !tournamentState) return "normal";
  return tournamentState.eliminatedTeamIds.has(pick.teamId) ? "eliminated" : "normal";
}

function getBoldestState(
  pick: LeaderboardBoldestPick | null,
  tournamentState: ReturnType<typeof buildTournamentState> | null
): TournamentPickState {
  if (!pick || !tournamentState) return "normal";
  const team = teamsByName.get(pick.winner_name);
  if (!team) return "normal";

  const targetRound = getBoldestTargetRound(pick.round);
  const targetRank = targetRound ? ADVANCEMENT_RANK[targetRound] ?? 0 : 0;
  const reachedRank = tournamentState.advancementByTeamId.get(team.id) ?? 0;
  if (targetRank > 0 && reachedRank >= targetRank) return "nailed";
  if (tournamentState.eliminatedTeamIds.has(team.id)) return "eliminated";
  return "normal";
}

function LeaderboardTeamLogo({
  src,
  seed,
  name,
  className,
  fallbackClassName,
}: {
  src: string | null | undefined;
  seed: number | null;
  name: string;
  className: string;
  fallbackClassName: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span className={fallbackClassName}>{seed !== null ? `#${seed}` : "?"}</span>;
  }
  return (
    <img
      src={src}
      alt={name}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

function renderChampion(
  entry: LeaderboardEntry,
  showElimination: boolean,
  tournamentState: ReturnType<typeof buildTournamentState> | null = null
) {
  const champion = getChampionDisplay(entry);
  const championState = showElimination ? getPickEliminationState(champion, tournamentState) : "normal";
  return (
    <span className="lb-col lb-col-champion">
      <LeaderboardTeamLogo
        src={champion?.logoUrl}
        seed={champion?.seed ?? null}
        name={champion?.name ?? "—"}
        className="lb-champion-logo"
        fallbackClassName="lb-champion-logo-fallback"
      />
      {champion?.seed !== null && champion?.seed !== undefined ? <span className="lb-champion-seed">#{champion.seed}</span> : null}
      <span className={`lb-champion-name ${championState === "eliminated" ? "lb-pick-name--eliminated" : ""}`}>
        {champion?.name ?? "—"}
      </span>
      {championState === "eliminated" ? <span className="lb-champion-elim">✗</span> : null}
    </span>
  );
}

function renderRunnerUp(
  entry: LeaderboardEntry,
  showElimination: boolean,
  tournamentState: ReturnType<typeof buildTournamentState> | null = null
) {
  const runnerUp = getRunnerUpDisplay(entry);
  const runnerUpState = showElimination ? getPickEliminationState(runnerUp, tournamentState) : "normal";

  return (
    <span className="lb-col lb-col-runner-up">
      {runnerUp ? (
        <>
          <LeaderboardTeamLogo
            src={runnerUp.logoUrl}
            seed={runnerUp.seed}
            name={runnerUp.name}
            className="lb-runner-logo"
            fallbackClassName="lb-runner-logo-fallback"
          />
          <span className={`lb-runner-name ${runnerUpState === "eliminated" ? "lb-pick-name--eliminated" : ""}`}>
            {runnerUp.shortName}
          </span>
          {runnerUp.seed !== null ? <span className="lb-runner-seed">#{runnerUp.seed}</span> : null}
          {runnerUpState === "eliminated" ? <span className="lb-runner-elim">✗</span> : null}
        </>
      ) : (
        <span className="lb-muted-dash">—</span>
      )}
    </span>
  );
}

function renderBoldestPick(
  boldestPick: LeaderboardBoldestPick | null,
  showStatus: boolean,
  tournamentState: ReturnType<typeof buildTournamentState> | null = null
) {
  const boldestState = showStatus ? getBoldestState(boldestPick, tournamentState) : "normal";
  const winnerTeam = boldestPick ? teamsByName.get(boldestPick.winner_name) : null;
  const targetRound = getBoldestTargetRound(boldestPick?.round);

  return (
    <span className={`lb-col lb-col-boldest ${boldestState !== "normal" ? `lb-col-boldest--${boldestState}` : ""}`}>
      {boldestPick && winnerTeam ? (
        <>
          <LeaderboardTeamLogo
            src={teamLogoUrl(winnerTeam)}
            seed={winnerTeam.seed}
            name={winnerTeam.name}
            className="lb-boldest-logo"
            fallbackClassName="lb-boldest-logo-fallback"
          />
          <span className={`lb-boldest-text ${boldestState !== "normal" ? `lb-boldest-text--${boldestState}` : ""}`}>
            #{boldestPick.winner_seed} {abbreviationForTeam(boldestPick.winner_name)}
          </span>
          {targetRound ? <span className="lb-boldest-arrow">→ {targetRound}</span> : null}
        </>
      ) : (
        <span className="lb-muted-dash">—</span>
      )}
    </span>
  );
}

function renderMobileStory(
  entry: LeaderboardEntry,
  showTournamentStates: boolean,
  tournamentState: ReturnType<typeof buildTournamentState> | null = null
) {
  const champion = getChampionDisplay(entry);
  const runnerUp = getRunnerUpDisplay(entry);
  const championState = showTournamentStates ? getPickEliminationState(champion, tournamentState) : "normal";
  const runnerUpState = showTournamentStates ? getPickEliminationState(runnerUp, tournamentState) : "normal";
  const boldestPick = parseBoldestPick(entry.boldest_pick);
  const boldestState = showTournamentStates ? getBoldestState(boldestPick, tournamentState) : "normal";
  const boldestWinner = boldestPick ? teamsByName.get(boldestPick.winner_name) : null;
  const targetRound = getBoldestTargetRound(boldestPick?.round);

  return (
    <span className="lb-col lb-col-mobile-story">
      <span className="lb-mobile-title-matchup">
        {champion ? (
          <span className="lb-mobile-team">
            <LeaderboardTeamLogo
              src={champion.logoUrl}
              seed={champion.seed}
              name={champion.name}
              className="lb-mobile-team-logo"
              fallbackClassName="lb-mobile-team-fallback"
            />
            <span className={`lb-mobile-team-name ${championState === "eliminated" ? "lb-pick-name--eliminated" : ""}`}>
              {champion.shortName}
            </span>
          </span>
        ) : (
          <span className="lb-muted-dash">—</span>
        )}
        <span className="lb-mobile-vs">vs</span>
        {runnerUp ? (
          <span className="lb-mobile-team">
            <LeaderboardTeamLogo
              src={runnerUp.logoUrl}
              seed={runnerUp.seed}
              name={runnerUp.name}
              className="lb-mobile-team-logo"
              fallbackClassName="lb-mobile-team-fallback"
            />
            <span className={`lb-mobile-team-name ${runnerUpState === "eliminated" ? "lb-pick-name--eliminated" : ""}`}>
              {runnerUp.shortName}
            </span>
          </span>
        ) : (
          <span className="lb-muted-dash">—</span>
        )}
      </span>
      <span className={`lb-mobile-boldest ${boldestState !== "normal" ? `lb-mobile-boldest--${boldestState}` : ""}`}>
        {boldestPick && boldestWinner ? (
          <>
            <LeaderboardTeamLogo
              src={teamLogoUrl(boldestWinner)}
              seed={boldestWinner.seed}
              name={boldestWinner.name}
              className="lb-mobile-boldest-logo"
              fallbackClassName="lb-mobile-boldest-fallback"
            />
            <span className={`lb-mobile-boldest-text ${boldestState !== "normal" ? `lb-boldest-text--${boldestState}` : ""}`}>
              #{boldestPick.winner_seed} {abbreviationForTeam(boldestPick.winner_name)}
            </span>
            {targetRound ? <span className="lb-mobile-boldest-arrow">→ {targetRound}</span> : null}
          </>
        ) : (
          <span className="lb-muted-dash">—</span>
        )}
      </span>
    </span>
  );
}

function LeaderboardWinCell({
  forecast,
  maxWinProb,
  oddsFormat,
}: {
  forecast: StandingsForecastEntry | null;
  maxWinProb: number;
  oddsFormat: ForecastOddsFormat;
}) {
  const probability = forecast?.finish1Prob ?? null;
  const relativeWidth =
    typeof probability === "number" && Number.isFinite(probability) && maxWinProb > 0
      ? Math.max(0, Math.min(100, (probability / maxWinProb) * 100))
      : 0;
  const tone = getWinTone(probability);

  return (
    <span className="lb-col lb-col-win">
      <span className="lb-win-bar">
        <span className="lb-win-bar-fill" style={{ width: `${relativeWidth}%` }} />
        <span className={`lb-win-value lb-win-value--${tone}`}>
          {formatForecastProbability(probability, oddsFormat)}
        </span>
      </span>
    </span>
  );
}

function LeaderboardDetailLine({
  label,
  logoSrc,
  fallbackSeed,
  primary,
  secondary,
  state = "normal",
}: {
  label: string;
  logoSrc: string | null | undefined;
  fallbackSeed: number | null;
  primary: string;
  secondary?: string | null;
  state?: TournamentPickState;
}) {
  return (
    <div className="lb-detail-line">
      <span className="lb-detail-line-label">{label}</span>
      <div className="lb-detail-line-body">
        <LeaderboardTeamLogo
          src={logoSrc}
          seed={fallbackSeed}
          name={primary}
          className="lb-detail-line-logo"
          fallbackClassName="lb-detail-line-fallback"
        />
        <span className={`lb-detail-line-primary ${state === "eliminated" ? "lb-pick-name--eliminated" : ""} ${state === "nailed" ? "lb-detail-line-primary--nailed" : ""}`}>
          {primary}
        </span>
        {secondary ? <span className="lb-detail-line-secondary">{secondary}</span> : null}
        {state === "eliminated" ? <span className="lb-detail-line-state">✗</span> : null}
      </div>
    </div>
  );
}

function LeaderboardForecastHistogram({
  bins,
  values,
  oddsFormat,
  simCount,
}: {
  bins: RankHistogramBin[];
  values: number[];
  oddsFormat: ForecastOddsFormat;
  simCount: number;
}) {
  return (
    <StandingsForecastHistogram
      bins={bins}
      values={values}
      format={oddsFormat}
      simCount={simCount}
      variant="leaderboard"
      showPrimaryLabel
    />
  );
}

function LBPrizeHero() {
  return (
    <div className="lb-prize-hero">
      <div className="lb-prize-hero-inner">
        <span className="lb-prize-trophy">🏆</span>
        <div className="lb-prize-text">
          <h3 className="lb-prize-amount">$100</h3>
          <p className="lb-prize-subtitle">to the top bracket</p>
        </div>
      </div>
      <p className="lb-prize-detail">Submit your bracket before tip-off. Highest score wins.</p>
    </div>
  );
}

function LBFooter() {
  return (
    <div className="lb-footer">
      <div className="lb-footer-scoring">
        <span className="lb-footer-label">SCORING</span>
        <span className="lb-footer-values">R64: 10 · R32: 20 · S16: 40 · E8: 80 · F4: 160 · Championship: 320</span>
      </div>
      <span className="lb-footer-max">Max possible: 1,920</span>
    </div>
  );
}

function LBEmptyState({
  submissionsLocked,
  onClose,
  onSubmitBracket,
}: {
  submissionsLocked: boolean;
  onClose?: () => void;
  onSubmitBracket?: () => void;
}) {
  return (
    <div className="lb-empty-state">
      <span className="lb-empty-icon">🏀</span>
      <h3 className="lb-empty-title">No brackets yet</h3>
      <p className="lb-empty-body">
        {submissionsLocked
          ? "Brackets are locked. Scores will populate here as results come in."
          : "Be the first to submit your bracket and compete for the $100 prize."}
      </p>
      {!submissionsLocked ? (
        <button className="lb-empty-cta" onClick={() => (onSubmitBracket ?? onClose)?.()}>
          Submit my bracket →
        </button>
      ) : null}
    </div>
  );
}

function ForecastDetail({
  entry,
  forecast,
  bins,
  tournamentState,
  oddsFormat,
  simCount,
}: {
  entry: LeaderboardEntry;
  forecast: StandingsForecastEntry;
  bins: StandingsForecastResult["bins"];
  tournamentState: ReturnType<typeof buildTournamentState> | null;
  oddsFormat: ForecastOddsFormat;
  simCount: number;
}) {
  const runnerUp = getRunnerUpDisplay(entry);
  const runnerUpState = getPickEliminationState(runnerUp, tournamentState);
  const boldestPick = parseBoldestPick(entry.boldest_pick);
  const boldestTeam = boldestPick ? teamsByName.get(boldestPick.winner_name) : null;
  const boldestState = getBoldestState(boldestPick, tournamentState);
  const boldestRound = getBoldestTargetRound(boldestPick?.round);

  return (
    <div className="lb-detail-forecast">
      <div className="lb-detail-forecast-left">
        <div className="lb-detail-forecast-metrics">
          <div className="lb-detail-forecast-stat">
            <span className="lb-detail-forecast-label">Win</span>
            <span className="lb-detail-forecast-value lb-detail-forecast-value--win">
              {formatForecastProbability(forecast.finish1Prob, oddsFormat)}
            </span>
          </div>
          <div className="lb-detail-forecast-stat">
            <span className="lb-detail-forecast-label">Exp Pts</span>
            <span className="lb-detail-forecast-value">{formatExpectedPoints(forecast.expectedPoints)}</span>
          </div>
          <div className="lb-detail-forecast-stat">
            <span className="lb-detail-forecast-label">Exp Rank</span>
            <span className="lb-detail-forecast-value">{formatExpectedRank(forecast.expectedRank)}</span>
          </div>
        </div>
        <div className="lb-detail-lines">
          {runnerUp ? (
            <LeaderboardDetailLine
              label="Runner-up"
              logoSrc={runnerUp.logoUrl}
              fallbackSeed={runnerUp.seed}
              primary={runnerUp.name}
              secondary={runnerUp.seed !== null ? `#${runnerUp.seed}` : null}
              state={runnerUpState}
            />
          ) : null}
          {boldestPick && boldestTeam ? (
            <LeaderboardDetailLine
              label="Boldest pick"
              logoSrc={teamLogoUrl(boldestTeam)}
              fallbackSeed={boldestTeam.seed}
              primary={`#${boldestPick.winner_seed} ${abbreviationForTeam(boldestPick.winner_name)}`}
              secondary={boldestRound ? `→ ${boldestRound}` : null}
              state={boldestState}
            />
          ) : null}
        </div>
      </div>
      <div className="lb-detail-forecast-hist">
        <span className="lb-detail-forecast-hist-label">Rank distribution</span>
        <LeaderboardForecastHistogram bins={bins} values={forecast.rankHistogram} oddsFormat={oddsFormat} simCount={simCount} />
      </div>
    </div>
  );
}

function RowDetail({
  canAdminDelete,
  deletingBracketId,
  entry,
  forecast,
  forecastBins,
  tournamentState,
  onDelete,
  oddsFormat,
  forecastSimCount,
}: {
  canAdminDelete: boolean;
  deletingBracketId: string | null;
  entry: LeaderboardEntry;
  forecast: StandingsForecastEntry | null;
  forecastBins: StandingsForecastResult["bins"];
  tournamentState: ReturnType<typeof buildTournamentState> | null;
  onDelete: (entry: LeaderboardEntry) => void;
  oddsFormat: ForecastOddsFormat;
  forecastSimCount: number;
}) {
  const isDeleting = deletingBracketId === entry.bracket_id;
  return (
    <div className="lb-row-detail">
      {forecast ? (
        <ForecastDetail
          entry={entry}
          forecast={forecast}
          bins={forecastBins}
          tournamentState={tournamentState}
          oddsFormat={oddsFormat}
          simCount={forecastSimCount}
        />
      ) : null}
      {canAdminDelete ? (
        <div className="lb-detail-actions">
          <button
            type="button"
            className="lb-admin-delete"
            onClick={() => onDelete(entry)}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete Bracket"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PreTournamentLeaderboard({
  canAdminDelete,
  deletingBracketId,
  entries,
  currentUserId,
  onDelete,
}: {
  canAdminDelete: boolean;
  deletingBracketId: string | null;
  entries: ParsedLeaderboardEntry[];
  currentUserId: string | null;
  onDelete: (entry: LeaderboardEntry) => void;
}) {
  return (
    <div className="lb-table">
      <div className={`lb-row lb-row--header lb-row--pre ${canAdminDelete ? "lb-row--admin" : ""}`}>
        <span className="lb-col lb-col-rank">#</span>
        <span className="lb-col lb-col-player">PLAYER</span>
        <span className="lb-col lb-col-bracket">BRACKET</span>
        <span className="lb-col lb-col-bracket-score">BRACKET SCORE</span>
        <span className="lb-col lb-col-champion">CHAMPION</span>
        <span className="lb-col lb-col-runner-up">RUNNER-UP</span>
        <span className="lb-col lb-col-boldest">BOLDEST PICK</span>
        <span className="lb-col lb-col-chaos">CHAOS</span>
        <span className="lb-col lb-col-mobile-story">PICKS</span>
        {canAdminDelete ? <span className="lb-col lb-col-admin">ADMIN</span> : null}
      </div>
      {entries.map((entry, index) => {
        const isMe = currentUserId !== null && entry.user_id === currentUserId;
        const isDeleting = deletingBracketId === entry.bracket_id;
        return (
          <div
            key={entry.bracket_id ?? `${entry.user_id}-${entry.bracket_name}-${index}`}
            className={`lb-row lb-row--pre ${canAdminDelete ? "lb-row--admin" : ""} ${isMe ? "lb-row--me" : ""}`}
          >
            <span className="lb-col lb-col-rank">{entry.rank ?? index + 1}</span>
            <span className="lb-col lb-col-player">
              {entry.display_name}
              {isMe ? <span className="lb-you-badge">YOU</span> : null}
            </span>
            <span className="lb-col lb-col-bracket">{entry.bracket_name}</span>
            <span className="lb-col lb-col-bracket-score">{formatBracketScore(entry.total_score)}</span>
            {renderChampion(entry, false, null)}
            {renderRunnerUp(entry, false, null)}
            {renderBoldestPick(entry.boldestParsed, false, null)}
            <span className="lb-col lb-col-chaos">
              {entry.chaos_score !== null && entry.chaos_score !== undefined ? (
                <>
                  <span className="lb-chaos-emoji">{getChaosTierEmoji(entry.chaos_score)}</span>
                  <span className="lb-chaos-score">{Math.round(entry.chaos_score)}</span>
                </>
              ) : (
                "—"
              )}
            </span>
            {renderMobileStory(entry, false, null)}
            {canAdminDelete ? (
              <span className="lb-col lb-col-admin">
                <button
                  type="button"
                  className="lb-admin-delete"
                  onClick={() => onDelete(entry)}
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TournamentLeaderboard({
  canAdminDelete,
  deletingBracketId,
  entries,
  currentUserId,
  forecast,
  forecastLoading,
  sortMode,
  onSortModeChange,
  tableBodyFading,
  tournamentState,
  onDelete,
  oddsFormat,
}: {
  canAdminDelete: boolean;
  deletingBracketId: string | null;
  entries: ParsedLeaderboardEntry[];
  currentUserId: string | null;
  forecast: StandingsForecastResult | null;
  forecastLoading: boolean;
  sortMode: LeaderboardSortMode;
  onSortModeChange: (mode: LeaderboardSortMode) => void;
  tableBodyFading: boolean;
  tournamentState: ReturnType<typeof buildTournamentState> | null;
  onDelete: (entry: LeaderboardEntry) => void;
  oddsFormat: ForecastOddsFormat;
}) {
  const [expandedBracketId, setExpandedBracketId] = useState<string | null>(null);
  const maxWinProb = useMemo(
    () =>
      entries.reduce((maxValue, entry) => {
        const value = forecast?.rows[entry.bracket_id]?.finish1Prob ?? 0;
        return value > maxValue ? value : maxValue;
      }, 0),
    [entries, forecast],
  );

  return (
    <div className="lb-table">
      <div className={`lb-row lb-row--header lb-row--tournament ${canAdminDelete ? "lb-row--admin" : ""}`}>
        <span className="lb-col lb-col-rank">#</span>
        <span className="lb-col lb-col-player">PLAYER</span>
        <span className="lb-col lb-col-champion">CHAMPION</span>
        <span className="lb-col lb-col-score">
          <button
            type="button"
            className={`lb-header-sort-btn ${sortMode === "score" ? "lb-header-sort-btn--active" : ""}`}
            onClick={() => onSortModeChange("score")}
          >
            SCORE {sortMode === "score" ? <span className="lb-header-sort-arrow">▼</span> : null}
          </button>
        </span>
        <span className="lb-col lb-col-correct">CORRECT</span>
        <span className="lb-col lb-col-win">
          <button
            type="button"
            className={`lb-header-sort-btn ${sortMode === "odds" ? "lb-header-sort-btn--active" : ""}`}
            onClick={() => onSortModeChange("odds")}
          >
            {getForecastHeaderLabel(oddsFormat)} {sortMode === "odds" ? <span className="lb-header-sort-arrow">▼</span> : null}
          </button>
        </span>
        <span className="lb-col lb-col-max">MAX</span>
        {canAdminDelete ? <span className="lb-col lb-col-admin">ADMIN</span> : null}
      </div>
      <div className={`lb-table-body ${tableBodyFading ? "lb-table-body--fading" : ""}`}>
        {entries.map((entry, index) => {
          const isMe = currentUserId !== null && entry.user_id === currentUserId;
          const key = entry.bracket_id ?? `${entry.user_id}-${entry.bracket_name}-${index}`;
          const expanded = expandedBracketId === key;
          const isDeleting = deletingBracketId === entry.bracket_id;
          const forecastEntry = forecast?.rows[entry.bracket_id] ?? null;
          const toggleExpanded = () => setExpandedBracketId(expanded ? null : key);
          const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleExpanded();
            }
          };
          const winProb = forecastEntry?.finish1Prob ?? null;
          const tier = getWinTier(winProb);
          const champion = getChampionDisplay(entry);
          const championState = getPickEliminationState(champion, tournamentState);

          return (
            <div key={key}>
              <div
                className={`lb-row lb-row--tournament ${canAdminDelete ? "lb-row--admin" : ""} ${isMe ? "lb-row--me" : ""} ${tier === "contender" ? "lb-row--contender" : ""} ${tier === "long-shot" ? "lb-row--long-shot" : ""} lb-row--interactive`}
                onClick={toggleExpanded}
                onKeyDown={handleKeyDown}
                role="button"
                tabIndex={0}
              >
                <span className="lb-col lb-col-rank">{index + 1}</span>
                <span className="lb-col lb-col-player">
                  <span className="lb-player-stack">
                    <span className="lb-player-name">
                      {entry.display_name}
                      {isMe ? <span className="lb-you-badge">YOU</span> : null}
                    </span>
                    <span className="lb-player-bracket">{entry.bracket_name}</span>
                  </span>
                </span>
                <span className="lb-col lb-col-champion">
                  <LeaderboardTeamLogo
                    src={champion?.logoUrl}
                    seed={champion?.seed ?? null}
                    name={champion?.name ?? "—"}
                    className="lb-champion-logo"
                    fallbackClassName="lb-champion-logo-fallback"
                  />
                  <span className="lb-champion-copy">
                    <span className={`lb-champion-name ${championState === "eliminated" ? "lb-pick-name--eliminated" : ""}`}>
                      {champion?.shortName ?? champion?.name ?? "—"}
                    </span>
                    {champion?.seed !== null && champion?.seed !== undefined ? (
                      <span className="lb-champion-seed">#{champion.seed}</span>
                    ) : null}
                  </span>
                  {championState === "eliminated" ? <span className="lb-champion-elim">✗</span> : null}
                </span>
                <span className={`lb-col lb-col-score ${sortMode === "score" ? "lb-col-score--active" : "lb-col-score--muted"}`}>
                  <span className="lb-score-value">{entry.total_score ?? 0}</span>
                </span>
                <span className="lb-col lb-col-correct">{entry.correct_picks ?? 0}/{entry.possible_picks ?? 63}</span>
                {forecastLoading && !forecastEntry ? (
                  <span className="lb-col lb-col-win">
                    <span className="lb-win-bar">
                      <span className="lb-win-value lb-win-value--muted">...</span>
                    </span>
                  </span>
                ) : (
                  <LeaderboardWinCell forecast={forecastEntry} maxWinProb={maxWinProb} oddsFormat={oddsFormat} />
                )}
                <span className="lb-col lb-col-max">{entry.max_remaining ?? "—"}</span>
                {canAdminDelete ? (
                  <span className="lb-col lb-col-admin">
                    <button
                      type="button"
                      className="lb-admin-delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(entry);
                      }}
                      disabled={isDeleting}
                    >
                      {isDeleting ? "Deleting..." : "Delete"}
                    </button>
                  </span>
                ) : null}
              </div>
              {expanded ? (
                <RowDetail
                  canAdminDelete={canAdminDelete}
                  deletingBracketId={deletingBracketId}
                  entry={entry}
                  forecast={forecastEntry}
                  forecastBins={forecast?.bins ?? []}
                  tournamentState={tournamentState}
                  onDelete={onDelete}
                  oddsFormat={oddsFormat}
                  forecastSimCount={forecast?.simCount ?? 10_000}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LeaderboardFullWidth({
  isVisible = true,
  refreshKey = 0,
  onClose,
  onSubmitBracket,
  submissionsLocked = false,
}: {
  isVisible?: boolean;
  refreshKey?: number;
  onClose?: () => void;
  onSubmitBracket?: () => void;
  submissionsLocked?: boolean;
}) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>(() => getCachedLeaderboard());
  const [tournamentResultMap, setTournamentResultMap] = useState<Record<string, ScoringResult>>(() => getCachedTournamentResultMap());
  const [adminDeleteError, setAdminDeleteError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingBracketId, setDeletingBracketId] = useState<string | null>(null);
  const [loading, setLoading] = useState(entries.length === 0);
  const [forecast, setForecast] = useState<StandingsForecastResult | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastProgress, setForecastProgress] = useState(0);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<LeaderboardSortMode>("odds");
  const [oddsFormat, setOddsFormat] = useState<ForecastOddsFormat>("percent");
  const [tableBodyFading, setTableBodyFading] = useState(false);
  const canAdminDelete = hasElevatedAccess(user?.email) && !submissionsLocked;
  const sortTimersRef = useRef<number[]>([]);

  const loadLeaderboard = useCallback(async () => {
    const cachedEntries = getCachedLeaderboard();
    if (cachedEntries.length > 0) {
      setEntries((current) => (current.length > 0 ? current : cachedEntries));
    }
    setLoading(cachedEntries.length === 0);
    const [{ data, error }, { data: resultsData, error: resultsError }] = await Promise.all([
      getLeaderboard(),
      getTournamentResultMap(),
    ]);
    if (error) {
      captureError("leaderboard_load", error);
      setLoadError((error as { message?: string })?.message ?? "Leaderboard is taking longer than expected.");
    } else {
      setLoadError(null);
    }
    if (resultsError) {
      captureError("leaderboard_results_load", resultsError);
    }
    setEntries(data ?? []);
    setTournamentResultMap(resultsData ?? {});
    setLoading(false);
  }, []);

  const handleAdminDelete = async (entry: LeaderboardEntry) => {
    if (!canAdminDelete) return;
    const confirmed = window.confirm(
      `Delete "${entry.bracket_name}" by ${entry.display_name}?\n\nThis removes it from the leaderboard and from the user's account.`
    );
    if (!confirmed) return;

    setAdminDeleteError(null);
    setDeletingBracketId(entry.bracket_id);
    const { error } = await deleteBracketAsAdmin(entry.bracket_id);
    if (error) {
      setAdminDeleteError((error as { message?: string })?.message ?? "Could not delete that bracket.");
      setDeletingBracketId(null);
      return;
    }

    await loadLeaderboard();
    setDeletingBracketId(null);
  };

  useEffect(() => {
    if (!isVisible) return;
    const timer = window.setTimeout(() => {
      void loadLeaderboard();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isVisible, refreshKey, loadLeaderboard]);

  useEffect(() => {
    return () => {
      sortTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      sortTimersRef.current = [];
    };
  }, []);

  const parsedEntries = useMemo<ParsedLeaderboardEntry[]>(
    () =>
      entries.map((entry) => ({
        ...entry,
        boldestParsed: parseBoldestPick(entry.boldest_pick),
      })),
    [entries]
  );
  const tournamentState = useMemo(() => buildTournamentState(tournamentResultMap), [tournamentResultMap]);

  const tournamentStarted = parsedEntries.some(
    (entry) =>
      Number(entry.total_score ?? 0) > 0 ||
      Number(entry.correct_picks ?? 0) > 0 ||
      Number(entry.r64_score ?? 0) > 0 ||
      Number(entry.r32_score ?? 0) > 0 ||
      Number(entry.s16_score ?? 0) > 0 ||
      Number(entry.e8_score ?? 0) > 0 ||
      Number(entry.f4_score ?? 0) > 0 ||
      Number(entry.champ_score ?? 0) > 0
  );
  const showForecast = submissionsLocked && parsedEntries.some((entry) => entry.picks && entry.bracket_id);
  const showTournamentLeaderboard = submissionsLocked || tournamentStarted;
  const visibleForecast = showForecast ? forecast : null;
  const visibleForecastLoading = showForecast ? forecastLoading : false;
  const visibleForecastProgress = showForecast ? forecastProgress : 0;
  const visibleForecastError = showForecast ? forecastError : null;
  const countLabel = `${parsedEntries.length} ${parsedEntries.length === 1 ? "bracket" : "brackets"} competing`;

  const scoreSortedEntries = useMemo(
    () => [...parsedEntries].sort(compareScoreEntries),
    [parsedEntries],
  );

  const displayedTournamentEntries = useMemo(() => {
    if (sortMode === "score") {
      return scoreSortedEntries;
    }

    return [...parsedEntries].sort((left, right) => {
      const leftProb = visibleForecast?.rows[left.bracket_id]?.finish1Prob ?? -1;
      const rightProb = visibleForecast?.rows[right.bracket_id]?.finish1Prob ?? -1;
      if (rightProb !== leftProb) return rightProb - leftProb;
      return compareScoreEntries(left, right);
    });
  }, [parsedEntries, scoreSortedEntries, sortMode, visibleForecast]);

  const handleSortModeChange = useCallback((nextMode: LeaderboardSortMode) => {
    if (nextMode === sortMode) return;
    sortTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    sortTimersRef.current = [];
    setTableBodyFading(true);

    const swapTimer = window.setTimeout(() => {
      setSortMode(nextMode);
      const revealTimer = window.setTimeout(() => {
        setTableBodyFading(false);
      }, 16);
      sortTimersRef.current = [revealTimer];
    }, SORT_FADE_OUT_MS);

    sortTimersRef.current = [swapTimer];
  }, [sortMode]);

  useEffect(() => {
    if (!isVisible || !showForecast) return;

    const forecastParticipants = parsedEntries
      .filter((entry) => entry.picks && entry.bracket_id)
      .map((entry) => ({
        id: entry.bracket_id,
        picks: entry.picks,
      }));

    if (forecastParticipants.length === 0) return;

    let cancelled = false;

    void (async () => {
      setForecastLoading(true);
      setForecastProgress(0);
      setForecastError(null);
      try {
        const nextForecast = await computeStandingsForecast(forecastParticipants, tournamentResultMap, {
          scopeKey: "leaderboard",
          onProgress: (completedRuns, totalRuns) => {
            if (!cancelled) setForecastProgress(completedRuns / totalRuns);
          },
        });
        if (cancelled) return;
        setForecast(nextForecast);
        setForecastLoading(false);
      } catch (error) {
        if (cancelled) return;
        setForecastError((error as Error).message || "Could not compute leaderboard win odds.");
        setForecastLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isVisible, parsedEntries, showForecast, tournamentResultMap]);

  return (
    <div className="leaderboard-full-wrapper">
      <div className="leaderboard-full">
        <div className="lb-header-row">
          <div className="lb-header-left">
            <h2 className="lb-title">LEADERBOARD</h2>
            <div className="lb-header-meta">
              <span className="lb-count">{countLabel}</span>
              {showTournamentLeaderboard ? (
                <div className="lb-control-cluster">
                  <div className="lb-sort-toggle" role="group" aria-label="Leaderboard sort">
                    <button
                      type="button"
                      className={`lb-sort-toggle-btn ${sortMode === "odds" ? "lb-sort-toggle-btn--active" : ""}`}
                      onClick={() => handleSortModeChange("odds")}
                    >
                      By Odds
                    </button>
                    <button
                      type="button"
                      className={`lb-sort-toggle-btn ${sortMode === "score" ? "lb-sort-toggle-btn--active" : ""}`}
                      onClick={() => handleSortModeChange("score")}
                    >
                      By Score
                    </button>
                  </div>
                  <button
                    type="button"
                    className="lb-format-toggle"
                    onClick={() => setOddsFormat((current) => (current === "percent" ? "american" : "percent"))}
                    aria-label={oddsFormat === "percent" ? "Show American win odds" : "Show implied win percentage"}
                  >
                    {oddsFormat === "percent" ? "US" : "%"}
                  </button>
                </div>
              ) : null}
              <button className="lb-refresh" onClick={loadLeaderboard} title="Refresh leaderboard">
                ↻
              </button>
            </div>
          </div>
          {onClose ? (
            <button className="lb-close" onClick={onClose}>
              ✕ Close
            </button>
          ) : null}
        </div>
        {adminDeleteError ? <div className="lb-admin-error">{adminDeleteError}</div> : null}
        {loadError ? <div className="lb-admin-error">{loadError}</div> : null}

        {NCAA_TOURNAMENT_COMPLETE ? (
          <div className="lb-winner-banner">
            <span className="lb-winner-banner__trophy">🏆</span>
            <div>
              <span className="lb-winner-banner__eyebrow">Final leaderboard</span>
              <strong>LB wins The Bracket Lab.</strong>
              <p>Michigan finished the job. The board is final, and the bragging rights are official.</p>
            </div>
          </div>
        ) : null}

        {submissionsLocked ? (
          <div className="lb-lock-banner">
            {NCAA_TOURNAMENT_COMPLETE
              ? "Tournament complete. Final scores are locked in."
              : "Brackets are locked. Scores update as results come in."}
          </div>
        ) : null}
        {showForecast ? (
          <div className="lb-forecast-banner">
            {visibleForecastLoading ? (
              <span>Simulating 10,000 seeded futures... {Math.round(Math.max(0, Math.min(1, visibleForecastProgress)) * 100)}%</span>
            ) : visibleForecast ? (
              <span>Leaderboard win odds updated from {visibleForecast.simCount.toLocaleString()} seeded simulations.</span>
            ) : visibleForecastError ? (
              <span>{visibleForecastError}</span>
            ) : null}
          </div>
        ) : null}

        {!submissionsLocked ? <LBPrizeHero /> : null}

        {loading ? (
          <div className="lb-loading">Loading leaderboard...</div>
        ) : parsedEntries.length === 0 ? (
          <LBEmptyState submissionsLocked={submissionsLocked} onClose={onClose} onSubmitBracket={onSubmitBracket} />
        ) : showTournamentLeaderboard ? (
          <TournamentLeaderboard
            canAdminDelete={canAdminDelete}
            deletingBracketId={deletingBracketId}
            entries={displayedTournamentEntries}
            currentUserId={user?.id ?? null}
            forecast={visibleForecast}
            forecastLoading={visibleForecastLoading}
            sortMode={sortMode}
            onSortModeChange={handleSortModeChange}
            tableBodyFading={tableBodyFading}
            tournamentState={tournamentState}
            onDelete={handleAdminDelete}
            oddsFormat={oddsFormat}
          />
        ) : (
          <PreTournamentLeaderboard
            canAdminDelete={canAdminDelete}
            deletingBracketId={deletingBracketId}
            entries={scoreSortedEntries}
            currentUserId={user?.id ?? null}
            onDelete={handleAdminDelete}
          />
        )}

        <LBFooter />
      </div>
    </div>
  );
}

export function Leaderboard() {
  return <LeaderboardFullWidth />;
}
