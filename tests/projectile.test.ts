import { describe, it, expect } from 'vitest';
import { createProjectile, updateProjectile } from '../src/projectile.js';
import { createTerrain } from '../src/terrain.js';
import { WEAPONS } from '../src/weapons.js';
import { createWorm } from '../src/worm.js';
import type { Terrain, ProjectileUpdateResult } from '../src/types.js';

function flatTerrain(width: number, height: number, groundY: number): Terrain {
  const terrain = createTerrain(width, height);
  terrain.mask.fill(0);
  terrain.decorationMask.fill(0);
  for (let x = 0; x < width; x++) {
    for (let y = groundY; y < height; y++) terrain.mask[y * width + x] = 1;
  }
  return terrain;
}

describe('createProjectile', () => {
  it('scales speed with charge power for a chargeable weapon', () => {
    const p = createProjectile('bazooka', 0, 0, 0, 0.5);
    expect(p.vx).toBeCloseTo(250 + (1100 - 250) * 0.5);
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

  it('explodes a bazooka on direct contact with a worm floating in open air, away from any terrain', () => {
    const terrain = flatTerrain(200, 200, 190); // ground far below, out of the flight path
    // Close and fast enough that gravity's drop over the short flight stays
    // well under the worm-hit radius, so a near-miss on the y-axis doesn't
    // make this test flaky.
    const worm = createWorm(50, 50, 'p2', 'Bob');
    const projectile = createProjectile('bazooka', 0, 50, 0, 1); // fired flat, straight at the worm
    let result: ProjectileUpdateResult | undefined;
    for (let i = 0; i < 30 && !(result && result.exploded); i++) {
      result = updateProjectile(projectile, terrain, [worm], 0, 1 / 60);
    }
    expect(result!.exploded).toBe(true);
    expect(worm.hp).toBeLessThan(100);
  });

  it('launches a hurt worm upward (explosion knockback)', () => {
    const terrain = flatTerrain(200, 200, 100);
    const worm = createWorm(60, 90, 'p2', 'Bob');
    worm.vy = 0;
    const projectile = createProjectile('bazooka', 60, 50, Math.PI / 2, 1);
    let result: ProjectileUpdateResult | undefined;
    for (let i = 0; i < 200 && !(result && result.exploded); i++) {
      result = updateProjectile(projectile, terrain, [worm], 0, 1 / 60);
    }
    expect(result!.exploded).toBe(true);
    expect(worm.vy).toBeLessThan(0);
  });

  it('explodes when a fast bazooka crosses a worm within one frame', () => {
    const terrain = flatTerrain(2_000, 400, 390);
    const worm = createWorm(50, 50, 'p2', 'Bob');
    const projectile = createProjectile('bazooka', 0, 50, 0, 1);

    const result = updateProjectile(projectile, terrain, [worm], 0, 0.1);

    expect(result.exploded).toBe(true);
    expect(worm.hp).toBeLessThan(100);
  });

  it('explodes when a fast bazooka crosses thin terrain within one frame', () => {
    const terrain = flatTerrain(2_000, 400, 390);
    terrain.mask[54 * terrain.width + 50] = 1;
    const projectile = createProjectile('bazooka', 0, 50, 0, 1);

    const result = updateProjectile(projectile, terrain, [], 0, 0.1);

    expect(result.exploded).toBe(true);
    expect(projectile.x).toBeGreaterThan(40);
    expect(projectile.x).toBeLessThan(60);
  });

  it('does not self-detonate on the worm that fired it', () => {
    const terrain = flatTerrain(200, 200, 190);
    const shooter = createWorm(0, 50, 'p1', 'Shooter');
    const projectile = createProjectile('bazooka', 0, 50, 0, 1, shooter);
    // One tick, still essentially at the shooter's own position - without
    // the owner exclusion this would explode immediately.
    const result = updateProjectile(projectile, terrain, [shooter], 0, 1 / 60);
    expect(result.exploded).toBe(false);
    expect(shooter.hp).toBe(100);
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

  it('kills a bazooka that flies off the edge of the map without ever hitting terrain', () => {
    const terrain = flatTerrain(200, 200, 100);
    // Fired flat and fast to the left from near the left edge - it exits
    // x < 0 well before gravity could bring it down onto the ground.
    const projectile = createProjectile('bazooka', 10, 50, Math.PI, 1);
    let result: ProjectileUpdateResult | undefined;
    for (let i = 0; i < 200 && !(result && result.exploded === false && !projectile.alive); i++) {
      result = updateProjectile(projectile, terrain, [], 0, 1 / 60);
    }
    expect(result!.exploded).toBe(false);
    expect(projectile.alive).toBe(false);
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

  it('curves a homing missile toward the nearest enemy worm', () => {
    const terrain = flatTerrain(2000, 2000, 1900); // ground far below - stays airborne for the test window
    const shooter = createWorm(0, 0, 'p1', 'Shooter');
    const target = createWorm(300, 300, 'p2', 'Target'); // down and to the right of the flight path
    const projectile = createProjectile('homingMissile', 0, 0, 0, 1, shooter); // fired flat along +x
    expect(projectile.vy).toBe(0);

    for (let i = 0; i < 10; i++) {
      updateProjectile(projectile, terrain, [shooter, target], 0, 1 / 60);
    }

    expect(projectile.vy).toBeGreaterThan(0); // turned downward, toward the target
    expect(Math.hypot(projectile.vx, projectile.vy)).toBeCloseTo(WEAPONS.homingMissile.maxSpeed, 0); // speed preserved (homingMissile has no gravity/wind)
  });

  it('always detonates a full-charge homing missile via convergence (not just a lifetime backstop), regardless of initial bearing error', () => {
    const terrain = flatTerrain(4000, 4000, 3900); // ground far below - stays airborne long enough to converge or fail
    const bearings = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI * 0.99];
    for (const bearing of bearings) {
      const shooter = createWorm(2000, 2000, 'p1', 'Shooter');
      const target = createWorm(2000 + Math.cos(bearing) * 400, 2000 + Math.sin(bearing) * 400, 'p2', 'Target');
      const projectile = createProjectile('homingMissile', shooter.x, shooter.y, 0, 1, shooter); // fired flat (+x) regardless of where the target actually is
      let result: ProjectileUpdateResult | undefined;
      let ticks = 0;
      for (; ticks < 600 && !(result && result.exploded); ticks++) {
        result = updateProjectile(projectile, terrain, [shooter, target], 0, 1 / 60);
      }
      expect(result!.exploded).toBe(true);
      expect(ticks).toBeLessThan(300); // converged well inside the lifetime backstop below - proves the tuning itself works, not just the backstop
    }
  });

  it('gives the homing missile a lifetime backstop that forces detonation even without a target', () => {
    const terrain = flatTerrain(400, 400, 390);
    const shooter = createWorm(200, 380, 'p1', 'Shooter');
    // Fired straight up, with no enemy worm anywhere: homingMissile has no
    // gravity so it never arcs back down onto the ground, and the
    // out-of-bounds cull deliberately has no ceiling on -y (see
    // updateProjectile). Nothing but the lifetime backstop can end this
    // shot - which keeps this test independent of the homing tuning.
    const projectile = createProjectile('homingMissile', shooter.x, shooter.y, -Math.PI / 2, 1, shooter);
    let result: ProjectileUpdateResult | undefined;
    for (let i = 0; i < 400; i++) { // 400/60 ≈ 6.67s, past the 6s maxLifetime
      result = updateProjectile(projectile, terrain, [shooter], 0, 1 / 60); // no enemy worm at all - flies dead straight, never converges, must still stop
      if (result.exploded) break;
    }
    expect(result!.exploded).toBe(true);
  });

  it('curves toward the enemy worm even when a friendly worm is closer', () => {
    const terrain = flatTerrain(2000, 2000, 1900);
    const shooter = createWorm(0, 0, 'p1', 'Shooter');
    const friendly = createWorm(50, 10, 'p1', 'Friendly'); // closer, but same team - must be ignored
    const enemy = createWorm(300, 300, 'p2', 'Enemy');
    const projectile = createProjectile('homingMissile', 0, 0, 0, 1, shooter);

    for (let i = 0; i < 10; i++) {
      updateProjectile(projectile, terrain, [shooter, friendly, enemy], 0, 1 / 60);
    }

    expect(projectile.vy).toBeGreaterThan(0); // still curving toward the enemy (down-right), not toward the closer friendly
  });

  it('steers toward a player-picked target point instead of the nearest enemy', () => {
    const terrain = flatTerrain(2000, 2000, 1900);
    const shooter = createWorm(500, 500, 'p1', 'Shooter');
    const enemy = createWorm(800, 800, 'p2', 'Enemy'); // down-right - would pull the missile down
    const projectile = createProjectile('homingMissile', 500, 500, 0, 1, shooter);
    projectile.target = { x: 800, y: 200 }; // up-right

    for (let i = 0; i < 10; i++) {
      updateProjectile(projectile, terrain, [shooter, enemy], 0, 1 / 60);
    }

    expect(projectile.vy).toBeLessThan(0); // turned up, toward the picked point, not down toward the enemy
  });

  it('detonates on reaching a target point in open air instead of circling it', () => {
    const terrain = flatTerrain(2000, 2000, 1900);
    const shooter = createWorm(500, 500, 'p1', 'Shooter');
    const projectile = createProjectile('homingMissile', 500, 500, 0, 1, shooter);
    projectile.target = { x: 700, y: 400 };
    let result: ProjectileUpdateResult | undefined;
    let ticks = 0;
    for (; ticks < 600 && !(result && result.exploded); ticks++) {
      result = updateProjectile(projectile, terrain, [shooter], 0, 1 / 60);
    }
    expect(result!.exploded).toBe(true);
    expect(ticks).toBeLessThan(120); // well before the 6s lifetime backstop
    expect(Math.hypot(projectile.x - 700, projectile.y - 400)).toBeLessThan(15);
  });

  it('still detonates at the target point when one slow frame carries it past', () => {
    const terrain = flatTerrain(2000, 2000, 1900);
    const shooter = createWorm(0, 0, 'p1', 'Shooter');
    const projectile = createProjectile('homingMissile', 500, 500, 0, 1, shooter);
    projectile.target = { x: 510, y: 500 }; // straight ahead, 10px - a 0.05s tick moves 22px
    const result = updateProjectile(projectile, terrain, [shooter], 0, 0.05);
    expect(result.exploded).toBe(true);
  });

  it('flies straight with no steering when no living enemy worm exists', () => {
    const terrain = flatTerrain(2000, 2000, 1900);
    const shooter = createWorm(0, 0, 'p1', 'Shooter');
    const projectile = createProjectile('homingMissile', 0, 0, 0, 1, shooter);

    for (let i = 0; i < 10; i++) {
      updateProjectile(projectile, terrain, [shooter], 0, 1 / 60); // no enemy worm in the array at all
    }

    expect(projectile.vy).toBe(0); // no target found - never steered, still flying dead level
    expect(projectile.vx).toBeGreaterThan(0);
  });
});

describe('updateProjectile cluster bomb', () => {
  it('spawns 5 cluster fragments at the detonation point when a cluster bomb explodes', () => {
    const terrain = flatTerrain(400, 400, 100);
    const projectile = createProjectile('clusterBomb', 60, 50, Math.PI / 2, 1);
    let result: ProjectileUpdateResult | undefined;
    for (let i = 0; i < 200 && !(result && result.exploded); i++) {
      result = updateProjectile(projectile, terrain, [], 0, 1 / 60);
    }
    expect(result!.exploded).toBe(true);
    expect(result!.spawned).toHaveLength(5);
    for (const fragment of result!.spawned!) {
      expect(fragment.weaponKey).toBe('clusterFragment');
      expect(fragment.alive).toBe(true);
      expect(fragment.x).toBeCloseTo(projectile.x, 0);
      expect(fragment.y).toBeCloseTo(projectile.y, 0);
    }
  });

  it('does not spawn further fragments when a cluster fragment itself explodes', () => {
    const terrain = flatTerrain(400, 400, 100);
    const projectile = createProjectile('clusterFragment', 60, 99, 0, 0);
    let result: ProjectileUpdateResult | undefined;
    for (let i = 0; i < 400; i++) {
      result = updateProjectile(projectile, terrain, [], 0, 1 / 60);
      if (result.exploded) break;
    }
    expect(result!.exploded).toBe(true);
    expect(result!.spawned).toEqual([]);
  });
});
