import type Phaser from 'phaser';
import {
  STARTING_HP,
  DEATH_ANIM_DURATION_MS,
  SHOTGUN_TRACER_DURATION,
  WORM_MOVE_SPEED,
  EXPLOSION_EFFECT_DURATION,
  SPLASH_EFFECT_DURATION,
  WATER_BAND_HEIGHT_FRACTION,
} from './constants.js';
import { WEAPON_KEYS } from './matchLoop.js';
import { WEAPONS } from './weapons.js';
import { findSurfaceY } from './terrain.js';
import type {
  Terrain,
  Worm,
  Projectile,
  MatchState,
  Rope,
  WeaponKey,
  Team,
  Gravestone,
  ShotgunTracer,
  Explosion,
  Splash,
} from './types.js';

let cachedImageData: ImageData | null = null;
let cachedRunLength: Int32Array | null = null;
let cachedBuildingRunLength: Int32Array | null = null;
let cachedWidth = 0;
let cachedHeight = 0;

const BUILDING_ROOF_DEPTH = 6;

const TERRAIN_HASH_UNIT = 255;
const GRASS_RIM_DEPTH = 3;
const GRASS_BODY_DEPTH = 12;
const TOPSOIL_DEPTH = 38;
const CLAY_DEPTH = 85;
// Cell size for the rounded pebble/blob mottling below - bigger than the
// 1px fine speckle, so dirt/clay/rock read as a cluster of chunky rounded
// blotches (the Worms art style this project is chasing) rather than only
// fine grain.
const BLOB_CELL = 9;
const SURFACE_TUFT_MAX_HEIGHT = 4;
const SHORELINE_FOAM_RANGE = 9;
const SHORELINE_FOAM_SPARSITY = 92;
const SUN_DIRECTION_X = -0.55;
const SUN_DIRECTION_Y = -0.83;

interface ColorRgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface TerrainMaterialColorInput {
  material: 1 | 2;
  x: number;
  y: number;
  depth: number;
  rowRunStartX?: number;
  atLeftEdge?: boolean;
  atRightEdge?: boolean;
  nearBase?: boolean;
  inWindow?: boolean;
  windowCellX?: number;
  windowCellY?: number;
  buildingSeed?: number;
  hasEmptyLeft?: boolean;
  hasEmptyRight?: boolean;
  hasEmptyAbove?: boolean;
  hasEmptyBelow?: boolean;
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function color(r: number, g: number, b: number, a = 255): ColorRgba {
  return { r: clampColor(r), g: clampColor(g), b: clampColor(b), a };
}

function adjustColor(base: ColorRgba, delta: number): ColorRgba {
  return color(base.r + delta, base.g + delta, base.b + delta, base.a);
}

function mixColor(a: ColorRgba, b: ColorRgba, amount: number): ColorRgba {
  const t = Math.max(0, Math.min(1, amount));
  return color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t);
}

function applyMaterialLighting(base: ColorRgba, input: TerrainMaterialColorInput, roughness: number): ColorRgba {
  let lit = base;
  const openLeft = input.hasEmptyLeft ? 1 : 0;
  const openRight = input.hasEmptyRight ? 1 : 0;
  const openAbove = input.hasEmptyAbove ? 1 : 0;
  const openBelow = input.hasEmptyBelow ? 1 : 0;
  const normalX = openLeft - openRight;
  const normalY = openAbove - openBelow;
  const normalLength = Math.hypot(normalX, normalY);
  if (normalLength > 0) {
    const light = (normalX / normalLength) * SUN_DIRECTION_X + (normalY / normalLength) * SUN_DIRECTION_Y;
    lit = adjustColor(lit, light * 34 * roughness);
  }
  if (input.hasEmptyLeft || input.hasEmptyRight || input.hasEmptyBelow) lit = adjustColor(lit, -30 * roughness);
  if (input.hasEmptyAbove) lit = mixColor(lit, color(255, 246, 208), 0.14 * roughness);
  return lit;
}

// Rounded "pebble" mottling: a coarse cellular blob per grid cell, laid over
// the fine per-pixel speckle so dirt/clay/rock read as chunky rounded
// blotches instead of only single-pixel grain.
function blobMottleStrength(x: number, y: number, seed: number): { strength: number; lighter: boolean } | null {
  const cellX = Math.floor(x / BLOB_CELL);
  const cellY = Math.floor(y / BLOB_CELL);
  const hash = terrainPixelHash(cellX, cellY, seed);
  if (hash < 70) return null; // most cells carry no blob at all
  const centerX = cellX * BLOB_CELL + (hash % BLOB_CELL);
  const centerY = cellY * BLOB_CELL + ((hash >> 3) % BLOB_CELL);
  const radius = 3 + (hash % 4);
  const dist2 = (x - centerX) ** 2 + (y - centerY) ** 2;
  if (dist2 > radius * radius) return null;
  return { strength: 1 - dist2 / (radius * radius), lighter: hash % 2 === 0 };
}

export function terrainPixelHash(x: number, y: number, seed: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (seed * 83492791);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return h & TERRAIN_HASH_UNIT;
}

function earthBaseColor(depth: number): ColorRgba {
  if (depth <= GRASS_RIM_DEPTH) return color(156, 213, 96);
  if (depth <= GRASS_BODY_DEPTH) return color(72, 151, 62);
  if (depth <= TOPSOIL_DEPTH) return color(112, 78, 47);
  if (depth <= CLAY_DEPTH) return color(139, 91, 57);
  return color(97, 64, 42);
}

function earthMaterialColor(input: TerrainMaterialColorInput): ColorRgba {
  const { x, y, depth } = input;
  const speckle = terrainPixelHash(x, y, depth);
  const fineNoise = (speckle - 127) / 127;
  const strata = Math.sin(depth * 0.22 + x * 0.018) + Math.sin(depth * 0.08 + x * 0.071) * 0.55;
  const root =
    terrainPixelHash(Math.floor(x / 3), Math.floor(y / 6), 131) > 245 &&
    depth > GRASS_BODY_DEPTH &&
    depth < TOPSOIL_DEPTH;
  const stone = terrainPixelHash(Math.floor(x / 4), Math.floor(y / 4), 211) > 248 && depth > TOPSOIL_DEPTH;
  let base = earthBaseColor(depth);

  if (depth <= GRASS_RIM_DEPTH) {
    base = mixColor(base, color(212, 237, 126), speckle > 150 ? 0.45 : 0.12);
  } else if (depth <= GRASS_BODY_DEPTH) {
    base = adjustColor(base, fineNoise * 18 + strata * 5);
  } else if (depth <= TOPSOIL_DEPTH) {
    base = adjustColor(base, fineNoise * 19 + strata * 8);
    if (root) base = color(58, 44, 28);
    if (speckle > 238) base = mixColor(base, color(46, 35, 25), 0.55);
  } else if (depth <= CLAY_DEPTH) {
    base = adjustColor(base, fineNoise * 18 + strata * 11);
    if (speckle > 232) base = mixColor(base, color(188, 126, 75), 0.45);
  } else {
    base = adjustColor(base, fineNoise * 13 + strata * 8);
    if (speckle > 228) base = mixColor(base, color(150, 101, 65), 0.42);
  }

  if (stone) base = mixColor(base, color(158, 118, 82), 0.75);
  if (depth === TOPSOIL_DEPTH || depth === CLAY_DEPTH) base = mixColor(base, color(54, 44, 37), 0.28);

  // Chunky rounded blotches under the grass, layered on top of the fine
  // strata/speckle above - this is what gives dirt/clay/rock the "pebbly"
  // look instead of a smooth graded fill.
  if (depth > GRASS_BODY_DEPTH) {
    const blob = blobMottleStrength(x, y, Math.floor(depth / 10));
    if (blob) {
      const tint = blob.lighter ? adjustColor(base, 26) : adjustColor(base, -24);
      base = mixColor(base, tint, 0.4 * blob.strength);
    }
  }

  // A crisp dark cartoon outline at the very edge of the mass, on top of
  // applyMaterialLighting's softer per-side shading - this is what gives
  // the terrain its bold, hand-inked silhouette instead of a shaded but
  // edgeless blob.
  if (depth <= 1 && (input.hasEmptyLeft || input.hasEmptyRight || input.hasEmptyAbove || input.hasEmptyBelow)) {
    base = mixColor(base, color(26, 19, 13), 0.32);
  }

  return applyMaterialLighting(base, input, 1);
}

function buildingMaterialColor(input: TerrainMaterialColorInput): ColorRgba {
  const depth = input.depth;
  const rowRunStartX = input.rowRunStartX ?? 0;
  const buildingSeed = input.buildingSeed ?? rowRunStartX;
  const speckle = terrainPixelHash(input.x, input.y, buildingSeed);
  const fineNoise = (speckle - 127) / 127;
  const verticalWeathering = Math.min(1, depth / 140);

  if (depth < 2)
    return applyMaterialLighting(speckle % 2 === 0 ? color(222, 226, 229) : color(189, 196, 202), input, 0.8);
  if (depth < BUILDING_ROOF_DEPTH)
    return applyMaterialLighting(adjustColor(color(95, 101, 110), fineNoise * 11), input, 0.75);

  if (input.inWindow) {
    const cellX = input.windowCellX ?? 0;
    const cellY = input.windowCellY ?? 0;
    const lit = windowIsLit(cellX, cellY, buildingSeed);
    const glass = mixColor(
      color(31, 56, 73),
      color(103, 143, 164),
      Math.max(0, Math.min(1, cellY * 0.08 + fineNoise * 0.16)),
    );
    if (!lit || speckle < 28) return applyMaterialLighting(glass, input, 0.45);
    const warmInterior = speckle > 190 ? color(255, 229, 151) : color(225, 164, 86);
    return mixColor(warmInterior, glass, speckle < 78 ? 0.45 : 0.12);
  }

  if (input.nearBase) return applyMaterialLighting(adjustColor(color(96, 73, 62), fineNoise * 13), input, 0.85);
  if (input.atLeftEdge || input.atRightEdge)
    return applyMaterialLighting(adjustColor(color(108, 78, 66), fineNoise * 10), input, 0.9);

  const facadeStripe = Math.floor((input.x - rowRunStartX) / 13) % 2 === 0;
  const floorDivider = (depth - BUILDING_ROOF_DEPTH) % BUILDING_WINDOW_PITCH_Y < 2;
  const mortarLine = (input.x - rowRunStartX) % 13 === 0 || depth % 9 === 0;
  const rainStain = terrainPixelHash(Math.floor(input.x / 5), 0, buildingSeed) > 218;
  let base = facadeStripe ? color(161, 109, 80) : color(137, 94, 75);
  base = mixColor(base, color(76, 78, 82), verticalWeathering * 0.22);
  if (floorDivider || mortarLine) base = mixColor(base, color(98, 84, 77), 0.45);
  if (rainStain) base = adjustColor(base, -18 * verticalWeathering);
  return applyMaterialLighting(adjustColor(base, fineNoise * 12), input, 0.82);
}

