import { describe, it, expect } from 'vitest';
import { createMatchRuntime, stepMatch } from '../src/matchLoop.js';
import { createTerrain } from '../src/terrain.js';
import { createWorm } from '../src/worm.js';
import { createMatch } from '../src/game.js';
import type { InputState, Team, MatchRuntime } from '../src/types.js';
import { STARTING_HP, TURN_BANNER_DURATION_MS } from '../src/constants.js';

function makeInput(overrides: Partial<InputState> = {}): InputState {
  return {
    left: false, right: false, aimUp: false, aimDown: false,
    jump: false, firing: false, endTurnRequested: false, selectedWeapon: 1,
    ...overrides,
  };
}

function makeRuntime(teams: Team[]): MatchRuntime {
  const terrain = createTerrain(200, 200);
  terrain.mask.fill(0);
  for (let x = 0; x < 200; x++) {
    for (let y = 150; y < 200; y++) terrain.mask[y * 200 + x] = 1;
  }
  return {
    terrain,
    teams,
    match: createMatch(teams),
    projectiles: [],
    rope: null,
    charging: false,
    chargePower: 0,
    retirementTimer: null,
    turnBannerTimer: null,
    gravestones: [],
  };
}

function twoWormTeams(): Team[] {
  return [
    { playerId: 'p1', name: 'Team 1', worms: [createWorm(50, 149, 'p1', 'A')] },
    { playerId: 'p2', name: 'Team 2', worms: [createWorm(150, 149, 'p2', 'B')] },
  ];
}

function fourWormTeams(): Team[] {
  return [
    { playerId: 'p1', name: 'Team 1', worms: [createWorm(50, 149, 'p1', 'A'), createWorm(70, 149, 'p1', 'B')] },
    { playerId: 'p2', name: 'Team 2', worms: [createWorm(150, 149, 'p2', 'C'), createWorm(170, 149, 'p2', 'D')] },
  ];
}

describe('createMatchRuntime', () => {
  it('builds two teams of two worms each on fresh terrain with empty runtime state', () => {
    const rt = createMatchRuntime(960, 540);
    expect(rt.teams).toHaveLength(2);
    expect(rt.teams[0].worms).toHaveLength(2);
    expect(rt.teams[1].worms).toHaveLength(2);
    expect(rt.projectiles).toEqual([]);
    expect(rt.rope).toBeNull();
    expect(rt.charging).toBe(false);
    expect(rt.chargePower).toBe(0);
    expect(rt.retirementTimer).toBeNull();
    expect(rt.turnBannerTimer).toBe(TURN_BANNER_DURATION_MS);
    expect(rt.gravestones).toEqual([]);
  });

  it('defaults team names to "Team 1" and "Team 2" when none are given', () => {
    const rt = createMatchRuntime(960, 540);
    expect(rt.teams[0].name).toBe('Team 1');
    expect(rt.teams[1].name).toBe('Team 2');
  });

  it('uses the given team names when provided', () => {
    const rt = createMatchRuntime(960, 540, 'Sharks', 'Jets');
    expect(rt.teams[0].name).toBe('Sharks');
    expect(rt.teams[1].name).toBe('Jets');
  });
});

describe('stepMatch charge/fire state machine', () => {
  it('charges a chargeable weapon while firing is held, then fires once on release', () => {
    const rt = makeRuntime(twoWormTeams());
    const input = makeInput({ firing: true, selectedWeapon: 1 }); // bazooka, chargeable

    stepMatch(rt, input, 0.2);
    expect(rt.charging).toBe(true);
    expect(rt.projectiles).toHaveLength(0);

    input.firing = false;
    stepMatch(rt, input, 0.016);
    expect(rt.charging).toBe(false);
    expect(rt.projectiles).toHaveLength(1);
    expect(rt.projectiles[0].weaponKey).toBe('bazooka');
  });

  it('fires a non-chargeable weapon immediately without needing release', () => {
    const rt = makeRuntime(twoWormTeams());
    const input = makeInput({ firing: true, selectedWeapon: 5 }); // dynamite, not chargeable

    stepMatch(rt, input, 0.016);

    expect(rt.projectiles).toHaveLength(1);
    expect(rt.projectiles[0].weaponKey).toBe('dynamite');
    expect(input.firing).toBe(false);
  });
});

