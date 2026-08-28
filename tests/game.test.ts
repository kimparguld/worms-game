import { describe, it, expect } from 'vitest';
import { createMatch, currentWorm, advanceTurn, tickTurnTimer, checkWinner } from '../src/game.js';
import { createWorm } from '../src/worm.js';
import type { Team } from '../src/types.js';

function makeTeams(): Team[] {
  return [
    { playerId: 'p1', name: 'Team 1', worms: [createWorm(0, 0, 'p1', 'A1'), createWorm(0, 0, 'p1', 'A2')] },
    { playerId: 'p2', name: 'Team 2', worms: [createWorm(0, 0, 'p2', 'B1'), createWorm(0, 0, 'p2', 'B2')] },
  ];
}

describe('createMatch', () => {
  it('interleaves turn order across teams', () => {
    const match = createMatch(makeTeams());
    expect(match.turnOrder.map((t) => t.playerId)).toEqual(['p1', 'p2', 'p1', 'p2']);
  });
});

describe('currentWorm', () => {
  it('returns the entry at currentIndex', () => {
    const match = createMatch(makeTeams());
    expect(currentWorm(match)).toBe(match.turnOrder[0]);
  });
});

describe('advanceTurn', () => {
  it('moves to the next worm and resets the timer', () => {
    const match = createMatch(makeTeams());
    match.turnTimeRemaining = 1000;
    advanceTurn(match);
    expect(match.currentIndex).toBe(1);
    expect(match.turnTimeRemaining).toBe(45000);
  });

  it('skips a dead worm in favor of the next alive worm on the other team, not a same-team worm', () => {
    const match = createMatch(makeTeams());
    match.turnOrder[1].worm.alive = false; // p2's B1 is dead
    advanceTurn(match);
    // Must still alternate to team p2 (its surviving worm, B2), not double up on p1.
    expect(match.turnOrder[match.currentIndex].playerId).toBe('p2');
    expect(match.turnOrder[match.currentIndex].worm.name).toBe('B2');
  });

  it('skips a worm that is still playing its death animation, alternating teams rather than repeating one', () => {
    const match = createMatch(makeTeams());
    match.turnOrder[1].worm.dying = true; // p2's B1 is mid-death-animation
    advanceTurn(match);
    expect(match.turnOrder[match.currentIndex].playerId).toBe('p2');
    expect(match.turnOrder[match.currentIndex].worm.name).toBe('B2');
  });

  it('keeps strict team alternation when one team has fewer worms than the other', () => {
    const teams: Team[] = [
      { playerId: 'p1', name: 'Team 1', worms: [createWorm(0, 0, 'p1', 'A1'), createWorm(0, 0, 'p1', 'A2'), createWorm(0, 0, 'p1', 'A3')] },
      { playerId: 'p2', name: 'Team 2', worms: [createWorm(0, 0, 'p2', 'B1')] },
    ];
    const match = createMatch(teams);
    const playerIds = [match.turnOrder[match.currentIndex].playerId];
    for (let i = 0; i < 5; i++) {
      advanceTurn(match);
      playerIds.push(match.turnOrder[match.currentIndex].playerId);
    }
    expect(playerIds).toEqual(['p1', 'p2', 'p1', 'p2', 'p1', 'p2']);
  });
});

describe('tickTurnTimer', () => {
  it('advances the turn automatically when time runs out', () => {
    const match = createMatch(makeTeams());
    tickTurnTimer(match, 46000);
    expect(match.currentIndex).toBe(1);
  });
});

describe('checkWinner', () => {
  it('returns null while more than one team has a living worm', () => {
    expect(checkWinner(makeTeams())).toBeNull();
  });

  it('returns the winning playerId once only one team survives', () => {
    const teams = makeTeams();
    teams[1].worms.forEach((w) => { w.alive = false; });
    expect(checkWinner(teams)).toBe('p1');
  });
});
