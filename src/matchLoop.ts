import { findSurfaceY, createTerrain, waterLevelY, carveCircle, isSolid } from './terrain.js';
import {
  createWorm,
  updateWormPhysics,
  adjustAim,
  takeDamage,
  tickDeathAnimation,
  applyExplosionKnockback,
  applyDirectionalKnockback,
} from './worm.js';
import { createMatch, currentWorm, advanceTurn, tickTurnTimer } from './game.js';
import { createProjectile, updateProjectile } from './projectile.js';
import { calcDamage, raycastHit, WEAPONS, WEAPON_MATCH_LIMITS } from './weapons.js';
import { fireRope, updateRopeSwing, adjustRopeLength } from './rope.js';
import { createStructure, isStructurePlacementValid, stampStructure, structureRotation } from './structures.js';
import {
  TURN_BANNER_DURATION_MS,
  ROPE_HOP_IMPULSE,
  SHOTGUN_TRACER_DURATION,
  EXPLOSION_EFFECT_DURATION,
  SPLASH_EFFECT_DURATION,
  MIN_TEAMS,
  WORMS_PER_TEAM,
  TURN_DURATION_MS,
  defaultTeamName,
  defaultWormName,
  DEATH_EXPLOSION_RADIUS,
  DEATH_EXPLOSION_DAMAGE,
  GRAVITY,
  STARTING_HP,
  MELEE_KNOCKBACK_SPEED,
  MELEE_KNOCKBACK_LIFT,
  MELEE_KNOCKBACK_DURATION,
} from './constants.js';
import type { Worm, WormInput, Team, WeaponKey, InputState, MatchRuntime, MatchSetup, Vector2, Crate, Explosion, Projectile } from './types.js';

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
  'homingMissile',
  'clusterBomb',
  'bat',
  'steelStructure',
];

export function cycleWeapon(current: number, delta: number): number {
  const max = WEAPON_KEYS.length;
  return ((current - 1 + delta + max) % max) + 1;
}

// px above the actual terrain surface, so worms fall a small, consistent distance
const SPAWN_SURFACE_BUFFER = 20;
const AIRSTRIKE_STRIKE_COUNT = 5;
const AIRSTRIKE_EDGE_MARGIN = 40;
// A health crate parachutes in every 4th turn (see spawnCrateIfDue), as long
// as the previous one is still uncollected - turnsSinceCrateEvent keeps
// climbing past the threshold in that case, so the next spawn simply waits
// for the map to clear instead of ever stacking a second crate.
const CRATE_SPAWN_INTERVAL_TURNS = 4;
const CRATE_HEAL_AMOUNT = 25;
const CRATE_PICKUP_RADIUS = 24; // px - distance from a worm's center that counts as reaching the crate
const CRATE_EDGE_MARGIN = 60; // keep the spawn x away from the world's edges
const CRATE_FALL_START_Y = -20; // spawns above the visible world and falls in, regardless of terrain height at that x

// The match every setting left at its default produces: MIN_TEAMS teams of
// WORMS_PER_TEAM worms, default names, STARTING_HP, TURN_DURATION_MS.
export function defaultMatchSetup(): MatchSetup {
  return {
    teams: Array.from({ length: MIN_TEAMS }, (_, t) => ({
      name: defaultTeamName(t),
      wormNames: Array.from({ length: WORMS_PER_TEAM }, (_, w) => defaultWormName(t, w)),
    })),
    startingHp: STARTING_HP,
    turnDurationMs: TURN_DURATION_MS,
  };
}

