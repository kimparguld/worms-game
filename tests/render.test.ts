import { describe, it, expect } from 'vitest';
import {
  turnBannerLabel,
  turnBannerAlpha,
  chargeBarLength,
  chargeBarColor,
  teamHealthFraction,
  weaponLabel,
  weaponAmmoLabel,
  fuseBlinkFrequency,
  projectileBlinkOn,
  deathWiggleRotation,
  deathWiggleScale,
  teamHealthBarX,
  teamHudRowOffset,
  tracerAlpha,
  weaponPickerLayout,
  clampCameraCenter,
  edgeScrollDirection,
  cameraZoomLimits,
  zoomAnchoredCenter,
} from '../src/render.js';
import { createWorm } from '../src/worm.js';
import { CAMERA_ZOOM_BOOST } from '../src/constants.js';

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
  it('names each of the ten selectable weapons', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(weaponLabel)).toEqual([
      'Bazooka',
      'Grenade',
      'Shotgun',
      'Ninja Rope',
      'Dynamite',
      'Sniper Rifle',
      'Airstrike Rocket',
      'Holy Hand Grenade',
      'Mine',
      'Drill',
    ]);
  });

  it('falls back to the default weapon for an out-of-range selection', () => {
    expect(weaponLabel(99)).toBe('Bazooka');
  });
});

describe('weaponAmmoLabel', () => {
  it('shows nothing for a weapon with no per-match limit', () => {
    expect(weaponAmmoLabel(undefined)).toBe('');
  });

  it('shows the remaining count for a limited weapon with uses left', () => {
    expect(weaponAmmoLabel(1)).toBe(' (1 left)');
    expect(weaponAmmoLabel(2)).toBe(' (2 left)');
  });

  it('shows OUT once a limited weapon has no uses left', () => {
    expect(weaponAmmoLabel(0)).toBe(' (OUT)');
  });
});

describe('teamHealthFraction', () => {
  it('is 1 when every worm is at full health', () => {
    const team = { playerId: 'p1', name: 'Team 1', worms: [createWorm(0, 0, 'p1', 'A'), createWorm(0, 0, 'p1', 'B')] };
    expect(teamHealthFraction(team)).toBe(1);
  });

  it('measures against the worms\' own starting health, not the default', () => {
    const team = { playerId: 'p1', name: 'Team 1', worms: [createWorm(0, 0, 'p1', 'A', 50), createWorm(0, 0, 'p1', 'B', 50)] };
    team.worms[0].hp = 0;
    expect(teamHealthFraction(team)).toBe(0.5);
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

  it('puts teams 3 and 4 under teams 1 and 2, in a second row', () => {
    expect(teamHealthBarX(2, 960)).toBe(teamHealthBarX(0, 960));
    expect(teamHealthBarX(3, 960)).toBe(teamHealthBarX(1, 960));
    expect(teamHudRowOffset(0)).toBe(0);
    expect(teamHudRowOffset(1)).toBe(0);
    expect(teamHudRowOffset(2)).toBeGreaterThan(0);
    expect(teamHudRowOffset(3)).toBe(teamHudRowOffset(2));
  });
});

describe('weaponPickerLayout', () => {
  it('gives every weapon slot its own non-overlapping cell inside the panel', () => {
    const layout = weaponPickerLayout(13, 1280, 720);
    expect(layout.cells.map((c) => c.slot)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    for (const cell of layout.cells) {
      expect(cell.x).toBeGreaterThanOrEqual(layout.panelX);
      expect(cell.y).toBeGreaterThanOrEqual(layout.panelY);
      expect(cell.x + layout.cellWidth).toBeLessThanOrEqual(layout.panelX + layout.panelWidth);
      expect(cell.y + layout.cellHeight).toBeLessThanOrEqual(layout.panelY + layout.panelHeight);
    }
    const keys = new Set(layout.cells.map((c) => `${c.x},${c.y}`));
    expect(keys.size).toBe(13);
  });

  it('drops columns to fit a narrow screen', () => {
    const layout = weaponPickerLayout(13, 360, 800);
    expect(layout.panelX).toBeGreaterThanOrEqual(0);
    expect(layout.panelX + layout.panelWidth).toBeLessThanOrEqual(360);
  });
});

describe('clampCameraCenter', () => {
  it('passes a focus point in the middle of the world straight through', () => {
    expect(clampCameraCenter(2000, 1000, 4480)).toBe(2000);
  });

  it('stops the view at the left and right world edges', () => {
    expect(clampCameraCenter(100, 1000, 4480)).toBe(500);
    expect(clampCameraCenter(4400, 1000, 4480)).toBe(3980);
  });

  it('centres on the world when the view is wider than it', () => {
    expect(clampCameraCenter(0, 5000, 4480)).toBe(2240);
  });

  it('can instead sit an oversized view flush with the far end of the world', () => {
    expect(clampCameraCenter(0, 2000, 1260, true)).toBe(1260 - 1000);
  });
});

describe('edgeScrollDirection', () => {
  it('scrolls toward whichever edge the pointer is near, and not at all in between', () => {
    expect(edgeScrollDirection(10, 1280, 40)).toBe(-1);
    expect(edgeScrollDirection(1270, 1280, 40)).toBe(1);
    expect(edgeScrollDirection(640, 1280, 40)).toBe(0);
  });
});

describe('cameraZoomLimits', () => {
  it('zooms out far enough to fit the whole map and no closer in than the default zoom', () => {
    const { min, max } = cameraZoomLimits(1280, 720, 4480, 1260);
    expect(min).toBeCloseTo(1280 / 4480); // whole width on screen
    expect(max).toBeCloseTo((720 / 1260) * CAMERA_ZOOM_BOOST);
  });
});

describe('zoomAnchoredCenter', () => {
  it('keeps the world point under the cursor at the same screen position after zooming', () => {
    const zoom = 0.8;
    const center = zoomAnchoredCenter(1500, 1000, 1280, zoom);
    // screen x -> world x under a camera centred at `center`
    expect(center + (1000 - 640) / zoom).toBeCloseTo(1500);
  });
});
