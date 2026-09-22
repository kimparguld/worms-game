import { integrateProjectile, calcDamage, WEAPONS, applyHoming } from './weapons.js';
import { isSolid, carveCircle } from './terrain.js';
import { takeDamage, applyExplosionKnockback } from './worm.js';
import { GRAVITY, WORM_HIT_RADIUS } from './constants.js';
import type { Terrain, Worm, WeaponDef, WeaponKey, Projectile, ProjectileUpdateResult, Vector2 } from './types.js';

export function createProjectile(
  weaponKey: WeaponKey,
  x: number,
  y: number,
  angle: number,
  power: number,
  owner?: Worm,
): Projectile {
  const def = WEAPONS[weaponKey];
  const speed = def.minSpeed + (def.maxSpeed - def.minSpeed) * power;
  return {
    weaponKey,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    fuseRemaining: def.fuseTime,
    lifetimeRemaining: def.maxLifetime ?? null,
    alive: true,
    owner,
  };
}

// How close (px) a homing missile must pass to its player-picked target
// point to detonate there - same as a direct worm hit.
const HOMING_TARGET_HIT_RADIUS = 10;

function distanceToSegment(point: Vector2, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / lengthSq));
  return Math.hypot(point.x - (ax + dx * t), point.y - (ay + dy * t));
}

type PathCollision =
  | { type: 'terrain'; x: number; y: number; safeX: number; safeY: number }
  | { type: 'worm'; worm: Worm; x: number; y: number; safeX: number; safeY: number }
  | null;

function findPathCollision(
  terrain: Terrain,
  worms: Worm[],
  projectile: Projectile,
  startX: number,
  startY: number,
): PathCollision {
  const distanceX = projectile.x - startX;
  const distanceY = projectile.y - startY;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(distanceX), Math.abs(distanceY))));
  let safeX = startX;
  let safeY = startY;

  for (let step = 1; step <= steps; step++) {
    const fraction = step / steps;
    const x = startX + distanceX * fraction;
    const y = startY + distanceY * fraction;
    const worm = worms.find(
      (candidate) =>
        candidate.alive &&
        !candidate.dying &&
        candidate !== projectile.owner &&
        Math.hypot(candidate.x - x, candidate.y - y) < WORM_HIT_RADIUS,
    );
    if (worm) return { type: 'worm', worm, x, y, safeX, safeY };
    if (isSolid(terrain, x, y)) return { type: 'terrain', x, y, safeX, safeY };
    safeX = x;
    safeY = y;
  }

  return null;
}