export function createMatchRuntime(width: number, height: number, setup: MatchSetup = defaultMatchSetup()): MatchRuntime {
  const wormCount = setup.teams.reduce((sum, t) => sum + t.wormNames.length, 0);
  const terrain = createTerrain(width, height, wormCount);
  const spawnY = (x: number) => findSurfaceY(terrain, x) - SPAWN_SURFACE_BUFFER;
  // Spawn columns are whatever random fractions this terrain's own
  // generation picked and kept its branches/buildings/lakes/islands clear of -
  // see terrain.ts's pickSpawnFractions - so worms and terrain always agree
  // on where it's safe to land, even though it's a different set every match.
  // Already shuffled there, so handing them out in order still mixes teams.
  const spawnXs = terrain.spawnFractions.map((f) => Math.round(f * width));
  let nextSpawn = 0;
  const teams: Team[] = setup.teams.map((teamSetup, t) => {
    const playerId = `p${t + 1}`;
    return {
      playerId,
      name: teamSetup.name,
      worms: teamSetup.wormNames.map((wormName) => {
        const x = spawnXs[nextSpawn++];
        return createWorm(x, spawnY(x), playerId, wormName, setup.startingHp);
      }),
      ammo: { ...WEAPON_MATCH_LIMITS },
    };
  });
  return {
    terrain,
    teams,
    match: createMatch(teams, setup.turnDurationMs),
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
    crates: [],
    cratePickups: [],
    turnsSinceCrateEvent: 0,
    homingTarget: null,
    structures: [],
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
    if (damage > 0) {
      takeDamage(target, damage);
      applyExplosionKnockback(target, damage);
    }
  }
  rt.explosions.push({ x, y, radius: def.craterRadius, timer: EXPLOSION_EFFECT_DURATION });
  rt.retirementTimer = 1;
}

