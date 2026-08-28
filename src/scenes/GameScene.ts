import Phaser from 'phaser';
import { createMatchRuntime, stepMatch } from '../matchLoop.js';
import { checkWinner, currentWorm } from '../game.js';
import { drawTerrain, drawScene, updateHud, drawSky, turnBannerAlpha, turnBannerLabel, drawTeamHealthBars } from '../render.js';
import { sharedInput } from '../inputState.js';
import { resetInputState } from '../input.js';
import { TURN_BANNER_DURATION_MS } from '../constants.js';
import type { Worm, MatchRuntime } from '../types.js';

export class GameScene extends Phaser.Scene {
  private rt!: MatchRuntime;

  private terrainTexture!: Phaser.Textures.CanvasTexture;
  private graphics!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private turnBannerText!: Phaser.GameObjects.Text;

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

    // The HUD panel sits top-centre, in the gap between the two team life
    // bars (which are anchored to the left and right edges by
    // drawTeamHealthBars). Top-left would sit directly on top of the first
    // team's bar and hide it.
    const hudPanelWidth = 220;
    const hudPanelHeight = 74;
    const hudPanelX = Math.round(width / 2 - hudPanelWidth / 2);
    const hudPanel = this.add.graphics();
    hudPanel.fillStyle(0x16213f, 0.72);
    hudPanel.fillRoundedRect(hudPanelX, 6, hudPanelWidth, hudPanelHeight, 10);
    hudPanel.lineStyle(2, 0xffffff, 0.15);
    hudPanel.strokeRoundedRect(hudPanelX, 6, hudPanelWidth, hudPanelHeight, 10);

    this.hudText = this.add.text(hudPanelX + 14, 16, '', {
      fontFamily: "'Baloo 2', sans-serif",
      fontSize: '17px',
      color: '#fff8e7',
      lineSpacing: 4,
    });

    this.turnBannerText = this.add
      .text(width / 2, height / 2 - 40, '', {
        fontFamily: "'Baloo 2', sans-serif",
        fontSize: '40px',
        fontStyle: '800',
        color: '#fff8e7',
        stroke: '#16213f',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setAlpha(0);

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
    drawScene(this.graphics, this.allWorms(), this.rt.projectiles, this.rt.match, this.rt.rope, this.rt.charging, this.rt.chargePower);
    drawTeamHealthBars(this.graphics, this.rt.teams, this.scale.width);
    updateHud(this.hudText, this.rt.match, sharedInput.selectedWeapon);

    const bannerAlpha = turnBannerAlpha(this.rt.turnBannerTimer ?? 0, TURN_BANNER_DURATION_MS);
    this.turnBannerText.setAlpha(bannerAlpha);
    if (bannerAlpha > 0) this.turnBannerText.setText(turnBannerLabel(currentWorm(this.rt.match).playerId));

    const result = checkWinner(this.rt.teams);
    if (result) this.scene.start('EndScene', { winner: result });
  }

  private allWorms(): Worm[] {
    return this.rt.teams.flatMap((t) => t.worms);
  }
}