describe('stepMatch dead-worm guard', () => {
  it('does not let a dead active worm aim, fire, or swing on the rope', () => {
    const teams = twoWormTeams();
    const worm = teams[0].worms[0];
    worm.alive = false;
    const originalAngle = worm.aimAngle;
    const originalX = worm.x;
    const originalY = worm.y;
    const rt = makeRuntime(teams);
    rt.rope = { attached: true, anchorX: 60, anchorY: 100, length: 50 };
    // selectedWeapon 5 (dynamite) is NOT chargeable, so firing:true would
    // create a projectile immediately if the dead-worm guard were missing.
    const input = makeInput({ firing: true, aimUp: true, selectedWeapon: 5 });

    stepMatch(rt, input, 0.5);

    expect(worm.aimAngle).toBe(originalAngle);
    // If the guard didn't also cover rope-swing, updateRopeSwing would have
    // moved this worm noticeably toward the (60, 100) anchor.
    expect(worm.x).toBe(originalX);
    expect(worm.y).toBe(originalY);
    expect(rt.projectiles).toHaveLength(0);
    expect(rt.charging).toBe(false);
    expect(rt.rope).not.toBeNull();
  });
});

describe('stepMatch retirement timer', () => {
  it('waits for all projectiles to settle before advancing the turn', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.retirementTimer = 0.01;
    rt.projectiles = [{ weaponKey: 'bazooka', x: 10, y: 10, vx: 0, vy: 0, fuseRemaining: null, alive: true }];
    const input = makeInput();
    const beforeIndex = rt.match.currentIndex;

    stepMatch(rt, input, 0.02);

    expect(rt.match.currentIndex).toBe(beforeIndex);
    expect(rt.retirementTimer).not.toBeNull();
  });
});

describe('stepMatch turn-timer / retirement interaction', () => {
  it('clears a stale retirement timer and charge state when the turn advances from the timer expiring', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.match.turnTimeRemaining = 5;
    rt.retirementTimer = 999; // stale, left over from a previous, already-resolved shot
    rt.charging = true;
    rt.chargePower = 0.5;
    const input = makeInput({ firing: true });

    stepMatch(rt, input, 0.01); // 10ms tick expires the 5ms-remaining turn timer

    expect(rt.match.currentIndex).not.toBe(0);
    expect(rt.retirementTimer).toBeNull();
    expect(rt.charging).toBe(false);
    expect(rt.chargePower).toBe(0);
  });

  it('clears a stale retirement timer and charge state when the turn advances via a voluntary end-turn', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.retirementTimer = 999;
    rt.charging = true;
    rt.chargePower = 0.5;
    const input = makeInput({ endTurnRequested: true, firing: true });

    stepMatch(rt, input, 0.016);

    expect(rt.match.currentIndex).toBe(1);
    expect(rt.retirementTimer).toBeNull();
    expect(rt.charging).toBe(false);
    expect(input.endTurnRequested).toBe(false);
  });
});

describe('stepMatch charge state does not leak across a retirement-driven turn advance', () => {
  it('does not let the next worm inherit charge state from the retirement timer ending the previous turn', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.retirementTimer = 0.01;
    const input = makeInput({ firing: true, selectedWeapon: 1 }); // bazooka, chargeable

    stepMatch(rt, input, 0.02); // retirement timer expires this frame, turn advances to worm B

    expect(rt.match.currentIndex).toBe(1);
    expect(rt.charging).toBe(false);
    expect(rt.chargePower).toBe(0);

    input.firing = false;
    stepMatch(rt, input, 0.016); // worm B releases fire - must NOT launch a shot it never charged

    expect(rt.projectiles).toHaveLength(0);
  });
});

