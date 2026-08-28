import { findSurfaceY, createTerrain } from './terrain.js';
import { createWorm, updateWormPhysics, adjustAim, takeDamage } from './worm.js';
import { createMatch, currentWorm, advanceTurn, tickTurnTimer } from './game.js';
import { createProjectile, updateProjectile } from './projectile.js';
import { raycastHit, WEAPONS } from './weapons.js';
import { fireRope, updateRopeSwing } from './rope.js';
import { TURN_BANNER_DURATION_MS } from './constants.js';
import type { Worm, WormInput, Team, WeaponKey, InputState, MatchRuntime } from './types.js';

export const WEAPON_KEYS: WeaponKey[] = ['bazooka', 'grenade', 'shotgun', 'ninjaRope', 'dynamite'];
// px above the actual terrain surface, so worms fall a small, consistent distance
const SPAWN_SURFACE_BUFFER = 20;

export function createMatchRuntime(width: number, height: number): MatchRuntime {
  const terrain = createTerrain(width, height);
  const spawnY = (x: number) => findSurfaceY(terrain, x) - SPAWN_SURFACE_BUFFER;
  const teams: Team[] = [
    { playerId: 'p1', worms: [createWorm(150, spawnY(150), 'p1', 'W1'), createWorm(200, spawnY(200), 'p1', 'W2')] },
    { playerId: 'p2', worms: [createWorm(760, spawnY(760), 'p2', 'W3'), createWorm(810, spawnY(810), 'p2', 'W4')] },
  ];
  return {
    terrain,
    teams,
    match: createMatch(teams),
    projectiles: [],
    rope: null,
    charging: false,
    chargePower: 0,
    retirementTimer: null,
    turnBannerTimer: TURN_BANNER_DURATION_MS,
  };
}

function allWorms(rt: MatchRuntime): Worm[] {
  return rt.teams.flatMap((t) => t.worms);
}

function fireWeapon(rt: MatchRuntime, worm: Worm, weaponKey: WeaponKey, power: number): void {
  const fireAngle = worm.facing === 1 ? worm.aimAngle : Math.PI - worm.aimAngle;

  if (weaponKey === 'shotgun') {
    for (let i = 0; i < WEAPONS.shotgun.pellets; i++) {
      // Non-null: shotgun's range is always defined (see WEAPONS.shotgun
      // above); the '?' on WeaponDef.range exists only because other
      // weapons omit it.
      const hit = raycastHit(rt.terrain, allWorms(rt), worm.x, worm.y, fireAngle, WEAPONS.shotgun.range!, worm);
      if (hit.type === 'worm' && hit.worm) takeDamage(hit.worm, WEAPONS.shotgun.maxDamage);
    }
    rt.retirementTimer = 1;
  } else if (weaponKey === 'ninjaRope') {
    const result = fireRope(worm.x, worm.y, fireAngle, rt.terrain, 300);
    rt.rope = result.attached ? result : null;
  } else {
    rt.projectiles.push(createProjectile(weaponKey, worm.x, worm.y, fireAngle, power));
    rt.retirementTimer = 2;
  }
}

export function stepMatch(rt: MatchRuntime, input: InputState, dt: number): void {
  // While the turn banner is showing, freeze everything else - the new
  // player shouldn't be able to act until it's gone.
  if (rt.turnBannerTimer !== null) {
    rt.turnBannerTimer -= dt * 1000;
    if (rt.turnBannerTimer <= 0) rt.turnBannerTimer = null;
    input.endTurnRequested = false; // don't let a keypress during the banner leak into the new turn
    return;
  }

  const active = currentWorm(rt.match);
  const worm = active.worm;
  const weaponKey = WEAPON_KEYS[input.selectedWeapon - 1] ?? 'bazooka';

  // A dead active worm can no longer swing on the rope, aim, or fire for
  // the rest of its turn - only physics (already a no-op for dead worms)
  // and turn timers keep running until the turn actually advances.
  if (worm.alive) {
    // Apply rope-swing logic only to the active worm when rope is attached
    if (rt.rope) {
      updateRopeSwing(worm, rt.rope, dt);
      if (input.jump) rt.rope = null;
    }
  }

  // Apply physics to all worms: real input for active worm, neutral input for others
  const neutralInput: WormInput = { left: false, right: false, jump: false };
  for (const w of allWorms(rt)) {
    const wormInput = w === worm ? input : neutralInput;
    updateWormPhysics(w, rt.terrain, wormInput, dt);
  }

  if (worm.alive) {
    if (input.aimUp) adjustAim(worm, -1, dt);
    if (input.aimDown) adjustAim(worm, 1, dt);

    const chargeableWeapon = WEAPONS[weaponKey].chargeable;
    if (input.firing && chargeableWeapon) {
      rt.charging = true;
      rt.chargePower = Math.min(1, rt.chargePower + dt);
    } else if (rt.charging) {
      fireWeapon(rt, worm, weaponKey, rt.chargePower);
      rt.charging = false;
      rt.chargePower = 0;
    } else if (input.firing && !chargeableWeapon) {
      fireWeapon(rt, worm, weaponKey, 1);
      input.firing = false;
    }
  }

  rt.projectiles = rt.projectiles.filter((p) => p.alive);
  for (const p of rt.projectiles) {
    updateProjectile(p, rt.terrain, allWorms(rt), rt.match.wind, dt);
  }

  // Tracks whether the turn advanced through ANY of the three paths below,
  // captured explicitly (not inferred from currentIndex) so every path's
  // in-flight state - charge, rope, retirement - gets cleared uniformly,
  // including the retirement path's own advance, which used to be missed.
  let turnAdvanced = false;

  if (rt.retirementTimer !== null) {
    rt.retirementTimer -= dt;
    if (rt.retirementTimer <= 0 && rt.projectiles.length === 0) {
      advanceTurn(rt.match);
      turnAdvanced = true;
    }
  }

  if (!turnAdvanced && tickTurnTimer(rt.match, dt * 1000)) {
    turnAdvanced = true;
  }

  if (input.endTurnRequested) {
    if (!turnAdvanced && advanceTurn(rt.match)) {
      turnAdvanced = true;
    }
    input.endTurnRequested = false;
  }

  // Whichever path ended the turn, in-flight state belonged to the
  // previous worm and must not bleed into the new one.
  if (turnAdvanced) {
    rt.retirementTimer = null;
    rt.charging = false;
    rt.chargePower = 0;
    rt.rope = null;
    rt.turnBannerTimer = TURN_BANNER_DURATION_MS;
  }
}
