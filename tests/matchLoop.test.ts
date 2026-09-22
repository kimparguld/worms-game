import { describe, it, expect, vi } from 'vitest';
import { createMatchRuntime, stepMatch, WEAPON_KEYS } from '../src/matchLoop.js';
import { createTerrain } from '../src/terrain.js';
import { createWorm, takeDamage } from '../src/worm.js';
import { createMatch } from '../src/game.js';
import type { InputState, Team, MatchRuntime } from '../src/types.js';
import {
  STARTING_HP,
  TURN_BANNER_DURATION_MS,
  SHOTGUN_TRACER_DURATION,
  DEATH_ANIM_DURATION_MS,
} from '../src/constants.js';
import { WEAPONS } from '../src/weapons.js';

function makeInput(overrides: Partial<InputState> = {}): InputState {
  return {
    left: false,
    right: false,
    aimUp: false,
    aimDown: false,
    jump: false,
    firing: false,
    endTurnRequested: false,
    selectedWeapon: 1,
    ...overrides,
  };
}

function makeRuntime(teams: Team[]): MatchRuntime {
  const terrain = createTerrain(200, 200);
  terrain.mask.fill(0);
  terrain.decorationMask.fill(0);
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
    shotgunTracer: null,
    explosions: [],
    splashes: [],
    crates: [],
    cratePickups: [],
    turnsSinceCrateEvent: 0,
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
    expect(rt.shotgunTracer).toBeNull();
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

  it('defaults worm names to "W1"-"W4" when none are given', () => {
    const rt = createMatchRuntime(960, 540);
    expect(rt.teams[0].worms.map((w) => w.name)).toEqual(['W1', 'W2']);
    expect(rt.teams[1].worms.map((w) => w.name)).toEqual(['W3', 'W4']);
  });

  it('uses the given worm names when provided', () => {
    const rt = createMatchRuntime(960, 540, 'Sharks', 'Jets', ['Zack', 'Wilfred', 'Gravy', 'Brain']);
    expect(rt.teams[0].worms.map((w) => w.name)).toEqual(['Zack', 'Wilfred']);
    expect(rt.teams[1].worms.map((w) => w.name)).toEqual(['Gravy', 'Brain']);
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

  it('lets the active worm retreat after dropping a static fuse weapon without firing again', () => {
    const rt = makeRuntime(twoWormTeams());
    const input = makeInput({ firing: true, selectedWeapon: 5 }); // dynamite, not chargeable

    stepMatch(rt, input, 0.016);
    const worm = rt.teams[0].worms[0];
    const startX = worm.x;

    input.right = true;
    input.firing = true;
    stepMatch(rt, input, 0.1);

    expect(worm.x).toBeGreaterThan(startX);
    expect(rt.projectiles).toHaveLength(1);
    expect(rt.projectiles[0].weaponKey).toBe('dynamite');
  });

  it('does not let a second shot be fired while the first is still pending, so the turn reliably ends', () => {
    const rt = makeRuntime(twoWormTeams());
    const input = makeInput({ firing: true, selectedWeapon: 1 }); // bazooka, chargeable

    stepMatch(rt, input, 0.2); // charge
    input.firing = false;
    stepMatch(rt, input, 0.016); // release - fires the first shot
    expect(rt.projectiles).toHaveLength(1);
    const firstRetirementTimer = rt.retirementTimer;
    expect(firstRetirementTimer).not.toBeNull();

    // Player presses fire again while the first shot is still in flight -
    // this must not start a new charge or reset the retirement timer.
    input.firing = true;
    stepMatch(rt, input, 0.2);

    expect(rt.charging).toBe(false);
    expect(rt.projectiles).toHaveLength(1);
    expect(rt.retirementTimer).toBeLessThanOrEqual(firstRetirementTimer!);
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

describe('stepMatch dying-worm guard', () => {
  it('does not let a dying active worm aim, fire, or swing on the rope', () => {
    const teams = twoWormTeams();
    const worm = teams[0].worms[0];
    worm.alive = true;
    worm.dying = true;
    worm.deathTimer = 500;
    const originalAngle = worm.aimAngle;
    const originalX = worm.x;
    const originalY = worm.y;
    const rt = makeRuntime(teams);
    rt.rope = { attached: true, anchorX: 60, anchorY: 100, length: 50 };
    // selectedWeapon 3 (shotgun) is NOT chargeable, so firing:true would
    // fire immediately (setting rt.retirementTimer and dealing raycast
    // damage) if the dying-worm guard were missing.
    const input = makeInput({ firing: true, aimUp: true, selectedWeapon: 3 });

    // A single small frame, not the 0.5s used by the dead-worm guard test
    // above: unlike a dead worm (whose physics is a full no-op), a dying
    // worm still falls under normal gravity by design (the death wiggle),
    // so a large dt would move it for reasons unrelated to this guard.
    stepMatch(rt, input, 0.016);

    expect(worm.aimAngle).toBe(originalAngle);
    // If the guard didn't also cover rope-swing, updateRopeSwing would have
    // pulled this worm noticeably toward the (60, 100) anchor - far more
    // than the sub-pixel drift a single frame of plain gravity produces.
    expect(Math.hypot(worm.x - originalX, worm.y - originalY)).toBeLessThan(5);
    // Shotgun deals damage via an instant raycast, not rt.projectiles, so the
    // aim-independent tell that it fired is the retirement timer it sets.
    expect(rt.retirementTimer).toBeNull();
    expect(teams[1].worms[0].hp).toBe(STARTING_HP);
    expect(rt.charging).toBe(false);
    expect(rt.rope).not.toBeNull();
  });

  it('does not let lethal fall damage fire a weapon in the same frame', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.match.turnOrder[0].worm;
    worm.vy = 1_000;
    const input = makeInput({ firing: true, selectedWeapon: 3 }); // shotgun

    stepMatch(rt, input, 0.016);

    expect(worm.dying).toBe(true);
    expect(rt.shotgunTracer).toBeNull();
    expect(rt.retirementTimer).toBeNull();
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

  it('waits for the explosion visual to finish, not just for the projectile to be gone, before advancing the turn', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.retirementTimer = 0.01;
    rt.projectiles = [];
    rt.explosions = [{ x: 10, y: 10, radius: 40, timer: 0.3 }];
    const input = makeInput();
    const beforeIndex = rt.match.currentIndex;

    stepMatch(rt, input, 0.02);

    expect(rt.match.currentIndex).toBe(beforeIndex);
    expect(rt.retirementTimer).not.toBeNull();
  });

  it("freezes the active worm's own movement while its shot is retiring", () => {
    const rt = makeRuntime(twoWormTeams());
    rt.retirementTimer = 1;
    const worm = rt.teams[0].worms[0];
    const startX = worm.x;
    const input = makeInput({ right: true });

    stepMatch(rt, input, 0.1);

    expect(worm.x).toBe(startX);
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

describe('stepMatch shotgun tracer', () => {
  it('sets a tracer from the shooter to each pellet endpoint when the shotgun fires', () => {
    const rt = makeRuntime(twoWormTeams());
    const shooter = rt.match.turnOrder[0].worm;
    const input = makeInput({ firing: true, selectedWeapon: 3 });

    stepMatch(rt, input, 0.016);

    expect(rt.shotgunTracer).not.toBeNull();
    expect(rt.shotgunTracer!.originX).toBe(shooter.x);
    expect(rt.shotgunTracer!.originY).toBe(shooter.y);
    expect(rt.shotgunTracer!.hits).toHaveLength(WEAPONS.shotgun.pellets);
  });

  it('clears the tracer once its display duration elapses', () => {
    const rt = makeRuntime(twoWormTeams());
    const input = makeInput({ firing: true, selectedWeapon: 3 });
    stepMatch(rt, input, 0.016);
    expect(rt.shotgunTracer).not.toBeNull();

    stepMatch(rt, makeInput(), SHOTGUN_TRACER_DURATION + 0.01);

    expect(rt.shotgunTracer).toBeNull();
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

describe('stepMatch ninja rope contract/expand', () => {
  it('shortens the rope length when aimUp is pressed while swinging', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.rope = { attached: true, anchorX: 60, anchorY: 100, length: 100 };
    const input = makeInput({ aimUp: true });

    stepMatch(rt, input, 0.1);

    expect(rt.rope.length).toBeLessThan(100);
  });

  it('lengthens the rope length when aimDown is pressed while swinging', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.rope = { attached: true, anchorX: 60, anchorY: 100, length: 100 };
    const input = makeInput({ aimDown: true });

    stepMatch(rt, input, 0.1);

    expect(rt.rope.length).toBeGreaterThan(100);
  });

  it('does not change the worm aim angle while adjusting rope length', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.match.turnOrder[0].worm;
    const originalAngle = worm.aimAngle;
    rt.rope = { attached: true, anchorX: 60, anchorY: 100, length: 100 };
    const input = makeInput({ aimUp: true });

    stepMatch(rt, input, 0.1);

    expect(worm.aimAngle).toBe(originalAngle);
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

describe('stepMatch water', () => {
  it('kills a worm instantly and records a splash when it ends up in the water', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.match.turnOrder[0].worm;
    worm.y = 190; // past the water line (200 * (1 - 0.07) = 186) for this 200-tall test terrain
    const input = makeInput();

    stepMatch(rt, input, 0.016);

    expect(worm.alive).toBe(false);
    expect(worm.dying).toBe(false);
    expect(rt.splashes).toHaveLength(1);
    expect(rt.splashes[0].x).toBeCloseTo(worm.x, 5);
  });

  it('automatically advances the turn when the active worm falls into the water', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.match.turnOrder[0].worm;
    worm.y = 190; // past the water line for this 200-tall test terrain
    const input = makeInput({ firing: true });

    stepMatch(rt, input, 0.016);

    expect(worm.alive).toBe(false);
    expect(rt.match.currentIndex).toBe(1);
    expect(rt.turnBannerTimer).toBe(TURN_BANNER_DURATION_MS);
    expect(rt.charging).toBe(false);
    expect(input.firing).toBe(false);
  });

  it('does not record a splash for a worm dying from damage on dry land', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.match.turnOrder[0].worm;
    worm.hp = 0;
    worm.dying = true;
    worm.deathTimer = 10;
    const input = makeInput();

    stepMatch(rt, input, 0.02);

    expect(rt.splashes).toHaveLength(0);
  });
});

describe('WEAPON_KEYS', () => {
  it('lists all ten original weapons plus the three newest at the end', () => {
    expect(WEAPON_KEYS).toEqual([
      'bazooka',
      'grenade',
      'shotgun',
      'ninjaRope',
      'dynamite',
      'sniperRifle',
      'airstrikeRocket',
      'holyHandGrenade',
      'mine',
      'drill',
      'homingMissile',
      'clusterBomb',
      'bat',
    ]);
  });
});

describe('stepMatch sniper rifle', () => {
  it('deals damage to a worm hit by the precise hitscan shot, just like the shotgun does', () => {
    const rt = makeRuntime(twoWormTeams());
    const target = rt.teams[1].worms[0];
    const shooter = rt.match.turnOrder[0].worm;
    shooter.aimAngle = 0; // level shot toward the target, which sits at the same y
    const sniperRifleIndex = WEAPON_KEYS.indexOf('sniperRifle') + 1;
    const input = makeInput({ firing: true, selectedWeapon: sniperRifleIndex });

    stepMatch(rt, input, 0.016);

    expect(target.hp).toBe(STARTING_HP - WEAPONS.sniperRifle.maxDamage);
  });
});

describe('stepMatch airstrike', () => {
  it('calls a random barrage without launching a projectile', () => {
    const teams = twoWormTeams();
    const rt = makeRuntime(teams);
    const airstrikeIndex = WEAPON_KEYS.indexOf('airstrikeRocket') + 1;
    const randomSpy = vi
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.25)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.75)
      .mockReturnValueOnce(1);
    const input = makeInput({ firing: true, selectedWeapon: airstrikeIndex });

    stepMatch(rt, input, 0.016);

    randomSpy.mockRestore();
    expect(input.firing).toBe(false);
    expect(rt.projectiles).toHaveLength(0);
    expect(rt.explosions).toHaveLength(5);
    expect(rt.explosions.map((explosion) => explosion.x)).toEqual([40, 70, 100, 130, 160]);
    expect(new Set(rt.explosions.map((explosion) => explosion.x)).size).toBeGreaterThan(1);
  });
});

describe('stepMatch drill', () => {
  it('carves terrain along the active worm aim line without attaching a rope', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.match.turnOrder[0].worm;
    worm.aimAngle = 0;
    const drillIndex = WEAPON_KEYS.indexOf('drill') + 1;
    const targetIndex = 150 * rt.terrain.width + 95;
    expect(rt.terrain.mask[targetIndex]).toBe(1);

    stepMatch(rt, makeInput({ firing: true, selectedWeapon: drillIndex }), 0.016);

    expect(rt.terrain.mask[targetIndex]).toBe(0);
    expect(rt.rope).toBeNull();
    expect(rt.projectiles).toHaveLength(0);
  });
});

describe('death explosion', () => {
  it('damages and launches a worm standing near one that just died, the instant it finalizes', () => {
    const victim = createWorm(50, 149, 'p1', 'A');
    const bystander = createWorm(65, 149, 'p2', 'B'); // 15px away - well inside the death blast radius
    const teams: Team[] = [
      { playerId: 'p1', name: 'Team 1', worms: [victim] },
      { playerId: 'p2', name: 'Team 2', worms: [bystander] },
    ];
    const rt = makeRuntime(teams);
    takeDamage(victim, 100); // starts the death animation
    const startHp = bystander.hp;
    const input = makeInput();
    const dt = 1 / 60;
    const maxTicks = Math.ceil(DEATH_ANIM_DURATION_MS / (dt * 1000)) + 1;
    for (let i = 0; i < maxTicks; i++) {
      stepMatch(rt, input, dt);
      if (rt.gravestones.length > 0) break; // stop the instant the death finalizes
    }

    expect(rt.gravestones).toHaveLength(1);
    expect(bystander.hp).toBeLessThan(startHp);
    expect(bystander.vy).toBeLessThan(0);
    expect(rt.explosions).toHaveLength(1);
    expect(rt.explosions[0].x).toBeCloseTo(50);
    expect(rt.explosions[0].radius).toBe(35);
  });

  it('does not hurt a worm outside the death blast radius', () => {
    const victim = createWorm(50, 149, 'p1', 'A');
    const farAway = createWorm(150, 149, 'p2', 'B');
    const teams: Team[] = [
      { playerId: 'p1', name: 'Team 1', worms: [victim] },
      { playerId: 'p2', name: 'Team 2', worms: [farAway] },
    ];
    const rt = makeRuntime(teams);
    takeDamage(victim, 100);
    const startHp = farAway.hp;
    const input = makeInput();
    const dt = 1 / 60;
    const maxTicks = Math.ceil(DEATH_ANIM_DURATION_MS / (dt * 1000)) + 1;
    for (let i = 0; i < maxTicks; i++) {
      stepMatch(rt, input, dt);
      if (rt.gravestones.length > 0) break;
    }

    expect(rt.gravestones).toHaveLength(1);
    expect(farAway.hp).toBe(startHp);
  });
});

// Advances one full turn and waits out the resulting turn-banner freeze, so
// the next call isn't swallowed by it - mirrors how a real match alternates
// turn-end and the frozen banner period in between.
function endTurn(rt: MatchRuntime): void {
  stepMatch(rt, makeInput({ endTurnRequested: true }), 1 / 60);
  while (rt.turnBannerTimer !== null) {
    stepMatch(rt, makeInput(), 1 / 60);
  }
}

describe('health crates', () => {
  // Matches CRATE_SPAWN_INTERVAL_TURNS in matchLoop.ts.
  const SPAWN_INTERVAL_TURNS = 4;
  const HEAL_AMOUNT = 25;

  it('does not spawn a crate before the spawn interval is reached', () => {
    const rt = makeRuntime(twoWormTeams());
    for (let i = 0; i < SPAWN_INTERVAL_TURNS - 1; i++) endTurn(rt);
    expect(rt.crates).toHaveLength(0);
  });

  it('spawns exactly one falling crate once the spawn interval is reached', () => {
    const rt = makeRuntime(twoWormTeams());
    for (let i = 0; i < SPAWN_INTERVAL_TURNS; i++) endTurn(rt);
    expect(rt.crates).toHaveLength(1);
    expect(rt.crates[0].landed).toBe(false);
  });

  it('does not spawn a second crate while one is still uncollected', () => {
    const rt = makeRuntime(twoWormTeams());
    for (let i = 0; i < SPAWN_INTERVAL_TURNS; i++) endTurn(rt);
    expect(rt.crates).toHaveLength(1);
    for (let i = 0; i < SPAWN_INTERVAL_TURNS; i++) endTurn(rt);
    expect(rt.crates).toHaveLength(1);
  });

  it('falls under gravity and lands once it reaches solid terrain', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.crates = [{ x: 100, y: 0, vy: 0, landed: false }];
    const input = makeInput();
    for (let i = 0; i < 120; i++) {
      stepMatch(rt, input, 1 / 60);
      if (rt.crates[0]?.landed) break;
    }
    expect(rt.crates[0].landed).toBe(true);
    expect(rt.crates[0].y).toBeGreaterThanOrEqual(150); // makeRuntime's solid ground starts at y=150
    expect(rt.crates[0].y).toBeLessThan(170); // shouldn't overshoot far past the surface in one tick
  });

  it('despawns into the water if it falls before finding solid ground', () => {
    const rt = makeRuntime(twoWormTeams());
    // Carve a vertical gap under the crate's spawn column, clear down to the
    // bottom, so it never finds solid ground and instead crosses the water
    // line - the two worms (at x=50/x=150) keep their solid ground.
    for (let x = 95; x <= 105; x++) {
      for (let y = 0; y < 200; y++) rt.terrain.mask[y * 200 + x] = 0;
    }
    rt.crates = [{ x: 100, y: 0, vy: 0, landed: false }];
    const input = makeInput();
    for (let i = 0; i < 200; i++) {
      stepMatch(rt, input, 1 / 60);
      if (rt.crates.length === 0) break;
    }
    expect(rt.crates).toHaveLength(0);
    expect(rt.splashes.some((s) => Math.abs(s.x - 100) < 1)).toBe(true);
  });

  it('heals the worm that reaches a landed crate, removes the crate, and records a pickup', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.teams[0].worms[0];
    takeDamage(worm, 30);
    rt.crates = [{ x: worm.x, y: worm.y, vy: 0, landed: true }];
    stepMatch(rt, makeInput(), 1 / 60);
    expect(worm.hp).toBe(STARTING_HP - 30 + HEAL_AMOUNT);
    expect(rt.crates).toHaveLength(0);
    expect(rt.cratePickups).toHaveLength(1);
  });

  it('caps healing at the starting HP rather than overhealing', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.teams[0].worms[0];
    takeDamage(worm, 10);
    rt.crates = [{ x: worm.x, y: worm.y, vy: 0, landed: true }];
    stepMatch(rt, makeInput(), 1 / 60);
    expect(worm.hp).toBe(STARTING_HP);
  });

  it('leaves a landed crate on the map until a worm actually reaches it', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.crates = [{ x: 100, y: 149, vy: 0, landed: true }]; // 50px from both worms, outside pickup range
    stepMatch(rt, makeInput(), 1 / 60);
    expect(rt.crates).toHaveLength(1);
  });

  it('does not let a dying worm collect a crate', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.teams[0].worms[0];
    worm.dying = true;
    rt.crates = [{ x: worm.x, y: worm.y, vy: 0, landed: true }];
    stepMatch(rt, makeInput(), 1 / 60);
    expect(rt.crates).toHaveLength(1);
  });

  it('detonates a crate caught in a weapon explosion like a grenade, removing it from the map', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.crates = [{ x: 100, y: 149, vy: 0, landed: true }];
    const airstrikeIndex = WEAPON_KEYS.indexOf('airstrikeRocket') + 1;
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5); // every bomb lands at x=100, on the crate
    const input = makeInput({ firing: true, selectedWeapon: airstrikeIndex });

    stepMatch(rt, input, 0.016);

    randomSpy.mockRestore();
    expect(rt.crates).toHaveLength(0);
    // 5 airstrike bombs plus the crate's own chained grenade-style blast.
    expect(rt.explosions.length).toBeGreaterThan(5);
  });

  it('leaves a crate untouched when no explosion reaches it', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.crates = [{ x: 190, y: 149, vy: 0, landed: true }];
    const airstrikeIndex = WEAPON_KEYS.indexOf('airstrikeRocket') + 1;
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0); // every bomb lands at x=40, far from the crate
    const input = makeInput({ firing: true, selectedWeapon: airstrikeIndex });

    stepMatch(rt, input, 0.016);

    randomSpy.mockRestore();
    expect(rt.crates).toHaveLength(1);
  });
});

