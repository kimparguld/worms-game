import type Phaser from 'phaser';
import {
  STARTING_HP, DEATH_ANIM_DURATION_MS, SHOTGUN_TRACER_DURATION, WORM_MOVE_SPEED,
  EXPLOSION_EFFECT_DURATION, SPLASH_EFFECT_DURATION, WATER_BAND_HEIGHT_FRACTION,
} from './constants.js';
import { WEAPON_KEYS } from './matchLoop.js';
import { WEAPONS } from './weapons.js';
import type {
  Terrain, Worm, Projectile, MatchState, Rope, WeaponKey, Team, Gravestone, ShotgunTracer,
  Explosion, Splash,
} from './types.js';

let cachedImageData: ImageData | null = null;
let cachedRunLength: Int32Array | null = null;
let cachedBuildingRunLength: Int32Array | null = null;
let cachedWidth = 0;
let cachedHeight = 0;

const GRASS_DEPTH = 5;
const DIRT_TRANSITION_DEPTH = 45;
const BUILDING_ROOF_DEPTH = 6;

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
  if (!cachedImageData || cachedWidth !== width || cachedHeight !== height) {
    cachedImageData = texture.context.createImageData(width, height);
    cachedRunLength = new Int32Array(width);
    cachedBuildingRunLength = new Int32Array(width);
    cachedWidth = width;
    cachedHeight = height;
  }
  const imageData = cachedImageData;
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

      let r: number;
      let g: number;
      let b: number;
      if (depth < 2) {
        // A bright sunlit lip along the roof's edge, instead of a dark
        // outline, so the roofline still pops without an inked look.
        r = 214; g = 218; b = 226;
      } else if (depth < BUILDING_ROOF_DEPTH) {
        r = 118; g = 122; b = 132;
      } else if (atLeftEdge || atRightEdge) {
        // Soft warm shading (not a hard dark line) so the facade still
        // reads as a solid volume at its corners.
        r = 128; g = 90; b = 62;
      } else {
        const wy = depth - BUILDING_ROOF_DEPTH;
        const cellX = dx % BUILDING_WINDOW_PITCH_X;
        const cellY = wy % BUILDING_WINDOW_PITCH_Y;
        const baseProbe = i + BUILDING_BASE_DEPTH * width;
        const nearBase = baseProbe >= terrain.mask.length || terrain.mask[baseProbe] !== 2;
        const inWindow =
          !nearBase &&
          cellX >= BUILDING_WINDOW_INSET_X &&
          cellX < BUILDING_WINDOW_INSET_X + BUILDING_WINDOW_WIDTH &&
          cellY >= BUILDING_WINDOW_INSET_Y &&
          cellY < BUILDING_WINDOW_INSET_Y + BUILDING_WINDOW_HEIGHT;
        if (inWindow) {
          const lit = windowIsLit(
            Math.floor(dx / BUILDING_WINDOW_PITCH_X),
            Math.floor(wy / BUILDING_WINDOW_PITCH_Y),
            rowRunStartX,
          );
          if (lit) { r = 250; g = 214; b = 137; } else { r = 92; g = 84; b = 100; }
        } else if (cellY < 2) {
          // Thin floor divider between window rows.
          r = 158; g = 108; b = 76;
        } else {
          r = 178; g = 124; b = 88;
        }
      }
      imageData.data[o] = r;
      imageData.data[o + 1] = g;
      imageData.data[o + 2] = b;
      imageData.data[o + 3] = 255;
    } else if (cell === 1) {
      buildingRunLength[x] = 0;
      runLength[x]++;
      const depth = runLength[x];
      let r: number;
      let g: number;
      let b: number;
      if (depth === 1) {
        // A bright sunlit rim along the grass's top edge - alternated
        // between two close shades per column (instead of one flat tone)
        // so the rim reads as a ragged grass-tip line, not a uniform stripe.
        if (x % 5 < 3) { r = 168; g = 235; b = 110; } else { r = 150; g = 225; b = 96; }
      } else if (depth <= GRASS_DEPTH) {
        r = 104; g = 214; b = 64;
      } else if (depth <= DIRT_TRANSITION_DEPTH) {
        r = 150; g = 96; b = 46;
      } else {
        r = 96; g = 60; b = 30;
      }
      const speckle = terrainSpeckle(x, y);
      imageData.data[o] = Math.max(0, Math.min(255, r + speckle));
      imageData.data[o + 1] = Math.max(0, Math.min(255, g + speckle));
      imageData.data[o + 2] = Math.max(0, Math.min(255, b + speckle));
      imageData.data[o + 3] = 255;
    } else {
      runLength[x] = 0;
      buildingRunLength[x] = 0;
      // Transparent - the static sky/cloud background layer shows through.
      imageData.data[o + 3] = 0;
    }
  }
  texture.context.putImageData(imageData, 0, 0);
  texture.refresh();
}

