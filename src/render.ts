import type Phaser from 'phaser';
import { CAMERA_ZOOM_BOOST } from './constants.js';
import { WEAPON_KEYS } from './matchLoop.js';
import { WEAPONS } from './weapons.js';
import type { MatchState, WeaponKey, Team } from './types.js';

export const TEAM_COLORS: Record<string, number> = { p1: 0x14d6b8, p2: 0xff3860, p3: 0xffb627, p4: 0x9b5de5 };

// Display-list depth bands.
//
// Phaser sorts the display list by `depth` first and falls back to insertion
// order only *within* one depth, and every Game Object starts at depth 0. That
// makes insertion order the whole z-order for this scene - which is fine for
// everything built up front in GameScene.create(), and wrong for anything
// created mid-match: a gravestone or splash spawned on frame 4000 lands at the
// very front, on top of the worms, even though the old drawScene drew both
// underneath them.
//
// Two bands are enough to fix that. The static backdrop (sky, water, terrain
// layers) sinks to DEPTH_BACKDROP, which opens up DEPTH_BEHIND_WORMS as a slot
// that is above the backdrop but below the default 0 that worms, projectiles,
// explosions, the aim/rope lines and the HUD all keep. Explosions deliberately
// stay at the default so they still draw on top, as they did before.
export const DEPTH_BACKDROP = -20;
export const DEPTH_BEHIND_WORMS = -10;

// CSS-hex form of TEAM_COLORS, for the DOM/Phaser.Text styling APIs that
// take a string instead of the numeric fill color Graphics calls use.
export function teamColorCss(playerId: string): string {
  const teamColor = TEAM_COLORS[playerId] ?? 0xdddddd;
  return `#${teamColor.toString(16).padStart(6, '0')}`;
}

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
  homingMissile: 'Homing Missile',
  clusterBomb: 'Cluster Bomb',
  clusterFragment: 'Cluster Fragment',
  bat: 'Baseball Bat',
  steelStructure: 'Steel Girder',
};

export function weaponLabel(selectedWeapon: number): string {
  const key = WEAPON_KEYS[selectedWeapon - 1] ?? WEAPON_KEYS[0];
  return WEAPON_LABELS[key];
}

// A weapon with no per-match limit (see WEAPON_MATCH_LIMITS) gets no
// suffix at all; a limited one shows its remaining count, or OUT once spent.
export function weaponAmmoLabel(remainingUses: number | undefined): string {
  if (remainingUses === undefined) return '';
  if (remainingUses <= 0) return ' (OUT)';
  return ` (${remainingUses} left)`;
}

export function updateHud(hudText: Phaser.GameObjects.Text, matchState: MatchState): void {
  hudText.setText(
    `Wind: ${matchState.wind.toFixed(1)}\n` +
      `Time: ${Math.max(0, Math.ceil(matchState.turnTimeRemaining / 1000))}s`,
  );
}