export function updateProjectile(
  projectile: Projectile,
  terrain: Terrain,
  worms: Worm[],
  wind: number,
  dt: number,
): ProjectileUpdateResult {
  if (!projectile.alive) return { exploded: false };
  const def = WEAPONS[projectile.weaponKey];
  const isFuseBased = def.fuseTime != null;

  if (isFuseBased && projectile.fuseRemaining != null) {
    projectile.fuseRemaining -= dt;
  }

  if (projectile.lifetimeRemaining != null) {
    projectile.lifetimeRemaining -= dt;
  }

  const prevX = projectile.x;
  const prevY = projectile.y;

  if (def.homing && projectile.owner) {
    let target: Vector2 | undefined = projectile.target;
    if (!target) {
      let bestDistance = Infinity;
      for (const w of worms) {
        if (!w.alive || w.dying || w.team === projectile.owner.team) continue;
        const distance = Math.hypot(w.x - projectile.x, w.y - projectile.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          target = { x: w.x, y: w.y };
        }
      }
    }
    if (target) {
      const steered = applyHoming(
        { x: projectile.vx, y: projectile.vy },
        { x: projectile.x, y: projectile.y },
        target,
        dt,
      );
      projectile.vx = steered.x;
      projectile.vy = steered.y;
    }
  }

  const gravity = def.gravity ? GRAVITY : 0;
  const windAccel = def.windAffected ? wind : 0;
  const { pos, vel } = integrateProjectile(
    { x: projectile.x, y: projectile.y },
    { x: projectile.vx, y: projectile.vy },
    gravity,
    windAccel,
    dt,
  );
  projectile.x = pos.x;
  projectile.y = pos.y;
  projectile.vx = vel.x;
  projectile.vy = vel.y;

  // A shot that flies off the side or bottom of the map would otherwise
  // never trigger hitTerrain (isSolid is false out of bounds) and would
  // stall the turn until the 45s turn timer rescues it. No ceiling on -y:
  // a lobbed shot must be allowed to arc above the screen and come back.
  const OUT_OF_BOUNDS_MARGIN = 200;
  if (
    projectile.x < -OUT_OF_BOUNDS_MARGIN ||
    projectile.x > terrain.width + OUT_OF_BOUNDS_MARGIN ||
    projectile.y > terrain.height + OUT_OF_BOUNDS_MARGIN
  ) {
    projectile.alive = false;
    return { exploded: false };
  }

  const fuseExpired = isFuseBased && projectile.fuseRemaining != null && projectile.fuseRemaining <= 0;
  const collision = findPathCollision(terrain, worms, projectile, prevX, prevY);
  const hitTerrain = collision?.type === 'terrain';
  const hitWorm = collision?.type === 'worm' ? collision.worm : undefined;
  if (collision) {
    projectile.x = collision.x;
    projectile.y = collision.y;
  }

  // Termination backstop (see WeaponDef.maxLifetime): a projectile that has
  // used up its flight time detonates where it is, whatever else is going on.
  // Checked ahead of the fuse branch so it can't be starved by a weapon that
  // is fuse-based too, and skipped entirely (lifetimeRemaining === null) for
  // every weapon that doesn't set maxLifetime.
  // A player-picked homing target may be open air, which the missile would
  // otherwise circle until its lifetime ran out - reaching it counts as a hit.
  // Measured against this tick's whole path, not just its end point, since a
  // slow frame can carry the missile past the point in a single step.
  const reachedTarget =
    projectile.target != null &&
    distanceToSegment(projectile.target, prevX, prevY, projectile.x, projectile.y) <= HOMING_TARGET_HIT_RADIUS;
  if (reachedTarget || (projectile.lifetimeRemaining != null && projectile.lifetimeRemaining <= 0)) {
    const spawned = explode(projectile, terrain, worms, def);
    return { exploded: true, spawned };
  }

  if (isFuseBased) {
    if (hitWorm) {
      const spawned = explode(projectile, terrain, worms, def);
      return { exploded: true, spawned };
    }
    if (hitTerrain) {
      projectile.x = collision.safeX;
      projectile.y = collision.safeY;
      if (def.bounces) {
        // Retains more energy per bounce than a "dead" 0.5/0.5 would, so a
        // grenade visibly hops and rolls a few times before its fuse runs
        // out instead of thudding to a stop after one bounce.
        projectile.vy = -projectile.vy * 0.65;
        projectile.vx = projectile.vx * 0.75;
      } else {
        projectile.vx = 0;
        projectile.vy = 0;
      }
    }
    if (fuseExpired) {
      const spawned = explode(projectile, terrain, worms, def);
      return { exploded: true, spawned };
    }
    return { exploded: false };
  }

  if (hitTerrain || hitWorm) {
    const spawned = explode(projectile, terrain, worms, def);
    return { exploded: true, spawned };
  }
  return { exploded: false };
}

const CLUSTER_FRAGMENT_MIN_SPEED = 150;
const CLUSTER_FRAGMENT_MAX_SPEED = 350;

function explode(projectile: Projectile, terrain: Terrain, worms: Worm[], def: WeaponDef): Projectile[] {
  projectile.alive = false;
  if (def.craterRadius > 0) {
    carveCircle(terrain, projectile.x, projectile.y, def.craterRadius);
  }
  for (const worm of worms) {
    if (!worm.alive) continue;
    const distance = Math.hypot(worm.x - projectile.x, worm.y - projectile.y);
    const damage = calcDamage(distance, def.blastRadius, def.maxDamage);
    if (damage > 0) {
      takeDamage(worm, damage);
      applyExplosionKnockback(worm, damage);
    }
  }
  if (!def.clusterCount) return [];
  const fragments: Projectile[] = [];
  for (let i = 0; i < def.clusterCount; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI; // upward-biased spread
    const speed = CLUSTER_FRAGMENT_MIN_SPEED + Math.random() * (CLUSTER_FRAGMENT_MAX_SPEED - CLUSTER_FRAGMENT_MIN_SPEED);
    fragments.push({
      weaponKey: 'clusterFragment',
      x: projectile.x,
      y: projectile.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      fuseRemaining: WEAPONS.clusterFragment.fuseTime,
      lifetimeRemaining: WEAPONS.clusterFragment.maxLifetime ?? null,
      alive: true,
      owner: projectile.owner,
    });
  }
  return fragments;
}
