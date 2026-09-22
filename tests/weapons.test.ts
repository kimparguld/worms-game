import { describe, it, expect } from 'vitest';
import { WORM_HIT_RADIUS } from '../src/constants.js';
import { WEAPONS, integrateProjectile, calcDamage, raycastHit, applyHoming, HOMING_TURN_RATE } from '../src/weapons.js';
import { createTerrain } from '../src/terrain.js';
import { createWorm } from '../src/worm.js';

describe('WEAPONS', () => {
  it('defines exactly the fifteen spec weapons', () => {
    expect(Object.keys(WEAPONS).sort()).toEqual(
      [
        'bazooka',
        'dynamite',
        'grenade',
        'ninjaRope',
        'shotgun',
        'sniperRifle',
        'airstrikeRocket',
        'holyHandGrenade',
        'mine',
        'drill',
        'homingMissile',
        'clusterBomb',
        'clusterFragment',
        'bat',
        'steelStructure',
      ].sort(),
    );
  });
});

describe('WEAPONS expanded arsenal', () => {
  it('flags exactly the homing missile as a homing weapon', () => {
    const homingWeapons = Object.values(WEAPONS)
      .filter((w) => w.homing)
      .map((w) => w.key);
    expect(homingWeapons).toEqual(['homingMissile']);
  });

  it('flags exactly the bat as a melee weapon', () => {
    const meleeWeapons = Object.values(WEAPONS)
      .filter((w) => w.melee)
      .map((w) => w.key);
    expect(meleeWeapons).toEqual(['bat']);
  });

  it('gives the cluster bomb 5 fragments and never lets a fragment cluster again', () => {
    expect(WEAPONS.clusterBomb.clusterCount).toBe(5);
    expect(WEAPONS.clusterFragment.clusterCount).toBeUndefined();
  });
});

describe('WEAPONS new arsenal', () => {
  it('gives the sniper rifle a precise long-range hitscan shot with no blast', () => {
    expect(WEAPONS.sniperRifle.hitscan).toBe(true);
    expect(WEAPONS.sniperRifle.pellets).toBe(1);
    expect(WEAPONS.sniperRifle.blastRadius).toBe(10);
    expect(WEAPONS.sniperRifle.range).toBe(1000);
  });

  it('makes the airstrike a random barrage instead of a precise targeted shot', () => {
    expect(WEAPONS.airstrikeRocket.gravity).toBe(false);
    expect(WEAPONS.airstrikeRocket.windAffected).toBe(false);
    expect(WEAPONS.airstrikeRocket.chargeable).toBe(false);
    expect(WEAPONS.airstrikeRocket.airstrike).toBe(true);
    expect(WEAPONS.airstrikeRocket.maxDamage).toBeLessThan(WEAPONS.bazooka.maxDamage);
  });

  it('gives the holy hand grenade a bigger blast and longer fuse than a regular grenade', () => {
    expect(WEAPONS.holyHandGrenade.maxDamage).toBeGreaterThan(WEAPONS.grenade.maxDamage);
    expect(WEAPONS.holyHandGrenade.blastRadius).toBeGreaterThan(WEAPONS.grenade.blastRadius);
    expect(WEAPONS.holyHandGrenade.fuseTime).toBeGreaterThan(WEAPONS.grenade.fuseTime!);
  });

  it('drops the mine straight down with a long fuse instead of throwing it', () => {
    expect(WEAPONS.mine.minSpeed).toBe(0);
    expect(WEAPONS.mine.maxSpeed).toBe(0);
    expect(WEAPONS.mine.fuseTime).toBe(10);
  });

  it('replaces the grappling hook with a drill that carves terrain', () => {
    expect(WEAPONS.drill.drill).toBe(true);
    expect(WEAPONS.drill.rope).toBe(false);
    expect(WEAPONS.drill.range).toBeGreaterThan(0);
  });

  it('flags only the ninja rope as a rope weapon', () => {
    const ropeWeapons = Object.values(WEAPONS)
      .filter((w) => w.rope)
      .map((w) => w.key)
      .sort();
    expect(ropeWeapons).toEqual(['ninjaRope']);
  });
});

describe('WEAPONS range', () => {
  it('gives the bazooka enough max speed to cross the bigger map at full charge', () => {
    expect(WEAPONS.bazooka.minSpeed).toBe(250);
    expect(WEAPONS.bazooka.maxSpeed).toBe(1100);
  });

  it('gives the grenade enough max speed and fuse time to travel and bounce further', () => {
    expect(WEAPONS.grenade.maxSpeed).toBe(900);
    expect(WEAPONS.grenade.fuseTime).toBe(3.5);
  });
});

