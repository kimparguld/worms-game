import { isSolid } from './terrain.js';
import { WORM_HIT_RADIUS } from './constants.js';
import type { Terrain, WeaponDef, WeaponKey, Worm, RaycastHit, ProjectileIntegration, Vector2 } from './types.js';

// Weapons with a cap on total uses per team per match - absent keys mean no
// limit. Checked/decremented per-team in matchLoop.ts's stepMatch.
export const WEAPON_MATCH_LIMITS: Partial<Record<WeaponKey, number>> = {
  airstrikeRocket: 1,
  holyHandGrenade: 2,
  homingMissile: 2,
  clusterBomb: 2,
  steelStructure: 8,
};

export const WEAPONS: Record<WeaponKey, WeaponDef> = {
  bazooka: {
    key: 'bazooka',
    maxDamage: 80,
    // Wider than the crater so a near miss still hurts without carving
    // any more terrain.
    blastRadius: 55,
    craterRadius: 40,
    chargeable: true,
    minSpeed: 250,
    maxSpeed: 1200,
    gravity: true,
    windAffected: true,
    fuseTime: null,
    hitscan: false,
    pellets: 0,
    bounces: false,
    rope: false,
    airstrike: false,
    drill: false,
    melee: false,
    homing: false,
  },
  grenade: {
    key: 'grenade',
    maxDamage: 60,
    blastRadius: 65,
    craterRadius: 45,
    chargeable: true,
    minSpeed: 150,
    maxSpeed: 1200,
    gravity: true,
    windAffected: true,
    fuseTime: 3.5,
    hitscan: false,
    pellets: 0,
    bounces: true,
    rope: false,
    airstrike: false,
    drill: false,
    melee: false,
    homing: false,
  },
  shotgun: {
    key: 'shotgun',
    maxDamage: 85,
    blastRadius: 10,
    craterRadius: 10,
    chargeable: false,
    minSpeed: 0,
    maxSpeed: 0,
    gravity: false,
    windAffected: false,
    fuseTime: null,
    hitscan: true,
    pellets: 2,
    bounces: false,
    rope: false,
    airstrike: false,
    drill: false,
    melee: false,
    homing: false,
    range: 500,
  },
  ninjaRope: {
    key: 'ninjaRope',
    maxDamage: 0,
    blastRadius: 0,
    craterRadius: 0,
    chargeable: false,
    minSpeed: 500,
    maxSpeed: 500,
    gravity: false,
    windAffected: false,
    fuseTime: null,
    hitscan: false,
    pellets: 0,
    bounces: false,
    rope: true,
    airstrike: false,
    drill: false,
    melee: false,
    homing: false,
    range: 600,
  },
  dynamite: {
    key: 'dynamite',
    maxDamage: 85,
    blastRadius: 80,
    craterRadius: 70,
    chargeable: false,
    minSpeed: 0,
    maxSpeed: 0,
    gravity: true,
    windAffected: false,
    fuseTime: 3,
    hitscan: false,
    pellets: 0,
    bounces: false,
    rope: false,
    airstrike: false,
    drill: false,
    melee: false,
    homing: false,
  },
  sniperRifle: {
    key: 'sniperRifle',
    maxDamage: 85,
    blastRadius: 10,
    craterRadius: 10,
    chargeable: false,
    minSpeed: 0,
    maxSpeed: 0,
    gravity: false,
    windAffected: false,
    fuseTime: null,
    hitscan: true,
    pellets: 1,
    bounces: false,
    rope: false,
    airstrike: false,
    drill: false,
    melee: false,
    homing: false,
    range: 1400,
  },
  airstrikeRocket: {
    key: 'airstrikeRocket',
    maxDamage: 56,
    blastRadius: 60,
    craterRadius: 40,
    chargeable: false,
    minSpeed: 0,
    maxSpeed: 0,
    gravity: false,
    windAffected: false,
    fuseTime: null,
    hitscan: false,
    pellets: 0,
    bounces: false,
    rope: false,
    airstrike: true,
    drill: false,
    melee: false,
    homing: false,
  },
  holyHandGrenade: {
    key: 'holyHandGrenade',
    maxDamage: 135,
    blastRadius: 130,
    craterRadius: 130,
    chargeable: true,
    minSpeed: 150,
    maxSpeed: 1150,
    gravity: true,
    windAffected: true,
    fuseTime: 6,
    hitscan: false,
    pellets: 4,
    bounces: true,
    rope: false,
    airstrike: false,
    drill: false,
    melee: false,
    homing: false,
  },
  mine: {
    key: 'mine',
    maxDamage: 75,
    blastRadius: 55,
    craterRadius: 55,
    chargeable: false,
    minSpeed: 0,
    maxSpeed: 0,
    gravity: true,
    windAffected: false,
    fuseTime: 10,
    hitscan: false,
    pellets: 0,
    bounces: false,
    rope: false,
    airstrike: false,
    drill: false,
    melee: false,
    homing: false,
  },
  drill: {
    key: 'drill',
    maxDamage: 0,
    blastRadius: 0,
    craterRadius: 16,
    chargeable: false,
    minSpeed: 0,
    maxSpeed: 0,
    gravity: false,
    windAffected: false,
    fuseTime: null,
    hitscan: false,
    pellets: 0,
    bounces: false,
    rope: false,
    airstrike: false,
    drill: true,
    melee: false,
    homing: false,
    range: 120,
  },
  homingMissile: {
    key: 'homingMissile',
    maxDamage: 75,
    blastRadius: 65,
    craterRadius: 55,
    chargeable: true,
    minSpeed: 250,
    // Deliberately slower than the bazooka's 1100: paired with
    // HOMING_TURN_RATE it fixes the missile's minimum turn radius
    // (speed / turn rate) at ~72px, small enough that the missile can always
    // curve back onto a target at any realistic engagement range instead of
    // settling into a permanent orbit around it. See HOMING_TURN_RATE.
    maxSpeed: 1050,
    gravity: false,
    windAffected: false,
    fuseTime: null,
    hitscan: false,
    pellets: 0,
    bounces: false,
    rope: false,
    airstrike: false,
    drill: false,
    melee: false,
    homing: true,
    // Self-destructs after 6s in flight. No turn radius above zero can reach
    // a target closer than twice that radius off its nose, so a point-blank
    // shot can still circle rather than converge; this bounds that case (and
    // any other untested one) so an in-flight missile can never outlive its
    // turn - matchLoop's retirement path waits on rt.projectiles emptying.
    maxLifetime: 6,
  },
  clusterBomb: {
    key: 'clusterBomb',
    maxDamage: 15,
    blastRadius: 25,
    craterRadius: 25,
    chargeable: true,
    minSpeed: 150,
    maxSpeed: 950,
    gravity: true,
    windAffected: true,
    fuseTime: null,
    hitscan: false,
    pellets: 0,
    bounces: false,
    rope: false,
    airstrike: false,
    drill: false,
    melee: false,
    homing: false,
    clusterCount: 5,
  },
  clusterFragment: {
    key: 'clusterFragment',
    maxDamage: 19,
    blastRadius: 35,
    craterRadius: 20,
    chargeable: false,
    // Not used to compute launch speed (fragments get an explicit vx/vy at
    // spawn time, see explode() in projectile.ts) - kept nonzero only so
    // hasActiveStaticFuseProjectile's `minSpeed === 0 && maxSpeed === 0`
    // check in matchLoop.ts can't misclassify a fragment as a static-fuse
    // drop like the mine/dynamite.
    minSpeed: 150,
    maxSpeed: 350,
    gravity: true,
    windAffected: true,
    fuseTime: 1.1,
    hitscan: false,
    pellets: 0,
    bounces: false,
    rope: false,
    airstrike: false,
    drill: false,
    melee: false,
    homing: false,
  },
  bat: {
    key: 'bat',
    maxDamage: 40,
    blastRadius: 0,
    craterRadius: 0,
    chargeable: false,
    minSpeed: 0,
    maxSpeed: 0,
    gravity: false,
    windAffected: false,
    fuseTime: null,
    hitscan: false,
    pellets: 0,
    bounces: false,
    rope: false,
    airstrike: false,
    drill: false,
    melee: true,
    homing: false,
    range: 55,
  },
  steelStructure: {
    key: 'steelStructure',
    maxDamage: 0,
    blastRadius: 0,
    craterRadius: 0,
    chargeable: false,
    minSpeed: 0,
    maxSpeed: 0,
    gravity: false,
    windAffected: false,
    fuseTime: null,
    hitscan: false,
    pellets: 0,
    bounces: false,
    rope: false,
    airstrike: false,
    drill: false,
    melee: false,
    homing: false,
    structure: true,
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

// rad/s. Sized against homingMissile.maxSpeed, not for turn speed's own sake:
// a guided projectile's minimum turn radius is speed / turn rate, and it can
// never reach a target sitting inside that circle, so too slow a turn rate
// makes the missile orbit its target forever instead of hitting it. At
// 450px/s this gives a ~72px radius - well under any realistic engagement
// distance - while a full 360deg/s turn still reads as a missile curving
// onto its target rather than snapping to it instantly.
export const HOMING_TURN_RATE = Math.PI * 2;

export function applyHoming(vel: Vector2, pos: Vector2, target: Vector2, dt: number): Vector2 {
  const currentAngle = Math.atan2(vel.y, vel.x);
  const desiredAngle = Math.atan2(target.y - pos.y, target.x - pos.x);
  let delta = desiredAngle - currentAngle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const maxStep = HOMING_TURN_RATE * dt;
  const turn = Math.max(-maxStep, Math.min(maxStep, delta));
  const newAngle = currentAngle + turn;
  const speed = Math.hypot(vel.x, vel.y);
  return { x: Math.cos(newAngle) * speed, y: Math.sin(newAngle) * speed };
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
  excludeWorm?: Worm,
): RaycastHit {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const step = 2;
  for (let d = 0; d <= maxRange; d += step) {
    const x = originX + dx * d;
    const y = originY + dy * d;
    const hitWorm = worms.find(
      (w) => w.alive && !w.dying && w !== excludeWorm && Math.hypot(w.x - x, w.y - y) < WORM_HIT_RADIUS,
    );
    if (hitWorm) return { type: 'worm', worm: hitWorm, x, y, distance: d };
    if (isSolid(terrain, x, y)) return { type: 'terrain', x, y, distance: d };
  }
  return { type: 'none', x: originX + dx * maxRange, y: originY + dy * maxRange, distance: maxRange };
}
