import { findSurfaceY, createTerrain, waterLevelY, SPAWN_EXCLUSION_FRACTIONS, carveCircle } from './terrain.js';
import { createWorm, updateWormPhysics, adjustAim, takeDamage, tickDeathAnimation } from './worm.js';
import { createMatch, currentWorm, advanceTurn, tickTurnTimer } from './game.js';
import { createProjectile, updateProjectile } from './projectile.js';
import { calcDamage, raycastHit, WEAPONS } from './weapons.js';
import { fireRope, updateRopeSwing, adjustRopeLength } from './rope.js';
import {
  TURN_BANNER_DURATION_MS,
  ROPE_HOP_IMPULSE,
  SHOTGUN_TRACER_DURATION,
  EXPLOSION_EFFECT_DURATION,
  SPLASH_EFFECT_DURATION,
  DEFAULT_WORM_NAMES,
} from './constants.js';
import type { Worm, WormInput, Team, WeaponKey, InputState, MatchRuntime, Vector2 } from './types.js';

export const WEAPON_KEYS: WeaponKey[] = [
  'bazooka',
  'grenade',
  'shotgun',
  'ninjaRope',
  'dynamite',
  'sniperRifle',
  'airstrikeRocket',
  'holyHandGrenade',
  'mine',
  'drill',
];
// px above the actual terrain surface, so worms fall a small, consistent distance
const SPAWN_SURFACE_BUFFER = 20;
const AIRSTRIKE_STRIKE_COUNT = 5;
const AIRSTRIKE_EDGE_MARGIN = 40;

export function createMatchRuntime(
  width: number,
  height: number,
  team1Name = 'Team 1',
  team2Name = 'Team 2',
  wormNames: [string, string, string, string] = DEFAULT_WORM_NAMES,
): MatchRuntime {
  const terrain = createTerrain(width, height);
  const spawnY = (x: number) => findSurfaceY(terrain, x) - SPAWN_SURFACE_BUFFER;
  // Spawn columns scale with width via the same fractions terrain.ts keeps
  // cliffs/buildings/lakes clear of - see SPAWN_EXCLUSION_FRACTIONS.
  const [p1aX, p1bX, p2aX, p2bX] = SPAWN_EXCLUSION_FRACTIONS.map((f) => Math.round(f * width));
  const teams: Team[] = [
    {
      playerId: 'p1',
      name: team1Name,
      worms: [createWorm(p1aX, spawnY(p1aX), 'p1', wormNames[0]), createWorm(p1bX, spawnY(p1bX), 'p1', wormNames[1])],
    },
    {
      playerId: 'p2',
      name: team2Name,
      worms: [createWorm(p2aX, spawnY(p2aX), 'p2', wormNames[2]), createWorm(p2bX, spawnY(p2bX), 'p2', wormNames[3])],
    },
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
    gravestones: [],
    shotgunTracer: null,
    explosions: [],
    splashes: [],
  };
}

function allWorms(rt: MatchRuntime): Worm[] {
  return rt.teams.flatMap((t) => t.worms);
}

function detonateAt(rt: MatchRuntime, weaponKey: WeaponKey, x: number, y: number): void {
  const def = WEAPONS[weaponKey];
  if (def.craterRadius > 0) carveCircle(rt.terrain, x, y, def.craterRadius);
  for (const target of allWorms(rt)) {
    if (!target.alive || target.dying) continue;
    const damage = calcDamage(Math.hypot(target.x - x, target.y - y), def.blastRadius, def.maxDamage);
    if (damage > 0) takeDamage(target, damage);
  }
  rt.explosions.push({ x, y, radius: def.craterRadius, timer: EXPLOSION_EFFECT_DURATION });
  rt.retirementTimer = 1;
}

function drillTerrain(rt: MatchRuntime, worm: Worm, angle: number, range: number, radius: number): void {
  const step = Math.max(4, radius * 0.7);
  for (let distance = radius; distance <= range; distance += step) {
    carveCircle(rt.terrain, worm.x + Math.cos(angle) * distance, worm.y + Math.sin(angle) * distance, radius);
  }
  rt.explosions.push({
    x: worm.x + Math.cos(angle) * range,
    y: worm.y + Math.sin(angle) * range,
    radius,
    timer: EXPLOSION_EFFECT_DURATION,
  });
  rt.retirementTimer = 1;
}