describe('stepMatch clears the rope when the turn advances', () => {
  it("does not let the incoming worm's rope-swing run from the previous worm's stale rope", () => {
    const rt = makeRuntime(twoWormTeams());
    rt.rope = { attached: true, anchorX: 60, anchorY: 100, length: 50 };
    const input = makeInput({ endTurnRequested: true });

    stepMatch(rt, input, 0.016); // turn advances to worm B this frame

    expect(rt.match.currentIndex).toBe(1);
    expect(rt.rope).toBeNull();

    const wormB = rt.teams[1].worms[0];
    const beforeX = wormB.x;
    const beforeY = wormB.y;

    stepMatch(rt, makeInput(), 0.016); // worm B's first real frame - must not swing on a stale rope

    expect(Math.hypot(wormB.x - beforeX, wormB.y - beforeY)).toBeLessThan(5);
  });
});

describe('stepMatch does not double-advance when the turn timer and a voluntary end-turn coincide', () => {
  it('advances the turn exactly once, not twice, in the same frame', () => {
    const rt = makeRuntime(fourWormTeams());
    rt.match.turnTimeRemaining = 5;
    const input = makeInput({ endTurnRequested: true });

    stepMatch(rt, input, 0.01); // 10ms tick expires the 5ms-remaining turn timer, and endTurnRequested is also set

    expect(rt.match.currentIndex).toBe(1); // exactly one worm's turn skipped, not two
  });
});

describe('stepMatch shotgun does not damage its own shooter', () => {
  it('excludes the active worm from its own shotgun blast', () => {
    const rt = makeRuntime(twoWormTeams());
    const shooter = rt.match.turnOrder[0].worm;
    shooter.aimAngle = -Math.PI / 2; // aimed straight up, into empty sky - nothing else to hit
    const input = makeInput({ firing: true, selectedWeapon: 3 });

    stepMatch(rt, input, 0.016);

    expect(shooter.hp).toBe(STARTING_HP);
  });
});

describe('stepMatch rope handling', () => {
  it('detaches the rope when jump is pressed while swinging', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.rope = { attached: true, anchorX: 60, anchorY: 100, length: 50 };
    const input = makeInput({ jump: true });

    stepMatch(rt, input, 0.016);

    expect(rt.rope).toBeNull();
  });
});

describe('stepMatch ninja rope hop', () => {
  it('gives the firing worm a small upward velocity nudge when the rope attaches', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.match.turnOrder[0].worm;
    worm.aimAngle = Math.PI / 2; // straight down, into the flat ground just below
    const input = makeInput({ firing: true, selectedWeapon: 4 }); // ninja rope

    stepMatch(rt, input, 0.016);

    expect(rt.rope).not.toBeNull();
    expect(worm.vy).toBeLessThan(0);
  });

  it('does not nudge the worm when the rope fails to attach', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.match.turnOrder[0].worm;
    worm.aimAngle = -Math.PI / 2; // straight up, into open sky - nothing to grapple
    const input = makeInput({ firing: true, selectedWeapon: 4 });

    stepMatch(rt, input, 0.016);

    expect(rt.rope).toBeNull();
    expect(worm.vy).toBeGreaterThanOrEqual(0); // no upward hop - just this frame's normal gravity
  });
});

describe('stepMatch weapon-index guard', () => {
  it('falls back to bazooka instead of throwing when selectedWeapon is out of range', () => {
    const rt = makeRuntime(twoWormTeams());
    const input = makeInput({ firing: true, selectedWeapon: 99 });

    expect(() => stepMatch(rt, input, 0.2)).not.toThrow();
    expect(rt.charging).toBe(true); // charging the fallback weapon (bazooka, chargeable)

    input.firing = false;
    stepMatch(rt, input, 0.016);

    expect(rt.projectiles).toHaveLength(1);
    expect(rt.projectiles[0].weaponKey).toBe('bazooka');
  });
});

