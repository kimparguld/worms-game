import { describe, it, expect } from 'vitest';
import {
  turnBannerLabel, turnBannerAlpha, chargeBarLength, chargeBarColor, teamHealthFraction, weaponLabel,
  fuseBlinkFrequency, projectileBlinkOn, deathWiggleRotation, deathWiggleScale, teamHealthBarX, tracerAlpha,
} from '../src/render.js';
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

describe('tracerAlpha', () => {
  it('is fully opaque the instant the tracer is created', () => {
    expect(tracerAlpha(0.15, 0.15)).toBe(1);
  });

  it('fades to 0 as the timer runs out', () => {
    expect(tracerAlpha(0, 0.15)).toBe(0);
  });

  it('is clamped to 0 once the timer has gone negative', () => {
    expect(tracerAlpha(-0.05, 0.15)).toBe(0);
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

describe('weaponLabel', () => {
  it('names each of the five selectable weapons', () => {
    expect([1, 2, 3, 4, 5].map(weaponLabel)).toEqual([
      'Bazooka', 'Grenade', 'Shotgun', 'Ninja Rope', 'Dynamite',
    ]);
  });

  it('falls back to the default weapon for an out-of-range selection', () => {
    expect(weaponLabel(9)).toBe('Bazooka');
  });
});

describe('teamHealthFraction', () => {
  it('is 1 when every worm is at full health', () => {
    const team = { playerId: 'p1', name: 'Team 1', worms: [createWorm(0, 0, 'p1', 'A'), createWorm(0, 0, 'p1', 'B')] };
    expect(teamHealthFraction(team)).toBe(1);
  });

  it('is the sum of remaining hp over the sum of max hp', () => {
    const team = { playerId: 'p1', name: 'Team 1', worms: [createWorm(0, 0, 'p1', 'A'), createWorm(0, 0, 'p1', 'B')] };
    team.worms[0].hp = 50; // out of 100
    team.worms[1].hp = 100;
    expect(teamHealthFraction(team)).toBe(0.75); // (50 + 100) / (100 + 100)
  });

  it('is 0 for a team with no worms', () => {
    expect(teamHealthFraction({ playerId: 'p1', name: 'Team 1', worms: [] })).toBe(0);
  });
});

describe('fuseBlinkFrequency', () => {
  it('starts at the slow blink rate when the fuse just began', () => {
    expect(fuseBlinkFrequency(3, 3)).toBeCloseTo(1.5, 5);
  });

  it('reaches the fast blink rate right before detonation', () => {
    expect(fuseBlinkFrequency(0, 3)).toBeCloseTo(9, 5);
  });

  it('increases monotonically as the fuse burns down', () => {
    expect(fuseBlinkFrequency(1, 3)).toBeGreaterThan(fuseBlinkFrequency(2, 3));
  });
});

describe('projectileBlinkOn', () => {
  it('toggles more times in the final second than the first second of a long fuse', () => {
    const fuseTime = 5;
    const dt = 0.01;

    let earlyToggles = 0;
    let prev = projectileBlinkOn(fuseTime, fuseTime);
    for (let t = dt; t <= 1; t += dt) {
      const on = projectileBlinkOn(fuseTime - t, fuseTime);
      if (on !== prev) earlyToggles++;
      prev = on;
    }

    let lateToggles = 0;
    prev = projectileBlinkOn(1, fuseTime);
    for (let t = 4; t <= 5; t += dt) {
      const on = projectileBlinkOn(fuseTime - t, fuseTime);
      if (on !== prev) lateToggles++;
      prev = on;
    }

    expect(lateToggles).toBeGreaterThan(earlyToggles);
  });
});

describe('deathWiggleRotation', () => {
  it('has no rotation at the very start of the animation', () => {
    expect(deathWiggleRotation(0, 900)).toBe(0);
  });

  it('swings wider later in the animation than earlier (the envelope grows with elapsed time)', () => {
    // Both points land on a peak of the wiggle's oscillation (sin term = 1),
    // isolating the growing envelope from the oscillation itself.
    const early = deathWiggleRotation(75, 900); // fraction 1/12
    const late = deathWiggleRotation(675, 900); // fraction 3/4
    expect(late).toBeGreaterThan(early);
  });
});

describe('deathWiggleScale', () => {
  it('starts at the neutral scale', () => {
    expect(deathWiggleScale(0, 900)).toBe(1);
  });

  it('stays within a small bounce range around the neutral scale', () => {
    for (let ms = 0; ms <= 900; ms += 50) {
      const scale = deathWiggleScale(ms, 900);
      expect(scale).toBeGreaterThanOrEqual(0.84);
      expect(scale).toBeLessThanOrEqual(1.16);
    }
  });
});

describe('teamHealthBarX', () => {
  it('left-aligns the first team', () => {
    expect(teamHealthBarX(0, 960)).toBe(16);
  });

  it('right-aligns the second team', () => {
    expect(teamHealthBarX(1, 960)).toBe(960 - 16 - 220);
  });
});
