import type Phaser from 'phaser';
import { STARTING_HP, DEATH_ANIM_DURATION_MS } from './constants.js';
import { WEAPON_KEYS } from './matchLoop.js';
import { WEAPONS } from './weapons.js';
import type { Terrain, Worm, Projectile, MatchState, Rope, WeaponKey, Team, Gravestone } from './types.js';

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
        // Dark lip along the very top of the roof, for a bit of depth.
        r = 66; g = 70; b = 78;
      } else if (depth < BUILDING_ROOF_DEPTH) {
        r = 90; g = 94; b = 102;
      } else if (atLeftEdge || atRightEdge) {
        // Shaded corners so the facade reads as a solid volume.
        r = 142; g = 96; b = 66;
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
  drawWorm(graphics, worm, false);
  graphics.restore();
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

export function drawScene(
  graphics: Phaser.GameObjects.Graphics,
  worms: Worm[],
  projectiles: Projectile[],
  matchState: MatchState,
  rope: Rope | null,
  charging: boolean,
  chargePower: number,
  gravestones: Gravestone[],
): void {
  graphics.clear();
  drawGravestones(graphics, gravestones);

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
  if (active && active.worm.alive) {
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
    const def = WEAPONS[projectile.weaponKey];
    const isBlinkingRed =
      def.fuseTime != null &&
      projectile.fuseRemaining != null &&
      projectileBlinkOn(projectile.fuseRemaining, def.fuseTime);
    const fallbackColor = PROJECTILE_COLORS[projectile.weaponKey] ?? 0xff5722;
    graphics.fillStyle(isBlinkingRed ? 0xff2222 : fallbackColor, 1);
    if (projectile.weaponKey === 'dynamite') {
      graphics.fillRoundedRect(projectile.x - 3, projectile.y - 5, 6, 10, 2);
    } else {
      graphics.fillCircle(projectile.x, projectile.y, 4);
      graphics.fillStyle(0xffffff, 0.5);
      graphics.fillCircle(projectile.x - 1.2, projectile.y - 1.2, 1.3);
    }
  }
}

// A Record (not a positional array) so TypeScript errors if a WeaponKey is
// ever added to WEAPON_KEYS in matchLoop.ts without a matching label here.
const WEAPON_LABELS: Record<WeaponKey, string> = {
  bazooka: 'Bazooka',
  grenade: 'Grenade',
  shotgun: 'Shotgun',
  ninjaRope: 'Ninja Rope',
  dynamite: 'Dynamite',
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