export function terrainMaterialColor(input: TerrainMaterialColorInput): ColorRgba {
  if (input.material === 2) return buildingMaterialColor(input);
  return earthMaterialColor(input);
}

export function surfaceDecorationHeight(x: number, surfaceY: number, seed: number): number {
  const hash = terrainPixelHash(x, surfaceY, seed);
  if (hash < 194) return 0;
  return 1 + (hash % SURFACE_TUFT_MAX_HEIGHT);
}

export function isShorelinePixel(mask: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  if (x < 0 || x >= width || y < 0 || y >= height) return false;
  if (mask[y * width + x] !== 0) return false;
  const waterStartY = height * (1 - WATER_BAND_HEIGHT_FRACTION);
  if (Math.abs(y - waterStartY) > SHORELINE_FOAM_RANGE) return false;

  const left = x > 0 && mask[y * width + x - 1] !== 0;
  const right = x + 1 < width && mask[y * width + x + 1] !== 0;
  const above = y > 0 && mask[(y - 1) * width + x] !== 0;
  const below = y + 1 < height && mask[(y + 1) * width + x] !== 0;
  return left || right || above || below;
}

function writePixel(imageData: ImageData, width: number, x: number, y: number, value: ColorRgba): void {
  const o = (y * width + x) * 4;
  imageData.data[o] = value.r;
  imageData.data[o + 1] = value.g;
  imageData.data[o + 2] = value.b;
  imageData.data[o + 3] = value.a;
}

function drawTerrainSurfaceDetails(imageData: ImageData, terrain: Terrain): void {
  const { width, height, mask } = terrain;
  for (let x = 0; x < width; x++) {
    for (let y = 1; y < height; y++) {
      const cell = mask[y * width + x];
      if (cell === 0) continue;

      if (cell === 1) {
        const tuftHeight = surfaceDecorationHeight(x, y, 17);
        for (let dy = 1; dy <= tuftHeight; dy++) {
          const targetY = y - dy;
          if (targetY < 0 || mask[targetY * width + x] !== 0) break;
          writePixel(imageData, width, x, targetY, color(99, 190, 66, 220 - dy * 26));
        }
      }
      break;
    }
  }
}

function drawShorelineFoam(imageData: ImageData, terrain: Terrain): void {
  const { width, height, mask } = terrain;
  const minY = Math.max(0, Math.floor(height * (1 - WATER_BAND_HEIGHT_FRACTION) - SHORELINE_FOAM_RANGE));
  const maxY = Math.min(height - 1, Math.ceil(height * (1 - WATER_BAND_HEIGHT_FRACTION) + SHORELINE_FOAM_RANGE));
  for (let y = minY; y <= maxY; y++) {
    for (let x = 0; x < width; x++) {
      if (!isShorelinePixel(mask, width, height, x, y)) continue;
      const hash = terrainPixelHash(x, y, 71);
      if (hash > SHORELINE_FOAM_SPARSITY) continue;
      writePixel(imageData, width, x, y, hash % 2 === 0 ? color(220, 246, 247, 210) : color(143, 216, 247, 180));
    }
  }
}

// Building facade: a flat slab of one colour reads as a brown monolith, so the
// wall is broken up into a grid of floors and windows. The grid is anchored to
// the left edge of the building's run on the current row (so windows never get
// sliced in half at the left edge) and to the depth below the roof.
const BUILDING_WINDOW_PITCH_X = 20;
const BUILDING_WINDOW_PITCH_Y = 26;
const BUILDING_WINDOW_INSET_X = 5;
const BUILDING_WINDOW_WIDTH = 10;
const BUILDING_WINDOW_INSET_Y = 7;
const BUILDING_WINDOW_HEIGHT = 13;
// Plain wall within this many px of where the facade meets the ground, so a
// building on a slope gets a solid base instead of a ragged row of windows
// sliced off by the terrain line.
const BUILDING_BASE_DEPTH = 16;

// Deterministic per-window hash: the same window is lit every frame (a window
// that flickers with the render loop would look like a bug, not like a city).
function windowIsLit(cellX: number, cellY: number, seed: number): boolean {
  let h = (cellX * 73856093) ^ (cellY * 19349663) ^ (seed * 83492791);
  h = (h ^ (h >>> 13)) >>> 0;
  return h % 3 !== 0;
}

// Deterministic per-pixel darken/lighten so grass/dirt/rock read as a
// mottled texture instead of a flat color fill - same cheap position-hash
// technique as windowIsLit, so a redraw (e.g. after an explosion) never
// flickers.
export function terrainSpeckle(x: number, y: number): number {
  let h = (x * 374761393) ^ (y * 668265263);
  h = (h ^ (h >>> 13)) * 1274126177;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 21) - 10; // -10..+10
}

export function drawTerrain(texture: Phaser.Textures.CanvasTexture, terrain: Terrain): void {
  const { width, height } = terrain;
  const sizeChanged = !cachedImageData || cachedWidth !== width || cachedHeight !== height;
  // The terrain only actually changes shape when something carves it
  // (explosion/dig); every other frame the last-painted texture is still
  // correct, so skip the ~width*height repaint below entirely instead of
  // redoing it 60 times a second for a static picture.
  if (terrain.dirty === false && !sizeChanged) return;
  if (sizeChanged) {
    cachedImageData = texture.context.createImageData(width, height);
    cachedRunLength = new Int32Array(width);
    cachedBuildingRunLength = new Int32Array(width);
    cachedWidth = width;
    cachedHeight = height;
  }
  const imageData = cachedImageData!;
  const runLength = cachedRunLength!;
  const buildingRunLength = cachedBuildingRunLength!;
  runLength.fill(0);
  buildingRunLength.fill(0);

  // Left edge (in the current row) of the building run being drawn - the
  // window grid is anchored to it. Row-major iteration walks x from 0 to
  // width-1 within each row, so tracking it inline costs nothing.
  let rowRunStartX = 0;

  for (let i = 0; i < terrain.mask.length; i++) {
    const x = i % width;
    const y = (i / width) | 0;
    const o = i * 4;
    const cell = terrain.mask[i];
    if (cell === 2) {
      runLength[x] = 0;
      buildingRunLength[x]++;
      if (x === 0 || terrain.mask[i - 1] !== 2) rowRunStartX = x;

      const depth = buildingRunLength[x] - 1;
      const dx = x - rowRunStartX;
      const atLeftEdge = dx < 2;
      const atRightEdge = x + 2 >= width || terrain.mask[i + 1] !== 2 || terrain.mask[i + 2] !== 2;

      const wy = depth - BUILDING_ROOF_DEPTH;
      const cellX = dx % BUILDING_WINDOW_PITCH_X;
      const cellY = wy % BUILDING_WINDOW_PITCH_Y;
      const baseProbe = i + BUILDING_BASE_DEPTH * width;
      const nearBase = baseProbe >= terrain.mask.length || terrain.mask[baseProbe] !== 2;
      const inWindow =
        depth >= BUILDING_ROOF_DEPTH &&
        !nearBase &&
        cellX >= BUILDING_WINDOW_INSET_X &&
        cellX < BUILDING_WINDOW_INSET_X + BUILDING_WINDOW_WIDTH &&
        cellY >= BUILDING_WINDOW_INSET_Y &&
        cellY < BUILDING_WINDOW_INSET_Y + BUILDING_WINDOW_HEIGHT;
      const materialColor = terrainMaterialColor({
        material: 2,
        x,
        y,
        depth,
        rowRunStartX,
        atLeftEdge,
        atRightEdge,
        nearBase,
        inWindow,
        windowCellX: Math.floor(dx / BUILDING_WINDOW_PITCH_X),
        windowCellY: Math.floor(Math.max(0, wy) / BUILDING_WINDOW_PITCH_Y),
        buildingSeed: rowRunStartX,
        hasEmptyLeft: x > 0 && terrain.mask[i - 1] === 0,
        hasEmptyRight: x + 1 < width && terrain.mask[i + 1] === 0,
        hasEmptyAbove: i - width >= 0 && terrain.mask[i - width] === 0,
        hasEmptyBelow: i + width < terrain.mask.length && terrain.mask[i + width] === 0,
      });
      imageData.data[o] = materialColor.r;
      imageData.data[o + 1] = materialColor.g;
      imageData.data[o + 2] = materialColor.b;
      imageData.data[o + 3] = materialColor.a;
    } else if (cell === 1) {
      buildingRunLength[x] = 0;
      runLength[x]++;
      const depth = runLength[x];
      const materialColor = terrainMaterialColor({
        material: 1,
        x,
        y,
        depth,
        hasEmptyLeft: x > 0 && terrain.mask[i - 1] === 0,
        hasEmptyRight: x + 1 < width && terrain.mask[i + 1] === 0,
        hasEmptyAbove: i - width >= 0 && terrain.mask[i - width] === 0,
        hasEmptyBelow: i + width < terrain.mask.length && terrain.mask[i + width] === 0,
      });
      imageData.data[o] = materialColor.r;
      imageData.data[o + 1] = materialColor.g;
      imageData.data[o + 2] = materialColor.b;
      imageData.data[o + 3] = materialColor.a;
    } else {
      runLength[x] = 0;
      buildingRunLength[x] = 0;
      // Transparent - the static sky/cloud background layer shows through.
      imageData.data[o + 3] = 0;
    }
  }
  drawTerrainSurfaceDetails(imageData, terrain);
  drawShorelineFoam(imageData, terrain);
  texture.context.putImageData(imageData, 0, 0);
  texture.refresh();
  terrain.dirty = false;
}