function rainAirstrike(rt: MatchRuntime, weaponKey: WeaponKey): void {
  const margin = Math.min(AIRSTRIKE_EDGE_MARGIN, rt.terrain.width / 4);
  const usableWidth = Math.max(1, rt.terrain.width - margin * 2);
  for (let i = 0; i < AIRSTRIKE_STRIKE_COUNT; i++) {
    const x = margin + Math.random() * usableWidth;
    const y = findSurfaceY(rt.terrain, x);
    detonateAt(rt, weaponKey, x, y);
  }
  rt.retirementTimer = 1.2;
}

function fireWeapon(rt: MatchRuntime, worm: Worm, weaponKey: WeaponKey, power: number): void {
  const fireAngle = worm.facing === 1 ? worm.aimAngle : Math.PI - worm.aimAngle;
  const def = WEAPONS[weaponKey];

  if (def.airstrike) {
    rainAirstrike(rt, weaponKey);
  } else if (def.drill) {
    drillTerrain(rt, worm, fireAngle, def.range ?? 120, def.craterRadius);
  } else if (def.hitscan) {
    const hits: Vector2[] = [];
    for (let i = 0; i < def.pellets; i++) {
      // Non-null: every hitscan weapon (shotgun, sniperRifle) defines
      // `range` - the '?' on WeaponDef.range exists only because
      // non-hitscan, non-rope weapons omit it.
      const hit = raycastHit(rt.terrain, allWorms(rt), worm.x, worm.y, fireAngle, def.range!, worm);
      if (hit.type === 'worm' && hit.worm) takeDamage(hit.worm, def.maxDamage);
      hits.push({ x: hit.x, y: hit.y });
    }
    // Reused for any hitscan weapon (not just the shotgun) as the visible
    // trace of an instant raycast shot - see the ShotgunTracer type.
    rt.shotgunTracer = { originX: worm.x, originY: worm.y, hits, timer: SHOTGUN_TRACER_DURATION };
    rt.retirementTimer = 1;
  } else if (def.rope) {
    // Non-null: every rope weapon defines `range` as its cast distance.
    const result = fireRope(worm.x, worm.y, fireAngle, rt.terrain, def.range!);
    rt.rope = result.attached ? result : null;
    // A grounded worm's very next physics tick would otherwise re-plant it
    // on the ground before the swing can take over - a small upward nudge
    // lifts it clear so updateRopeSwing actually gets to run the swing.
    if (result.attached) worm.vy -= ROPE_HOP_IMPULSE;
  } else {
    rt.projectiles.push(createProjectile(weaponKey, worm.x, worm.y, fireAngle, power, worm));
    rt.retirementTimer = 2;
  }
}

