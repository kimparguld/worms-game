import { integrateProjectile, calcDamage, WEAPONS } from './weapons.js';
import { isSolid, carveCircle } from './terrain.js';
import { takeDamage } from './worm.js';
import { GRAVITY } from './constants.js';

export function createProjectile(weaponKey, x, y, angle, power) {
  const def = WEAPONS[weaponKey];
  const speed = def.minSpeed + (def.maxSpeed - def.minSpeed) * power;
  return {
    weaponKey,
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    fuseRemaining: def.fuseTime,
    alive: true,
  };
}

export function updateProjectile(projectile, terrain, worms, wind, dt) {
  if (!projectile.alive) return { exploded: false };
  const def = WEAPONS[projectile.weaponKey];
  const isFuseBased = def.fuseTime != null;

  if (isFuseBased) projectile.fuseRemaining -= dt;

  const prevX = projectile.x;
  const prevY = projectile.y;

  const gravity = def.gravity ? GRAVITY : 0;
  const windAccel = def.windAffected ? wind : 0;
  const { pos, vel } = integrateProjectile(
    { x: projectile.x, y: projectile.y },
    { x: projectile.vx, y: projectile.vy },
    gravity, windAccel, dt
  );
  projectile.x = pos.x;
  projectile.y = pos.y;
  projectile.vx = vel.x;
  projectile.vy = vel.y;

  const fuseExpired = isFuseBased && projectile.fuseRemaining <= 0;
  const hitTerrain = isSolid(terrain, projectile.x, projectile.y);

  if (isFuseBased) {
    if (hitTerrain) {
      projectile.x = prevX;
      projectile.y = prevY;
      if (def.bounces) {
        projectile.vy = -projectile.vy * 0.5;
        projectile.vx = projectile.vx * 0.5;
      } else {
        projectile.vx = 0;
        projectile.vy = 0;
      }
    }
    if (fuseExpired) {
      explode(projectile, terrain, worms, def);
      return { exploded: true };
    }
    return { exploded: false };
  }

  if (hitTerrain) {
    explode(projectile, terrain, worms, def);
    return { exploded: true };
  }
  return { exploded: false };
}

function explode(projectile, terrain, worms, def) {
  projectile.alive = false;
  if (def.craterRadius > 0) {
    carveCircle(terrain, projectile.x, projectile.y, def.craterRadius);
  }
  for (const worm of worms) {
    if (!worm.alive) continue;
    const distance = Math.hypot(worm.x - projectile.x, worm.y - projectile.y);
    const damage = calcDamage(distance, def.blastRadius, def.maxDamage);
    if (damage > 0) takeDamage(worm, damage);
  }
}