// Drawn once (not per frame) - the sky doesn't change during a match.
export function drawSky(graphics: Phaser.GameObjects.Graphics, width: number, height: number): void {
  graphics.clear();
  graphics.fillGradientStyle(0x4f9fd5, 0x8cc9e8, 0xffd9ad, 0xd79f72, 1);
  graphics.fillRect(0, 0, width, height);

  graphics.fillStyle(0xffffff, 0.16);
  graphics.fillRect(0, 0, width, height * 0.34);

  graphics.fillStyle(0xfff1a8, 0.85);
  graphics.fillCircle(width * 0.83, height * 0.16, Math.max(24, width * 0.035));
  graphics.lineStyle(2, 0xfff1a8, 0.24);
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const inner = Math.max(34, width * 0.045);
    const outer = Math.max(52, width * 0.07);
    graphics.lineBetween(
      width * 0.83 + Math.cos(angle) * inner,
      height * 0.16 + Math.sin(angle) * inner,
      width * 0.83 + Math.cos(angle) * outer,
      height * 0.16 + Math.sin(angle) * outer,
    );
  }

  graphics.fillStyle(0xffffff, 0.1);
  for (let y = height * 0.09; y < height * 0.49; y += height * 0.075) {
    const offset = Math.sin(y * 0.037) * width * 0.035;
    graphics.fillRoundedRect(width * 0.06 + offset, y, width * 0.68, 2, 1);
  }

  graphics.fillStyle(0xb8d1bd, 0.26);
  graphics.beginPath();
  graphics.moveTo(0, height * 0.56);
  for (let x = 0; x <= width; x += 32) {
    const y = height * 0.5 + Math.sin(x * 0.012) * height * 0.035 + Math.sin(x * 0.027) * height * 0.018;
    graphics.lineTo(x, y);
  }
  graphics.lineTo(width, height);
  graphics.lineTo(0, height);
  graphics.closePath();
  graphics.fillPath();

  graphics.fillStyle(0x79a790, 0.22);
  graphics.beginPath();
  graphics.moveTo(0, height * 0.65);
  for (let x = 0; x <= width; x += 28) {
    const y = height * 0.6 + Math.sin(x * 0.016 + 1.5) * height * 0.045;
    graphics.lineTo(x, y);
  }
  graphics.lineTo(width, height);
  graphics.lineTo(0, height);
  graphics.closePath();
  graphics.fillPath();

  graphics.fillStyle(0x617f78, 0.24);
  graphics.beginPath();
  graphics.moveTo(0, height * 0.72);
  for (let x = 0; x <= width; x += 34) {
    const y = height * 0.69 + Math.sin(x * 0.018 + 2.4) * height * 0.026 + Math.sin(x * 0.043) * height * 0.01;
    graphics.lineTo(x, y);
  }
  graphics.lineTo(width, height);
  graphics.lineTo(0, height);
  graphics.closePath();
  graphics.fillPath();

  graphics.fillStyle(0x263f46, 0.2);
  const skylineBase = height * 0.68;
  for (let x = 0; x < width; x += 34) {
    const buildingHeight = 18 + ((x * 37) % 46);
    graphics.fillRect(x, skylineBase - buildingHeight, 20 + ((x * 11) % 18), buildingHeight);
    if (x % 68 === 0)
      graphics.fillTriangle(
        x + 8,
        skylineBase - buildingHeight,
        x + 18,
        skylineBase - buildingHeight - 16,
        x + 28,
        skylineBase - buildingHeight,
      );
  }

  graphics.fillGradientStyle(0xffffff, 0xffffff, 0xffecd1, 0xffecd1, 0.08, 0.08, 0.3, 0.3);
  graphics.fillRect(0, height * 0.48, width, height * 0.28);

  const clouds: Array<[number, number, number]> = [
    [width * 0.15, height * 0.18, 1],
    [width * 0.45, height * 0.1, 0.8],
    [width * 0.72, height * 0.22, 1.1],
    [width * 0.88, height * 0.08, 0.7],
    [width * 0.3, height * 0.3, 0.55],
    [width * 0.62, height * 0.14, 0.48],
  ];
  graphics.fillStyle(0xffffff, 0.85);
  for (const [cx, cy, scale] of clouds) {
    graphics.fillStyle(0x8fb7c8, 0.15);
    graphics.fillEllipse(cx + 5 * scale, cy + 11 * scale, 72 * scale, 18 * scale);
    graphics.fillStyle(0xffffff, 0.85);
    graphics.fillEllipse(cx, cy, 60 * scale, 26 * scale);
    graphics.fillEllipse(cx - 28 * scale, cy + 6 * scale, 38 * scale, 20 * scale);
    graphics.fillEllipse(cx + 30 * scale, cy + 6 * scale, 42 * scale, 20 * scale);
    graphics.fillStyle(0xfff8e7, 0.55);
    graphics.fillEllipse(cx - 12 * scale, cy - 5 * scale, 36 * scale, 12 * scale);
  }

  // Fine painterly grain over the whole sky, so its gradient bands read as
  // a painted backdrop rather than a flat digital fill - affordable at this
  // density because the sky is drawn once and never redrawn during a match.
  const grainCell = 8;
  for (let gy = 0; gy * grainCell < height; gy++) {
    for (let gx = 0; gx * grainCell < width; gx++) {
      const hash = terrainPixelHash(gx, gy, 401);
      if (hash < 226) continue;
      const px = gx * grainCell + (hash % grainCell);
      const py = gy * grainCell + ((hash >> 3) % grainCell);
      const light = hash % 2 === 0;
      graphics.fillStyle(light ? 0xffffff : 0x1c2a33, light ? 0.05 : 0.035);
      graphics.fillRect(px, py, 1.4, 1.4);
    }
  }
}

// Sits behind the terrain layer in the display list, so it's only ever
// visible where terrain has been dug/blown away down to the water line -
// see WATER_BAND_HEIGHT_FRACTION and terrain.ts's waterLevelY. Redrawn every
// frame (unlike the static sky) so the surface highlight bands can animate.
export function drawWater(graphics: Phaser.GameObjects.Graphics, width: number, height: number, timeMs: number): void {
  graphics.clear();
  const level = height * (1 - WATER_BAND_HEIGHT_FRACTION);
  const band = height - level;
  graphics.fillGradientStyle(0x287fa8, 0x2e91bc, 0x082d4c, 0x061f3a, 1);
  graphics.fillRect(0, level, width, band);

  graphics.fillStyle(0x021221, 0.16);
  graphics.fillRect(0, level + band * 0.68, width, band * 0.32);

  graphics.fillStyle(0xffffff, 0.065);
  for (let x = -90; x < width; x += 90) {
    const shimmerX = x + ((timeMs / 55) % 90);
    graphics.fillTriangle(shimmerX, level + band * 0.12, shimmerX + 18, level + band * 0.12, shimmerX + 84, height);
  }

  const t = timeMs / 1000;
  const drawWave = (
    yOffset: number,
    freq: number,
    speed: number,
    amp: number,
    color: number,
    alpha: number,
    lineWidth: number,
  ) => {
    graphics.lineStyle(lineWidth, color, alpha);
    graphics.beginPath();
    for (let x = 0; x <= width; x += 8) {
      const y =
        level +
        yOffset +
        Math.sin(x * freq + t * speed) * amp +
        Math.sin(x * freq * 0.37 - t * speed * 0.65) * amp * 0.38;
      if (x === 0) graphics.moveTo(x, y);
      else graphics.lineTo(x, y);
    }
    graphics.strokePath();
  };
  drawWave(0, 0.035, 1.1, 3, 0xffffff, 0.4, 2.5);
  drawWave(4, 0.05, 2.2, 2.5, 0x8fd8f7, 0.55, 2);
  drawWave(10, 0.04, -1.6, 2, 0xcdeffb, 0.3, 1.5);
  drawWave(22, 0.031, 0.9, 1.7, 0xffffff, 0.13, 1);
  drawWave(band * 0.45, 0.026, 1.3, 3.2, 0x75c6e8, 0.2, 1.5);
  drawWave(band * 0.72, 0.022, -1.0, 2.5, 0x0a3158, 0.22, 2);

  // Sun-glint sparkles: a sparse deterministic set of points near the
  // surface that flicker in and out, so the water reads as a reflective
  // rippled texture instead of a flat gradient. Fixed column stride (not a
  // full per-pixel scan) keeps this cheap enough to redraw every frame.
  const glintStride = 26;
  for (let x = 0; x < width; x += glintStride) {
    const hash = terrainPixelHash(x, 0, 613);
    if (hash < 165) continue;
    const glintY = level + band * (0.06 + ((hash % 40) / 40) * 0.3);
    const flicker = Math.max(0, Math.sin(t * 2.6 + hash));
    if (flicker <= 0) continue;
    graphics.fillStyle(0xffffff, 0.55 * flicker);
    graphics.fillCircle(x + ((t * 14) % glintStride), glintY, 1.2);
  }
}