describe('stepMatch weapon selection resets each turn', () => {
  it('resets the selected weapon back to bazooka when the turn advances', () => {
    const rt = makeRuntime(twoWormTeams());
    const input = makeInput({ endTurnRequested: true, selectedWeapon: 5 });

    stepMatch(rt, input, 0.016);

    expect(input.selectedWeapon).toBe(1);
  });

  it('does not reset the selected weapon mid-turn', () => {
    const rt = makeRuntime(twoWormTeams());
    const input = makeInput({ selectedWeapon: 5 });

    stepMatch(rt, input, 0.016);

    expect(input.selectedWeapon).toBe(5);
  });
});

describe('stepMatch limited-use weapons', () => {
  it('fires a limited weapon and decrements the active team ammo', () => {
    const teams = twoWormTeams();
    teams[0].ammo = { airstrikeRocket: 1 };
    const rt = makeRuntime(teams);
    const airstrikeIndex = WEAPON_KEYS.indexOf('airstrikeRocket') + 1;
    const input = makeInput({ firing: true, selectedWeapon: airstrikeIndex });

    stepMatch(rt, input, 0.016);

    expect(rt.teams[0].ammo!.airstrikeRocket).toBe(0);
    expect(rt.explosions).toHaveLength(5);
  });

  it('blocks firing once a limited weapon reaches zero remaining uses for that team', () => {
    const teams = twoWormTeams();
    teams[0].ammo = { airstrikeRocket: 0 };
    const rt = makeRuntime(teams);
    const airstrikeIndex = WEAPON_KEYS.indexOf('airstrikeRocket') + 1;
    const input = makeInput({ firing: true, selectedWeapon: airstrikeIndex });

    stepMatch(rt, input, 0.016);

    expect(rt.teams[0].ammo!.airstrikeRocket).toBe(0);
    expect(rt.explosions).toHaveLength(0);
  });

  it('does not gate an unlimited weapon even with no ammo map set', () => {
    const rt = makeRuntime(twoWormTeams());
    const input = makeInput({ firing: true, selectedWeapon: 5 }); // dynamite, no match limit

    stepMatch(rt, input, 0.016);

    expect(rt.projectiles).toHaveLength(1);
  });

  it("keeps each team's limited-weapon ammo independent", () => {
    const teams = twoWormTeams();
    teams[0].ammo = { airstrikeRocket: 1 };
    teams[1].ammo = { airstrikeRocket: 1 };
    const rt = makeRuntime(teams);
    const airstrikeIndex = WEAPON_KEYS.indexOf('airstrikeRocket') + 1;
    stepMatch(rt, makeInput({ firing: true, selectedWeapon: airstrikeIndex }), 0.016);

    expect(rt.teams[0].ammo!.airstrikeRocket).toBe(0);
    expect(rt.teams[1].ammo!.airstrikeRocket).toBe(1);
  });
});

