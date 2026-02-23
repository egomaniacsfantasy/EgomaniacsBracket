# Egomaniacs Bracket Odds

A React + TypeScript prototype for conditioned March Madness bracket odds.

## Run locally

```bash
cd /Users/andrevlahakis/Documents/New\ project/EgomaniacsBracketOdds
npm install
npm run dev
```

Open `http://localhost:5173/bracket`.

## MVP behavior

- Full tournament structure: `R64 -> R32 -> Sweet 16 -> Elite 8 -> Final Four -> Championship`
- Every matchup shows win odds for each team.
- Clicking a team locks that pick and auto-advances winners into future matchups.
- If an earlier pick changes, invalid downstream picks are automatically cleared.
- Right panel futures update after every pick:
  - Odds to win championship
  - Odds to win region
  - Odds to win side (`Left = East/West`, `Right = South/Midwest`)
- Includes:
  - Undo (single-step stack)
  - Reset all
  - Reset by region
  - Chalk bracket quick-fill
  - Odds format toggle (American / implied % / decimal / American+implied)
  - Simulation run slider (`2k`, `5k`, `10k`)

## Odds computation

### Matchup model

Each team has a static rating. For Team A vs Team B:

`p(A beats B) = 1 / (1 + 10^((ratingB - ratingA)/400))`

American odds conversion:

- If `p >= 0.5`: `odds = - (p / (1 - p)) * 100`
- Else: `odds = ((1 - p) / p) * 100`

Implied probability is `p * 100`.

### Conditional futures model

Futures are recomputed by Monte Carlo simulation with forced picks:

1. Simulate entire tournament N times.
2. For each game where user locked a winner, force that winner in every run (when valid for that matchup).
3. Simulate all unlocked games via the matchup probabilities.
4. Aggregate:
   - `P(team wins championship | locked picks)`
   - `P(team wins region | locked picks)`
   - `P(team wins side | locked picks)`

Also computed in panel:

- Simulation-based likelihood of locked picks so far.
- Fast approximation: product of locked game probabilities.

### Performance notes

- Simulation results are cached by hash of `locked picks + simulation run count`.
- Recompute is debounced by `150ms`.
- Futures panel shows `Updating…` while recomputing.

## Data and customization

- Team data: `src/data/teams.ts`
  - Modify names, seeds, ratings, or add logo URLs.
- Bracket structure: `src/data/bracket.ts`
  - Round graph, region mapping, side mapping.
- Simulation: `src/lib/simulation.ts`
- Odds helpers: `src/lib/odds.ts`

To swap in another season, update `src/data/teams.ts` and keep each region seeded `1..16`.