// Bold, saturated palette. Form reads through flat color + soft shading
// (an underside shade ellipse, a glossy highlight) rather than hard black
// outlines - a thin, low-alpha line is used only where two similarly-toned
// shapes would otherwise merge (eyes against the head).
const TEAM_COLORS: Record<string, number> = { p1: 0x14d6b8, p2: 0xff3860 };

// CSS-hex form of TEAM_COLORS, for the DOM/Phaser.Text styling APIs that
// take a string instead of the numeric fill color Graphics calls use.
export function teamColorCss(playerId: string): string {
  const teamColor = TEAM_COLORS[playerId] ?? 0xdddddd;
  return `#${teamColor.toString(16).padStart(6, '0')}`;
}

const BODY_COLOR = 0xd99578;
const BODY_SHADE_COLOR = 0x8f4e3f;
const BODY_HIGHLIGHT_COLOR = 0xf7c7ad;
const SOFT_LINE_COLOR = 0x5f3835;
const HEAD_RADIUS = 10;

// Tapering tail segments trailing behind the head - worms crawl, they don't
// stand on legs, so this is the whole lower body.
const SEGMENT_OFFSETS = [9, 17, 24]; // px behind the head along the facing axis
const SEGMENT_RADII = [8.5, 7, 5.5];

const CRAWL_HZ = 2.4; // wiggle cycles per second while actively crawling
const CRAWL_AMPLITUDE = 3; // px of vertical travel per segment at full speed
const IDLE_HZ = 0.6; // slow shared "breathing" bob while stationary
const IDLE_BOB_AMPLITUDE = 1;

// Stable integer hash of a worm's name, shared by wormPhaseSeed (idle bob
// timing) and wormFreckleSpots (skin texture) so each worm gets one
// consistent identity seed instead of two separate hashing schemes.
function wormNameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

// Deterministic per-worm phase offset (hashed from its name) so idle worms
// don't all bob in perfect unison.
function wormPhaseSeed(name: string): number {
  return ((wormNameHash(name) % 1000) / 1000) * Math.PI * 2;
}

// Deterministic freckle/scale-texture spots on a worm's head, hashed from
// its name so the pattern is stable across frames (and between the live
// worm and its death-wiggle animation, which redraws the same worm) without
// needing extra state on the Worm type. Position is expressed relative to
// the head center, before the facing flip drawWorm applies.
export function wormFreckleSpots(name: string): Array<{ dx: number; dy: number; r: number }> {
  const seed = wormNameHash(name);
  const spots: Array<{ dx: number; dy: number; r: number }> = [];
  for (let i = 0; i < 6; i++) {
    const hash = terrainPixelHash(i, 7, seed);
    if (hash < 70) continue; // most worms show 3-5 freckles
    const angle = (hash / TERRAIN_HASH_UNIT) * Math.PI * 2;
    const radius = 3 + (hash % 6);
    spots.push({ dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius * 0.6 - 1, r: 1.2 + (hash % 3) * 0.4 });
  }
  return spots;
}

// Vertical bob for one point along the body (0 = head, 1..3 = tail segments,
// outward from the head): a traveling wave while crawling - each segment lags
// the one ahead of it, giving an inchworm ripple - or a gentle shared bob
// while idle.
function crawlOffsetY(worm: Worm, timeMs: number, point: number): number {
  const move = Math.min(1, Math.abs(worm.vx) / WORM_MOVE_SPEED);
  const t = timeMs / 1000;
  if (move > 0.05) {
    return Math.sin(t * CRAWL_HZ * Math.PI * 2 - point * 1.1) * CRAWL_AMPLITUDE * move;
  }
  const seed = wormPhaseSeed(worm.name);
  return Math.sin(t * IDLE_HZ * Math.PI * 2 + seed - point * 0.5) * IDLE_BOB_AMPLITUDE;
}

function headPosition(worm: Worm, timeMs: number): { x: number; y: number } {
  return { x: worm.x + worm.facing * 6, y: worm.y + crawlOffsetY(worm, timeMs, 0) };
}

// The worm's fist/weapon-grip point, just past the head along its facing
// direction - shared by the arm nub in drawWorm and the weapon shapes in
// drawHeldWeapon so both line up.
function handPosition(worm: Worm, timeMs: number): { x: number; y: number } {
  const head = headPosition(worm, timeMs);
  return { x: head.x + worm.facing * 11, y: head.y + 2 };
}

// Drawn on the active worm only, at its hand, so it visibly carries whichever
// weapon is currently selected - oriented along its aim for the two barrel
// weapons, held statically for the lobbed/utility ones.
function drawHeldWeapon(
  graphics: Phaser.GameObjects.Graphics,
  worm: Worm,
  handX: number,
  handY: number,
  weaponKey: WeaponKey,
): void {
  const fireAngle = worm.facing === 1 ? worm.aimAngle : Math.PI - worm.aimAngle;

  if (weaponKey === 'bazooka') {
    const length = 29;
    const endX = handX + Math.cos(fireAngle) * length;
    const endY = handY + Math.sin(fireAngle) * length;
    graphics.lineStyle(8, 0x565964, 1);
    graphics.lineBetween(handX, handY, endX, endY);
    graphics.lineStyle(2, 0xaeb5c2, 0.55);
    graphics.lineBetween(
      handX - Math.sin(fireAngle) * 2,
      handY + Math.cos(fireAngle) * 2,
      endX - Math.sin(fireAngle) * 2,
      endY + Math.cos(fireAngle) * 2,
    );
    graphics.lineStyle(3, 0x30323a, 1);
    graphics.lineBetween(
      handX - Math.cos(fireAngle) * 5,
      handY - Math.sin(fireAngle) * 5,
      handX + Math.cos(fireAngle) * 2,
      handY + Math.sin(fireAngle) * 2,
    );
    graphics.fillStyle(0x3a3a42, 1);
    graphics.fillCircle(endX, endY, 5.5);
    graphics.fillStyle(0xd6452f, 1);
    graphics.fillCircle(endX - Math.cos(fireAngle) * 6, endY - Math.sin(fireAngle) * 6, 3.2);
  } else if (weaponKey === 'shotgun') {
    // Short, fat, and light gunmetal gray - deliberately unlike the
    // bazooka's long dark tube, so the two read as different guns even at
    // normal gameplay scale, not just on close zoom.
    graphics.save();
    graphics.translateCanvas(handX, handY);
    graphics.rotateCanvas(fireAngle);
    graphics.fillStyle(0x8a5a2e, 1);
    graphics.fillRoundedRect(-13, -4, 9, 8, 2);
    graphics.fillStyle(0xc5ccd5, 1);
    graphics.fillRoundedRect(-3, -5.5, 22, 5, 2.2);
    graphics.fillRoundedRect(-3, 0.5, 22, 5, 2.2);
    graphics.lineStyle(1.2, 0x6f747e, 0.85);
    graphics.lineBetween(-3, 0, 20, 0);
    graphics.fillStyle(0x353842, 1);
    graphics.fillCircle(20, -3, 2.3);
    graphics.fillCircle(20, 3, 2.3);
    graphics.restore();
  } else if (weaponKey === 'grenade') {
    graphics.fillStyle(0x203719, 0.22);
    graphics.fillEllipse(handX + 1, handY + 3, 15, 9);
    graphics.fillStyle(0x4f9a3a, 1);
    graphics.fillCircle(handX, handY, 6.5);
    // Pineapple-style cross-hatch texture
    graphics.lineStyle(1, 0x2e4a1c, 0.6);
    graphics.lineBetween(handX - 4.5, handY, handX + 4.5, handY);
    graphics.lineBetween(handX, handY - 4.5, handX, handY + 4.5);
    graphics.lineBetween(handX - 3.2, handY - 3.2, handX + 3.2, handY + 3.2);
    graphics.lineBetween(handX - 3.2, handY + 3.2, handX + 3.2, handY - 3.2);
    graphics.fillStyle(0xffffff, 0.3);
    graphics.fillCircle(handX - 2, handY - 2, 2);
    graphics.lineStyle(1.6, 0x4a4a3a, 1);
    graphics.lineBetween(handX, handY - 6.5, handX, handY - 9.5);
    graphics.fillStyle(0xc9c9c9, 1);
    graphics.fillCircle(handX, handY - 9.5, 2.2);
    graphics.lineStyle(1.2, 0xe9edf2, 0.9);
    graphics.beginPath();
    graphics.arc(handX + 3.2, handY - 8.8, 3, -Math.PI * 0.2, Math.PI * 1.1);
    graphics.strokePath();
  } else if (weaponKey === 'dynamite') {
    // A bundle of three sticks reads more like cartoon TNT than one stick -
    // a thin darker groove between each keeps them legible without a full
    // outline.
    for (const dx of [-3.5, 0, 3.5]) {
      graphics.fillStyle(0xd7263d, 1);
      graphics.fillRoundedRect(handX + dx - 1.6, handY - 7, 3.2, 13, 1.4);
    }
    graphics.lineStyle(0.8, 0x8a1220, 0.7);
    graphics.lineBetween(handX - 1.9, handY - 7, handX - 1.9, handY + 6);
    graphics.lineBetween(handX + 1.9, handY - 7, handX + 1.9, handY + 6);
    graphics.lineStyle(1.4, 0x8a5a2a, 1);
    graphics.lineBetween(handX, handY - 7, handX + 3, handY - 11);
    graphics.fillStyle(0xffe58a, 1);
    graphics.fillCircle(handX + 3, handY - 11, 1.8);
    graphics.fillStyle(0xff7a1a, 0.8);
    graphics.fillCircle(handX + 4.4, handY - 12.3, 1.3);
  } else if (weaponKey === 'ninjaRope') {
    graphics.fillStyle(0x30323a, 1);
    graphics.fillCircle(handX - worm.facing * 3, handY + 1, 4.5);
    graphics.lineStyle(2.2, 0xc49a55, 1);
    graphics.beginPath();
    graphics.arc(handX, handY, 6, 0, Math.PI * 1.3);
    graphics.strokePath();
    const hookX = handX + Math.cos(Math.PI * 1.3) * 6;
    const hookY = handY + Math.sin(Math.PI * 1.3) * 6;
    graphics.fillStyle(0x9a9aa2, 1);
    graphics.fillCircle(hookX, hookY, 2.2);
  } else if (weaponKey === 'sniperRifle') {
    // A long, thin barrel - visually distinct from the bazooka's thicker
    // tube at a glance.
    const length = 26;
    const endX = handX + Math.cos(fireAngle) * length;
    const endY = handY + Math.sin(fireAngle) * length;
    graphics.lineStyle(3.5, 0x2e2e38, 1);
    graphics.lineBetween(handX, handY, endX, endY);
    graphics.fillStyle(0x1c1c22, 1);
    graphics.fillRect(handX + Math.cos(fireAngle) * 10 - 2, handY + Math.sin(fireAngle) * 10 - 5, 4, 4);
  } else if (weaponKey === 'airstrikeRocket') {
    // A sleeker, finned rocket in icy blue - reads as "air support" rather
    // than the bazooka's infantry rocket.
    const length = 22;
    const endX = handX + Math.cos(fireAngle) * length;
    const endY = handY + Math.sin(fireAngle) * length;
    graphics.lineStyle(5, 0x4fc3f7, 1);
    graphics.lineBetween(handX, handY, endX, endY);
    graphics.fillStyle(0x1c8fc7, 1);
    graphics.fillTriangle(
      endX,
      endY,
      endX - Math.cos(fireAngle) * 6 - 4,
      endY - Math.sin(fireAngle) * 6,
      endX - Math.cos(fireAngle) * 6 + 4,
      endY - Math.sin(fireAngle) * 6,
    );
  } else if (weaponKey === 'holyHandGrenade') {
    // A grenade with a gold cross instead of a pull-pin ring - reads as a
    // "blessed" upgrade of the regular grenade at a glance.
    graphics.fillStyle(0xffd700, 1);
    graphics.fillCircle(handX, handY, 7);
    graphics.lineStyle(1, 0xb8860b, 0.7);
    graphics.strokeCircle(handX, handY, 7);
    graphics.fillStyle(0xfff4c2, 0.4);
    graphics.fillCircle(handX - 2, handY - 2, 2.2);
    graphics.lineStyle(2, 0xfff4c2, 1);
    graphics.lineBetween(handX, handY - 11, handX, handY - 3);
    graphics.lineBetween(handX - 3, handY - 7, handX + 3, handY - 7);
  } else if (weaponKey === 'mine') {
    // A dark, spiked sphere - reads as a naval-style mine, not another
    // grenade, even though both are round.
    graphics.fillStyle(0x37474f, 1);
    graphics.fillCircle(handX, handY, 6.5);
    for (const angle of [0, 60, 120, 180, 240, 300]) {
      const rad = (angle * Math.PI) / 180;
      graphics.lineStyle(1.6, 0x1c262b, 1);
      graphics.lineBetween(
        handX + Math.cos(rad) * 6.5,
        handY + Math.sin(rad) * 6.5,
        handX + Math.cos(rad) * 10,
        handY + Math.sin(rad) * 10,
      );
    }
  } else if (weaponKey === 'drill') {
    graphics.save();
    graphics.translateCanvas(handX, handY);
    graphics.rotateCanvas(fireAngle);
    graphics.fillStyle(0x2f3338, 1);
    graphics.fillRoundedRect(-8, -5, 12, 10, 3);
    graphics.fillStyle(0xd8dde3, 1);
    graphics.fillTriangle(4, -5, 17, 0, 4, 5);
    graphics.lineStyle(1.2, 0x808891, 0.9);
    graphics.lineBetween(6, -3, 14, 1.5);
    graphics.lineBetween(6, 3, 14, -1.5);
    graphics.fillStyle(0xffd966, 1);
    graphics.fillCircle(-5, 0, 2.2);
    graphics.restore();
  }
}

