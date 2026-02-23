import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./index.css";
import { teamsById } from "./data/teams";
import { regionRounds } from "./data/bracket";
import { finalRounds, gamesByRegionAndRound, resetRegionPicks, resolveGames, sanitizeLockedPicks, type LockedPicks } from "./lib/bracket";
import { toImpliedLabel, toOneInX } from "./lib/odds";
import { generateSimulatedBracket, hashLocks, runSimulation } from "./lib/simulation";
import { fallbackLogo, teamLogoUrl } from "./lib/logo";
import type { OddsDisplayMode, Region, ResolvedGame, SimulationOutput } from "./types";

const DEFAULT_SIM_RUNS = 5000;

const formatModes: { id: OddsDisplayMode; label: string }[] = [
  { id: "dual", label: "American + Implied" },
  { id: "american", label: "American" },
  { id: "implied", label: "Implied %" },
  { id: "decimal", label: "Decimal" },
];

const simRunOptions = [2000, 5000, 10000];
const regionSections: Region[][] = [
  ["South", "East"],
  ["West", "Midwest"],
];
const invertedRegions = new Set<Region>(["East", "Midwest"]);

const gameRoundLabel: Record<string, string> = {
  R64: "Round of 64",
  R32: "Round of 32",
  S16: "Sweet 16",
  E8: "Elite 8",
  F4: "Final Four",
  CHAMP: "Championship",
};

