import Phaser from 'phaser';
import { createMatchRuntime, stepMatch } from '../matchLoop.js';
import { checkWinner } from '../game.js';
import { drawTerrain, drawScene, updateHud, drawSky } from '../render.js';
import { sharedInput } from '../inputState.js';
import { resetInputState } from '../input.js';
import type { Worm, MatchRuntime } from '../types.js';

export class GameScene extends Phaser.Scene {
  private rt!: MatchRuntime;

  private terrainTexture!: Phaser.Textures.CanvasTexture;
  private graphics!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;

  constructor() {
    super('GameScene');
  }

  create(): void {
    resetInputState(sharedInput);

    const { width, height } = this.scale;
    this.rt = createMatchRuntime(width, height);

    // Static sky/cloud backdrop, drawn once - it never changes during a
    // match, unlike the terrain (destructible) and worms (moving) above it.
    const sky = this.add.graphics();
    drawSky(sky, width, height);

    if (this.textures.exists('terrainTex')) this.textures.remove('terrainTex');
    // Non-null: the line above always removes any colliding key first, so
    // createCanvas never actually returns null here.
    this.terrainTexture = this.textures.createCanvas('terrainTex', width, height)!;
    this.add.image(0, 0, 'terrainTex').setOrigin(0, 0);

    this.graphics = this.add.graphics();

    const hudPanel = this.add.graphics();
    hudPanel.fillStyle(0x16213f, 0.72);
    hudPanel.fillRoundedRect(6, 6, 150, 74, 10);
    hudPanel.lineStyle(2, 0xffffff, 0.15);
    hudPanel.strokeRoundedRect(6, 6, 150, 74, 10);

    this.hudText = this.add.text(18, 16, '', {
      fontFamily: "'Baloo 2', sans-serif",
      fontSize: '17px',
      color: '#fff8e7',
      lineSpacing: 4,
    });

    // Release the terrain texture's GPU memory when this scene shuts down
    // (on restart, or when EndScene takes over) instead of leaking it.
    this.events.once('shutdown', () => {
      if (this.textures.exists('terrainTex')) this.textures.remove('terrainTex');
    });
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(0.05, delta / 1000);
    stepMatch(this.rt, sharedInput, dt);

    drawTerrain(this.terrainTexture, this.rt.terrain);
    drawScene(this.graphics, this.allWorms(), this.rt.projectiles, this.rt.match, this.rt.rope);
    updateHud(this.hudText, this.rt.match, sharedInput.selectedWeapon);

    const result = checkWinner(this.rt.teams);
    if (result) this.scene.start('EndScene', { winner: result });
  }

  private allWorms(): Worm[] {
    return this.rt.teams.flatMap((t) => t.worms);
  }
}