// The Y the worm's ground shadow should be drawn at: the terrain surface
// under it, not the worm's own y - the worm's y rises while airborne (e.g.
// mid-jump), and a shadow that followed it up would defeat the point of a
// ground shadow. Scans downward starting at the worm's own y, not the world
// top, so a worm standing in a dug-out tunnel gets its tunnel floor, not
// whatever solid roof/building sits higher up that same column.
export function wormShadowY(worm: Worm, terrain: Terrain): number {
  return findSurfaceY(terrain, worm.x, worm.y);
}

function drawWorm(
  graphics: Phaser.GameObjects.Graphics,
  worm: Worm,
  isActive: boolean,
  timeMs: number,
  terrain: Terrain,
  heldWeapon?: WeaponKey,
): void {
  const teamColor = TEAM_COLORS[worm.team] ?? 0xdddddd;
  const facing = worm.facing;
  const head = headPosition(worm, timeMs);
  const hand = handPosition(worm, timeMs);
  const shadowY = wormShadowY(worm, terrain);

  // Soft ground shadow spanning the whole crawling body
  graphics.fillStyle(0x000000, 0.24);
  graphics.fillEllipse(worm.x - facing * 6, shadowY + 14, 42, 8);
  graphics.fillStyle(0x4c2e22, 0.08);
  graphics.fillEllipse(worm.x - facing * 7, shadowY + 11, 34, 4);

  // The active worm's "it's your turn" marker is the bouncing arrow above
  // its head (GameScene's activeWormArrow, a separate GameObject) - a flat
  // stroked ring here would just double up on it.

  // Tapering tail segments, drawn back-to-front so each overlaps cleanly
  // under the segment ahead of it - no legs, worms crawl.
  for (let i = SEGMENT_OFFSETS.length - 1; i >= 0; i--) {
    const segX = worm.x - facing * SEGMENT_OFFSETS[i];
    const segY = worm.y + 2 + crawlOffsetY(worm, timeMs, i + 1);
    const r = SEGMENT_RADII[i];
    graphics.fillStyle(0x5b2f28, 0.18);
    graphics.fillCircle(segX + 1.4, segY + 1.8, r * 1.02);
    graphics.fillStyle(BODY_COLOR, 1);
    graphics.fillCircle(segX, segY, r);
    graphics.fillStyle(BODY_SHADE_COLOR, 0.62);
    graphics.fillEllipse(segX, segY + r * 0.4, r * 1.5, r * 0.7);
    graphics.fillStyle(BODY_HIGHLIGHT_COLOR, 0.32);
    graphics.fillEllipse(segX - facing * 2, segY - r * 0.36, r * 0.82, r * 0.32);
  }

  // Small resting arm nub on the foremost tail segment, opposite the arm
  // holding the weapon.
  const backArmX = worm.x - facing * 12;
  const backArmY = worm.y + 3 + crawlOffsetY(worm, timeMs, 1);
  graphics.fillStyle(BODY_COLOR, 1);
  graphics.fillCircle(backArmX, backArmY, 4.5);

  // Head, with a subtle underside shade and a glossy highlight for a
  // rounded, toy-like cartoon feel.
  graphics.fillStyle(0x5b2f28, 0.18);
  graphics.fillCircle(head.x + 1.6, head.y + 1.8, HEAD_RADIUS * 1.03);
  graphics.fillStyle(BODY_COLOR, 1);
  graphics.fillCircle(head.x, head.y, HEAD_RADIUS);
  graphics.fillStyle(BODY_SHADE_COLOR, 0.6);
  graphics.fillEllipse(head.x, head.y + 5, 15, 7);
  graphics.fillStyle(BODY_HIGHLIGHT_COLOR, 0.48);
  graphics.fillEllipse(head.x - facing * 3, head.y - 5, 8, 4.8);
  graphics.fillStyle(0x6e4037, 0.18);
  graphics.fillEllipse(head.x + facing * 4, head.y + 1, 3, 6);

  // Freckle/scale texture spots, unique per worm - breaks up the flat skin
  // fill so the head reads as a textured hide rather than a plain circle.
  graphics.fillStyle(BODY_SHADE_COLOR, 0.75);
  for (const spot of wormFreckleSpots(worm.name)) {
    graphics.fillCircle(head.x + spot.dx * facing, head.y + spot.dy, spot.r);
  }

  // Front arm, reaching from the head to the fist/weapon-grip point.
  graphics.lineStyle(6, BODY_COLOR, 1);
  graphics.lineBetween(head.x + facing * 3, head.y + 4, hand.x, hand.y);
  graphics.lineStyle(2, BODY_HIGHLIGHT_COLOR, 0.35);
  graphics.lineBetween(head.x + facing * 2, head.y + 2, hand.x - facing * 1.2, hand.y - 1.2);
  graphics.fillStyle(BODY_COLOR, 1);
  graphics.fillCircle(hand.x, hand.y, 4);

  // Team-colored headband, with a knotted tail flapping out the back.
  const tailBaseX = head.x - facing * 7;
  const tailTipX = head.x - facing * 14;
  graphics.fillStyle(teamColor, 1);
  graphics.fillTriangle(tailBaseX, head.y - 8, tailTipX, head.y - 11, tailTipX + facing * 3, head.y - 3);
  graphics.fillEllipse(head.x, head.y - 6, 20, 7);
  graphics.fillStyle(0xffffff, 0.18);
  graphics.fillEllipse(head.x - facing * 3, head.y - 8, 14, 2.4);

  // Eyes, offset toward the direction the worm is facing
  const eyeOffsetX = facing * 4;
  graphics.fillStyle(0xffffff, 1);
  graphics.fillCircle(head.x + eyeOffsetX - 3, head.y - 2, 4);
  graphics.fillCircle(head.x + eyeOffsetX + 4, head.y - 2, 4);
  graphics.lineStyle(1, SOFT_LINE_COLOR, 0.45);
  graphics.strokeCircle(head.x + eyeOffsetX - 3, head.y - 2, 4);
  graphics.strokeCircle(head.x + eyeOffsetX + 4, head.y - 2, 4);
  graphics.fillStyle(0x1c1c1c, 1);
  graphics.fillCircle(head.x + eyeOffsetX - 3 + facing, head.y - 2, 1.9);
  graphics.fillCircle(head.x + eyeOffsetX + 4 + facing, head.y - 2, 1.9);

  // Expressive eyebrows for a bit of cartoon attitude
  graphics.lineStyle(1.8, SOFT_LINE_COLOR, 0.75);
  graphics.lineBetween(head.x + eyeOffsetX - 6, head.y - 6.5, head.x + eyeOffsetX - 1, head.y - 8);
  graphics.lineBetween(head.x + eyeOffsetX + 2, head.y - 8, head.x + eyeOffsetX + 7, head.y - 6.5);

  // A small smile for personality
  graphics.lineStyle(1.6, 0x8a4a4a, 0.85);
  graphics.beginPath();
  graphics.arc(head.x + eyeOffsetX + 1, head.y + 3, 3.6, (20 * Math.PI) / 180, (160 * Math.PI) / 180);
  graphics.strokePath();

  if (isActive && heldWeapon) drawHeldWeapon(graphics, worm, hand.x, hand.y, heldWeapon);
}