// A dying worm goes out with a blast of its own - worms crowded around a
// kill are at risk, same as standing too close to any other explosive. No
// crater (death isn't terrain-destroying), just damage, knockback, and the
// same fireball visual every other blast uses.
function detonateDeath(rt: MatchRuntime, deadWorm: Worm): void {
  for (const target of allWorms(rt)) {
    if (!target.alive || target.dying) continue;
    const damage = calcDamage(
      Math.hypot(target.x - deadWorm.x, target.y - deadWorm.y),
      DEATH_EXPLOSION_RADIUS,
      DEATH_EXPLOSION_DAMAGE,
    );
    if (damage > 0) {
      takeDamage(target, damage);
      applyExplosionKnockback(target, damage);
    }
  }
  rt.explosions.push({ x: deadWorm.x, y: deadWorm.y, radius: DEATH_EXPLOSION_RADIUS, timer: EXPLOSION_EFFECT_DURATION });
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

function spawnCrateIfDue(rt: MatchRuntime): void {
  if (rt.crates.length > 0) return; // one on the map at a time - see CRATE_SPAWN_INTERVAL_TURNS comment
  const margin = Math.min(CRATE_EDGE_MARGIN, rt.terrain.width / 4);
  const x = margin + Math.random() * Math.max(1, rt.terrain.width - margin * 2);
  rt.crates.push({ x, y: CRATE_FALL_START_Y, vy: 0, landed: false });
  rt.turnsSinceCrateEvent = 0;
}

// Falls a still-airborne crate under gravity until it either lands on solid
// terrain (same isSolid check worms/projectiles use) or crosses the water
// line first, in which case it's lost - same as a worm dying in water, it
// gets a splash and disappears rather than resting on the seabed.
function updateCrates(rt: MatchRuntime, dt: number): void {
  for (const crate of rt.crates) {
    if (crate.landed) continue;
    crate.vy += GRAVITY * dt;
    crate.y += crate.vy * dt;
    if (isSolid(rt.terrain, crate.x, crate.y)) {
      crate.landed = true;
      crate.vy = 0;
    }
  }
  const surviving: Crate[] = [];
  for (const crate of rt.crates) {
    if (!crate.landed && crate.y >= waterLevelY(rt.terrain)) {
      rt.splashes.push({ x: crate.x, y: waterLevelY(rt.terrain), timer: SPLASH_EFFECT_DURATION });
      continue;
    }
    surviving.push(crate);
  }
  rt.crates = surviving;
}

// A landed crate heals whichever worm's center comes within pickup range -
// checked against every worm (not just the active one) since that's cheap
// and correct, matching how detonateAt/detonateDeath already scan allWorms.
function collectCrates(rt: MatchRuntime): void {
  const remaining: Crate[] = [];
  for (const crate of rt.crates) {
    if (!crate.landed) {
      remaining.push(crate);
      continue;
    }
    const collector = allWorms(rt).find(
      (w) => w.alive && !w.dying && Math.hypot(w.x - crate.x, w.y - crate.y) < CRATE_PICKUP_RADIUS,
    );
    if (collector) {
      collector.hp = Math.min(collector.maxHp, collector.hp + CRATE_HEAL_AMOUNT);
      rt.cratePickups.push({ x: crate.x, y: crate.y, timer: SPLASH_EFFECT_DURATION });
    } else {
      remaining.push(crate);
    }
  }
  rt.crates = remaining;
}

// Falls a not-yet-landed gravestone under gravity, same shape as
// updateCrates, so a worm that dies mid-air doesn't leave its headstone
// floating - it lands on the first solid ground below, or rests at the
// water surface if there's none (a gravestone never disappears the way a
// lost crate does).
function updateGravestones(rt: MatchRuntime, dt: number): void {
  for (const stone of rt.gravestones) {
    if (stone.landed) continue;
    stone.vy += GRAVITY * dt;
    stone.y += stone.vy * dt;
    if (isSolid(rt.terrain, stone.x, stone.y) || stone.y >= waterLevelY(rt.terrain)) {
      stone.landed = true;
      stone.vy = 0;
    }
  }
}

// At most one crate is ever on the map (see CRATE_SPAWN_INTERVAL_TURNS), so
// there's no need to worry about one explosion catching several crates or a
// chain reaction between them - just whether this tick's newly created
// explosions reach the one that's there. Detonates it in place using the
// grenade's own stats regardless of which weapon actually caused it, per
// spec: a dropbox "explodes like a grenade" when hit.
function detonateCratesCaughtInBlast(rt: MatchRuntime, newExplosions: Explosion[]): void {
  if (newExplosions.length === 0 || rt.crates.length === 0) return;
  const remaining: Crate[] = [];
  for (const crate of rt.crates) {
    const hit = newExplosions.some((ex) => Math.hypot(crate.x - ex.x, crate.y - ex.y) <= ex.radius);
    if (hit) {
      detonateAt(rt, 'grenade', crate.x, crate.y);
    } else {
      remaining.push(crate);
    }
  }
  rt.crates = remaining;
}

function meleeStrike(rt: MatchRuntime, worm: Worm, range: number, damage: number): void {
  let target: Worm | null = null;
  let bestDistance = Infinity;
  for (const candidate of allWorms(rt)) {
    if (candidate === worm || !candidate.alive || candidate.dying) continue;
    const dx = candidate.x - worm.x;
    const dy = candidate.y - worm.y;
    if (dx * worm.facing < 0) continue; // behind the swinger
    const distance = Math.hypot(dx, dy);
    if (distance <= range && distance < bestDistance) {
      bestDistance = distance;
      target = candidate;
    }
  }
  if (target) {
    takeDamage(target, damage);
    applyDirectionalKnockback(
      target,
      Math.sign(target.x - worm.x) || worm.facing,
      MELEE_KNOCKBACK_SPEED,
      MELEE_KNOCKBACK_LIFT,
      MELEE_KNOCKBACK_DURATION,
    );
  }
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
  } else if (def.melee) {
    meleeStrike(rt, worm, def.range ?? 50, def.maxDamage);
  } else {
    const projectile = createProjectile(weaponKey, worm.x, worm.y, fireAngle, power, worm);
    if (def.homing && rt.homingTarget) projectile.target = { ...rt.homingTarget };
    rt.projectiles.push(projectile);
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

// Places the selected steel girder centred on (x, y), tilted by the active
// worm's aim - called from GameScene's click handler, outside stepMatch, so
// it re-checks everything stepMatch's own fire path would. Uses up the turn
// like firing does. Returns whether a girder was actually placed.
export function tryPlaceStructure(rt: MatchRuntime, input: InputState, x: number, y: number): boolean {
  if (rt.turnBannerTimer !== null || rt.retirementTimer !== null || rt.rope) return false;
  const weaponKey = WEAPON_KEYS[input.selectedWeapon - 1];
  if (!weaponKey || !WEAPONS[weaponKey].structure) return false;
  const active = currentWorm(rt.match);
  const worm = active.worm;
  if (!worm.alive || worm.dying) return false;
  const team = rt.teams.find((t) => t.playerId === active.playerId)!;
  const ammo = team.ammo?.[weaponKey];
  if (ammo !== undefined && ammo <= 0) return false;

  const structure = createStructure(x, y, structureRotation(worm));
  if (!isStructurePlacementValid(rt.terrain, allWorms(rt), worm, structure)) return false;
  stampStructure(rt.terrain, structure);
  (rt.structures ??= []).push(structure);
  if (ammo !== undefined) team.ammo![weaponKey] = ammo - 1;
  rt.retirementTimer = 1;
  return true;
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

  // Ahead of this tick's death loop (which may push new gravestones below),
  // same convention updateCrates/spawnCrateIfDue already follow: an entity
  // created this tick sits still until the *next* tick's physics pass,
  // rather than also falling within the very frame it was born.
  updateGravestones(rt, dt);

  // Baseline for detonateCratesCaughtInBlast below: only explosions created
  // during this tick (from any source - a fired weapon, a chained crate
  // blast, a worm's own death blast) should ever be checked against crates,
  // never one that's just lingering on screen from an earlier frame.
  const explosionsBefore = rt.explosions.length;

  const active = currentWorm(rt.match);
  const worm = active.worm;
  const activeTeam = rt.teams.find((t) => t.playerId === active.playerId)!;
  const weaponKey = WEAPON_KEYS[input.selectedWeapon - 1] ?? 'bazooka';
  const ammoRemaining = activeTeam.ammo?.[weaponKey];
  const weaponDepleted = ammoRemaining !== undefined && ammoRemaining <= 0;
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
      rt.gravestones.push({ x: w.x, y: w.y, vy: 0, landed: isSolid(rt.terrain, w.x, w.y) });
      detonateDeath(rt, w);
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
    // A weapon that's used up its per-match allowance (see
    // WEAPON_MATCH_LIMITS) simply doesn't respond to fire input at all - no
    // charge starts, nothing fires. The player can still select it (so the
    // HUD can show it's spent) but pressing fire is a no-op.
    // Structures are placed by clicking (tryPlaceStructure), not fired.
    if (rt.retirementTimer === null && !weaponDepleted && !WEAPONS[weaponKey].structure) {
      const chargeableWeapon = WEAPONS[weaponKey].chargeable;
      if (input.firing && chargeableWeapon) {
        rt.charging = true;
        rt.chargePower = Math.min(1, rt.chargePower + dt);
      } else if (rt.charging) {
        fireWeapon(rt, worm, weaponKey, rt.chargePower);
        rt.charging = false;
        rt.chargePower = 0;
        if (ammoRemaining !== undefined) activeTeam.ammo![weaponKey] = ammoRemaining - 1;
      } else if (input.firing && !chargeableWeapon) {
        fireWeapon(rt, worm, weaponKey, 1);
        input.firing = false;
        if (ammoRemaining !== undefined) activeTeam.ammo![weaponKey] = ammoRemaining - 1;
      }
    }
  }

  rt.projectiles = rt.projectiles.filter((p) => p.alive);
  const spawnedThisTick: Projectile[] = [];
  for (const p of rt.projectiles) {
    const result = updateProjectile(p, rt.terrain, allWorms(rt), rt.match.wind, dt);
    if (result.exploded) {
      rt.explosions.push({
        x: p.x,
        y: p.y,
        radius: WEAPONS[p.weaponKey].craterRadius,
        timer: EXPLOSION_EFFECT_DURATION,
      });
      if (result.spawned) spawnedThisTick.push(...result.spawned);
    }
  }
  rt.projectiles.push(...spawnedThisTick);

  if (rt.shotgunTracer) {
    rt.shotgunTracer.timer -= dt;
    if (rt.shotgunTracer.timer <= 0) rt.shotgunTracer = null;
  }

  for (const e of rt.explosions) e.timer -= dt;
  const newExplosions = rt.explosions.slice(explosionsBefore);
  detonateCratesCaughtInBlast(rt, newExplosions);
  rt.explosions = rt.explosions.filter((e) => e.timer > 0);
  for (const s of rt.splashes) s.timer -= dt;
  rt.splashes = rt.splashes.filter((s) => s.timer > 0);

  updateCrates(rt, dt);
  collectCrates(rt);
  for (const pu of rt.cratePickups) pu.timer -= dt;
  rt.cratePickups = rt.cratePickups.filter((pu) => pu.timer > 0);

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
    rt.homingTarget = null;
    // A bat victim's knockback window is short and self-resolving, but a turn
    // ending inside it would otherwise leave the next worm's first moments
    // uncontrollable (updateWormPhysics ignores input while it runs).
    for (const w of allWorms(rt)) w.knockbackTimer = null;
    input.selectedWeapon = 1;
    rt.turnsSinceCrateEvent += 1;
    if (rt.turnsSinceCrateEvent >= CRATE_SPAWN_INTERVAL_TURNS) spawnCrateIfDue(rt);
  }
}