describe('stepMatch homing missile', () => {
  it('fires a chargeable homing missile and decrements limited ammo', () => {
    const teams = twoWormTeams();
    teams[0].ammo = { homingMissile: 2 };
    const rt = makeRuntime(teams);
    const homingIndex = WEAPON_KEYS.indexOf('homingMissile') + 1;
    const input = makeInput({ firing: true, selectedWeapon: homingIndex });

    stepMatch(rt, input, 0.2); // charge
    input.firing = false;
    stepMatch(rt, input, 0.016); // release - fires

    expect(rt.projectiles).toHaveLength(1);
    expect(rt.projectiles[0].weaponKey).toBe('homingMissile');
    expect(rt.teams[0].ammo!.homingMissile).toBe(1);
  });
});

describe('stepMatch cluster bomb', () => {
  it('adds spawned fragments to rt.projectiles only after the tick the parent detonates on', () => {
    const rt = makeRuntime(twoWormTeams());
    const clusterIndex = WEAPON_KEYS.indexOf('clusterBomb') + 1;
    const worm = rt.match.turnOrder[0].worm;
    worm.aimAngle = 0; // level shot - gravity alone brings it down onto the flat ground just below
    const input = makeInput({ firing: true, selectedWeapon: clusterIndex });

    stepMatch(rt, input, 0.2); // charge
    input.firing = false;
    stepMatch(rt, input, 0.016); // release - fires, still airborne
    expect(rt.projectiles.filter((p) => p.weaponKey === 'clusterBomb')).toHaveLength(1);
    expect(rt.projectiles.filter((p) => p.weaponKey === 'clusterFragment')).toHaveLength(0);

    let detonated = false;
    for (let i = 0; i < 20 && !detonated; i++) {
      stepMatch(rt, input, 1 / 60);
      detonated = rt.projectiles.every((p) => p.weaponKey !== 'clusterBomb');
    }

    const fragments = rt.projectiles.filter((p) => p.weaponKey === 'clusterFragment');
    expect(fragments).toHaveLength(5);
    const yRightAfterSpawn = fragments[0].y;

    stepMatch(rt, input, 1 / 60);
    const sameFragment = rt.projectiles.find((p) => p === fragments[0])!;
    expect(sameFragment.y).not.toBe(yRightAfterSpawn); // it has now moved - it wasn't ticked on its spawn frame, but is ticking normally since
  });
});