function hasActiveStaticFuseProjectile(rt: MatchRuntime, worm: Worm): boolean {
  return rt.projectiles.some((projectile) => {
    const weapon = WEAPONS[projectile.weaponKey];
    return (
      projectile.alive &&
      projectile.owner === worm &&
      weapon.fuseTime !== null &&
      weapon.minSpeed === 0 &&
      weapon.maxSpeed === 0
    );
  });
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
  const canAct = worm.alive && !worm.dying;

  // A dead or dying active worm can no longer swing on the rope, aim, or
  // fire for the rest of its turn - only physics (already a no-op for dead
  // worms) and turn timers keep running until the turn actually advances.
  if (canAct) {
    // Apply rope-swing logic only to the active worm when rope is attached
    if (rt.rope) {
      updateRopeSwing(worm, rt.rope, dt, rt.terrain);
      if (input.jump) rt.rope = null;
    }
  }

  // Apply physics to all worms: real input for active worm, neutral input for others.
  // Most committed shots lock movement while they resolve. Static fuse
  // weapons are the exception: once dropped, the shooter gets a short retreat
  // window while the fuse burns, but retirementTimer still prevents firing
  // a second weapon in the same turn.
  const neutralInput: WormInput = { left: false, right: false, jump: false };
  const isRetiring = rt.retirementTimer !== null;
  const canRetreatFromStaticFuse = isRetiring && hasActiveStaticFuseProjectile(rt, worm);
  let activeWormDiedInWater = false;
  for (const w of allWorms(rt)) {
    const wormInput = w === worm && (!isRetiring || canRetreatFromStaticFuse) ? input : neutralInput;
    const wasAlive = w.alive;
    updateWormPhysics(w, rt.terrain, wormInput, dt);
    // alive flipping straight to false (skipping the dying/wiggle state) only
    // happens on water contact - takeDamage-driven deaths always pass through
    // `dying` first, so this cleanly identifies a water death.
    if (wasAlive && !w.alive) {
      rt.splashes.push({ x: w.x, y: waterLevelY(rt.terrain), timer: SPLASH_EFFECT_DURATION });
      if (w === worm) activeWormDiedInWater = true;
    }
    if (tickDeathAnimation(w, dt * 1000)) {
      rt.gravestones.push({ x: w.x, y: w.y });
    }
  }

  if (canAct && worm.alive && !worm.dying && !activeWormDiedInWater) {
    // While swinging on the rope, up/down arrows reel it in/out instead of
    // aiming - aiming is meaningless mid-swing since fireAngle isn't used
    // for anything until the rope is released.
    if (rt.rope) {
      if (input.aimUp) adjustRopeLength(rt.rope, -1, dt);
      if (input.aimDown) adjustRopeLength(rt.rope, 1, dt);
    } else {
      if (input.aimUp) adjustAim(worm, -1, dt);
      if (input.aimDown) adjustAim(worm, 1, dt);
    }

    // A shot already fired this turn is waiting to resolve (retirementTimer
    // set) - without this guard, firing again here (e.g. a held-down fire
    // key re-triggering the charge branch) pushes a second projectile and
    // resets retirementTimer, which can repeatedly postpone the turn ending
    // until the 45s turn timer finally rescues it.
    if (rt.retirementTimer === null) {
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
  }

  rt.projectiles = rt.projectiles.filter((p) => p.alive);
  for (const p of rt.projectiles) {
    const result = updateProjectile(p, rt.terrain, allWorms(rt), rt.match.wind, dt);
    if (result.exploded) {
      rt.explosions.push({
        x: p.x,
        y: p.y,
        radius: WEAPONS[p.weaponKey].craterRadius,
        timer: EXPLOSION_EFFECT_DURATION,
      });
    }
  }

  if (rt.shotgunTracer) {
    rt.shotgunTracer.timer -= dt;
    if (rt.shotgunTracer.timer <= 0) rt.shotgunTracer = null;
  }

  for (const e of rt.explosions) e.timer -= dt;
  rt.explosions = rt.explosions.filter((e) => e.timer > 0);
  for (const s of rt.splashes) s.timer -= dt;
  rt.splashes = rt.splashes.filter((s) => s.timer > 0);

  // Tracks whether the turn advanced through ANY of the three paths below,
  // captured explicitly (not inferred from currentIndex) so every path's
  // in-flight state - charge, rope, retirement - gets cleared uniformly,
  // including the retirement path's own advance, which used to be missed.
  let turnAdvanced = false;

  if (activeWormDiedInWater && advanceTurn(rt.match)) {
    input.firing = false;
    input.jump = false;
    turnAdvanced = true;
  }

  if (!turnAdvanced && rt.retirementTimer !== null) {
    rt.retirementTimer -= dt;
    // Also wait for any in-flight explosion's visual to finish, not just for
    // the projectile itself to be gone - otherwise the turn (and the next
    // worm's turn banner) can cut in while the blast is still on screen.
    if (rt.retirementTimer <= 0 && rt.projectiles.length === 0 && rt.explosions.length === 0) {
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
    rt.shotgunTracer = null;
  }
}
