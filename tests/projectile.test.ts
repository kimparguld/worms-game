import { describe, it, expect } from 'vitest';
import { createProjectile, updateProjectile } from '../src/projectile.js';
import { createTerrain } from '../src/terrain.js';
import { createWorm } from '../src/worm.js';
import type { Terrain, ProjectileUpdateResult } from '../src/types.js';

function flatTerrain(width: number, height: number, groundY: number): Terrain {
  const terrain = createTerrain(width, height);
  terrain.mask.fill(0);
  for (let x = 0; x < width; x++) {
    for (let y = groundY; y < height; y++) terrain.mask[y * width + x] = 1;
  }
  return terrain;
}

describe('createProjectile', () => {
  it('scales speed with charge power for a chargeable weapon', () => {
    const p = createProjectile('bazooka', 0, 0, 0, 0.5);
    expect(p.vx).toBeCloseTo(200 + (600 - 200) * 0.5);
    expect(p.alive).toBe(true);
  });
});

describe('updateProjectile', () => {
  it('explodes a bazooka on terrain contact, carving a crater and damaging nearby worms', () => {
    const terrain = flatTerrain(200, 200, 100);
    const worm = createWorm(60, 90, 'p2', 'Bob');
    const projectile = createProjectile('bazooka', 60, 50, Math.PI / 2, 1);
    let result: ProjectileUpdateResult | undefined;
    for (let i = 0; i < 200 && !(result && result.exploded); i++) {
      result = updateProjectile(projectile, terrain, [worm], 0, 1 / 60);
    }
    expect(result!.exploded).toBe(true);
    expect(worm.hp).toBeLessThan(100);
  });

  it('bounces a grenade off terrain until its fuse expires', () => {
    const terrain = flatTerrain(200, 200, 100);
    const projectile = createProjectile('grenade', 60, 50, Math.PI / 2, 1);
    let bounced = false;
    let result: ProjectileUpdateResult | undefined;
    for (let i = 0; i < 400; i++) {
      result = updateProjectile(projectile, terrain, [], 0, 1 / 60);
      if (projectile.vy < 0) bounced = true;
      if (result.exploded) break;
    }
    expect(bounced).toBe(true);
    expect(result!.exploded).toBe(true);
  });

  it('rests dynamite in place until it detonates', () => {
    const terrain = flatTerrain(200, 200, 100);
    const projectile = createProjectile('dynamite', 60, 99, 0, 0);
    const startX = projectile.x;
    let result: ProjectileUpdateResult | undefined;
    for (let i = 0; i < 400; i++) {
      result = updateProjectile(projectile, terrain, [], 0, 1 / 60);
      if (result.exploded) break;
    }
    expect(projectile.x).toBeCloseTo(startX, 0);
    expect(result!.exploded).toBe(true);
  });
});
