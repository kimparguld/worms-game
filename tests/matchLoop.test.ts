import { describe, it, expect } from 'vitest';
import { createMatchRuntime, stepMatch } from '../src/matchLoop.js';
import { createTerrain } from '../src/terrain.js';
import { createWorm } from '../src/worm.js';
import { createMatch } from '../src/game.js';
import type { InputState, Team, MatchRuntime } from '../src/types.js';

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
  };
}

function twoWormTeams(): Team[] {
  return [
    { playerId: 'p1', worms: [createWorm(50, 149, 'p1', 'A')] },
    { playerId: 'p2', worms: [createWorm(150, 149, 'p2', 'B')] },
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
    const rt = makeRuntime(teams);
    rt.rope = { attached: true, anchorX: 60, anchorY: 100, length: 50 };
    const input = makeInput({ firing: true, aimUp: true, selectedWeapon: 1 });

    stepMatch(rt, input, 0.5);

    expect(worm.aimAngle).toBe(originalAngle);
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
  });
});

describe('stepMatch turn-timer / retirement interaction', () => {
  it('clears a stale retirement timer and charge state when the turn advances from the timer expiring', () => {
    const rt = makeRuntime(twoWormTeams());
    rt.match.turnTimeRemaining = 5;
    rt.retirementTimer = 999; // stale, left over from a previous, already-resolved shot
    rt.charging = true;
    rt.chargePower = 0.5;
    const input = makeInput();

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
    const input = makeInput({ endTurnRequested: true });

    stepMatch(rt, input, 0.016);

    expect(rt.match.currentIndex).toBe(1);
    expect(rt.retirementTimer).toBeNull();
    expect(rt.charging).toBe(false);
    expect(input.endTurnRequested).toBe(false);
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

describe('stepMatch weapon-index guard', () => {
  it('falls back to a valid weapon instead of throwing when selectedWeapon is out of range', () => {
    const rt = makeRuntime(twoWormTeams());
    const input = makeInput({ selectedWeapon: 99 });

    expect(() => stepMatch(rt, input, 0.016)).not.toThrow();
  });
});