const DEATH_WIGGLE_END_FRACTION = 0.8; // last 20% of the animation is the "poof" burst instead of the wiggle

export function deathWiggleRotation(elapsedMs: number, durationMs: number): number {
  const fraction = Math.max(0, Math.min(1, elapsedMs / durationMs));
  // Spins increasingly wildly as the worm's last moment approaches.
  return Math.sin(fraction * Math.PI * 6) * fraction * (Math.PI / 2);
}

export function deathWiggleScale(elapsedMs: number, durationMs: number): number {
  const fraction = Math.max(0, Math.min(1, elapsedMs / durationMs));
  // A quick squash-and-stretch bounce for comic effect.
  return 1 + Math.sin(fraction * Math.PI * 8) * 0.15;
}

function drawDyingWorm(graphics: Phaser.GameObjects.Graphics, worm: Worm, elapsedMs: number, terrain: Terrain): void {
  const fraction = Math.max(0, Math.min(1, elapsedMs / DEATH_ANIM_DURATION_MS));

  if (fraction >= DEATH_WIGGLE_END_FRACTION) {
    // The wiggle hands off to a quick expanding "poof" instead of the worm body.
    const poofFraction = (fraction - DEATH_WIGGLE_END_FRACTION) / (1 - DEATH_WIGGLE_END_FRACTION);
    graphics.lineStyle(3, 0xfff8e7, 1 - poofFraction);
    graphics.strokeCircle(worm.x, worm.y, 6 + poofFraction * 26);
    graphics.lineStyle(2, 0xffd966, 1 - poofFraction);
    graphics.strokeCircle(worm.x, worm.y, 2 + poofFraction * 16);
    return;
  }

  const rotation = deathWiggleRotation(elapsedMs, DEATH_ANIM_DURATION_MS);
  const scale = deathWiggleScale(elapsedMs, DEATH_ANIM_DURATION_MS);
  graphics.save();
  graphics.translateCanvas(worm.x, worm.y);
  graphics.rotateCanvas(rotation);
  graphics.scaleCanvas(scale, scale);
  graphics.translateCanvas(-worm.x, -worm.y);
  drawWorm(graphics, worm, false, elapsedMs, terrain);
  graphics.restore();
}

// Fireball + shockwave + a few radiating sparks, scaled by the weapon's
// crater radius so a dynamite blast reads as bigger than a bazooka's.
export function drawExplosions(graphics: Phaser.GameObjects.Graphics, explosions: Explosion[]): void {
  for (const ex of explosions) {
    const fraction = Math.max(0, Math.min(1, 1 - ex.timer / EXPLOSION_EFFECT_DURATION));
    const fadeAlpha = 1 - fraction;
    const flashAlpha = Math.max(0, 1 - fraction * 3);
    const shockRadius = ex.radius * (0.7 + fraction * 2);
    const coreRadius = ex.radius * (0.35 + fraction * 0.5);

    graphics.fillStyle(0x18120d, 0.18 * fadeAlpha);
    graphics.fillEllipse(ex.x + ex.radius * 0.08, ex.y + ex.radius * 0.36, shockRadius * 1.12, shockRadius * 0.24);

    graphics.lineStyle(4, 0xfff2b0, fadeAlpha * 0.74);
    graphics.strokeCircle(ex.x, ex.y, shockRadius);
    graphics.lineStyle(1.5, 0xffffff, flashAlpha * 0.6);
    graphics.strokeCircle(ex.x, ex.y, shockRadius * 0.56);

    const smokeCount = 9;
    for (let i = 0; i < smokeCount; i++) {
      const angle = (i / smokeCount) * Math.PI * 2 + ex.radius * 0.017;
      const distance = coreRadius * (0.2 + fraction * (0.85 + (i % 3) * 0.12));
      const smokeRadius = coreRadius * (0.28 + (i % 4) * 0.05) * (0.75 + fraction * 0.8);
      const shade = i % 2 === 0 ? 0x473a31 : 0x2c2926;
      graphics.fillStyle(shade, fadeAlpha * 0.3);
      graphics.fillCircle(ex.x + Math.cos(angle) * distance, ex.y + Math.sin(angle) * distance, smokeRadius);
    }

    const sparkCount = 14;
    for (let i = 0; i < sparkCount; i++) {
      const angle = (i / sparkCount) * Math.PI * 2 + (ex.x % 7) * 0.3;
      const innerR = coreRadius * 0.5;
      const outerR = coreRadius * (1.05 + 0.9 * ((i % 4) / 3));
      graphics.lineStyle(i % 3 === 0 ? 3.2 : 2, i % 2 === 0 ? 0xfff2b0 : 0xff8a2a, fadeAlpha * 0.78);
      graphics.lineBetween(
        ex.x + Math.cos(angle) * innerR,
        ex.y + Math.sin(angle) * innerR,
        ex.x + Math.cos(angle) * outerR,
        ex.y + Math.sin(angle) * outerR,
      );
    }

    graphics.fillStyle(0x6b2d19, fadeAlpha * 0.45);
    graphics.fillCircle(ex.x + coreRadius * 0.1, ex.y + coreRadius * 0.13, coreRadius * 1.1);
    graphics.fillStyle(0xff4f1a, fadeAlpha * 0.92);
    graphics.fillCircle(ex.x, ex.y, coreRadius);
    graphics.fillStyle(0xffb347, fadeAlpha);
    graphics.fillCircle(ex.x, ex.y, coreRadius * 0.6);
    graphics.fillStyle(0xfff8e0, flashAlpha);
    graphics.fillCircle(ex.x, ex.y, coreRadius * 0.4);
  }
}

// A quick expanding ring plus a few droplets, at the water's surface, so a
// worm's death-by-water reads as a splash rather than a silent disappearance.
export function drawSplashes(graphics: Phaser.GameObjects.Graphics, splashes: Splash[]): void {
  for (const sp of splashes) {
    const fraction = Math.max(0, Math.min(1, 1 - sp.timer / SPLASH_EFFECT_DURATION));
    const alpha = 1 - fraction;
    const ringRadius = 6 + fraction * 22;

    graphics.lineStyle(2.5, 0xdff3fb, alpha * 0.8);
    graphics.strokeCircle(sp.x, sp.y, ringRadius);

    const dropletCount = 5;
    for (let i = 0; i < dropletCount; i++) {
      const angle = -Math.PI / 2 + (i - (dropletCount - 1) / 2) * 0.4;
      const dist = 4 + fraction * 16;
      const dx = sp.x + Math.cos(angle) * dist;
      const dy = sp.y - fraction * 14 + Math.sin(angle) * dist * 0.4;
      graphics.fillStyle(0xbfe8fb, alpha * 0.85);
      graphics.fillCircle(dx, dy, 1.8 - fraction * 1.2);
    }
  }
}

export function drawGravestones(graphics: Phaser.GameObjects.Graphics, gravestones: Gravestone[]): void {
  for (const stone of gravestones) {
    graphics.fillStyle(0x000000, 0.24);
    graphics.fillEllipse(stone.x + 1, stone.y + 10, 20, 6);
    graphics.fillGradientStyle(0xb9bec2, 0x9ca2a8, 0x6c7379, 0x555d63, 1);
    graphics.fillRoundedRect(stone.x - 7, stone.y - 9, 14, 16, { tl: 7, tr: 7, bl: 2, br: 2 });
    graphics.lineStyle(1.5, 0x6b7076, 1);
    graphics.strokeRoundedRect(stone.x - 7, stone.y - 9, 14, 16, { tl: 7, tr: 7, bl: 2, br: 2 });
    graphics.lineStyle(1, 0xe3e6e8, 0.45);
    graphics.lineBetween(stone.x - 4, stone.y - 5, stone.x - 4, stone.y + 5);
    graphics.lineStyle(1.5, 0x6b7076, 0.9);
    graphics.lineBetween(stone.x - 3, stone.y - 3, stone.x + 3, stone.y - 3);
    graphics.lineBetween(stone.x, stone.y - 6, stone.x, stone.y - 0.5);
  }
}

