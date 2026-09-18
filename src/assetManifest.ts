// Every sprite/spritesheet/image the game needs, in one data-driven table.
// The Phaser preloader (src/assetLoader.ts) and the placeholder generator
// (scripts/generate-placeholder-art.mjs) both read this file; adding a new
// sprite anywhere in the game is one entry here, nothing else.

export type AssetKind = 'image' | 'spritesheet' | 'nineslice';

export interface SpritesheetAnimation {
  name: string;
  frames: number[];
  frameRate: number;
  repeat: number; // -1 = loop forever, 0 = play once
}

export interface NineSliceInsets {
  leftWidth: number;
  rightWidth: number;
  topHeight: number;
  bottomHeight: number;
}

export interface AssetManifestEntry {
  key: string; // Phaser texture key - must be globally unique
  kind: AssetKind;
  path: string; // relative to public/, e.g. "assets/worm/idle.png"
  width: number; // full image width ('image'/'nineslice') or single-frame width ('spritesheet')
  height: number; // full image height ('image'/'nineslice') or single-frame height ('spritesheet')
  frameCount?: number; // 'spritesheet' only - frames laid out left-to-right
  animations?: SpritesheetAnimation[]; // 'spritesheet' only - omitted for particle-variety sheets
  nineSlice?: NineSliceInsets; // 'nineslice' only
  placeholderColor: number; // 0xRRGGBB flat fill used by the placeholder generator
}

const WEAPON_PLACEHOLDER_COLORS: Record<string, number> = {
  bazooka: 0xff5722,
  grenade: 0x6fbf4a,
  shotgun: 0xffd966,
  ninjaRope: 0x8d6e63,
  dynamite: 0xd7263d,
  sniperRifle: 0x2e2e38,
  airstrikeRocket: 0x4fc3f7,
  holyHandGrenade: 0xffd700,
  mine: 0x37474f,
  drill: 0xd8dde3,
};

const WEAPON_HELD_ENTRIES: AssetManifestEntry[] = Object.entries(WEAPON_PLACEHOLDER_COLORS).map(([key, color]) => ({
  key: `${key}_held`,
  kind: 'image',
  path: `assets/weapons/${key}_held.png`,
  width: 32,
  height: 32,
  placeholderColor: color,
}));

// Bazooka and airstrikeRocket are elongated/directional; the rest are 24x24.
const ELONGATED_PROJECTILE_KEYS = new Set(['bazooka', 'airstrikeRocket']);

const WEAPON_PROJECTILE_ENTRIES: AssetManifestEntry[] = Object.entries(WEAPON_PLACEHOLDER_COLORS).map(
  ([key, color]) => ({
    key: `${key}_projectile`,
    kind: 'image',
    path: `assets/weapons/${key}_projectile.png`,
    width: ELONGATED_PROJECTILE_KEYS.has(key) ? 40 : 24,
    height: ELONGATED_PROJECTILE_KEYS.has(key) ? 16 : 24,
    placeholderColor: color,
  }),
);

