import { isSolid } from './terrain.js';
import type { Terrain, WeaponDef, WeaponKey, Worm, RaycastHit, ProjectileIntegration, Vector2 } from './types.js';

export const WEAPONS: Record<WeaponKey, WeaponDef> = {
  bazooka: {
    key: 'bazooka', maxDamage: 60, blastRadius: 40, craterRadius: 40,
    chargeable: true, minSpeed: 200, maxSpeed: 600,
    gravity: true, windAffected: true, fuseTime: null, hitscan: false, pellets: 0, bounces: false,
  },
  grenade: {
    key: 'grenade', maxDamage: 50, blastRadius: 45, craterRadius: 45,
    chargeable: true, minSpeed: 150, maxSpeed: 400,
    gravity: true, windAffected: true, fuseTime: 3, hitscan: false, pellets: 0, bounces: true,
  },
  shotgun: {
    key: 'shotgun', maxDamage: 25, blastRadius: 0, craterRadius: 0,
    chargeable: false, minSpeed: 0, maxSpeed: 0,
    gravity: false, windAffected: false, fuseTime: null, hitscan: true, pellets: 2, bounces: false, range: 500,
  },
  ninjaRope: {
    key: 'ninjaRope', maxDamage: 0, blastRadius: 0, craterRadius: 0,
    chargeable: false, minSpeed: 500, maxSpeed: 500,
    gravity: false, windAffected: false, fuseTime: null, hitscan: false, pellets: 0, bounces: false,
  },
  dynamite: {
    key: 'dynamite', maxDamage: 75, blastRadius: 60, craterRadius: 60,
    chargeable: false, minSpeed: 0, maxSpeed: 0,
    gravity: true, windAffected: false, fuseTime: 5, hitscan: false, pellets: 0, bounces: false,
  },
};

export function integrateProjectile(
  pos: Vector2,
  vel: Vector2,
  gravity: number,
  wind: number,
  dt: number,
): ProjectileIntegration {
  const nvx = vel.x + wind * dt;
  const nvy = vel.y + gravity * dt;
  return {
    pos: { x: pos.x + nvx * dt, y: pos.y + nvy * dt },
    vel: { x: nvx, y: nvy },
  };
}

export function calcDamage(distance: number, blastRadius: number, maxDamage: number): number {
  if (blastRadius <= 0) return distance <= 0 ? maxDamage : 0;
  if (distance >= blastRadius) return 0;
  const falloff = 1 - distance / blastRadius;
  return Math.round(maxDamage * falloff);
}

export function raycastHit(
  terrain: Terrain,
  worms: Worm[],
  originX: number,
  originY: number,
  angle: number,
  maxRange: number,
): RaycastHit {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const step = 2;
  for (let d = 0; d <= maxRange; d += step) {
    const x = originX + dx * d;
    const y = originY + dy * d;
    const hitWorm = worms.find((w) => w.alive && Math.hypot(w.x - x, w.y - y) < 10);
    if (hitWorm) return { type: 'worm', worm: hitWorm, x, y, distance: d };
    if (isSolid(terrain, x, y)) return { type: 'terrain', x, y, distance: d };
  }
  return { type: 'none', x: originX + dx * maxRange, y: originY + dy * maxRange, distance: maxRange };
}