// Drawn once (not per frame) - the sky doesn't change during a match.
export function drawSky(graphics: Phaser.GameObjects.Graphics, width: number, height: number): void {
  graphics.clear();
  graphics.fillGradientStyle(0x6ec3f4, 0x6ec3f4, 0xfdecc8, 0xfdecc8, 1);
  graphics.fillRect(0, 0, width, height);

  const clouds: Array<[number, number, number]> = [
    [width * 0.15, height * 0.18, 1],
    [width * 0.45, height * 0.1, 0.8],
    [width * 0.72, height * 0.22, 1.1],
    [width * 0.88, height * 0.08, 0.7],
  ];
  graphics.fillStyle(0xffffff, 0.85);
  for (const [cx, cy, scale] of clouds) {
    graphics.fillEllipse(cx, cy, 60 * scale, 26 * scale);
    graphics.fillEllipse(cx - 28 * scale, cy + 6 * scale, 38 * scale, 20 * scale);
    graphics.fillEllipse(cx + 30 * scale, cy + 6 * scale, 42 * scale, 20 * scale);
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
  graphics.fillGradientStyle(0x2e8fc7, 0x2e8fc7, 0x0c3f6e, 0x0c3f6e, 1);
  graphics.fillRect(0, level, width, band);

  const t = timeMs / 1000;
  const drawWave = (yOffset: number, freq: number, speed: number, amp: number, color: number, alpha: number, lineWidth: number) => {
    graphics.lineStyle(lineWidth, color, alpha);
    graphics.beginPath();
    for (let x = 0; x <= width; x += 10) {
      const y = level + yOffset + Math.sin(x * freq + t * speed) * amp;
      if (x === 0) graphics.moveTo(x, y);
      else graphics.lineTo(x, y);
    }
    graphics.strokePath();
  };
  drawWave(4, 0.05, 2.2, 2.5, 0x8fd8f7, 0.55, 2);
  drawWave(10, 0.04, -1.6, 2, 0xcdeffb, 0.3, 1.5);
}

// Bold, saturated palette. Form reads through flat color + soft shading
// (an underside shade ellipse, a glossy highlight) rather than hard black
// outlines - a thin, low-alpha line is used only where two similarly-toned
// shapes would otherwise merge (eyes against the head).
const TEAM_COLORS: Record<string, number> = { p1: 0x14d6b8, p2: 0xff3860 };
const BODY_COLOR = 0xffb199;
const BODY_SHADE_COLOR = 0xe0805a;
const SOFT_LINE_COLOR = 0x8a4a4a;
const HEAD_RADIUS = 10;

// Tapering tail segments trailing behind the head - worms crawl, they don't
// stand on legs, so this is the whole lower body.
const SEGMENT_OFFSETS = [9, 17, 24]; // px behind the head along the facing axis
const SEGMENT_RADII = [8.5, 7, 5.5];

const CRAWL_HZ = 2.4; // wiggle cycles per second while actively crawling
const CRAWL_AMPLITUDE = 3; // px of vertical travel per segment at full speed
const IDLE_HZ = 0.6; // slow shared "breathing" bob while stationary
const IDLE_BOB_AMPLITUDE = 1;

// Deterministic per-worm phase offset (hashed from its name) so idle worms
// don't all bob in perfect unison.
function wormPhaseSeed(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * Math.PI * 2;
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
    const length = 20;
    const endX = handX + Math.cos(fireAngle) * length;
    const endY = handY + Math.sin(fireAngle) * length;
    graphics.lineStyle(6, 0x5c5c66, 1);
    graphics.lineBetween(handX, handY, endX, endY);
    graphics.lineStyle(1.6, 0x3a3a42, 0.7);
    graphics.lineBetween(handX, handY - 1.2, endX, endY - 1.2);
    // Flared muzzle at the barrel tip
    graphics.fillStyle(0x3a3a42, 1);
    graphics.fillCircle(endX, endY, 4.5);
  } else if (weaponKey === 'shotgun') {
    // Short, fat, and light gunmetal gray - deliberately unlike the
    // bazooka's long dark tube, so the two read as different guns even at
    // normal gameplay scale, not just on close zoom.
    graphics.save();
    graphics.translateCanvas(handX, handY);
    graphics.rotateCanvas(fireAngle);
    graphics.fillStyle(0x8a5a2e, 1);
    graphics.fillRoundedRect(-11, -3.5, 7, 7, 2);
    graphics.fillStyle(0xb7bcc4, 1);
    graphics.fillRoundedRect(-2, -4.5, 17, 9, 2.5);
    graphics.lineStyle(1.2, 0x8a8f98, 0.8);
    graphics.lineBetween(-2, 0, 15, 0);
    graphics.restore();
  } else if (weaponKey === 'grenade') {
    graphics.fillStyle(0x3f7a2e, 1);
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
    graphics.fillCircle(handX, handY - 9.5, 1.9);
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
  } else if (weaponKey === 'ninjaRope') {
    graphics.lineStyle(2.2, 0x8a6a3a, 1);
    graphics.beginPath();
    graphics.arc(handX, handY, 6, 0, Math.PI * 1.3);
    graphics.strokePath();
    const hookX = handX + Math.cos(Math.PI * 1.3) * 6;
    const hookY = handY + Math.sin(Math.PI * 1.3) * 6;
    graphics.fillStyle(0x9a9aa2, 1);
    graphics.fillCircle(hookX, hookY, 2.2);
  }
}