describe('integrateProjectile', () => {
  it('applies gravity to vertical velocity and moves position', () => {
    const { pos, vel } = integrateProjectile({ x: 0, y: 0 }, { x: 10, y: 0 }, 100, 0, 1);
    expect(vel.y).toBe(100);
    expect(pos.x).toBe(10);
    expect(pos.y).toBe(100);
  });

  it('applies wind to horizontal velocity', () => {
    const { vel } = integrateProjectile({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, 20, 1);
    expect(vel.x).toBe(20);
  });
});

describe('calcDamage', () => {
  it('deals max damage at the blast center', () => {
    expect(calcDamage(0, 40, 60)).toBe(60);
  });

  it('deals zero damage at or beyond the blast radius', () => {
    expect(calcDamage(40, 40, 60)).toBe(0);
    expect(calcDamage(100, 40, 60)).toBe(0);
  });

  it('falls off linearly between center and radius', () => {
    expect(calcDamage(20, 40, 60)).toBe(30);
  });
});

describe('raycastHit', () => {
  it('hits terrain along the ray', () => {
    const terrain = createTerrain(100, 100);
    terrain.mask.fill(0);
    terrain.decorationMask.fill(0);
    for (let x = 0; x < 100; x++) terrain.mask[50 * 100 + x] = 1;
    const hit = raycastHit(terrain, [], 50, 0, Math.PI / 2, 200);
    expect(hit.type).toBe('terrain');
    expect(hit.y).toBeCloseTo(50, 0);
  });

  it('hits a worm before terrain if the worm is closer', () => {
    const terrain = createTerrain(100, 100);
    terrain.mask.fill(0);
    terrain.decorationMask.fill(0);
    const worm = createWorm(50, 20, 'p1', 'A');
    const hit = raycastHit(terrain, [worm], 50, 0, Math.PI / 2, 200);
    expect(hit.type).toBe('worm');
    expect(hit.worm).toBe(worm);
  });

  it('excludes the shooter from its own raycast', () => {
    const terrain = createTerrain(100, 100);
    terrain.mask.fill(0);
    terrain.decorationMask.fill(0);
    const shooter = createWorm(50, 50, 'p1', 'Shooter');
    const hit = raycastHit(terrain, [shooter], 50, 50, 0, 200, shooter);
    expect(hit.type).toBe('none');
  });

  it('hits a worm the ray passes near but not through its center - the rendered worm is far wider than its physics point', () => {
    const terrain = createTerrain(100, 100);
    terrain.mask.fill(0);
    terrain.decorationMask.fill(0);
    const worm = createWorm(50 + WORM_HIT_RADIUS - 4, 40, 'p1', 'A');
    const hit = raycastHit(terrain, [worm], 50, 0, Math.PI / 2, 200);
    expect(hit.type).toBe('worm');
  });

  it('does not hit a worm the ray clears by more than WORM_HIT_RADIUS', () => {
    const terrain = createTerrain(100, 100);
    terrain.mask.fill(0);
    terrain.decorationMask.fill(0);
    const worm = createWorm(50 + WORM_HIT_RADIUS + 2, 40, 'p1', 'A');
    const hit = raycastHit(terrain, [worm], 50, 0, Math.PI / 2, 200);
    expect(hit.type).toBe('none');
  });

  it('does not hit a worm that is already dying', () => {
    const terrain = createTerrain(100, 100);
    terrain.mask.fill(0);
    terrain.decorationMask.fill(0);
    const worm = createWorm(50, 20, 'p1', 'A');
    worm.dying = true;
    const hit = raycastHit(terrain, [worm], 50, 0, Math.PI / 2, 200);
    expect(hit.type).toBe('none');
  });
});

describe('applyHoming', () => {
  it('turns velocity toward the target, clamped by HOMING_TURN_RATE, preserving speed', () => {
    const vel = { x: 100, y: 0 }; // moving right, speed 100
    const pos = { x: 0, y: 0 };
    const target = { x: 100, y: 100 }; // desired angle: 45 degrees
    const dt = 0.1;

    const result = applyHoming(vel, pos, target, dt);

    const maxTurn = HOMING_TURN_RATE * dt;
    const newAngle = Math.atan2(result.y, result.x);
    expect(newAngle).toBeCloseTo(maxTurn, 5); // clamped - hasn't reached 45 degrees yet
    expect(Math.hypot(result.x, result.y)).toBeCloseTo(100, 5);
  });

  it('does not overshoot once already pointed at the target', () => {
    const vel = { x: 0, y: 100 }; // moving straight down, speed 100
    const pos = { x: 0, y: 0 };
    const target = { x: 0, y: 100 }; // directly ahead

    const result = applyHoming(vel, pos, target, 0.1);

    expect(result.x).toBeCloseTo(0, 5);
    expect(result.y).toBeCloseTo(100, 5);
  });
});