describe('createMatchRuntime limited-weapon ammo', () => {
  it('seeds each team with independent starting ammo for airstrike and holy hand grenade', () => {
    const rt = createMatchRuntime(960, 540);
    expect(rt.teams[0].ammo?.airstrikeRocket).toBe(1);
    expect(rt.teams[0].ammo?.holyHandGrenade).toBe(2);
    expect(rt.teams[1].ammo?.airstrikeRocket).toBe(1);
    expect(rt.teams[1].ammo?.holyHandGrenade).toBe(2);
    rt.teams[0].ammo!.airstrikeRocket = 0;
    expect(rt.teams[1].ammo?.airstrikeRocket).toBe(1);
  });

  it('leaves unlimited weapons out of the ammo map', () => {
    const rt = createMatchRuntime(960, 540);
    expect(rt.teams[0].ammo?.bazooka).toBeUndefined();
  });
});

describe('stepMatch falling gravestones', () => {
  it('lets a gravestone keep falling under gravity when the worm died high in the air', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.match.turnOrder[0].worm;
    worm.y = 20; // well above the solid ground starting at y=150
    worm.hp = 0;
    worm.dying = true;
    worm.deathTimer = 10; // 10ms left
    const input = makeInput();

    stepMatch(rt, input, 0.02); // finalizes the death this frame

    expect(rt.gravestones).toHaveLength(1);
    expect(rt.gravestones[0].landed).toBe(false);
    const yAfterDeath = rt.gravestones[0].y;

    for (let i = 0; i < 60; i++) {
      stepMatch(rt, input, 1 / 60);
      if (rt.gravestones[0].landed) break;
    }

    expect(rt.gravestones[0].landed).toBe(true);
    expect(rt.gravestones[0].y).toBeGreaterThan(yAfterDeath);
    expect(rt.gravestones[0].y).toBeGreaterThanOrEqual(150);
  });

  it('lands quickly, barely falling, when the worm died right at ground level', () => {
    const rt = makeRuntime(twoWormTeams());
    const worm = rt.match.turnOrder[0].worm;
    worm.hp = 0;
    worm.dying = true;
    worm.deathTimer = 10;
    const input = makeInput();

    stepMatch(rt, input, 0.02); // finalizes the death this frame
    const deathY = rt.gravestones[0].y;

    for (let i = 0; i < 10; i++) {
      stepMatch(rt, input, 1 / 60);
      if (rt.gravestones[0].landed) break;
    }

    expect(rt.gravestones[0].landed).toBe(true);
    expect(rt.gravestones[0].y - deathY).toBeLessThan(5);
  });
});