export function updateWeaponText(
  weaponText: Phaser.GameObjects.Text,
  selectedWeapon: number,
  remainingUses: number | undefined,
): void {
  const key = WEAPON_KEYS[selectedWeapon - 1] ?? WEAPON_KEYS[0];
  const actionHint = WEAPONS[key].airstrike
    ? '\nFire to call random rain'
    : WEAPONS[key].homing
      ? '\nClick the map to set a target'
      : WEAPONS[key].structure
        ? '\nClick near your worm to place'
        : '';
  weaponText.setText(
    `Weapon: ${selectedWeapon} - ${weaponLabel(selectedWeapon)}${weaponAmmoLabel(remainingUses)}` + actionHint,
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
  const maxHp = team.worms.reduce((sum, w) => sum + w.maxHp, 0);
  return totalHp / maxHp;
}

export const TEAM_BAR_WIDTH = 220;
const TEAM_BAR_MARGIN = 16; // horizontal inset from the screen edge

const TEAM_BAR_ROW_HEIGHT = 46; // px between the first and second row of team bars (name + bar)

// Even-indexed teams sit at the left edge, odd ones at the right, so teams
// 1/2 keep their old spots and teams 3/4 stack in a second row beneath them.
export function teamHealthBarX(index: number, canvasWidth: number): number {
  return index % 2 === 0 ? TEAM_BAR_MARGIN : canvasWidth - TEAM_BAR_MARGIN - TEAM_BAR_WIDTH;
}

// Vertical offset of a team's name + bar from the first row.
export function teamHudRowOffset(index: number): number {
  return Math.floor(index / 2) * TEAM_BAR_ROW_HEIGHT;
}

export interface WeaponPickerCell {
  slot: number; // 1-based, same numbering as InputState.selectedWeapon
  x: number;
  y: number;
}

export interface WeaponPickerLayout {
  panelX: number;
  panelY: number;
  panelWidth: number;
  panelHeight: number;
  cellWidth: number;
  cellHeight: number;
  cells: WeaponPickerCell[];
}

export const WEAPON_PICKER_TITLE_HEIGHT = 40;
const WEAPON_PICKER_CELL_WIDTH = 116;
const WEAPON_PICKER_CELL_HEIGHT = 84;
const WEAPON_PICKER_GAP = 8;
const WEAPON_PICKER_PADDING = 16;
const WEAPON_PICKER_MAX_COLUMNS = 5;
const WEAPON_PICKER_SCREEN_MARGIN = 16;

// Grid of weapon slots centred on screen. Columns shrink to fit narrow
// (mobile) viewports so the panel never runs off the side; cell (x, y) is
// the cell's top-left corner in screen space.
export function weaponPickerLayout(weaponCount: number, screenWidth: number, screenHeight: number): WeaponPickerLayout {
  const fitColumns = Math.floor(
    (screenWidth - WEAPON_PICKER_SCREEN_MARGIN * 2 - WEAPON_PICKER_PADDING * 2 + WEAPON_PICKER_GAP) /
      (WEAPON_PICKER_CELL_WIDTH + WEAPON_PICKER_GAP),
  );
  const columns = Math.max(1, Math.min(WEAPON_PICKER_MAX_COLUMNS, weaponCount, fitColumns));
  const rows = Math.ceil(weaponCount / columns);
  const panelWidth =
    WEAPON_PICKER_PADDING * 2 + columns * WEAPON_PICKER_CELL_WIDTH + (columns - 1) * WEAPON_PICKER_GAP;
  const panelHeight =
    WEAPON_PICKER_TITLE_HEIGHT +
    WEAPON_PICKER_PADDING * 2 +
    rows * WEAPON_PICKER_CELL_HEIGHT +
    (rows - 1) * WEAPON_PICKER_GAP;
  const panelX = Math.round((screenWidth - panelWidth) / 2);
  const panelY = Math.max(WEAPON_PICKER_SCREEN_MARGIN, Math.round((screenHeight - panelHeight) / 2));
  const cells: WeaponPickerCell[] = [];
  for (let i = 0; i < weaponCount; i++) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    cells.push({
      slot: i + 1,
      x: panelX + WEAPON_PICKER_PADDING + column * (WEAPON_PICKER_CELL_WIDTH + WEAPON_PICKER_GAP),
      y: panelY + WEAPON_PICKER_TITLE_HEIGHT + WEAPON_PICKER_PADDING + row * (WEAPON_PICKER_CELL_HEIGHT + WEAPON_PICKER_GAP),
    });
  }
  return {
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    cellWidth: WEAPON_PICKER_CELL_WIDTH,
    cellHeight: WEAPON_PICKER_CELL_HEIGHT,
    cells,
  };
}

// Keeps a camera's centre, on one axis, far enough from either world edge
// that its view never shows past it. A view larger than the world on that
// axis centres on it - or, with alignEnd, sits flush against the world's far
// end (used vertically, so a zoomed-out view keeps the ground at the bottom
// of the screen and shows extra sky above it rather than below the water).
export function clampCameraCenter(focus: number, viewSize: number, worldSize: number, alignEnd = false): number {
  if (viewSize >= worldSize) return alignEnd ? worldSize - viewSize / 2 : worldSize / 2;
  const half = viewSize / 2;
  return Math.max(half, Math.min(worldSize - half, focus));
}

// Wheel-zoom range. `max` is the default play zoom - (nearly) the whole
// world height on screen, see CAMERA_ZOOM_BOOST - and the closest the
// camera ever gets; `min` zooms out until the entire map fits.
export function cameraZoomLimits(
  screenWidth: number,
  screenHeight: number,
  worldWidth: number,
  worldHeight: number,
): { min: number; max: number } {
  const max = (screenHeight / worldHeight) * CAMERA_ZOOM_BOOST;
  const min = Math.min(max, screenWidth / worldWidth, screenHeight / worldHeight);
  return { min, max };
}

// The camera centre (on one axis) that keeps `anchorWorld` - the world point
// under the cursor - under the same screen position `pointerScreen` after
// switching to `zoom`, so wheel zoom closes in on whatever the cursor is on.
export function zoomAnchoredCenter(anchorWorld: number, pointerScreen: number, screenSize: number, zoom: number): number {
  return anchorWorld - (pointerScreen - screenSize / 2) / zoom;
}

// Screen-edge scrolling: -1/1 while the pointer sits within `margin` px of
// the left/right edge, 0 elsewhere.
export function edgeScrollDirection(pointerX: number, screenWidth: number, margin: number): -1 | 0 | 1 {
  if (pointerX <= margin) return -1;
  if (pointerX >= screenWidth - margin) return 1;
  return 0;
}