describe('stepMatch turn banner', () => {
  it('sets the turn banner timer when the turn advances', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.match.turnTimeRemaining = 5;
    const input = makeInput();

    stepMatch(rt, input, 0.01); // 10ms tick expires the 5ms-remaining turn timer

    expect(rt.turnBannerTimer).toBe(TURN_BANNER_DURATION_MS);
  });

  it('freezes input/physics processing while the turn banner is showing', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.turnBannerTimer = TURN_BANNER_DURATION_MS;
    const worm = rt.match.turnOrder[rt.match.currentIndex].worm;
    const originalX = worm.x;
    const input = makeInput({ left: true });

    stepMatch(rt, input, 0.5);

    expect(worm.x).toBe(originalX);
  });

  it('counts down and clears once the banner duration elapses, then resumes normal processing', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.turnBannerTimer = 100; // 100ms left

    stepMatch(rt, makeInput(), 0.05); // 50ms tick, banner still showing
    expect(rt.turnBannerTimer).toBe(50);

    stepMatch(rt, makeInput(), 0.05); // another 50ms tick, banner clears exactly at 0
    expect(rt.turnBannerTimer).toBeNull();

    const worm = rt.match.turnOrder[rt.match.currentIndex].worm;
    const originalX = worm.x;
    stepMatch(rt, makeInput({ left: true }), 0.5); // banner is gone - input processes normally again
    expect(worm.x).not.toBe(originalX);
  });

  it('does not let an endTurnRequested keypress during the banner freeze leak into the new turn', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.turnBannerTimer = 50; // 50ms left in the banner
    const indexAtBannerStart = rt.match.currentIndex;
    // A real input object is mutated in place frame to frame (set on
    // keydown, expected to be consumed/cleared as frames process it), so
    // reusing the same object across both calls is what actually exercises
    // the latch: without the fix, the freeze's early return skips clearing
    // it, leaving it true for the next stepMatch call.
    const input = makeInput({ endTurnRequested: true });

    // Player presses Esc/Backspace while the banner is still showing - this
    // must NOT be allowed to end the incoming player's turn once the banner
    // clears on a later frame.
    stepMatch(rt, input, 0.1); // 100ms tick clears the 50ms-remaining banner

    expect(rt.turnBannerTimer).toBeNull();
    expect(input.endTurnRequested).toBe(false); // must not survive the freeze
    expect(rt.match.currentIndex).toBe(indexAtBannerStart);

    // The very next unfrozen frame: if the flag had latched through, this
    // call would silently end the turn that just started.
    stepMatch(rt, input, 0.016);

    expect(rt.match.currentIndex).toBe(indexAtBannerStart);
  });
});

describe('stepMatch death animation', () => {
  it('leaves a gravestone at the spot once a dying worm finishes its animation', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.match.turnOrder[0].worm;
    worm.hp = 0;
    worm.dying = true;
    worm.deathTimer = 10; // 10ms left
    const input = makeInput();

    stepMatch(rt, input, 0.02); // 20ms tick expires the 10ms-remaining death timer

    expect(worm.alive).toBe(false);
    expect(worm.dying).toBe(false);
    expect(rt.gravestones).toHaveLength(1);
    expect(rt.gravestones[0].x).toBeCloseTo(worm.x, 5);
    expect(rt.gravestones[0].y).toBeCloseTo(worm.y, 5);
  });

  it('does not leave a gravestone while the death animation is still playing', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.match.turnOrder[0].worm;
    worm.hp = 0;
    worm.dying = true;
    worm.deathTimer = 500;
    const input = makeInput();

    stepMatch(rt, input, 0.02);

    expect(worm.dying).toBe(true);
    expect(rt.gravestones).toHaveLength(0);
  });
});