function drawWorm(
  graphics: Phaser.GameObjects.Graphics,
  worm: Worm,
  isActive: boolean,
  timeMs: number,
  heldWeapon?: WeaponKey,
): void {
  const teamColor = TEAM_COLORS[worm.team] ?? 0xdddddd;
  const facing = worm.facing;
  const head = headPosition(worm, timeMs);
  const hand = handPosition(worm, timeMs);

  // Soft ground shadow spanning the whole crawling body
  graphics.fillStyle(0x000000, 0.2);
  graphics.fillEllipse(worm.x - facing * 6, worm.y + 13, 38, 7);

  // The active worm's "it's your turn" marker is the pulsing gold glow
  // halo (GameScene's activeWormGlow, a separate GameObject) - a flat
  // stroked ring here would just double up on it.

  // Tapering tail segments, drawn back-to-front so each overlaps cleanly
  // under the segment ahead of it - no legs, worms crawl.
  for (let i = SEGMENT_OFFSETS.length - 1; i >= 0; i--) {
    const segX = worm.x - facing * SEGMENT_OFFSETS[i];
    const segY = worm.y + 2 + crawlOffsetY(worm, timeMs, i + 1);
    const r = SEGMENT_RADII[i];
    graphics.fillStyle(BODY_COLOR, 1);
    graphics.fillCircle(segX, segY, r);
    graphics.fillStyle(BODY_SHADE_COLOR, 0.55);
    graphics.fillEllipse(segX, segY + r * 0.4, r * 1.5, r * 0.7);
  }

  // Small resting arm nub on the foremost tail segment, opposite the arm
  // holding the weapon.
  const backArmX = worm.x - facing * 12;
  const backArmY = worm.y + 3 + crawlOffsetY(worm, timeMs, 1);
  graphics.fillStyle(BODY_COLOR, 1);
  graphics.fillCircle(backArmX, backArmY, 4.5);

  // Head, with a subtle underside shade and a glossy highlight for a
  // rounded, toy-like cartoon feel.
  graphics.fillStyle(BODY_COLOR, 1);
  graphics.fillCircle(head.x, head.y, HEAD_RADIUS);
  graphics.fillStyle(BODY_SHADE_COLOR, 0.6);
  graphics.fillEllipse(head.x, head.y + 5, 15, 7);
  graphics.fillStyle(0xffffff, 0.35);
  graphics.fillEllipse(head.x - facing * 3, head.y - 5, 7, 4.5);

  // Front arm, reaching from the head to the fist/weapon-grip point.
  graphics.lineStyle(6, BODY_COLOR, 1);
  graphics.lineBetween(head.x + facing * 3, head.y + 4, hand.x, hand.y);
  graphics.fillStyle(BODY_COLOR, 1);
  graphics.fillCircle(hand.x, hand.y, 4);

  // Team-colored headband, with a knotted tail flapping out the back.
  const tailBaseX = head.x - facing * 7;
  const tailTipX = head.x - facing * 14;
  graphics.fillStyle(teamColor, 1);
  graphics.fillTriangle(tailBaseX, head.y - 8, tailTipX, head.y - 11, tailTipX + facing * 3, head.y - 3);
  graphics.fillEllipse(head.x, head.y - 6, 20, 7);

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

function drawDyingWorm(graphics: Phaser.GameObjects.Graphics, worm: Worm, elapsedMs: number): void {
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
  drawWorm(graphics, worm, false, elapsedMs);
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

    graphics.lineStyle(3, 0xfff2b0, fadeAlpha * 0.8);
    graphics.strokeCircle(ex.x, ex.y, shockRadius);

    const sparkCount = 7;
    for (let i = 0; i < sparkCount; i++) {
      const angle = (i / sparkCount) * Math.PI * 2 + (ex.x % 7) * 0.3;
      const innerR = coreRadius * 0.5;
      const outerR = coreRadius * (1.1 + 0.5 * ((i % 3) / 2));
      graphics.lineStyle(2.5, 0xffb347, fadeAlpha * 0.7);
      graphics.lineBetween(
        ex.x + Math.cos(angle) * innerR, ex.y + Math.sin(angle) * innerR,
        ex.x + Math.cos(angle) * outerR, ex.y + Math.sin(angle) * outerR,
      );
    }

    graphics.fillStyle(0xff5a1a, fadeAlpha * 0.9);
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
    graphics.fillStyle(0x000000, 0.18);
    graphics.fillEllipse(stone.x, stone.y + 9, 16, 5);
    graphics.fillStyle(0x9aa0a6, 1);
    graphics.fillRoundedRect(stone.x - 7, stone.y - 9, 14, 16, { tl: 7, tr: 7, bl: 2, br: 2 });
    graphics.lineStyle(1.5, 0x6b7076, 1);
    graphics.strokeRoundedRect(stone.x - 7, stone.y - 9, 14, 16, { tl: 7, tr: 7, bl: 2, br: 2 });
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
  grapplingHook: 0x8d6e63,
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
): void {
  graphics.clear();
  drawGravestones(graphics, gravestones);
  drawSplashes(graphics, splashes);

  if (shotgunTracer) {
    const alpha = tracerAlpha(shotgunTracer.timer, SHOTGUN_TRACER_DURATION);
    graphics.lineStyle(2, 0xfff2b0, alpha);
    for (const hit of shotgunTracer.hits) {
      graphics.lineBetween(shotgunTracer.originX, shotgunTracer.originY, hit.x, hit.y);
    }
    graphics.fillStyle(0xffe58a, alpha);
    graphics.fillCircle(shotgunTracer.originX, shotgunTracer.originY, 5);
  }

  const active = matchState.turnOrder[matchState.currentIndex];

  // Draw rope visualization if attached
  if (rope && rope.anchorX != null && rope.anchorY != null && active.worm.alive) {
    const worm = active.worm;
    graphics.lineStyle(2.5, 0x8d6e63, 1);
    graphics.lineBetween(worm.x, worm.y, rope.anchorX, rope.anchorY);
    graphics.fillStyle(0x8d6e63, 1);
    graphics.fillCircle(rope.anchorX, rope.anchorY, 4);
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
      drawDyingWorm(graphics, worm, DEATH_ANIM_DURATION_MS - (worm.deathTimer ?? 0));
      continue;
    }
    const isActive = Boolean(active && worm === active.worm);
    drawWorm(graphics, worm, isActive, timeMs, isActive ? activeWeaponKey : undefined);

    const barWidth = 26;
    const barHeight = 5;
    const barX = worm.x - barWidth / 2;
    const barY = worm.y - 27;
    const hpFrac = worm.hp / STARTING_HP;
    const hpColor = hpFrac > 0.5 ? 0x6fbf4a : hpFrac > 0.25 ? 0xffd966 : 0xe85d5d;

    graphics.fillStyle(0x16213f, 0.55);
    graphics.fillRoundedRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2, 3);
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
      graphics.fillStyle(fillColor, 1);
      graphics.fillRoundedRect(-6, -3, 10, 6, 2);
      graphics.fillTriangle(4, -3, 4, 3, 9, 0);
      graphics.fillStyle(0xffe58a, 0.9);
      graphics.fillTriangle(-9, -1.6, -6, 0, -9, 1.6);
      graphics.restore();
    } else if (projectile.weaponKey === 'dynamite') {
      graphics.fillStyle(fillColor, 1);
      graphics.fillRoundedRect(projectile.x - 3, projectile.y - 5, 6, 10, 2);
    } else {
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
  grapplingHook: 'Grappling Hook',
};

export function weaponLabel(selectedWeapon: number): string {
  const key = WEAPON_KEYS[selectedWeapon - 1] ?? WEAPON_KEYS[0];
  return WEAPON_LABELS[key];
}

export function updateHud(
  hudText: Phaser.GameObjects.Text,
  matchState: MatchState,
  selectedWeapon: number,
): void {
  hudText.setText(
    `Wind: ${matchState.wind.toFixed(1)}\n` +
      `Time: ${Math.max(0, Math.ceil(matchState.turnTimeRemaining / 1000))}s\n` +
      `Weapon: ${selectedWeapon} - ${weaponLabel(selectedWeapon)}`,
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
    graphics.fillStyle(color, 1);
    graphics.fillRoundedRect(x, y, Math.max(0, TEAM_BAR_WIDTH * fraction), TEAM_BAR_HEIGHT, 4);
  });
}
