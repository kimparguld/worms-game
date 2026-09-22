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
  homingMissile: 0xe91e63,
  clusterBomb: 0x8e44ad,
  clusterFragment: 0xb07cc6,
  bat: 0x795548,
  steelStructure: 0x5a5f66,
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
const ELONGATED_PROJECTILE_KEYS = new Set(['bazooka', 'airstrikeRocket', 'homingMissile']);

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
    height: 56,
    frameCount: 1,
    animations: [{ name: 'idle', frames: [0], frameRate: 1, repeat: 0 }],
    placeholderColor: 0xd99578,
  },
  {
    key: 'worm_walk',
    kind: 'spritesheet',
    path: 'assets/worm/walk.png',
    width: 48,
    height: 56,
    frameCount: 3,
    animations: [{ name: 'walk', frames: [0, 1, 2, 1], frameRate: 8, repeat: -1 }],
    placeholderColor: 0xd99578,
  },
  {
    key: 'worm_jump',
    kind: 'spritesheet',
    path: 'assets/worm/jump.png',
    width: 48,
    height: 56,
    frameCount: 5,
    animations: [{ name: 'jump', frames: [0, 1, 2, 3, 4], frameRate: 8, repeat: -1 }],
    placeholderColor: 0xd99578,
  },
  {
    key: 'worm_fall',
    kind: 'spritesheet',
    path: 'assets/worm/fall.png',
    width: 48,
    height: 56,
    frameCount: 1,
    animations: [{ name: 'fall', frames: [0], frameRate: 1, repeat: 0 }],
    placeholderColor: 0xd99578,
  },
  {
    key: 'worm_death',
    kind: 'spritesheet',
    path: 'assets/worm/death.png',
    width: 48,
    height: 56,
    frameCount: 5,
    animations: [{ name: 'death', frames: [0, 1, 2, 3, 4], frameRate: 7, repeat: -1 }],
    placeholderColor: 0x8f4e3f,
  },
  // --- Weapons: one held image + one projectile image per weapon key ---
  ...WEAPON_HELD_ENTRIES,
  ...WEAPON_PROJECTILE_ENTRIES,
  // Full-size art for a placed steel structure - see STEEL_STRUCTURE_ART in
  // structures.ts for the girder's opaque bounds inside this padded canvas.
  {
    key: 'steelStructure_placed',
    kind: 'image',
    path: 'assets/weapons/steelStructure_placed.png',
    width: 740,
    height: 429,
    placeholderColor: 0x5a5f66,
  },

  // --- Terrain ---
  {
    key: 'terrain_ground',
    kind: 'image',
    path: 'assets/terrain/ground.png',
    width: 512,
    height: 512,
    placeholderColor: 0x8a5a2e,
  },
  {
    key: 'terrain_grass',
    kind: 'image',
    path: 'assets/terrain/grass.png',
    width: 512,
    height: 512,
    placeholderColor: 0x4f9a3c,
  },
  {
    key: 'terrain_building_1',
    kind: 'image',
    path: 'assets/terrain/building_1.png',
    width: 512,
    height: 512,
    placeholderColor: 0x6c7379,
  },
  {
    key: 'terrain_building_2',
    kind: 'image',
    path: 'assets/terrain/building_2.png',
    width: 512,
    height: 512,
    placeholderColor: 0x5a6066,
  },
  {
    key: 'terrain_building_3',
    kind: 'image',
    path: 'assets/terrain/building_3.png',
    width: 512,
    height: 512,
    placeholderColor: 0x788089,
  },
  // Alternate ground fill textures - one is picked at random per match (see
  // terrain.ts's pickGroundTextureKey) so the dirt/soil look varies match to
  // match instead of always being the same texture.
  {
    key: 'terrain_ground_2',
    kind: 'image',
    path: 'assets/terrain/ground_2.png',
    width: 512,
    height: 512,
    placeholderColor: 0x8a5a2e,
  },
  {
    key: 'terrain_ground_3',
    kind: 'image',
    path: 'assets/terrain/ground_3.png',
    width: 1254,
    height: 1254,
    placeholderColor: 0x8a5a2e,
  },

  // --- Terrain decoration props: individual sprites cropped out of the
  // rocks/trees/bushes/flowers reference sheets in public/assets/terrain
  // (each sheet is a loose collage of pre-rendered icons, not a uniform
  // grid, so they were trimmed to their own transparent-background PNGs
  // under public/assets/terrain/props rather than sliced as a spritesheet).
  // terrainDecorations.ts randomly scatters a random subset of these across
  // each match's generated terrain.
  // --- Terrain decoration: Rocks (cropped from rocks.png, see public/assets/terrain/props) ---
  {
    key: 'terrain_rock_0',
    kind: 'image',
    path: 'assets/terrain/props/terrain_rock_0.png',
    width: 473,
    height: 407,
    placeholderColor: 0x8a6a4a,
  },
  {
    key: 'terrain_rock_1',
    kind: 'image',
    path: 'assets/terrain/props/terrain_rock_1.png',
    width: 369,
    height: 461,
    placeholderColor: 0x8a6a4a,
  },
  {
    key: 'terrain_rock_2',
    kind: 'image',
    path: 'assets/terrain/props/terrain_rock_2.png',
    width: 470,
    height: 342,
    placeholderColor: 0x8a6a4a,
  },
  {
    key: 'terrain_rock_3',
    kind: 'image',
    path: 'assets/terrain/props/terrain_rock_3.png',
    width: 312,
    height: 226,
    placeholderColor: 0x8a6a4a,
  },
  {
    key: 'terrain_rock_4',
    kind: 'image',
    path: 'assets/terrain/props/terrain_rock_4.png',
    width: 278,
    height: 204,
    placeholderColor: 0x8a6a4a,
  },
  {
    key: 'terrain_rock_5',
    kind: 'image',
    path: 'assets/terrain/props/terrain_rock_5.png',
    width: 321,
    height: 234,
    placeholderColor: 0x8a6a4a,
  },
  {
    key: 'terrain_rock_6',
    kind: 'image',
    path: 'assets/terrain/props/terrain_rock_6.png',
    width: 328,
    height: 160,
    placeholderColor: 0x8a6a4a,
  },
  {
    key: 'terrain_rock_7',
    kind: 'image',
    path: 'assets/terrain/props/terrain_rock_7.png',
    width: 260,
    height: 141,
    placeholderColor: 0x8a6a4a,
  },
  {
    key: 'terrain_rock_8',
    kind: 'image',
    path: 'assets/terrain/props/terrain_rock_8.png',
    width: 215,
    height: 104,
    placeholderColor: 0x8a6a4a,
  },
  {
    key: 'terrain_rock_9',
    kind: 'image',
    path: 'assets/terrain/props/terrain_rock_9.png',
    width: 187,
    height: 107,
    placeholderColor: 0x8a6a4a,
  },
  {
    key: 'terrain_rock_10',
    kind: 'image',
    path: 'assets/terrain/props/terrain_rock_10.png',
    width: 204,
    height: 109,
    placeholderColor: 0x8a6a4a,
  },
  {
    key: 'terrain_rock_11',
    kind: 'image',
    path: 'assets/terrain/props/terrain_rock_11.png',
    width: 149,
    height: 94,
    placeholderColor: 0x8a6a4a,
  },
  {
    key: 'terrain_rock_12',
    kind: 'image',
    path: 'assets/terrain/props/terrain_rock_12.png',
    width: 117,
    height: 61,
    placeholderColor: 0x8a6a4a,
  },
  {
    key: 'terrain_rock_13',
    kind: 'image',
    path: 'assets/terrain/props/terrain_rock_13.png',
    width: 59,
    height: 42,
    placeholderColor: 0x8a6a4a,
  },
  // --- Terrain decoration: Trees (cropped from trees.png, see public/assets/terrain/props) ---
  {
    key: 'terrain_tree_0',
    kind: 'image',
    path: 'assets/terrain/props/terrain_tree_0.png',
    width: 532,
    height: 614,
    placeholderColor: 0x4f9a3c,
  },
  {
    key: 'terrain_tree_1',
    kind: 'image',
    path: 'assets/terrain/props/terrain_tree_1.png',
    width: 260,
    height: 604,
    placeholderColor: 0x4f9a3c,
  },
  {
    key: 'terrain_tree_2',
    kind: 'image',
    path: 'assets/terrain/props/terrain_tree_2.png',
    width: 486,
    height: 560,
    placeholderColor: 0x4f9a3c,
  },
  {
    key: 'terrain_tree_3',
    kind: 'image',
    path: 'assets/terrain/props/terrain_tree_3.png',
    width: 233,
    height: 337,
    placeholderColor: 0x4f9a3c,
  },
  {
    key: 'terrain_tree_4',
    kind: 'image',
    path: 'assets/terrain/props/terrain_tree_4.png',
    width: 301,
    height: 353,
    placeholderColor: 0x4f9a3c,
  },
  {
    key: 'terrain_tree_5',
    kind: 'image',
    path: 'assets/terrain/props/terrain_tree_5.png',
    width: 278,
    height: 266,
    placeholderColor: 0x4f9a3c,
  },
  // --- Terrain decoration: Bushes (cropped from bushes.png, see public/assets/terrain/props) ---
  {
    key: 'terrain_bush_0',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_0.png',
    width: 273,
    height: 229,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_1',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_1.png',
    width: 283,
    height: 172,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_2',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_2.png',
    width: 271,
    height: 216,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_3',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_3.png',
    width: 282,
    height: 253,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_4',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_4.png',
    width: 222,
    height: 188,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_5',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_5.png',
    width: 272,
    height: 221,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_6',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_6.png',
    width: 230,
    height: 251,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_7',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_7.png',
    width: 213,
    height: 263,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_8',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_8.png',
    width: 272,
    height: 182,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_9',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_9.png',
    width: 269,
    height: 186,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_10',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_10.png',
    width: 280,
    height: 247,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_11',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_11.png',
    width: 262,
    height: 197,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_12',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_12.png',
    width: 290,
    height: 179,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_13',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_13.png',
    width: 258,
    height: 177,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_14',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_14.png',
    width: 259,
    height: 211,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_15',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_15.png',
    width: 279,
    height: 228,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_16',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_16.png',
    width: 294,
    height: 199,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_17',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_17.png',
    width: 232,
    height: 200,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_18',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_18.png',
    width: 238,
    height: 153,
    placeholderColor: 0x5cae4b,
  },
  {
    key: 'terrain_bush_19',
    kind: 'image',
    path: 'assets/terrain/props/terrain_bush_19.png',
    width: 259,
    height: 194,
    placeholderColor: 0x5cae4b,
  },
  // --- Terrain decoration: Flowers/plants (cropped from flowers.png, see public/assets/terrain/props) ---
  {
    key: 'terrain_flower_0',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_0.png',
    width: 181,
    height: 234,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_1',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_1.png',
    width: 181,
    height: 228,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_2',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_2.png',
    width: 237,
    height: 198,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_3',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_3.png',
    width: 248,
    height: 263,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_4',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_4.png',
    width: 181,
    height: 204,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_5',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_5.png',
    width: 228,
    height: 214,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_6',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_6.png',
    width: 217,
    height: 272,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_7',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_7.png',
    width: 215,
    height: 187,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_8',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_8.png',
    width: 181,
    height: 187,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_9',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_9.png',
    width: 223,
    height: 184,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_10',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_10.png',
    width: 219,
    height: 233,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_11',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_11.png',
    width: 149,
    height: 236,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_12',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_12.png',
    width: 210,
    height: 167,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_13',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_13.png',
    width: 186,
    height: 195,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_14',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_14.png',
    width: 168,
    height: 186,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_15',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_15.png',
    width: 234,
    height: 166,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_16',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_16.png',
    width: 212,
    height: 181,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_17',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_17.png',
    width: 163,
    height: 196,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_18',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_18.png',
    width: 222,
    height: 179,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_19',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_19.png',
    width: 200,
    height: 170,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_20',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_20.png',
    width: 174,
    height: 196,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_21',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_21.png',
    width: 214,
    height: 194,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_22',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_22.png',
    width: 164,
    height: 187,
    placeholderColor: 0xe8b84b,
  },
  {
    key: 'terrain_flower_23',
    kind: 'image',
    path: 'assets/terrain/props/terrain_flower_23.png',
    width: 193,
    height: 193,
    placeholderColor: 0xe8b84b,
  },

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
  {
    key: 'fx_muzzle',
    kind: 'spritesheet',
    path: 'assets/effects/muzzle.png',
    width: 16,
    height: 16,
    frameCount: 3,
    placeholderColor: 0xfff2b0,
  },
  {
    key: 'fx_dust',
    kind: 'spritesheet',
    path: 'assets/effects/dust.png',
    width: 12,
    height: 12,
    frameCount: 3,
    placeholderColor: 0xc9a876,
  },

  // --- Particle base textures (tinted at runtime, same as today's shared white dot) ---
  {
    key: 'particle_spark',
    kind: 'image',
    path: 'assets/particles/spark.png',
    width: 8,
    height: 8,
    placeholderColor: 0xffb347,
  },
  {
    key: 'particle_debris',
    kind: 'image',
    path: 'assets/particles/debris.png',
    width: 8,
    height: 8,
    placeholderColor: 0x6b4523,
  },
  {
    key: 'particle_droplet',
    kind: 'image',
    path: 'assets/particles/droplet.png',
    width: 8,
    height: 8,
    placeholderColor: 0x8fd8f7,
  },

  // --- Misc ---
  {
    key: 'gravestone',
    kind: 'image',
    path: 'assets/misc/gravestone.png',
    width: 16,
    height: 16,
    placeholderColor: 0x9ca2a8,
  },
  {
    key: 'rope_hook',
    kind: 'image',
    path: 'assets/misc/rope_hook.png',
    width: 12,
    height: 12,
    placeholderColor: 0x9a9aa2,
  },
  {
    key: 'turn_arrow',
    kind: 'image',
    path: 'assets/misc/turn_arrow.png',
    width: 26,
    height: 30,
    placeholderColor: 0xffd966,
  },
  {
    key: 'crate',
    kind: 'image',
    path: 'assets/misc/crate.png',
    width: 28,
    height: 28,
    placeholderColor: 0xc0392b,
  },

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
  {
    key: 'crosshair',
    kind: 'image',
    path: 'assets/hud/crosshair.png',
    width: 10,
    height: 10,
    placeholderColor: 0xffd966,
  },

  // --- Missing-texture fallback (Task 3) ---
  {
    key: 'missing_texture',
    kind: 'image',
    path: 'assets/missing_texture.png',
    width: 16,
    height: 16,
    placeholderColor: 0xff00ff,
  },
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
