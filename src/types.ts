// A single static prop (rock/tree/bush/flower) scattered across the terrain
// at generation time - see terrainDecorations.ts. Its own art/position for
// rendering; its actual collision footprint lives in Terrain.decorationMask
// (a layer separate from the natural ground, see that field's comment), not
// here.
export interface TerrainDecoration {
  textureKey: string;
  x: number;
  y: number; // the ground surface row the decoration's bottom edge sits on
  scale: number;
  flipX: boolean;
}

export interface Terrain {
  width: number;
  height: number;
  mask: Uint8Array;
  // Rocks/trees/bushes/flowers' collision, kept as its own layer *above* the
  // natural ground rather than merged into `mask` - see terrainDecorations.ts.
  // A point is solid if either mask says so (see isSolid), so a decoration
  // still climbs/digs exactly like terrain, but the ground's own silhouette
  // never gets reshaped to fit one: an object always reads as something
  // standing on the surface, not as a lump grown out of it. Same
  // width*height layout as `mask`.
  decorationMask: Uint8Array;
  // Set whenever either mask is mutated (carveCircle); drawTerrain consumes
  // it to skip its full per-pixel repaint on the vast majority of frames
  // where the shape hasn't changed since the last draw. Optional so tests
  // that build a Terrain literal without it still work - drawTerrain treats
  // a missing flag as dirty.
  dirty?: boolean;
  // Fractions (of width) of the columns this terrain's generation kept every
  // branch/building/lake/island clear of, for worm spawning - see
  // terrain.ts's pickSpawnFractions. createMatchRuntime reads this instead
  // of picking its own separate random columns, so the two always agree.
  spawnFractions: number[];
  // Which of the alternate ground fill textures (see assetManifest.ts) this
  // match's terrain should render with - picked once per match so the
  // dirt/soil look varies without changing mid-match.
  groundTextureKey: string;
  decorations: TerrainDecoration[];
}

export interface Worm {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  // The HP this worm started the match with - picked on the start screen,
  // so it varies per match rather than being STARTING_HP. Caps crate heals
  // and scales the worm's/team's health bars.
  maxHp: number;
  team: string;
  name: string;
  facing: 1 | -1;
  aimAngle: number;
  alive: boolean;
  onGround: boolean;
  dying: boolean;
  deathTimer: number | null;
  knockbackTimer: number | null;
}

export interface WormInput {
  left: boolean;
  right: boolean;
  jump: boolean;
}

export interface Team {
  playerId: string;
  name: string;
  worms: Worm[];
  // Remaining uses this match for weapons with a per-match limit (see
  // WEAPON_MATCH_LIMITS in weapons.ts) - keyed only for limited weapons, so
  // an unlimited weapon simply has no entry here. Optional so hand-built
  // Team literals in tests that don't care about ammo keep compiling; only
  // createMatchRuntime seeds it for real play.
  ammo?: Partial<Record<WeaponKey, number>>;
}

export interface TurnEntry {
  playerId: string;
  worm: Worm;
}

export interface MatchState {
  teams: Team[];
  turnOrder: TurnEntry[];
  currentIndex: number;
  turnTimeRemaining: number;
  // Full length of every turn this match (start screen setting) - what
  // turnTimeRemaining resets to on each turn change.
  turnDurationMs: number;
  wind: number;
  teamWormPointer: Record<string, number>;
}

// What the start screen hands to GameScene/createMatchRuntime: one entry
// per playing team (2-4, WORMS_PER_TEAM names each) plus the match settings.
export interface TeamSetup {
  name: string;
  wormNames: string[];
}

export interface MatchSetup {
  teams: TeamSetup[];
  startingHp: number;
  turnDurationMs: number;
}

export interface InputState {
  left: boolean;
  right: boolean;
  aimUp: boolean;
  aimDown: boolean;
  jump: boolean;
  firing: boolean;
  endTurnRequested: boolean;
  selectedWeapon: number;
}

export type WeaponKey =
  | 'bazooka'
  | 'grenade'
  | 'shotgun'
  | 'ninjaRope'
  | 'dynamite'
  | 'sniperRifle'
  | 'airstrikeRocket'
  | 'holyHandGrenade'
  | 'mine'
  | 'drill'
  | 'homingMissile'
  | 'clusterBomb'
  | 'clusterFragment'
  | 'bat'
  | 'steelStructure';

