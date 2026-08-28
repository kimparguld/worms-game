import { TURN_DURATION_MS, WIND_MAX } from './constants.js';
import type { Team, TurnEntry, MatchState, Worm } from './types.js';

export function createMatch(teams: Team[]): MatchState {
  const turnOrder: TurnEntry[] = [];
  const maxWorms = Math.max(...teams.map((t) => t.worms.length));
  for (let i = 0; i < maxWorms; i++) {
    for (const team of teams) {
      if (team.worms[i]) turnOrder.push({ playerId: team.playerId, worm: team.worms[i] });
    }
  }
  // -1 means "hasn't acted yet"; the team owning the opening turn is seeded
  // to its actual starting worm index so its next turn resumes from there.
  const teamWormPointer: Record<string, number> = {};
  for (const team of teams) teamWormPointer[team.playerId] = -1;
  if (turnOrder.length > 0) teamWormPointer[turnOrder[0].playerId] = 0;
  return {
    teams,
    turnOrder,
    currentIndex: 0,
    turnTimeRemaining: TURN_DURATION_MS,
    wind: randomWind(),
    teamWormPointer,
  };
}

export function currentWorm(matchState: MatchState): TurnEntry {
  return matchState.turnOrder[matchState.currentIndex];
}

// Finds the next alive, non-dying worm index after `after`, wrapping around.
function nextAliveWormIndex(worms: Worm[], after: number): number {
  const n = worms.length;
  for (let i = 1; i <= n; i++) {
    const idx = (after + i) % n;
    if (worms[idx].alive && !worms[idx].dying) return idx;
  }
  return -1;
}

// Rotates strictly by team (skipping teams with no alive worms left) rather
// than walking the flat turnOrder array, so a dead/missing worm on one team
// never lets another team take two turns in a row.
export function advanceTurn(matchState: MatchState): boolean {
  const { turnOrder, teams, teamWormPointer } = matchState;
  if (turnOrder.length === 0) return false;
  const currentTeamPos = teams.findIndex((t) => t.playerId === turnOrder[matchState.currentIndex].playerId);

  for (let step = 1; step <= teams.length; step++) {
    const team = teams[(currentTeamPos + step) % teams.length];
    const wormIdx = nextAliveWormIndex(team.worms, teamWormPointer[team.playerId] ?? -1);
    if (wormIdx === -1) continue;
    const idx = turnOrder.findIndex((e) => e.worm === team.worms[wormIdx]);
    if (idx === -1) continue;
    teamWormPointer[team.playerId] = wormIdx;
    matchState.currentIndex = idx;
    matchState.turnTimeRemaining = TURN_DURATION_MS;
    matchState.wind = randomWind();
    return true;
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
