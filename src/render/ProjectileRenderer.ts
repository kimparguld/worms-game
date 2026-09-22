import Phaser from 'phaser';
import type { Projectile, WeaponKey } from '../types.js';
import { WEAPONS } from '../weapons.js';
import { projectileBlinkOn } from '../render.js';
import { WORM_RENDER_SCALE } from '../constants.js';

const DIRECTIONAL_WEAPONS = new Set<WeaponKey>(['bazooka', 'airstrikeRocket', 'sniperRifle', 'drill', 'homingMissile']);
const BLINK_TINT = 0xff2222;
const NORMAL_TINT = 0xffffff;
// Drawn at the same multiple of their native art size as the worms (see
// WORM_RENDER_SCALE), so a shot reads at a matching scale on screen.
// Render-only: projectile collision is a point, unaffected by this.
const PROJECTILE_RENDER_SCALE = WORM_RENDER_SCALE;

export class ProjectileRenderer {
  private pool: Phaser.GameObjects.Image[] = [];
  private inUse: Phaser.GameObjects.Image[] = [];

  constructor(
    private scene: Phaser.Scene,
    private worldObjects: Phaser.GameObjects.GameObject[],
  ) {}

  update(projectiles: Projectile[]): void {
    const live = projectiles.filter((p) => p.alive);

    // Release any pooled image no longer backed by a live projectile.
    while (this.inUse.length > live.length) {
      const image = this.inUse.pop()!;
      image.setVisible(false);
      this.pool.push(image);
    }

    for (let i = 0; i < live.length; i++) {
      const projectile = live[i];
      const image = this.inUse[i] ?? this.acquire();
      this.inUse[i] = image;

      const def = WEAPONS[projectile.weaponKey];
      const isBlinking =
        def.fuseTime != null && projectile.fuseRemaining != null && projectileBlinkOn(projectile.fuseRemaining, def.fuseTime);

      image
        .setTexture(`${projectile.weaponKey}_projectile`)
        .setPosition(projectile.x, projectile.y)
        .setScale(PROJECTILE_RENDER_SCALE)
        .setTint(isBlinking ? BLINK_TINT : NORMAL_TINT)
        .setVisible(true);

      if (DIRECTIONAL_WEAPONS.has(projectile.weaponKey)) {
        image.setRotation(Math.atan2(projectile.vy, projectile.vx));
      } else {
        image.setRotation(0);
      }
    }
  }

  private acquire(): Phaser.GameObjects.Image {
    const existing = this.pool.pop();
    if (existing) return existing;
    const image = this.scene.add.image(0, 0, 'bazooka_projectile').setVisible(false);
    this.worldObjects.push(image);
    return image;
  }
}
