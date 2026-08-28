import { describe, it, expect } from 'vitest';
import { turnBannerLabel, turnBannerAlpha, chargeBarLength, chargeBarColor, teamHealthFraction } from '../src/render.js';
import { createWorm } from '../src/worm.js';

describe('turnBannerLabel', () => {
  it('formats a playerId like "p2" as "Player 2 turn"', () => {
    expect(turnBannerLabel('p2')).toBe('Player 2 turn');
  });

  it('falls back to the raw playerId when it has no digits', () => {
    expect(turnBannerLabel('draw')).toBe('draw turn');
  });
});

describe('turnBannerAlpha', () => {
  it('is 0 when there is no time remaining', () => {
    expect(turnBannerAlpha(0, 1500)).toBe(0);
  });

  it('is fully opaque in the middle of the banner duration', () => {
    expect(turnBannerAlpha(750, 1500)).toBe(1);
  });

  it('is 0 at the very start, before it has had time to fade in', () => {
    expect(turnBannerAlpha(1500, 1500)).toBeCloseTo(0, 5);
  });

  it('fades out near the end of the banner', () => {
    expect(turnBannerAlpha(10, 1500)).toBeLessThan(0.1);
  });
});

describe('chargeBarLength', () => {
  it('is at its minimum when charge power is 0', () => {
    expect(chargeBarLength(0)).toBe(20);
  });

  it('is at its maximum when charge power is 1', () => {
    expect(chargeBarLength(1)).toBe(90);
  });

  it('grows monotonically with charge power', () => {
    expect(chargeBarLength(0.5)).toBeGreaterThan(chargeBarLength(0.25));
  });
});

describe('chargeBarColor', () => {
  it('is yellow at charge power 0', () => {
    expect(chargeBarColor(0)).toBe(0xffd966);
  });

  it('is red at charge power 1', () => {
    expect(chargeBarColor(1)).toBe(0xe85d5d);
  });
});

describe('teamHealthFraction', () => {
  it('is 1 when every worm is at full health', () => {
    const team = { playerId: 'p1', worms: [createWorm(0, 0, 'p1', 'A'), createWorm(0, 0, 'p1', 'B')] };
    expect(teamHealthFraction(team)).toBe(1);
  });

  it('is the sum of remaining hp over the sum of max hp', () => {
    const team = { playerId: 'p1', worms: [createWorm(0, 0, 'p1', 'A'), createWorm(0, 0, 'p1', 'B')] };
    team.worms[0].hp = 50; // out of 100
    team.worms[1].hp = 100;
    expect(teamHealthFraction(team)).toBe(0.75); // (50 + 100) / (100 + 100)
  });

  it('is 0 for a team with no worms', () => {
    expect(teamHealthFraction({ playerId: 'p1', worms: [] })).toBe(0);
  });
});
