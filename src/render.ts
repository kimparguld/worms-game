import type Phaser from 'phaser';
import { STARTING_HP } from './constants.js';
import type { Terrain, Worm, Projectile, MatchState, Rope } from './types.js';

let cachedImageData: ImageData | null = null;
let cachedWidth = 0;
let cachedHeight = 0;

export function drawTerrain(texture: Phaser.Textures.CanvasTexture, terrain: Terrain): void {
  const { width, height } = terrain;
  if (!cachedImageData || cachedWidth !== width || cachedHeight !== height) {
    cachedImageData = texture.context.createImageData(width, height);
    cachedWidth = width;
    cachedHeight = height;
  }
  const imageData = cachedImageData;
  for (let i = 0; i < terrain.mask.length; i++) {
    const solid = terrain.mask[i] === 1;
    const o = i * 4;
    imageData.data[o] = solid ? 92 : 110;
    imageData.data[o + 1] = solid ? 64 : 190;
    imageData.data[o + 2] = solid ? 51 : 255;
    imageData.data[o + 3] = 255;
  }
  texture.context.putImageData(imageData, 0, 0);
  texture.refresh();
}

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
    graphics.lineStyle(2, 0x8d6e63, 1);
    graphics.lineBetween(worm.x, worm.y, rope.anchorX, rope.anchorY);
    graphics.fillStyle(0x8d6e63, 1);
    graphics.fillCircle(rope.anchorX, rope.anchorY, 4);
  }

  // Draw a crosshair showing the active worm's current aim direction
  if (active && active.worm.alive) {
    const worm = active.worm;
    const fireAngle = worm.facing === 1 ? worm.aimAngle : Math.PI - worm.aimAngle;
    const innerRadius = 14;
    const outerRadius = 26;
    const startX = worm.x + Math.cos(fireAngle) * innerRadius;
    const startY = worm.y + Math.sin(fireAngle) * innerRadius;
    const endX = worm.x + Math.cos(fireAngle) * outerRadius;
    const endY = worm.y + Math.sin(fireAngle) * outerRadius;
    graphics.lineStyle(2, 0xffffff, 0.9);
    graphics.lineBetween(startX, startY, endX, endY);
    graphics.fillStyle(0xffffff, 0.9);
    graphics.fillCircle(endX, endY, 3);
  }

  for (const worm of worms) {
    if (!worm.alive) continue;
    graphics.fillStyle(active && worm === active.worm ? 0xffee58 : 0xe0e0e0, 1);
    graphics.fillCircle(worm.x, worm.y, 8);

    graphics.fillStyle(0x000000, 1);
    graphics.fillRect(worm.x - 12, worm.y - 18, 24, 4);
    graphics.fillStyle(0x4caf50, 1);
    graphics.fillRect(worm.x - 12, worm.y - 18, 24 * (worm.hp / STARTING_HP), 4);
  }

  graphics.fillStyle(0xff5722, 1);
  for (const projectile of projectiles) {
    if (!projectile.alive) continue;
    graphics.fillCircle(projectile.x, projectile.y, 3);
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
