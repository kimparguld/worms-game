import type Phaser from 'phaser';
import { STARTING_HP } from './constants.js';
import type { Terrain, Worm, Projectile, MatchState, Rope, WeaponKey } from './types.js';

let cachedImageData: ImageData | null = null;
let cachedRunLength: Int32Array | null = null;
let cachedBuildingRunLength: Int32Array | null = null;
let cachedWidth = 0;
let cachedHeight = 0;

const GRASS_DEPTH = 5;
const DIRT_TRANSITION_DEPTH = 45;
const BUILDING_ROOF_DEPTH = 6;

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

  for (let i = 0; i < terrain.mask.length; i++) {
    const x = i % width;
    const o = i * 4;
    const cell = terrain.mask[i];
    if (cell === 2) {
      runLength[x] = 0;
      buildingRunLength[x]++;
      if (buildingRunLength[x] <= BUILDING_ROOF_DEPTH) {
        imageData.data[o] = 90;
        imageData.data[o + 1] = 94;
        imageData.data[o + 2] = 102;
      } else {
        imageData.data[o] = 178;
        imageData.data[o + 1] = 124;
        imageData.data[o + 2] = 88;
      }
      imageData.data[o + 3] = 255;
    } else if (cell === 1) {
      buildingRunLength[x] = 0;
      runLength[x]++;
      if (runLength[x] <= GRASS_DEPTH) {
        imageData.data[o] = 111;
        imageData.data[o + 1] = 191;
        imageData.data[o + 2] = 74;
      } else if (runLength[x] <= DIRT_TRANSITION_DEPTH) {
        imageData.data[o] = 139;
        imageData.data[o + 1] = 90;
        imageData.data[o + 2] = 43;
      } else {
        imageData.data[o] = 90;
        imageData.data[o + 1] = 58;
        imageData.data[o + 2] = 30;
      }
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

const TEAM_COLORS: Record<string, number> = { p1: 0x2fbfae, p2: 0xe85d75 };
const BODY_COLOR = 0xf2a6a6;
const BODY_SHADE_COLOR = 0xd97c7c;

function drawWorm(graphics: Phaser.GameObjects.Graphics, worm: Worm, isActive: boolean): void {
  const teamColor = TEAM_COLORS[worm.team] ?? 0xdddddd;
  const facing = worm.facing;

  // Soft ground shadow
  graphics.fillStyle(0x000000, 0.18);
  graphics.fillEllipse(worm.x, worm.y + 10, 20, 6);

  // Ring around the active worm - team color already carries the
  // team distinction, so the "it's your turn" marker uses a different
  // (gold) color to stay legible against either team's bandana. Sized
  // to clear the bandana rather than cut through it.
  if (isActive) {
    graphics.lineStyle(2.5, 0xffd966, 1);
    graphics.strokeCircle(worm.x, worm.y - 1, 18);
  }

  // Body, with a subtle underside shade for a rounded, cartoon feel
  graphics.fillStyle(BODY_COLOR, 1);
  graphics.fillEllipse(worm.x, worm.y, 22, 17);
  graphics.fillStyle(BODY_SHADE_COLOR, 0.6);
  graphics.fillEllipse(worm.x, worm.y + 5, 17, 8);

  // Team-colored bandana across the top of the head
  graphics.fillStyle(teamColor, 1);
  graphics.fillEllipse(worm.x, worm.y - 6, 20, 7);

  // Eyes, offset toward the direction the worm is facing
  const eyeOffsetX = facing * 5;
  graphics.fillStyle(0xffffff, 1);
  graphics.fillCircle(worm.x + eyeOffsetX - 3, worm.y - 2, 3.4);
  graphics.fillCircle(worm.x + eyeOffsetX + 4, worm.y - 2, 3.4);
  graphics.fillStyle(0x1c1c1c, 1);
  graphics.fillCircle(worm.x + eyeOffsetX - 3 + facing, worm.y - 2, 1.6);
  graphics.fillCircle(worm.x + eyeOffsetX + 4 + facing, worm.y - 2, 1.6);

  // A small smile for personality
  graphics.lineStyle(1.4, 0x8a4a4a, 0.8);
  graphics.beginPath();
  graphics.arc(worm.x + eyeOffsetX + 1, worm.y + 3, 3.5, (20 * Math.PI) / 180, (160 * Math.PI) / 180);
  graphics.strokePath();
}

const PROJECTILE_COLORS: Record<WeaponKey, number> = {
  bazooka: 0xff5722,
  grenade: 0x6fbf4a,
  shotgun: 0xffd966,
  ninjaRope: 0x8d6e63,
  dynamite: 0xd7263d,
};

export function drawScene(
  graphics: Phaser.GameObjects.Graphics,
  worms: Worm[],
  projectiles: Projectile[],
  matchState: MatchState,
  rope: Rope | null,
): void {
  graphics.clear();

  const active = matchState.turnOrder[matchState.currentIndex];

  // Draw rope visualization if attached
  if (rope && rope.anchorX != null && rope.anchorY != null && active.worm.alive) {
    const worm = active.worm;
    graphics.lineStyle(2.5, 0x8d6e63, 1);
    graphics.lineBetween(worm.x, worm.y, rope.anchorX, rope.anchorY);
    graphics.fillStyle(0x8d6e63, 1);
    graphics.fillCircle(rope.anchorX, rope.anchorY, 4);
  }

  // Draw a crosshair showing the active worm's current aim direction
  if (active && active.worm.alive) {
    const worm = active.worm;
    const fireAngle = worm.facing === 1 ? worm.aimAngle : Math.PI - worm.aimAngle;
    const innerRadius = 16;
    const outerRadius = 28;
    const startX = worm.x + Math.cos(fireAngle) * innerRadius;
    const startY = worm.y + Math.sin(fireAngle) * innerRadius;
    const endX = worm.x + Math.cos(fireAngle) * outerRadius;
    const endY = worm.y + Math.sin(fireAngle) * outerRadius;
    graphics.lineStyle(2.5, 0xffd966, 0.95);
    graphics.lineBetween(startX, startY, endX, endY);
    graphics.fillStyle(0xffd966, 0.95);
    graphics.fillCircle(endX, endY, 3);
  }

  for (const worm of worms) {
    if (!worm.alive) continue;
    drawWorm(graphics, worm, Boolean(active && worm === active.worm));

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
    graphics.fillStyle(PROJECTILE_COLORS[projectile.weaponKey] ?? 0xff5722, 1);
    if (projectile.weaponKey === 'dynamite') {
      graphics.fillRoundedRect(projectile.x - 3, projectile.y - 5, 6, 10, 2);
    } else {
      graphics.fillCircle(projectile.x, projectile.y, 4);
      graphics.fillStyle(0xffffff, 0.5);
      graphics.fillCircle(projectile.x - 1.2, projectile.y - 1.2, 1.3);
    }
  }
}

export function updateHud(
  hudText: Phaser.GameObjects.Text,
  matchState: MatchState,
  selectedWeapon: number,
): void {
  hudText.setText(
    `Wind: ${matchState.wind.toFixed(1)}\n` +
      `Time: ${Math.max(0, Math.ceil(matchState.turnTimeRemaining / 1000))}s\n` +
      `Weapon: ${selectedWeapon}`,
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
