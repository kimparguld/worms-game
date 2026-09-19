import Phaser from 'phaser';
import type { Crate } from '../types.js';

// Pool/inUse pattern copied from ProjectileRenderer - crates are a
// simple flat-sprite entity with no animation, and in practice there's
// never more than one active at a time (see matchLoop's
// CRATE_SPAWN_INTERVAL_TURNS), but the array keeps this consistent with
// every other entity list on MatchRuntime.
export class CrateRenderer {
  private pool: Phaser.GameObjects.Image[] = [];
  private inUse: Phaser.GameObjects.Image[] = [];

  constructor(
    private scene: Phaser.Scene,
    private worldObjects: Phaser.GameObjects.GameObject[],
  ) {}

  update(crates: Crate[]): void {
    while (this.inUse.length > crates.length) {
      const image = this.inUse.pop()!;
      image.setVisible(false);
      this.pool.push(image);
    }

    for (let i = 0; i < crates.length; i++) {
      const crate = crates[i];
      const image = this.inUse[i] ?? this.acquire();
      this.inUse[i] = image;
      image.setPosition(crate.x, crate.y).setVisible(true);
    }
  }

  private acquire(): Phaser.GameObjects.Image {
    const existing = this.pool.pop();
    if (existing) return existing;
    const image = this.scene.add.image(0, 0, 'crate').setVisible(false);
    this.worldObjects.push(image);
    return image;
  }
}
