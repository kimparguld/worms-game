import Phaser from 'phaser';
import type { Worm, Team, Terrain, WeaponKey } from '../types.js';
import { wormAnimationState } from './wormAnimationState.js';
import { TEAM_COLORS, deathWiggleRotation, deathWiggleScale } from '../render.js';
import { DEATH_ANIM_DURATION_MS, STARTING_HP } from '../constants.js';

// Fraction of the death animation spent on the wiggle clip before the sprite
// hides and EffectsRenderer's poof burst takes over - matches the old
// drawDyingWorm's DEATH_WIGGLE_END_FRACTION (src/render.ts:1016, now private
// again since drawDyingWorm itself is deleted in Task 12).
const DEATH_WIGGLE_END_FRACTION = 0.8;

const HAND_OFFSET = 11; // px along facing, past the head - matches the old handPosition() (src/render.ts:717-720)
const HP_BAR_WIDTH = 28;
const HP_BAR_HEIGHT = 6;
// Deliberately NOT read from the manifest (unlike HudRenderer's team bars,
// which do). 'health_bar_frame' declares 6/6/6/6, tuned for the ~20px-tall
// team bars; this per-worm pill reuses the same source asset at less than half
// that height (HP_BAR_HEIGHT + 4 = 10px), where a 6px top plus a 6px bottom
// inset would exceed the display height and make the two slices overlap by
// 2px - invisible on flat placeholder colour, visibly squashed with real frame
// art. 2px a side leaves 6px of stretchable middle at this size.
const HP_BAR_INSET = 2;

export class WormRenderer {
  private sprite: Phaser.GameObjects.Sprite;
  private headband: Phaser.GameObjects.Image;
  private weaponImage: Phaser.GameObjects.Image;
  private hpBarFrame: Phaser.GameObjects.NineSlice;
  private hpBarFill: Phaser.GameObjects.Rectangle;
  private lastAnimationState: string | null = null;

  constructor(scene: Phaser.Scene, worldObjects: Phaser.GameObjects.GameObject[], worm: Worm, team: Team) {
    this.sprite = scene.add.sprite(worm.x, worm.y, 'worm_idle').setOrigin(0.5, 0.5);
    this.headband = scene.add.image(worm.x, worm.y, 'worm_headband').setTint(TEAM_COLORS[team.playerId] ?? 0xdddddd);
    this.weaponImage = scene.add.image(worm.x, worm.y, 'bazooka_held').setVisible(false);
    this.hpBarFrame = scene.add.nineslice(
      worm.x,
      worm.y,
      'health_bar_frame',
      undefined,
      HP_BAR_WIDTH + 4,
      HP_BAR_HEIGHT + 4,
      HP_BAR_INSET,
      HP_BAR_INSET,
      HP_BAR_INSET,
      HP_BAR_INSET,
    );
    this.hpBarFill = scene.add.rectangle(worm.x, worm.y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x6fbf4a).setOrigin(0, 0.5);
    worldObjects.push(this.sprite, this.headband, this.weaponImage, this.hpBarFrame, this.hpBarFill);
  }

  update(worm: Worm, isActive: boolean, activeWeaponKey: WeaponKey | undefined, terrain: Terrain, timeMs: number): void {
    void terrain; // ground-shadow rendering was dropped in this rewrite (see plan Task 6 note) - kept in the signature so callers don't need worm-shadow-specific branching
    void timeMs; // animation timing is driven by Phaser's own AnimationManager clock via sprite.play(), not a caller-supplied timestamp - kept in the signature to match Task 11's call site and this project's tsconfig noUnusedParameters check
    const state = wormAnimationState(worm);

    if (state === 'dead') {
      this.setAllVisible(false);
      return;
    }

    this.sprite.setFlipX(worm.facing === -1);
    this.sprite.setPosition(worm.x, worm.y);

    if (state === 'death') {
      const elapsed = DEATH_ANIM_DURATION_MS - (worm.deathTimer ?? 0);
      const fraction = elapsed / DEATH_ANIM_DURATION_MS;
      if (fraction >= DEATH_WIGGLE_END_FRACTION) {
        // Handed off to EffectsRenderer's poof burst (GameScene tracks the
        // WeakSet-based "already poofed" check, see Task 8/11).
        this.setAllVisible(false);
        return;
      }
      this.playAnimation('death');
      this.sprite.setRotation(deathWiggleRotation(elapsed, DEATH_ANIM_DURATION_MS));
      this.sprite.setScale(deathWiggleScale(elapsed, DEATH_ANIM_DURATION_MS));
      this.sprite.setVisible(true);
      this.headband.setVisible(false);
      this.weaponImage.setVisible(false);
      this.hpBarFrame.setVisible(false);
      this.hpBarFill.setVisible(false);
      return;
    }

    this.sprite.setRotation(0);
    this.sprite.setScale(1);
    this.sprite.setVisible(true);
    this.playAnimation(state);

    const facing = worm.facing;
    const headX = worm.x + facing * 6;
    const headY = worm.y;
    this.headband.setPosition(headX, headY - 6).setFlipX(facing === -1).setVisible(true);

    if (isActive && activeWeaponKey) {
      const handX = headX + facing * HAND_OFFSET;
      const handY = headY + 2;
      const fireAngle = facing === 1 ? worm.aimAngle : Math.PI - worm.aimAngle;
      this.weaponImage
        .setTexture(`${activeWeaponKey}_held`)
        .setPosition(handX, handY)
        .setRotation(fireAngle)
        .setFlipY(facing === -1)
        .setVisible(true);
    } else {
      this.weaponImage.setVisible(false);
    }

    const hpFraction = Math.max(0, worm.hp / STARTING_HP);
    const barX = worm.x - HP_BAR_WIDTH / 2;
    const barY = worm.y - 25;
    this.hpBarFrame.setPosition(worm.x, barY).setVisible(true);
    this.hpBarFill.setPosition(barX, barY).setSize(HP_BAR_WIDTH * hpFraction, HP_BAR_HEIGHT).setVisible(true);
    this.hpBarFill.setFillStyle(hpFraction > 0.5 ? 0x6fbf4a : hpFraction > 0.25 ? 0xffd966 : 0xe85d5d);
  }

  private playAnimation(state: string): void {
    if (this.lastAnimationState === state) return;
    this.lastAnimationState = state;
    this.sprite.play(`worm_${state}`);
  }

  private setAllVisible(visible: boolean): void {
    this.sprite.setVisible(visible);
    this.headband.setVisible(visible);
    this.weaponImage.setVisible(visible && this.weaponImage.visible);
    this.hpBarFrame.setVisible(visible);
    this.hpBarFill.setVisible(visible);
  }
}
