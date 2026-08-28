import { describe, it, expect } from 'vitest';
import { WEAPONS, integrateProjectile, calcDamage, raycastHit } from '../src/weapons.js';
import { createTerrain } from '../src/terrain.js';
import { createWorm } from '../src/worm.js';

describe('WEAPONS', () => {
  it('defines exactly the five spec weapons', () => {
    expect(Object.keys(WEAPONS).sort()).toEqual(
      ['bazooka', 'dynamite', 'grenade', 'ninjaRope', 'shotgun'].sort()
    );
  });
});

describe('WEAPONS range', () => {
  it('gives the bazooka enough max speed to cross most of the map at full charge', () => {
    expect(WEAPONS.bazooka.maxSpeed).toBe(850);
  });

  it('gives the grenade enough max speed to reach well past a short lob', () => {
    expect(WEAPONS.grenade.maxSpeed).toBe(600);
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
    for (let x = 0; x < 100; x++) terrain.mask[50 * 100 + x] = 1;
    const hit = raycastHit(terrain, [], 50, 0, Math.PI / 2, 200);
    expect(hit.type).toBe('terrain');
    expect(hit.y).toBeCloseTo(50, 0);
  });

  it('hits a worm before terrain if the worm is closer', () => {
    const terrain = createTerrain(100, 100);
    terrain.mask.fill(0);
    const worm = createWorm(50, 20, 'p1', 'A');
    const hit = raycastHit(terrain, [worm], 50, 0, Math.PI / 2, 200);
    expect(hit.type).toBe('worm');
    expect(hit.worm).toBe(worm);
  });

  it('excludes the shooter from its own raycast', () => {
    const terrain = createTerrain(100, 100);
    terrain.mask.fill(0);
    const shooter = createWorm(50, 50, 'p1', 'Shooter');
    const hit = raycastHit(terrain, [shooter], 50, 50, 0, 200, shooter);
    expect(hit.type).toBe('none');
  });

  it('does not hit a worm that is already dying', () => {
    const terrain = createTerrain(100, 100);
    terrain.mask.fill(0);
    const worm = createWorm(50, 20, 'p1', 'A');
    worm.dying = true;
    const hit = raycastHit(terrain, [worm], 50, 0, Math.PI / 2, 200);
    expect(hit.type).toBe('none');
  });
});