export const ASSET_MANIFEST: AssetManifestEntry[] = [
  // --- Worms (neutral skin tone, no per-team color baked in) ---
  {
    key: 'worm_idle',
    kind: 'spritesheet',
    path: 'assets/worm/idle.png',
    width: 48,
    height: 48,
    frameCount: 3,
    animations: [{ name: 'idle', frames: [0, 1, 2, 1], frameRate: 4, repeat: -1 }],
    placeholderColor: 0xd99578,
  },
  {
    key: 'worm_walk',
    kind: 'spritesheet',
    path: 'assets/worm/walk.png',
    width: 48,
    height: 48,
    frameCount: 4,
    animations: [{ name: 'walk', frames: [0, 1, 2, 3], frameRate: 8, repeat: -1 }],
    placeholderColor: 0xd99578,
  },
  {
    key: 'worm_jump',
    kind: 'spritesheet',
    path: 'assets/worm/jump.png',
    width: 48,
    height: 48,
    frameCount: 1,
    animations: [{ name: 'jump', frames: [0], frameRate: 1, repeat: 0 }],
    placeholderColor: 0xd99578,
  },
  {
    key: 'worm_fall',
    kind: 'spritesheet',
    path: 'assets/worm/fall.png',
    width: 48,
    height: 48,
    frameCount: 1,
    animations: [{ name: 'fall', frames: [0], frameRate: 1, repeat: 0 }],
    placeholderColor: 0xd99578,
  },
  {
    key: 'worm_death',
    kind: 'spritesheet',
    path: 'assets/worm/death.png',
    width: 48,
    height: 48,
    frameCount: 5,
    animations: [{ name: 'death', frames: [0, 1, 2, 3, 4], frameRate: 7, repeat: -1 }],
    placeholderColor: 0x8f4e3f,
  },
  {
    key: 'worm_headband',
    kind: 'image',
    path: 'assets/worm/headband.png',
    width: 16,
    height: 16,
    placeholderColor: 0xffffff, // tinted per-team at runtime via setTint
  },

  // --- Weapons: one held image + one projectile image per weapon key ---
  ...WEAPON_HELD_ENTRIES,
  ...WEAPON_PROJECTILE_ENTRIES,

  // --- Terrain ---
  { key: 'terrain_ground', kind: 'image', path: 'assets/terrain/ground.png', width: 512, height: 512, placeholderColor: 0x8a5a2e },
  { key: 'terrain_building_1', kind: 'image', path: 'assets/terrain/building_1.png', width: 256, height: 512, placeholderColor: 0x6c7379 },
  { key: 'terrain_building_2', kind: 'image', path: 'assets/terrain/building_2.png', width: 256, height: 512, placeholderColor: 0x5a6066 },
  { key: 'terrain_building_3', kind: 'image', path: 'assets/terrain/building_3.png', width: 256, height: 512, placeholderColor: 0x788089 },

  // --- Water ---
  { key: 'water', kind: 'image', path: 'assets/water/water.png', width: 128, height: 128, placeholderColor: 0x2f7fb8 },

  // --- Sky (shared by GameScene, StartScene, EndScene) ---
  { key: 'sky', kind: 'image', path: 'assets/sky/sky.png', width: 1600, height: 900, placeholderColor: 0x6ec3f4 },

  // --- Effects: one-shot animated sprites ---
  {
    key: 'fx_explosion',
    kind: 'spritesheet',
    path: 'assets/effects/explosion.png',
    width: 64,
    height: 64,
    frameCount: 7,
    animations: [{ name: 'explode', frames: [0, 1, 2, 3, 4, 5, 6], frameRate: 18, repeat: 0 }],
    placeholderColor: 0xff8a2a,
  },
  {
    key: 'fx_splash',
    kind: 'spritesheet',
    path: 'assets/effects/splash.png',
    width: 32,
    height: 32,
    frameCount: 4,
    animations: [{ name: 'splash', frames: [0, 1, 2, 3], frameRate: 7, repeat: 0 }],
    placeholderColor: 0xdff3fb,
  },

  // --- Effects: particle-variety sheets (emitter picks a random frame per particle, no animation) ---
  { key: 'fx_muzzle', kind: 'spritesheet', path: 'assets/effects/muzzle.png', width: 16, height: 16, frameCount: 3, placeholderColor: 0xfff2b0 },
  { key: 'fx_dust', kind: 'spritesheet', path: 'assets/effects/dust.png', width: 12, height: 12, frameCount: 3, placeholderColor: 0xc9a876 },

  // --- Particle base textures (tinted at runtime, same as today's shared white dot) ---
  { key: 'particle_spark', kind: 'image', path: 'assets/particles/spark.png', width: 8, height: 8, placeholderColor: 0xffb347 },
  { key: 'particle_debris', kind: 'image', path: 'assets/particles/debris.png', width: 8, height: 8, placeholderColor: 0x6b4523 },
  { key: 'particle_droplet', kind: 'image', path: 'assets/particles/droplet.png', width: 8, height: 8, placeholderColor: 0x8fd8f7 },

  // --- Misc ---
  { key: 'gravestone', kind: 'image', path: 'assets/misc/gravestone.png', width: 16, height: 16, placeholderColor: 0x9ca2a8 },
  { key: 'rope_hook', kind: 'image', path: 'assets/misc/rope_hook.png', width: 12, height: 12, placeholderColor: 0x9a9aa2 },
  { key: 'turn_arrow', kind: 'image', path: 'assets/misc/turn_arrow.png', width: 26, height: 30, placeholderColor: 0xffd966 },

  // --- HUD ---
  {
    key: 'hud_panel',
    kind: 'nineslice',
    path: 'assets/hud/panel.png',
    width: 32,
    height: 32,
    nineSlice: { leftWidth: 10, rightWidth: 10, topHeight: 10, bottomHeight: 10 },
    placeholderColor: 0x16213f,
  },
  {
    key: 'health_bar_frame',
    kind: 'nineslice',
    path: 'assets/hud/health_bar_frame.png',
    width: 24,
    height: 16,
    nineSlice: { leftWidth: 6, rightWidth: 6, topHeight: 6, bottomHeight: 6 },
    placeholderColor: 0x0f172e,
  },
  { key: 'crosshair', kind: 'image', path: 'assets/hud/crosshair.png', width: 10, height: 10, placeholderColor: 0xffd966 },

  // --- Missing-texture fallback (Task 3) ---
  { key: 'missing_texture', kind: 'image', path: 'assets/missing_texture.png', width: 16, height: 16, placeholderColor: 0xff00ff },
];

// The nine-slice insets declared for `key`, already ordered as the positional
// leftWidth/rightWidth/topHeight/bottomHeight tail of Phaser's
// `scene.add.nineslice(...)`, so a call site can spread it instead of
// re-typing four numbers that then silently drift from this manifest.
//
// Throws rather than falling back to zeros: a missing/malformed entry is a
// manifest bug, and zero insets would render as a plain stretched image that
// looks *almost* right - the worst possible failure mode to debug later.
export function nineSliceInsets(key: string): [number, number, number, number] {
  const insets = ASSET_MANIFEST.find((entry) => entry.key === key)?.nineSlice;
  if (!insets) throw new Error(`nineSliceInsets: manifest entry "${key}" declares no nineSlice insets`);
  return [insets.leftWidth, insets.rightWidth, insets.topHeight, insets.bottomHeight];
}
