import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext";
import {
  deleteBracketAsAdmin,
  getChaosTierEmoji,
  type LeaderboardBoldestPick,
  type LeaderboardEntry,
  type LeaderboardFinalFourTeam,
  getLeaderboard,
} from "./bracketStorage";
import { hasElevatedAccess } from "./groupVisibility";

type ParsedLeaderboardEntry = LeaderboardEntry & {
  finalFourParsed: LeaderboardFinalFourTeam[];
  boldestParsed: LeaderboardBoldestPick | null;
};

function parseFinalFour(value: unknown): LeaderboardFinalFourTeam[] {
  const raw = typeof value === "string" ? safeJsonParse(value) : value;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = item as Record<string, unknown>;
      const name = typeof row.name === "string" ? row.name : null;
      const seed = typeof row.seed === "number" ? row.seed : typeof row.seed === "string" ? Number(row.seed) : null;
      const logoUrl = typeof row.logoUrl === "string" ? row.logoUrl : null;
      if (!name || !Number.isFinite(seed ?? NaN)) return null;
      return { name, seed: Number(seed), logoUrl };
    })
    .filter((row): row is LeaderboardFinalFourTeam => Boolean(row));
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

function renderChampion(entry: LeaderboardEntry, showElimination: boolean) {
  const champName = entry.champion_name ?? "—";
  const champSeed = entry.champion_seed ?? null;
  return (
    <span className="lb-col lb-col-champion">
      <LeaderboardTeamLogo
        src={entry.champion_logo_url}
        seed={champSeed}
        name={champName}
        className="lb-champion-logo"
        fallbackClassName="lb-champion-logo-fallback"
      />
      {champSeed !== null ? <span className="lb-champion-seed">#{champSeed}</span> : null}
      <span className={`lb-champion-name ${showElimination && entry.champion_eliminated ? "lb-champion-name--eliminated" : ""}`}>
        {champName}
      </span>
      {showElimination && entry.champion_eliminated ? <span className="lb-champion-elim">✗</span> : null}
    </span>
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

function LBEmptyState({ onClose, onSubmitBracket }: { onClose?: () => void; onSubmitBracket?: () => void }) {
  return (
    <div className="lb-empty-state">
      <span className="lb-empty-icon">🏀</span>
      <h3 className="lb-empty-title">No brackets yet</h3>
      <p className="lb-empty-body">Be the first to submit your bracket and compete for the $100 prize.</p>
      <button className="lb-empty-cta" onClick={() => (onSubmitBracket ?? onClose)?.()}>
        Submit my bracket →
      </button>
    </div>
  );
}

function RowDetail({
  canAdminDelete,
  deletingBracketId,
  entry,
  onDelete,
}: {
  canAdminDelete: boolean;
  deletingBracketId: string | null;
  entry: LeaderboardEntry;
  onDelete: (entry: LeaderboardEntry) => void;
}) {
  const isDeleting = deletingBracketId === entry.bracket_id;
  return (
    <div className="lb-row-detail">
      <div className="lb-detail-rounds">
        <div className="lb-detail-round">
          <span className="lb-detail-round-label">R64</span>
          <span className="lb-detail-round-score">{entry.r64_score ?? 0}</span>
        </div>
        <div className="lb-detail-round">
          <span className="lb-detail-round-label">R32</span>
          <span className="lb-detail-round-score">{entry.r32_score ?? 0}</span>
        </div>
        <div className="lb-detail-round">
          <span className="lb-detail-round-label">S16</span>
          <span className="lb-detail-round-score">{entry.s16_score ?? 0}</span>
        </div>
        <div className="lb-detail-round">
          <span className="lb-detail-round-label">E8</span>
          <span className="lb-detail-round-score">{entry.e8_score ?? 0}</span>
        </div>
        <div className="lb-detail-round">
          <span className="lb-detail-round-label">F4</span>
          <span className="lb-detail-round-score">{entry.f4_score ?? 0}</span>
        </div>
        <div className="lb-detail-round">
          <span className="lb-detail-round-label">CHAMP</span>
          <span className="lb-detail-round-score">{entry.champ_score ?? 0}</span>
        </div>
      </div>
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
        <span className="lb-col lb-col-champion">CHAMPION</span>
        <span className="lb-col lb-col-f4">FINAL FOUR</span>
        <span className="lb-col lb-col-chaos">CHAOS</span>
        <span className="lb-col lb-col-boldest">BOLDEST PICK</span>
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
            {renderChampion(entry, false)}
            <span className="lb-col lb-col-f4">
              {entry.finalFourParsed.length > 0 ? (
                <div className="lb-f4-logos">
                  {entry.finalFourParsed.slice(0, 4).map((team, logoIndex) => (
                    <img
                      key={`${entry.bracket_id ?? index}-f4-${logoIndex}`}
                      src={team.logoUrl ?? ""}
                      alt={team.name}
                      className="lb-f4-logo"
                      title={`#${team.seed} ${team.name}`}
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ))}
                </div>
              ) : (
                "—"
              )}
            </span>
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
            <span className="lb-col lb-col-boldest">
              {entry.boldestParsed ? (
                <span className="lb-boldest-text">
                  #{entry.boldestParsed.winner_seed} {entry.boldestParsed.winner_name}
                  <span className="lb-boldest-over"> over </span>#{entry.boldestParsed.loser_seed}{" "}
                  {entry.boldestParsed.loser_name}
                </span>
              ) : (
                "—"
              )}
            </span>
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
  onDelete,
}: {
  canAdminDelete: boolean;
  deletingBracketId: string | null;
  entries: ParsedLeaderboardEntry[];
  currentUserId: string | null;
  onDelete: (entry: LeaderboardEntry) => void;
}) {
  const [expandedBracketId, setExpandedBracketId] = useState<string | null>(null);

  return (
    <div className="lb-table">
      <div className="lb-row lb-row--header lb-row--tournament">
        <span className="lb-col lb-col-rank">#</span>
        <span className="lb-col lb-col-player">PLAYER</span>
        <span className="lb-col lb-col-bracket">BRACKET</span>
        <span className="lb-col lb-col-score">SCORE</span>
        <span className="lb-col lb-col-correct">CORRECT</span>
        <span className="lb-col lb-col-champion">CHAMPION</span>
        <span className="lb-col lb-col-chaos">CHAOS</span>
        <span className="lb-col lb-col-max">MAX</span>
      </div>
      {entries.map((entry, index) => {
        const isMe = currentUserId !== null && entry.user_id === currentUserId;
        const key = entry.bracket_id ?? `${entry.user_id}-${entry.bracket_name}-${index}`;
        const expanded = expandedBracketId === key;
        return (
          <div key={key}>
            <button
              type="button"
              className={`lb-row lb-row--tournament ${isMe ? "lb-row--me" : ""}`}
              onClick={() => setExpandedBracketId(expanded ? null : key)}
            >
              <span className="lb-col lb-col-rank">{entry.rank ?? index + 1}</span>
              <span className="lb-col lb-col-player">
                {entry.display_name}
                {isMe ? <span className="lb-you-badge">YOU</span> : null}
              </span>
              <span className="lb-col lb-col-bracket">{entry.bracket_name}</span>
              <span className="lb-col lb-col-score lb-score-value">{entry.total_score ?? 0}</span>
              <span className="lb-col lb-col-correct">{entry.correct_picks ?? 0}/{entry.possible_picks ?? 63}</span>
              {renderChampion(entry, true)}
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
              <span className="lb-col lb-col-max">{entry.max_remaining ?? "—"}</span>
            </button>
            {expanded ? (
              <RowDetail
                canAdminDelete={canAdminDelete}
                deletingBracketId={deletingBracketId}
                entry={entry}
                onDelete={onDelete}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function LeaderboardFullWidth({
  isVisible = true,
  refreshKey = 0,
  onClose,
  onSubmitBracket,
}: {
  isVisible?: boolean;
  refreshKey?: number;
  onClose?: () => void;
  onSubmitBracket?: () => void;
}) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [adminDeleteError, setAdminDeleteError] = useState<string | null>(null);
  const [deletingBracketId, setDeletingBracketId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const canAdminDelete = hasElevatedAccess(user?.email);

  const loadLeaderboard = async () => {
    setLoading(true);
    const { data } = await getLeaderboard(200);
    setEntries(data ?? []);
    setLoading(false);
  };

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
    void loadLeaderboard();
  }, [isVisible, refreshKey]);

  const parsedEntries = useMemo<ParsedLeaderboardEntry[]>(
    () =>
      [...entries]
        .sort((a, b) => {
          const rankA = a.rank ?? Number.MAX_SAFE_INTEGER;
          const rankB = b.rank ?? Number.MAX_SAFE_INTEGER;
          if (rankA !== rankB) return rankA - rankB;
          return Number(b.total_score ?? 0) - Number(a.total_score ?? 0);
        })
        .map((entry) => ({
          ...entry,
          finalFourParsed: parseFinalFour(entry.final_four),
          boldestParsed: parseBoldestPick(entry.boldest_pick),
        })),
    [entries]
  );

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
  const countLabel = `${parsedEntries.length} ${parsedEntries.length === 1 ? "bracket" : "brackets"} competing`;

  return (
    <div className="leaderboard-full-wrapper">
      <div className="leaderboard-full">
        <div className="lb-header-row">
          <div className="lb-header-left">
            <h2 className="lb-title">LEADERBOARD</h2>
            <span className="lb-count">{countLabel}</span>
            <button className="lb-refresh" onClick={loadLeaderboard} title="Refresh leaderboard">
              ↻
            </button>
          </div>
          {onClose ? (
            <button className="lb-close" onClick={onClose}>
              ✕ Close
            </button>
          ) : null}
        </div>
        {adminDeleteError ? <div className="lb-admin-error">{adminDeleteError}</div> : null}

        <LBPrizeHero />

        {loading ? (
          <div className="lb-loading">Loading leaderboard...</div>
        ) : parsedEntries.length === 0 ? (
          <LBEmptyState onClose={onClose} onSubmitBracket={onSubmitBracket} />
        ) : tournamentStarted ? (
          <TournamentLeaderboard
            canAdminDelete={canAdminDelete}
            deletingBracketId={deletingBracketId}
            entries={parsedEntries}
            currentUserId={user?.id ?? null}
            onDelete={handleAdminDelete}
          />
        ) : (
          <PreTournamentLeaderboard
            canAdminDelete={canAdminDelete}
            deletingBracketId={deletingBracketId}
            entries={parsedEntries}
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
