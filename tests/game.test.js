import { describe, it, expect } from 'vitest';
import { createMatch, currentWorm, advanceTurn, tickTurnTimer, checkWinner } from '../src/game.js';
import { createWorm } from '../src/worm.js';

function makeTeams() {
  return [
    { playerId: 'p1', worms: [createWorm(0, 0, 'p1', 'A1'), createWorm(0, 0, 'p1', 'A2')] },
    { playerId: 'p2', worms: [createWorm(0, 0, 'p2', 'B1'), createWorm(0, 0, 'p2', 'B2')] },
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

  it('skips dead worms', () => {
    const match = createMatch(makeTeams());
    match.turnOrder[1].worm.alive = false;
    advanceTurn(match);
    expect(match.currentIndex).toBe(2);
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
