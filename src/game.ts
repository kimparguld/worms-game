import { TURN_DURATION_MS, WIND_MAX } from './constants.js';
import type { Team, TurnEntry, MatchState } from './types.js';

export function createMatch(teams: Team[]): MatchState {
  const turnOrder: TurnEntry[] = [];
  const maxWorms = Math.max(...teams.map((t) => t.worms.length));
  for (let i = 0; i < maxWorms; i++) {
    for (const team of teams) {
      if (team.worms[i]) turnOrder.push({ playerId: team.playerId, worm: team.worms[i] });
    }
  }
  return {
    teams,
    turnOrder,
    currentIndex: 0,
    turnTimeRemaining: TURN_DURATION_MS,
    wind: randomWind(),
  };
}

export function currentWorm(matchState: MatchState): TurnEntry {
  return matchState.turnOrder[matchState.currentIndex];
}

export function advanceTurn(matchState: MatchState): boolean {
  const n = matchState.turnOrder.length;
  for (let i = 1; i <= n; i++) {
    const idx = (matchState.currentIndex + i) % n;
    if (matchState.turnOrder[idx].worm.alive && !matchState.turnOrder[idx].worm.dying) {
      matchState.currentIndex = idx;
      matchState.turnTimeRemaining = TURN_DURATION_MS;
      matchState.wind = randomWind();
      return true;
    }
  }
  return false;
}

export function tickTurnTimer(matchState: MatchState, dtMs: number): boolean {
  matchState.turnTimeRemaining -= dtMs;
  if (matchState.turnTimeRemaining <= 0) return advanceTurn(matchState);
  return false;
}

export function checkWinner(teams: Team[]): string | null {
  const teamsAlive = teams.filter((t) => t.worms.some((w) => w.alive));
  if (teamsAlive.length === 1) return teamsAlive[0].playerId;
  if (teamsAlive.length === 0) return 'draw';
  return null;
}

function randomWind(): number {
  return (Math.random() * 2 - 1) * WIND_MAX;
}