export interface WeaponDef {
  key: WeaponKey;
  maxDamage: number;
  blastRadius: number;
  craterRadius: number;
  chargeable: boolean;
  minSpeed: number;
  maxSpeed: number;
  gravity: boolean;
  windAffected: boolean;
  fuseTime: number | null;
  hitscan: boolean;
  pellets: number;
  bounces: boolean;
  rope: boolean;
  airstrike: boolean;
  drill: boolean;
  melee: boolean;
  homing: boolean;
  clusterCount?: number;
  // Placed with the mouse as a solid girder rather than fired - see
  // structures.ts and tryPlaceStructure in matchLoop.ts.
  structure?: boolean;
  // Hard cap (seconds) on how long a projectile may stay in flight before it
  // is forced to detonate where it is - a termination backstop, deliberately
  // separate from fuseTime so a weapon can have one without also taking on
  // fuse-based terrain behavior (resting/bouncing instead of exploding on
  // contact). Only weapons that could otherwise fly indefinitely need it: the
  // homing missile, whose finite turn radius means a point-blank shot can
  // circle a target it can't turn tightly enough to reach. Unset elsewhere.
  maxLifetime?: number;
  range?: number;
}

export interface Projectile {
  weaponKey: WeaponKey;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuseRemaining: number | null;
  // Seconds left before WeaponDef.maxLifetime forces this projectile to
  // detonate; null for the weapons that don't set maxLifetime (all but the
  // homing missile), which skips the check entirely.
  lifetimeRemaining: number | null;
  alive: boolean;
  // Homing missile only: the world point the player picked to steer toward
  // (see MatchRuntime.homingTarget). Unset means seek the nearest enemy.
  target?: Vector2;
  // The worm that fired it, excluded from direct-hit detection so a shot
  // doesn't detonate the instant it leaves its own shooter's position.
  owner?: Worm;
}

export interface ProjectileUpdateResult {
  exploded: boolean;
  spawned?: Projectile[];
}

// A steel girder placed by a worm. Only its placement lives here: once
// stamped, its collision is plain decorationMask terrain (see structures.ts).
export interface SteelStructure {
  x: number; // centre
  y: number;
  rotation: number; // radians
  length: number;
  thickness: number;
}

export interface Rope {
  attached: boolean;
  anchorX: number | null;
  anchorY: number | null;
  length: number;
}

export interface RaycastHit {
  type: 'worm' | 'terrain' | 'none';
  worm?: Worm;
  x: number;
  y: number;
  distance: number;
}

export interface Gravestone {
  x: number;
  y: number;
  vy: number;
  // Falls under gravity (like a Crate) until it reaches solid ground or the
  // water line, so a worm that dies mid-air doesn't leave its gravestone
  // floating - see updateGravestones in matchLoop.ts.
  landed: boolean;
}

export interface Explosion {
  x: number;
  y: number;
  radius: number;
  timer: number;
}

export interface Splash {
  x: number;
  y: number;
  timer: number;
}

export interface Crate {
  x: number;
  y: number;
  vy: number;
  landed: boolean;
}

export interface CratePickup {
  x: number;
  y: number;
  timer: number;
}

export interface ShotgunTracer {
  originX: number;
  originY: number;
  hits: Vector2[];
  timer: number;
}

export interface Vector2 {
  x: number;
  y: number;
}

export interface ProjectileIntegration {
  pos: Vector2;
  vel: Vector2;
}

export interface MatchRuntime {
  terrain: Terrain;
  teams: Team[];
  match: MatchState;
  projectiles: Projectile[];
  rope: Rope | null;
  charging: boolean;
  chargePower: number;
  retirementTimer: number | null;
  turnBannerTimer: number | null;
  gravestones: Gravestone[];
  shotgunTracer: ShotgunTracer | null;
  explosions: Explosion[];
  splashes: Splash[];
  crates: Crate[];
  cratePickups: CratePickup[];
  turnsSinceCrateEvent: number;
  // Where the active player clicked to aim the homing missile this turn;
  // copied onto the missile when it fires and cleared on every turn change.
  // Optional so hand-built runtimes in tests keep compiling.
  homingTarget?: Vector2 | null;
  // Every girder placed this match, in order, for TerrainRenderer to draw.
  // Optional for the same reason as homingTarget.
  structures?: SteelStructure[];
}
