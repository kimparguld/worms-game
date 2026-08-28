export interface Terrain {
  width: number;
  height: number;
  mask: Uint8Array;
}

export interface Worm {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  team: string;
  name: string;
  facing: 1 | -1;
  aimAngle: number;
  alive: boolean;
  onGround: boolean;
  dying: boolean;
  deathTimer: number | null;
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
  wind: number;
  teamWormPointer: Record<string, number>;
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

export type WeaponKey = 'bazooka' | 'grenade' | 'shotgun' | 'ninjaRope' | 'dynamite';

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
  range?: number;
}

export interface Projectile {
  weaponKey: WeaponKey;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuseRemaining: number | null;
  alive: boolean;
}

export interface ProjectileUpdateResult {
  exploded: boolean;
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
}