function App() {
  const [lockedPicks, setLockedPicks] = useState<LockedPicks>({});
  const [undoStack, setUndoStack] = useState<LockedPicks[]>([]);
  const [displayMode, setDisplayMode] = useState<OddsDisplayMode>("dual");
  const [simRuns, setSimRuns] = useState<number>(DEFAULT_SIM_RUNS);
  const [sortDesc, setSortDesc] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastPickedKey, setLastPickedKey] = useState<string | null>(null);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [simResult, setSimResult] = useState<SimulationOutput>({
    futures: [],
    gameWinProbs: {},
    likelihoodApprox: 0,
    likelihoodSimulation: 0,
  });

  const simulationCacheRef = useRef<Map<string, SimulationOutput>>(new Map());

  const { games, sanitized } = useMemo(() => resolveGames(lockedPicks), [lockedPicks]);

  useEffect(() => {
    const key = hashLocks(sanitized, simRuns);
    const existing = simulationCacheRef.current.get(key);
    let active = true;

    if (existing) {
      setSimResult(existing);
      setIsUpdating(false);
      return undefined;
    }

    const updateTimer = window.setTimeout(() => {
      if (!active) return;
      setIsUpdating(true);
    }, 20);

    const timer = window.setTimeout(() => {
      if (!active) return;
      const result = runSimulation(sanitized, simRuns);
      simulationCacheRef.current.set(key, result);
      setSimResult(result);
      setIsUpdating(false);
    }, 150);

    return () => {
      active = false;
      window.clearTimeout(updateTimer);
      window.clearTimeout(timer);
    };
  }, [sanitized, simRuns]);

  const sortedFutures = useMemo(() => {
    const rows = [...simResult.futures];
    rows.sort((a, b) => {
      const diff = b.champProb - a.champProb;
      return sortDesc ? diff : -diff;
    });
    return rows;
  }, [simResult.futures, sortDesc]);

  const pushUndo = (current: LockedPicks) => {
    setUndoStack((prev) => [...prev, current]);
  };

  const onPick = (game: ResolvedGame, teamId: string | null) => {
    if (!teamId) return;
    if (teamId !== game.teamAId && teamId !== game.teamBId) return;
    pushUndo(lockedPicks);

    const next: LockedPicks = { ...lockedPicks };
    if (lockedPicks[game.id] === teamId) {
      delete next[game.id];
    } else {
      next[game.id] = teamId;
    }
    setLastPickedKey(`${game.id}:${teamId}`);

    setLockedPicks(sanitizeLockedPicks(next));
  };

  const onUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setLockedPicks(previous);
  };

  const onResetAll = () => {
    if (Object.keys(lockedPicks).length === 0) return;
    pushUndo(lockedPicks);
    setLockedPicks({});
  };

  const onResetRegion = (region: Region) => {
    pushUndo(lockedPicks);
    setLockedPicks(resetRegionPicks(lockedPicks, region));
  };

  const onModelSim = () => {
    pushUndo(lockedPicks);
    setLockedPicks(sanitizeLockedPicks(generateSimulatedBracket(lockedPicks)));
  };

  const finalGames = finalRounds(games);
  const leftSemi = finalGames.find((g) => g.id === "F4-Left-0") ?? null;
  const rightSemi = finalGames.find((g) => g.id === "F4-Right-0") ?? null;
  const titleGame = finalGames.find((g) => g.id === "CHAMP-0") ?? null;

  return (
    <div className="eg-shell">
      <div className="bg-shape bg-top" aria-hidden="true" />
      <div className="bg-shape bg-bottom" aria-hidden="true" />

      <main className="eg-app">
        <header className="eg-header">
          <p className="eg-kicker">Egomaniacs Bracket Odds</p>
          <h1>What Are the Odds?</h1>
          <p className="eg-subtitle">
            March Madness what-if odds. Click picks to condition futures in real time.
          </p>
        </header>

        <section className={`eg-layout ${sidePanelOpen ? "panel-open" : "panel-collapsed"}`}>
          <div className="eg-main-panel">
            <div className="eg-main-actions">
              <button onClick={onUndo} disabled={undoStack.length === 0} className="eg-btn">
                Undo
              </button>
              <button onClick={onResetAll} className="eg-btn">
                Reset All
              </button>
              <button onClick={onModelSim} className="eg-btn">
                Model Sim Bracket
              </button>
              <div className="eg-mode-toggle">
                {formatModes.map((mode) => (
                  <button
                    key={mode.id}
                    className={`eg-chip ${displayMode === mode.id ? "active" : ""}`}
                    onClick={() => setDisplayMode(mode.id)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="eg-bracket-stack">
              <section className="eg-bracket-section">
                <div className="eg-section-head">
                  <h2>Top Half Bracket</h2>
                  <p>South + East</p>
                </div>
                <div className="eg-region-scroll">
                  <div className="eg-region-grid bracket-style">
                    {regionSections[0].map((region) => (
                      <RegionBracket
                        key={region}
                        region={region}
                        games={games}
                        gameWinProbs={simResult.gameWinProbs}
                        onPick={onPick}
                        lastPickedKey={lastPickedKey}
                        onResetRegion={onResetRegion}
                        inverted={invertedRegions.has(region)}
                      />
                    ))}
                  </div>
                </div>
              </section>

              <section className="eg-finals-card bracket-finals">
                <h2>Final Four and Title</h2>
                <div className="eg-finals-stage">
                  <div className="eg-semi-col left">
                    <p className="eg-finals-label">Semifinal</p>
                    {leftSemi ? (
                      <GameCard
                        key={leftSemi.id}
                        game={leftSemi}
                        gameWinProbs={simResult.gameWinProbs}
                        onPick={onPick}
                        lastPickedKey={lastPickedKey}
                      />
                    ) : null}
                  </div>

                  <div className="eg-title-col">
                    <p className="eg-finals-label title">National Championship</p>
                    {titleGame ? (
                      <div className="eg-title-hero">
                        <GameCard
                          key={titleGame.id}
                          game={titleGame}
                          gameWinProbs={simResult.gameWinProbs}
                          onPick={onPick}
                          lastPickedKey={lastPickedKey}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="eg-semi-col right">
                    <p className="eg-finals-label">Semifinal</p>
                    {rightSemi ? (
                      <GameCard
                        key={rightSemi.id}
                        game={rightSemi}
                        gameWinProbs={simResult.gameWinProbs}
                        onPick={onPick}
                        lastPickedKey={lastPickedKey}
                      />
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="eg-bracket-section">
                <div className="eg-section-head">
                  <h2>Bottom Half Bracket</h2>
                  <p>West + Midwest</p>
                </div>
                <div className="eg-region-scroll">
                  <div className="eg-region-grid bracket-style">
                    {regionSections[1].map((region) => (
                      <RegionBracket
                        key={region}
                        region={region}
                        games={games}
                        gameWinProbs={simResult.gameWinProbs}
                        onPick={onPick}
                        lastPickedKey={lastPickedKey}
                        onResetRegion={onResetRegion}
                        inverted={invertedRegions.has(region)}
                      />
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>

          <aside className={`eg-side-panel ${sidePanelOpen ? "open" : "collapsed"}`}>
            <button
              type="button"
              className="eg-side-toggle"
              onClick={() => setSidePanelOpen((v) => !v)}
              aria-expanded={sidePanelOpen}
            >
              {sidePanelOpen ? "Collapse ▸" : "Futures ▾"}
            </button>

            <section className="eg-panel-block">
              <div className="eg-panel-head">
                <h3>
                  Futures
                  <span
                    className="eg-info"
                    title="Futures are recalculated via simulation given your locked picks."
                  >
                    i
                  </span>
                </h3>
                <button className="eg-mini-btn" onClick={() => setSortDesc((v) => !v)}>
                  Sort {sortDesc ? "↓" : "↑"}
                </button>
              </div>

              {isUpdating ? <p className="eg-updating">Updating…</p> : null}
              <div className="eg-table-wrap">
                <table className="eg-table">
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>R32</th>
                      <th>S16</th>
                      <th>E8</th>
                      <th>F4</th>
                      <th>Title</th>
                      <th>Champ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFutures.map((row) => {
                      const team = teamsById.get(row.teamId);
                      if (!team) return null;
                      return (
                        <tr key={row.teamId}>
                          <td>
                            <div className="team-cell">
                              <TeamLogo teamName={team.name} src={teamLogoUrl(team)} />
                              <span className="seed">{team.seed}</span>
                              <span>{team.name}</span>
                            </div>
                          </td>
                          <OddsCell prob={row.round2Prob} />
                          <OddsCell prob={row.sweet16Prob} />
                          <OddsCell prob={row.elite8Prob} />
                          <OddsCell prob={row.final4Prob} />
                          <OddsCell prob={row.titleGameProb} />
                          <OddsCell prob={row.champProb} />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="eg-panel-block">
              <h3>Your Bracket</h3>
              <p className="eg-metric-label">Likelihood of your picks so far (simulation-based)</p>
              <p className="eg-metric-value">{toImpliedLabel(simResult.likelihoodSimulation)}</p>
              <p className="eg-metric-sub">{toOneInX(simResult.likelihoodSimulation)}</p>

              <p className="eg-metric-label">Fast approximation (product of locked game win probs)</p>
              <p className="eg-metric-value">{toImpliedLabel(simResult.likelihoodApprox)}</p>
              <p className="eg-metric-sub">{toOneInX(simResult.likelihoodApprox)}</p>
            </section>

            <section className="eg-panel-block">
              <h3>Settings</h3>
              <label className="eg-setting-label" htmlFor="sim-runs">
                Simulation runs
              </label>
              <input
                id="sim-runs"
                type="range"
                min={0}
                max={2}
                step={1}
                value={simRunOptions.indexOf(simRuns)}
                onChange={(e) => setSimRuns(simRunOptions[Number(e.target.value)])}
              />
              <p className="eg-setting-value">{simRuns.toLocaleString()} runs</p>

              <p className="eg-setting-label">Side definition</p>
              <p className="eg-setting-value">Left side: East/West, Right side: South/Midwest</p>

              <p className="eg-setting-label">Current lock count</p>
              <p className="eg-setting-value">{Object.keys(sanitized).length} picks</p>
            </section>
          </aside>
        </section>
      </main>
    </div>
  );
}

function OddsCell({ prob }: { prob: number }) {
  return (
    <td>
      <p className="odds-primary">{toImpliedLabel(prob)}</p>
    </td>
  );
}

function RegionBracket({
  region,
  games,
  gameWinProbs,
  onPick,
  lastPickedKey,
  onResetRegion,
  inverted,
}: {
  region: Region;
  games: ResolvedGame[];
  gameWinProbs: SimulationOutput["gameWinProbs"];
  onPick: (game: ResolvedGame, teamId: string | null) => void;
  lastPickedKey: string | null;
  onResetRegion: (region: Region) => void;
  inverted: boolean;
}) {
  const rounds = inverted ? [...regionRounds].reverse() : [...regionRounds];

  return (
    <section className={`eg-region-card bracket-region ${inverted ? "region-inverted" : ""}`}>
      <div className="eg-region-head">
        <h2>{region}</h2>
        <button className="eg-mini-btn" onClick={() => onResetRegion(region)}>
          Reset Region
        </button>
      </div>

      <div className="eg-round-grid bracket-grid">
        {rounds.map((round) => {
          const roundGames = gamesByRegionAndRound(games, region, round);
          const rowCounts = roundGames.map((g) => Math.max(2, (gameWinProbs[g.id] || []).length));
          const totalRows = rowCounts.reduce((sum, n) => sum + n, 0);
          const laneHeight = Math.max(260, totalRows * 22 + Math.max(0, roundGames.length - 1) * 18 + 18);
          const laneVars = {
            "--lane-height": `${laneHeight}px`,
          } as CSSProperties;
          return (
            <div key={`${region}-${round}`} className={`eg-round-col lane-${round.toLowerCase()}`}>
              <p className="eg-round-label">{gameRoundLabel[round]}</p>
              <div className="eg-games-lane" style={laneVars}>
                {roundGames.map((game) => {
                  const rows = Math.max(2, (gameWinProbs[game.id] || []).length);
                  const slotVars = {
                    "--rows": rows,
                  } as CSSProperties;
                  return (
                    <div key={game.id} className="eg-game-node" style={slotVars}>
                      <GameCard
                        game={game}
                        gameWinProbs={gameWinProbs}
                        onPick={onPick}
                        lastPickedKey={lastPickedKey}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function GameCard({
  game,
  gameWinProbs,
  onPick,
  lastPickedKey,
}: {
  game: ResolvedGame;
  gameWinProbs: SimulationOutput["gameWinProbs"];
  onPick: (game: ResolvedGame, teamId: string | null) => void;
  lastPickedKey: string | null;
}) {
  const candidates = (gameWinProbs[game.id] || [])
    .map((entry) => ({ ...entry, team: teamsById.get(entry.teamId) }))
    .filter((entry) => Boolean(entry.team));
  const rows = candidates.length > 0 ? candidates : [];

  return (
    <article className={`eg-game-card round-${game.round.toLowerCase()}`}>
      <div className="eg-game-list">
        {rows.length > 0 ? (
          rows.map((candidate) => {
            const team = candidate.team!;
            const canPick =
              game.teamAId !== null &&
              game.teamBId !== null &&
              (team.id === game.teamAId || team.id === game.teamBId);
            return (
              <TeamRow
                key={`${game.id}-${team.id}`}
                label={team.name}
                seed={team.seed}
                teamName={team.name}
                logoSrc={teamLogoUrl(team)}
                prob={candidate.prob}
              selected={game.winnerId === team.id}
              freshPick={Boolean(lastPickedKey === `${game.id}:${team.id}`)}
              disabled={!canPick}
              tooltip={`Chance to advance from this game: ${(candidate.prob * 100).toFixed(1)}%`}
              compact={game.round !== "R64"}
              onPick={() => onPick(game, canPick ? team.id : null)}
            />
          );
          })
        ) : (
          <>
            <TeamRow
              label="TBD"
              seed={null}
              teamName={null}
              logoSrc={null}
              prob={null}
              selected={false}
              freshPick={false}
              disabled
              tooltip="Waiting for simulation..."
              compact={game.round !== "R64"}
              onPick={() => {}}
            />
            <TeamRow
              label="TBD"
              seed={null}
              teamName={null}
              logoSrc={null}
              prob={null}
              selected={false}
              freshPick={false}
              disabled
              tooltip="Waiting for simulation..."
              compact={game.round !== "R64"}
              onPick={() => {}}
            />
          </>
        )}
      </div>
    </article>
  );
}

function TeamRow({
  label,
  seed,
  teamName,
  logoSrc,
  prob,
  selected,
  freshPick,
  disabled,
  tooltip,
  compact,
  onPick,
}: {
  label: string;
  seed: number | null;
  teamName: string | null;
  logoSrc: string | null;
  prob: number | null;
  selected: boolean;
  freshPick: boolean;
  disabled: boolean;
  tooltip: string;
  compact: boolean;
  onPick: () => void;
}) {
  const percent = prob !== null ? `${(prob * 100).toFixed(1)}%` : "--";
  const isLongName = label.length >= 18;

  return (
    <button
      type="button"
      className={`eg-team-row ${compact ? "compact" : ""} ${selected ? "selected" : ""} ${freshPick ? "fresh-pick" : ""}`}
      disabled={disabled}
      onClick={onPick}
      title={tooltip}
    >
      <span className="team-seed" aria-label={seed !== null ? `Seed ${seed}` : "Seed unavailable"}>
        {seed !== null ? seed : "--"}
      </span>
      {teamName && logoSrc ? (
        <TeamLogo teamName={teamName} src={logoSrc} />
      ) : (
        <span className="team-logo team-logo-placeholder" aria-hidden="true" />
      )}
      {compact ? null : <span className={`team-name ${isLongName ? "long-name" : ""}`}>{label}</span>}
      <span className="team-odds-wrap">
        <span className="team-odds">{percent}</span>
      </span>
    </button>
  );
}

function TeamLogo({ teamName, src }: { teamName: string; src: string }) {
  const [failed, setFailed] = useState(false);
  const fallback = fallbackLogo(teamName);

  return (
    <img
      className="team-logo"
      src={failed ? fallback : src}
      alt={`${teamName} logo`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default App;
