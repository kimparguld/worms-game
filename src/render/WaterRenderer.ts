import Phaser from 'phaser';
import { waterLevelY } from '../terrain.js';
import type { Terrain } from '../types.js';

const SCROLL_PX_PER_SECOND = 18;

// A TileSprite on one tileable water texture, tilePositionX advanced every
// frame - replaces the procedural wave-line drawing. Scroll alone reads as
// moving water, no animation frames needed.
export class WaterRenderer {
  private tileSprite: Phaser.GameObjects.TileSprite;

  constructor(scene: Phaser.Scene, worldObjects: Phaser.GameObjects.GameObject[], width: number, height: number, terrain: Terrain) {
    const waterY = waterLevelY(terrain);
    this.tileSprite = scene.add.tileSprite(0, waterY, width, height - waterY, 'water').setOrigin(0, 0);
    worldObjects.push(this.tileSprite);
  }

  update(timeMs: number): void {
    this.tileSprite.tilePositionX = (timeMs / 1000) * SCROLL_PX_PER_SECOND;
  }
}
