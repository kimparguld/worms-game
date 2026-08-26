import type { Terrain, Worm, Projectile, MatchState, Rope } from './types.js';

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  terrain: Terrain,
  worms: Worm[],
  projectiles: Projectile[],
  matchState: MatchState,
  selectedWeapon: number,
  rope: Rope | null,
): void {
  const { width, height } = terrain;
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < terrain.mask.length; i++) {
    const solid = terrain.mask[i] === 1;
    const o = i * 4;
    imageData.data[o] = solid ? 92 : 110;
    imageData.data[o + 1] = solid ? 64 : 190;
    imageData.data[o + 2] = solid ? 51 : 255;
    imageData.data[o + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  const active = matchState.turnOrder[matchState.currentIndex];

  // Draw rope visualization if attached
  if (rope && rope.anchorX != null && rope.anchorY != null) {
    const worm = active.worm;
    const ropeColor = '#8d6e63';

    ctx.strokeStyle = ropeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(worm.x, worm.y);
    ctx.lineTo(rope.anchorX, rope.anchorY);
    ctx.stroke();

    ctx.fillStyle = ropeColor;
    ctx.beginPath();
    ctx.arc(rope.anchorX, rope.anchorY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const worm of worms) {
    if (!worm.alive) continue;
    ctx.fillStyle = active && worm === active.worm ? '#ffee58' : '#e0e0e0';
    ctx.beginPath();
    ctx.arc(worm.x, worm.y, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#000';
    ctx.fillRect(worm.x - 12, worm.y - 18, 24, 4);
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(worm.x - 12, worm.y - 18, 24 * (worm.hp / 100), 4);
  }

  ctx.fillStyle = '#ff5722';
  for (const projectile of projectiles) {
    if (!projectile.alive) continue;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#fff';
  ctx.font = '16px sans-serif';
  ctx.fillText(`Wind: ${matchState.wind.toFixed(1)}`, 10, 20);
  ctx.fillText(`Time: ${Math.max(0, Math.ceil(matchState.turnTimeRemaining / 1000))}s`, 10, 40);
  ctx.fillText(`Weapon: ${selectedWeapon}`, 10, 60);
}
