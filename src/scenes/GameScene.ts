import Phaser from 'phaser';
import { createMatchRuntime, stepMatch, WEAPON_KEYS } from '../matchLoop.js';
import { checkWinner, currentWorm } from '../game.js';
import {
  drawTerrain, drawScene, updateHud, drawSky, drawWater, turnBannerAlpha, turnBannerLabel, drawTeamHealthBars,
  teamHealthBarX, TEAM_BAR_WIDTH,
} from '../render.js';
import { sharedInput } from '../inputState.js';
import { resetInputState } from '../input.js';
import { TURN_BANNER_DURATION_MS } from '../constants.js';
import type { Worm, MatchRuntime } from '../types.js';

interface GameSceneData {
  team1Name?: string;
  team2Name?: string;
}

export class GameScene extends Phaser.Scene {
  private rt!: MatchRuntime;
  private team1Name = 'Team 1';
  private team2Name = 'Team 2';

  private terrainTexture!: Phaser.Textures.CanvasTexture;
  private waterGraphics!: Phaser.GameObjects.Graphics;
  private graphics!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private turnBannerText!: Phaser.GameObjects.Text;

  private emberEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private debrisEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private splashEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  // Identity-tracked (not value-tracked): an explosion/splash's `timer`
  // counts down every frame, so the only reliable "have I already fired a
  // burst for this one" check is object identity, not its current field
  // values. Entries fall out on their own once matchLoop's filter() drops
  // the dead effect and nothing else references it.
  private burstedExplosions = new WeakSet<object>();
  private burstedSplashes = new WeakSet<object>();
  private bannerWasVisible = false;

  constructor() {
    super('GameScene');
  }

  init(data: GameSceneData): void {
    this.team1Name = data.team1Name ?? 'Team 1';
    this.team2Name = data.team2Name ?? 'Team 2';
  }

  create(): void {
    resetInputState(sharedInput);

    const { width, height } = this.scale;
    this.rt = createMatchRuntime(width, height, this.team1Name, this.team2Name);

    // Static sky/cloud backdrop, drawn once - it never changes during a
    // match, unlike the terrain (destructible) and worms (moving) above it.
    const sky = this.add.graphics();
    drawSky(sky, width, height);

    // Sits behind the terrain layer (added next) so it's only visible where
    // terrain has been dug/blown away down to the water line; redrawn every
    // frame in update() so its surface highlight can animate.
    this.waterGraphics = this.add.graphics();
    drawWater(this.waterGraphics, width, height, 0);

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

    [0, 1].forEach((i) =>
      this.add
        .text(teamHealthBarX(i, width) + TEAM_BAR_WIDTH / 2, 8, this.rt.teams[i].name, {
          fontFamily: "'Baloo 2', sans-serif",
          fontSize: '16px',
          fontStyle: '700',
          color: '#fff8e7',
          stroke: '#16213f',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 0),
    );

    this.createParticleEmitters();

    // Release the terrain texture's GPU memory when this scene shuts down
    // (on restart, or when EndScene takes over) instead of leaking it.
    this.events.once('shutdown', () => {
      if (this.textures.exists('terrainTex')) this.textures.remove('terrainTex');
    });
  }

  // One shared 8x8 white dot texture, tinted per-emitter - cheaper than a
  // separate generated texture per effect, and tinting is all these bursts
  // need since they're flat-colored particles, not sprite art.
  private createParticleEmitters(): void {
    if (!this.textures.exists('particleDot')) {
      const dot = this.make.graphics({ x: 0, y: 0 });
      dot.fillStyle(0xffffff, 1);
      dot.fillCircle(4, 4, 4);
      dot.generateTexture('particleDot', 8, 8);
      dot.destroy();
    }

    this.emberEmitter = this.add.particles(0, 0, 'particleDot', {
      lifespan: 450,
      speed: { min: 60, max: 240 },
      scale: { start: 1.2, end: 0 },
      tint: [0xfff2b0, 0xffb347, 0xff5a1a],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.debrisEmitter = this.add.particles(0, 0, 'particleDot', {
      lifespan: 700,
      speed: { min: 40, max: 160 },
      angle: { min: -150, max: -30 },
      gravityY: 500,
      scale: { start: 0.9, end: 0.2 },
      tint: [0x96622e, 0x6b4523],
      emitting: false,
    });
    this.splashEmitter = this.add.particles(0, 0, 'particleDot', {
      lifespan: 500,
      speed: { min: 60, max: 180 },
      angle: { min: -150, max: -30 },
      gravityY: 700,
      scale: { start: 0.8, end: 0.1 },
      tint: [0xdff3fb, 0x8fd8f7],
      emitting: false,
    });
  }

  // Fires the one-shot particle burst + camera shake for any explosion or
  // splash that appeared since the last frame. Identity (not value) based,
  // see burstedExplosions/burstedSplashes field comment.
  private triggerEffectBursts(): void {
    for (const ex of this.rt.explosions) {
      if (this.burstedExplosions.has(ex)) continue;
      this.burstedExplosions.add(ex);
      this.emberEmitter.explode(18, ex.x, ex.y);
      this.debrisEmitter.explode(10, ex.x, ex.y);
      const intensity = Phaser.Math.Clamp(ex.radius / 900, 0.002, 0.012);
      this.cameras.main.shake(180, intensity);
    }
    for (const sp of this.rt.splashes) {
      if (this.burstedSplashes.has(sp)) continue;
      this.burstedSplashes.add(sp);
      this.splashEmitter.explode(14, sp.x, sp.y);
    }
  }

  update(time: number, delta: number): void {
    const dt = Math.min(0.05, delta / 1000);
    stepMatch(this.rt, sharedInput, dt);

    drawWater(this.waterGraphics, this.scale.width, this.scale.height, time);
    drawTerrain(this.terrainTexture, this.rt.terrain);
    drawScene(
      this.graphics,
      this.allWorms(),
      this.rt.projectiles,
      this.rt.match,
      this.rt.rope,
      this.rt.charging,
      this.rt.chargePower,
      this.rt.gravestones,
      this.rt.shotgunTracer,
      WEAPON_KEYS[sharedInput.selectedWeapon - 1] ?? 'bazooka',
      time,
      this.rt.explosions,
      this.rt.splashes,
    );
    drawTeamHealthBars(this.graphics, this.rt.teams, this.scale.width);
    updateHud(this.hudText, this.rt.match, sharedInput.selectedWeapon);
    this.triggerEffectBursts();

    const bannerAlpha = turnBannerAlpha(this.rt.turnBannerTimer ?? 0, TURN_BANNER_DURATION_MS);
    this.turnBannerText.setAlpha(bannerAlpha);
    if (bannerAlpha > 0) this.turnBannerText.setText(turnBannerLabel(currentWorm(this.rt.match).playerId));
    if (bannerAlpha > 0 && !this.bannerWasVisible) {
      // Pop the banner in with a quick overshoot instead of a hard alpha
      // snap, so a turn switch reads as an announcement, not a glitch.
      this.turnBannerText.setScale(0.7);
      this.tweens.add({ targets: this.turnBannerText, scale: 1, duration: 220, ease: 'Back.Out' });
    }
    this.bannerWasVisible = bannerAlpha > 0;

    const result = checkWinner(this.rt.teams);
    if (result) this.scene.start('EndScene', { winner: result });
  }

  private allWorms(): Worm[] {
    return this.rt.teams.flatMap((t) => t.worms);
  }
}