const PROJECTILE_COLORS: Record<WeaponKey, number> = {
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

const FUSE_BLINK_START_HZ = 1.5;
const FUSE_BLINK_END_HZ = 9;

export function fuseBlinkFrequency(fuseRemaining: number, fuseTime: number): number {
  if (fuseTime <= 0) return FUSE_BLINK_END_HZ;
  const elapsedFraction = Math.max(0, Math.min(1, 1 - fuseRemaining / fuseTime));
  return FUSE_BLINK_START_HZ + (FUSE_BLINK_END_HZ - FUSE_BLINK_START_HZ) * elapsedFraction;
}

export function projectileBlinkOn(fuseRemaining: number, fuseTime: number): boolean {
  if (fuseTime <= 0) return false;
  const elapsed = Math.max(0, fuseTime - fuseRemaining);
  // Phase is the integral of a frequency that ramps linearly from
  // FUSE_BLINK_START_HZ to FUSE_BLINK_END_HZ over fuseTime, so the blink
  // visibly speeds up (a "chirp") as the fuse burns down, instead of
  // blinking at a constant rate the whole time.
  const freqSlope = (FUSE_BLINK_END_HZ - FUSE_BLINK_START_HZ) / fuseTime;
  const phase = FUSE_BLINK_START_HZ * elapsed + 0.5 * freqSlope * elapsed * elapsed;
  return Math.sin(phase * Math.PI * 2) >= 0;
}

export function tracerAlpha(timer: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(1, timer / duration));
}

export function drawScene(
  graphics: Phaser.GameObjects.Graphics,
  worms: Worm[],
  projectiles: Projectile[],
  matchState: MatchState,
  rope: Rope | null,
  charging: boolean,
  chargePower: number,
  gravestones: Gravestone[],
  shotgunTracer: ShotgunTracer | null,
  activeWeaponKey: WeaponKey,
  timeMs: number,
  explosions: Explosion[],
  splashes: Splash[],
  terrain: Terrain,
): void {
  graphics.clear();
  drawGravestones(graphics, gravestones);
  drawSplashes(graphics, splashes);

  if (shotgunTracer) {
    const alpha = tracerAlpha(shotgunTracer.timer, SHOTGUN_TRACER_DURATION);
    for (const hit of shotgunTracer.hits) {
      graphics.lineStyle(5, 0xff9d42, alpha * 0.18);
      graphics.lineBetween(shotgunTracer.originX, shotgunTracer.originY, hit.x, hit.y);
      graphics.lineStyle(2, 0xfff2b0, alpha);
      graphics.lineBetween(shotgunTracer.originX, shotgunTracer.originY, hit.x, hit.y);
      graphics.fillStyle(0xffffff, alpha * 0.9);
      graphics.fillCircle(hit.x, hit.y, 2.5);
    }
    graphics.fillStyle(0xffe58a, alpha);
    graphics.fillCircle(shotgunTracer.originX, shotgunTracer.originY, 6);
  }

  const active = matchState.turnOrder[matchState.currentIndex];

  // Draw rope visualization if attached
  if (rope && rope.anchorX != null && rope.anchorY != null && active.worm.alive) {
    const worm = active.worm;
    graphics.lineStyle(5, 0x2f2514, 0.22);
    graphics.lineBetween(worm.x + 1, worm.y + 1, rope.anchorX + 1, rope.anchorY + 1);
    graphics.lineStyle(2.5, 0xc49a55, 1);
    graphics.lineBetween(worm.x, worm.y, rope.anchorX, rope.anchorY);
    graphics.fillStyle(0xdee2e6, 1);
    graphics.fillCircle(rope.anchorX, rope.anchorY, 4.8);
    graphics.lineStyle(1.4, 0x70757f, 1);
    graphics.strokeCircle(rope.anchorX, rope.anchorY, 4.8);
  }

  // Draw a crosshair showing the active worm's current aim direction, or a
  // growing charge bar in its place while a chargeable weapon is charging.
  // Skipped for bazooka/shotgun while just aiming (not charging) - their
  // held-weapon sprite already points along the aim angle, so the crosshair
  // is redundant clutter; the charge bar still matters and stays.
  const weaponHasOwnAimIndicator = activeWeaponKey === 'bazooka' || activeWeaponKey === 'shotgun';
  if (active && active.worm.alive && (charging || !weaponHasOwnAimIndicator)) {
    const worm = active.worm;
    const fireAngle = worm.facing === 1 ? worm.aimAngle : Math.PI - worm.aimAngle;
    const innerRadius = 16;
    const outerRadius = charging ? innerRadius + chargeBarLength(chargePower) : 28;
    const startX = worm.x + Math.cos(fireAngle) * innerRadius;
    const startY = worm.y + Math.sin(fireAngle) * innerRadius;
    const endX = worm.x + Math.cos(fireAngle) * outerRadius;
    const endY = worm.y + Math.sin(fireAngle) * outerRadius;
    const color = charging ? chargeBarColor(chargePower) : 0xffd966;
    graphics.lineStyle(charging ? 4 : 2.5, color, 0.95);
    graphics.lineBetween(startX, startY, endX, endY);
    graphics.fillStyle(color, 0.95);
    graphics.fillCircle(endX, endY, charging ? 5 : 3);
  }

  for (const worm of worms) {
    if (!worm.alive) continue;
    if (worm.dying) {
      drawDyingWorm(graphics, worm, DEATH_ANIM_DURATION_MS - (worm.deathTimer ?? 0), terrain);
      continue;
    }
    const isActive = Boolean(active && worm === active.worm);
    drawWorm(graphics, worm, isActive, timeMs, terrain, isActive ? activeWeaponKey : undefined);

    // A stroked "pill" (dark backing + team-colored border) rather than a
    // bare bar, so it reads as a nameplate badge - the worm's name (a
    // separate Phaser.Text GameScene owns, positioned just above this) sits
    // on top of it.
    const barWidth = 28;
    const barHeight = 6;
    const barX = worm.x - barWidth / 2;
    const barY = worm.y - 25;
    const hpFrac = worm.hp / STARTING_HP;
    const hpColor = hpFrac > 0.5 ? 0x6fbf4a : hpFrac > 0.25 ? 0xffd966 : 0xe85d5d;
    const teamColor = TEAM_COLORS[worm.team] ?? 0xdddddd;

    graphics.fillStyle(0x16213f, 0.78);
    graphics.fillRoundedRect(barX - 2, barY - 2, barWidth + 4, barHeight + 4, 4);
    graphics.lineStyle(1, teamColor, 0.9);
    graphics.strokeRoundedRect(barX - 2, barY - 2, barWidth + 4, barHeight + 4, 4);
    graphics.fillStyle(hpColor, 1);
    graphics.fillRoundedRect(barX, barY, Math.max(0, barWidth * hpFrac), barHeight, 2);
  }

  for (const projectile of projectiles) {
    if (!projectile.alive) continue;
    const def = WEAPONS[projectile.weaponKey];
    const isBlinkingRed =
      def.fuseTime != null &&
      projectile.fuseRemaining != null &&
      projectileBlinkOn(projectile.fuseRemaining, def.fuseTime);
    const fillColor = isBlinkingRed ? 0xff2222 : (PROJECTILE_COLORS[projectile.weaponKey] ?? 0xff5722);

    if (projectile.weaponKey === 'bazooka') {
      // A rocket-shaped capsule with a nose cone and flame trail, oriented
      // along its flight direction instead of a plain dot.
      const angle = Math.atan2(projectile.vy, projectile.vx);
      graphics.save();
      graphics.translateCanvas(projectile.x, projectile.y);
      graphics.rotateCanvas(angle);
      graphics.fillStyle(0x15171a, 0.2);
      graphics.fillEllipse(-19, 0, 34, 11);
      graphics.fillStyle(0x6c747d, 0.22);
      graphics.fillCircle(-25, 0, 9);
      graphics.fillStyle(0xd9dde2, 0.18);
      graphics.fillCircle(-29, -1.5, 6);
      graphics.fillStyle(0xff8a2a, 0.62);
      graphics.fillTriangle(-23, -5, -7, 0, -23, 5);
      graphics.fillStyle(0xffe58a, 0.88);
      graphics.fillTriangle(-16, -2.6, -4, 0, -16, 2.6);
      graphics.fillStyle(0x8a2f20, 1);
      graphics.fillRoundedRect(-8, -4.2, 14, 8.4, 2);
      graphics.fillStyle(fillColor, 1);
      graphics.fillRoundedRect(-5, -3.1, 11, 6.2, 2);
      graphics.fillStyle(0xf2f5f7, 1);
      graphics.fillTriangle(6, -3.5, 6, 3.5, 12, 0);
      graphics.fillStyle(0xffffff, 0.52);
      graphics.fillRoundedRect(-2, -2.5, 7, 1.5, 1);
      graphics.fillStyle(0x45505a, 1);
      graphics.fillTriangle(-4, -3.5, -9, -7, -3, -2.5);
      graphics.fillTriangle(-4, 3.5, -9, 7, -3, 2.5);
      graphics.restore();
    } else if (projectile.weaponKey === 'dynamite') {
      graphics.fillStyle(0x161010, 0.2);
      graphics.fillEllipse(projectile.x + 1, projectile.y + 5, 17, 6);
      graphics.fillStyle(fillColor, 1);
      graphics.fillRoundedRect(projectile.x - 5, projectile.y - 5, 4, 11, 1.5);
      graphics.fillRoundedRect(projectile.x - 1, projectile.y - 6, 4, 12, 1.5);
      graphics.fillRoundedRect(projectile.x + 3, projectile.y - 5, 4, 11, 1.5);
      graphics.fillStyle(0xff8a8a, 0.28);
      graphics.fillRoundedRect(projectile.x - 4.4, projectile.y - 4.2, 2, 8, 1);
      graphics.fillRoundedRect(projectile.x - 0.4, projectile.y - 5.2, 2, 9, 1);
      graphics.lineStyle(1.4, 0x8a1220, 0.8);
      graphics.lineBetween(projectile.x - 5, projectile.y - 1, projectile.x + 7, projectile.y - 1);
      graphics.fillStyle(0xffe58a, isBlinkingRed ? 1 : 0.65);
      graphics.fillCircle(projectile.x + 6, projectile.y - 8, isBlinkingRed ? 3 : 2);
    } else if (projectile.weaponKey === 'airstrikeRocket') {
      const angle = Math.atan2(projectile.vy, projectile.vx);
      graphics.save();
      graphics.translateCanvas(projectile.x, projectile.y);
      graphics.rotateCanvas(angle);
      graphics.fillStyle(0x123b55, 0.22);
      graphics.fillEllipse(-17, 0, 30, 8);
      graphics.fillStyle(0x4fc3f7, 1);
      graphics.fillRoundedRect(-7, -2.5, 12, 5, 2);
      graphics.fillStyle(0xe6f7ff, 1);
      graphics.fillTriangle(5, -2.5, 5, 2.5, 10, 0);
      graphics.fillStyle(0x1c8fc7, 1);
      graphics.fillTriangle(-5, -2.5, -10, -6, -4, -1.8);
      graphics.fillTriangle(-5, 2.5, -10, 6, -4, 1.8);
      graphics.restore();
    } else if (projectile.weaponKey === 'mine') {
      graphics.fillStyle(0x10171a, 0.22);
      graphics.fillEllipse(projectile.x + 1, projectile.y + 5, 16, 6);
      graphics.fillStyle(fillColor, 1);
      graphics.fillCircle(projectile.x, projectile.y, 5);
      graphics.fillStyle(0x7b8a91, 0.4);
      graphics.fillCircle(projectile.x - 1.5, projectile.y - 1.5, 2);
      graphics.lineStyle(1.4, 0x1c262b, 1);
      for (const angle of [0, 90, 180, 270]) {
        const rad = (angle * Math.PI) / 180;
        graphics.lineBetween(
          projectile.x + Math.cos(rad) * 5,
          projectile.y + Math.sin(rad) * 5,
          projectile.x + Math.cos(rad) * 8,
          projectile.y + Math.sin(rad) * 8,
        );
      }
    } else if (projectile.weaponKey === 'grenade') {
      graphics.fillStyle(0x203719, 0.25);
      graphics.fillEllipse(projectile.x + 1.5, projectile.y + 2.5, 11, 7);
      graphics.fillStyle(0x2c5d25, 1);
      graphics.fillCircle(projectile.x + 1, projectile.y + 1, 5.5);
      graphics.fillStyle(fillColor, 1);
      graphics.fillCircle(projectile.x, projectile.y, 5.2);
      graphics.lineStyle(1, 0x2e4a1c, 0.65);
      graphics.lineBetween(projectile.x - 4, projectile.y, projectile.x + 4, projectile.y);
      graphics.lineBetween(projectile.x, projectile.y - 4, projectile.x, projectile.y + 4);
      graphics.fillStyle(0xffffff, 0.5);
      graphics.fillCircle(projectile.x - 1.8, projectile.y - 1.8, 1.3);
    } else {
      graphics.fillStyle(0x141414, 0.18);
      graphics.fillEllipse(projectile.x + 1, projectile.y + 3, 10, 5);
      graphics.fillStyle(fillColor, 1);
      graphics.fillCircle(projectile.x, projectile.y, 4.5);
      graphics.fillStyle(0xffffff, 0.55);
      graphics.fillCircle(projectile.x - 1.3, projectile.y - 1.3, 1.4);
    }
  }

  drawExplosions(graphics, explosions);
}

// A Record (not a positional array) so TypeScript errors if a WeaponKey is
// ever added to WEAPON_KEYS in matchLoop.ts without a matching label here.
const WEAPON_LABELS: Record<WeaponKey, string> = {
  bazooka: 'Bazooka',
  grenade: 'Grenade',
  shotgun: 'Shotgun',
  ninjaRope: 'Ninja Rope',
  dynamite: 'Dynamite',
  sniperRifle: 'Sniper Rifle',
  airstrikeRocket: 'Airstrike Rocket',
  holyHandGrenade: 'Holy Hand Grenade',
  mine: 'Mine',
  drill: 'Drill',
};

export function weaponLabel(selectedWeapon: number): string {
  const key = WEAPON_KEYS[selectedWeapon - 1] ?? WEAPON_KEYS[0];
  return WEAPON_LABELS[key];
}

export function updateHud(hudText: Phaser.GameObjects.Text, matchState: MatchState, selectedWeapon: number): void {
  const key = WEAPON_KEYS[selectedWeapon - 1] ?? WEAPON_KEYS[0];
  const actionHint = WEAPONS[key].airstrike ? '\nFire to call random rain' : '';
  hudText.setText(
    `Wind: ${matchState.wind.toFixed(1)}\n` +
      `Time: ${Math.max(0, Math.ceil(matchState.turnTimeRemaining / 1000))}s\n` +
      `Weapon: ${selectedWeapon} - ${weaponLabel(selectedWeapon)}` +
      actionHint,
  );
}

export function turnBannerLabel(playerId: string): string {
  const num = playerId.replace(/[^0-9]/g, '');
  return num ? `Player ${num} turn` : `${playerId} turn`;
}

export function turnBannerAlpha(timeRemainingMs: number, durationMs: number): number {
  if (timeRemainingMs <= 0 || durationMs <= 0) return 0;
  const fadeMs = Math.min(300, durationMs / 2);
  const fadeInAlpha = (durationMs - timeRemainingMs) / fadeMs;
  const fadeOutAlpha = timeRemainingMs / fadeMs;
  return Math.max(0, Math.min(1, fadeInAlpha, fadeOutAlpha));
}

const CHARGE_BAR_MIN_LENGTH = 20;
const CHARGE_BAR_MAX_LENGTH = 90;
const CHARGE_BAR_START_COLOR = { r: 0xff, g: 0xd9, b: 0x66 }; // 0xffd966
const CHARGE_BAR_END_COLOR = { r: 0xe8, g: 0x5d, b: 0x5d }; // 0xe85d5d

export function chargeBarLength(chargePower: number): number {
  const clamped = Math.max(0, Math.min(1, chargePower));
  return CHARGE_BAR_MIN_LENGTH + (CHARGE_BAR_MAX_LENGTH - CHARGE_BAR_MIN_LENGTH) * clamped;
}

export function chargeBarColor(chargePower: number): number {
  const clamped = Math.max(0, Math.min(1, chargePower));
  const r = Math.round(CHARGE_BAR_START_COLOR.r + (CHARGE_BAR_END_COLOR.r - CHARGE_BAR_START_COLOR.r) * clamped);
  const g = Math.round(CHARGE_BAR_START_COLOR.g + (CHARGE_BAR_END_COLOR.g - CHARGE_BAR_START_COLOR.g) * clamped);
  const b = Math.round(CHARGE_BAR_START_COLOR.b + (CHARGE_BAR_END_COLOR.b - CHARGE_BAR_START_COLOR.b) * clamped);
  return (r << 16) | (g << 8) | b;
}

export function teamHealthFraction(team: Team): number {
  if (team.worms.length === 0) return 0;
  const totalHp = team.worms.reduce((sum, w) => sum + w.hp, 0);
  const maxHp = team.worms.length * STARTING_HP;
  return totalHp / maxHp;
}

export const TEAM_BAR_WIDTH = 220;
const TEAM_BAR_HEIGHT = 16;
const TEAM_BAR_MARGIN = 16; // horizontal inset from the screen edge
const TEAM_BAR_TOP = 30; // leaves room above the bar for the team-name label

export function teamHealthBarX(index: number, canvasWidth: number): number {
  return index === 0 ? TEAM_BAR_MARGIN : canvasWidth - TEAM_BAR_MARGIN - TEAM_BAR_WIDTH;
}

// Subtle canvas-grain speckle for UI chrome (HUD panel, health bar frames)
// so flat rounded-rect fills read as a lightly textured card instead of
// solid color. A sparse deterministic grid - cheap enough to redraw every
// frame for the health bars, and used once for the static HUD panel.
export function drawPanelGrain(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  seed: number,
): void {
  const cell = 4;
  for (let gy = 0; gy * cell < height; gy++) {
    for (let gx = 0; gx * cell < width; gx++) {
      const hash = terrainPixelHash(gx, gy, seed);
      if (hash < 165) continue;
      graphics.fillStyle(0xffffff, 0.08 + (hash % 30) / 300);
      graphics.fillRect(x + gx * cell + (hash % cell), y + gy * cell + ((hash >> 3) % cell), 1.5, 1.5);
    }
  }
}

// One life bar per team across the top of the screen: the first team's bar
// is left-aligned, the second team's is right-aligned. This project always
// creates exactly two teams (see matchLoop.ts's createMatchRuntime), so a
// two-slot left/right layout is sufficient.
export function drawTeamHealthBars(graphics: Phaser.GameObjects.Graphics, teams: Team[], canvasWidth: number): void {
  graphics.clear();
  teams.forEach((team, index) => {
    const x = teamHealthBarX(index, canvasWidth);
    const y = TEAM_BAR_TOP;
    const fraction = teamHealthFraction(team);
    const color = TEAM_COLORS[team.playerId] ?? 0xdddddd;

    graphics.fillStyle(0x16213f, 0.72);
    graphics.fillRoundedRect(x - 2, y - 2, TEAM_BAR_WIDTH + 4, TEAM_BAR_HEIGHT + 4, 6);
    graphics.fillStyle(0x0f172e, 1);
    graphics.fillRoundedRect(x, y, TEAM_BAR_WIDTH, TEAM_BAR_HEIGHT, 4);
    drawPanelGrain(graphics, x - 2, y - 2, TEAM_BAR_WIDTH + 4, TEAM_BAR_HEIGHT + 4, index === 0 ? 811 : 823);
    graphics.fillStyle(0xffffff, 0.08);
    graphics.fillRoundedRect(x + 1, y + 1, TEAM_BAR_WIDTH - 2, 5, 3);
    graphics.fillStyle(color, 1);
    graphics.fillRoundedRect(x, y, Math.max(0, TEAM_BAR_WIDTH * fraction), TEAM_BAR_HEIGHT, 4);
    graphics.fillStyle(0xffffff, 0.2);
    graphics.fillRoundedRect(x + 2, y + 2, Math.max(0, TEAM_BAR_WIDTH * fraction - 4), 4, 2);
  });
}
