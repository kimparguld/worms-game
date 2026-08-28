import Phaser from 'phaser';
import { createMatchRuntime, stepMatch, WEAPON_KEYS } from '../matchLoop.js';
import { checkWinner, currentWorm } from '../game.js';
import {
  drawTerrain,
  drawScene,
  updateHud,
  drawSky,
  drawWater,
  turnBannerAlpha,
  turnBannerLabel,
  drawTeamHealthBars,
  teamHealthBarX,
  TEAM_BAR_WIDTH,
} from '../render.js';
import { sharedInput } from '../inputState.js';
import { resetInputState } from '../input.js';
import { TURN_BANNER_DURATION_MS, WORLD_WIDTH, WORLD_HEIGHT } from '../constants.js';
import { soundSystem } from '../sound.js';
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
  private uiGraphics!: Phaser.GameObjects.Graphics;
  private uiCamera!: Phaser.Cameras.Scene2D.Camera;
  private hudText!: Phaser.GameObjects.Text;
  private turnBannerText!: Phaser.GameObjects.Text;

  private emberEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private debrisEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private splashEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private muzzleEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private dustEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private activeWormGlow!: Phaser.GameObjects.Image;

  // Identity-tracked (not value-tracked): an explosion/splash's `timer`
  // counts down every frame, so the only reliable "have I already fired a
  // burst for this one" check is object identity, not its current field
  // values. Entries fall out on their own once matchLoop's filter() drops
  // the dead effect and nothing else references it.
  private burstedExplosions = new WeakSet<object>();
  private burstedSplashes = new WeakSet<object>();
  private burstedProjectiles = new WeakSet<object>();
  private burstedShotgunTracers = new WeakSet<object>();
  private bannerWasVisible = false;
  private wasCharging = false;
  // Counts down in triggerMovementDust; only one worm can act per turn, so
  // a single shared cooldown (rather than one per worm) is enough to keep
  // footstep puffs from firing every single frame while walking.
  private dustCooldownMs = 0;

  // Populated as each object is created in create(), then handed to the two
  // cameras' .ignore() calls at the end of create(). Anything that draws at
  // world coordinates (terrain, worms, particles...) belongs in
  // worldObjects; anything that must stay full-size/screen-space (HUD,
  // banner, health bars) belongs in uiObjects. A new effect added later and
  // left off both arrays would render on *both* cameras, doubled up.
  private worldObjects: Phaser.GameObjects.GameObject[] = [];
  private uiObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('GameScene');
  }

  init(data: GameSceneData): void {
    this.team1Name = data.team1Name ?? 'Team 1';
    this.team2Name = data.team2Name ?? 'Team 2';
  }

  create(): void {
    resetInputState(sharedInput);
    // Phaser reuses this Scene instance across restarts (StartScene ->
    // GameScene -> EndScene -> StartScene -> GameScene...), so create() runs
    // more than once over the scene's lifetime while these two arrays are
    // plain class fields initialized only at construction. Without clearing
    // them here, each rematch would push another batch of objects onto
    // arrays still holding references to the previous match's now-destroyed
    // objects - an unbounded leak, and a growing list for every .ignore() call.
    this.worldObjects = [];
    this.uiObjects = [];
    this.input.once('pointerdown', () => this.unlockAudio());
    this.input.keyboard?.once('keydown', () => this.unlockAudio());

    const { width, height } = this.scale; // viewport size - UI-space layout only
    this.rt = createMatchRuntime(WORLD_WIDTH, WORLD_HEIGHT, this.team1Name, this.team2Name);

    // Static sky/cloud backdrop, drawn once - it never changes during a
    // match, unlike the terrain (destructible) and worms (moving) above it.
    const sky = this.add.graphics();
    drawSky(sky, WORLD_WIDTH, WORLD_HEIGHT);
    this.worldObjects.push(sky);

    // Sits behind the terrain layer (added next) so it's only visible where
    // terrain has been dug/blown away down to the water line; redrawn every
    // frame in update() so its surface highlight can animate.
    this.waterGraphics = this.add.graphics();
    drawWater(this.waterGraphics, WORLD_WIDTH, WORLD_HEIGHT, 0);
    this.worldObjects.push(this.waterGraphics);

    if (this.textures.exists('terrainTex')) this.textures.remove('terrainTex');
    // Non-null: the line above always removes any colliding key first, so
    // createCanvas never actually returns null here.
    this.terrainTexture = this.textures.createCanvas('terrainTex', WORLD_WIDTH, WORLD_HEIGHT)!;
    const terrainImage = this.add.image(0, 0, 'terrainTex').setOrigin(0, 0);
    this.worldObjects.push(terrainImage);

    this.graphics = this.add.graphics();
    this.worldObjects.push(this.graphics);

    this.uiGraphics = this.add.graphics();
    this.uiObjects.push(this.uiGraphics);

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
    this.uiObjects.push(hudPanel);

    this.hudText = this.add.text(hudPanelX + 14, 16, '', {
      fontFamily: "'Baloo 2', sans-serif",
      fontSize: '17px',
      color: '#fff8e7',
      lineSpacing: 4,
    });
    this.uiObjects.push(this.hudText);

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
    this.uiObjects.push(this.turnBannerText);

    [0, 1].forEach((i) => {
      const teamNameText = this.add
        .text(teamHealthBarX(i, width) + TEAM_BAR_WIDTH / 2, 8, this.rt.teams[i].name, {
          fontFamily: "'Baloo 2', sans-serif",
          fontSize: '16px',
          fontStyle: '700',
          color: '#fff8e7',
          stroke: '#16213f',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 0);
      this.uiObjects.push(teamNameText);
    });

    this.createParticleEmitters();
    this.worldObjects.push(this.emberEmitter, this.debrisEmitter, this.splashEmitter, this.muzzleEmitter, this.dustEmitter);

    // A soft gold halo behind the active-worm ring (drawn separately in
    // render.ts) - a dedicated Image using its own radially-faded texture,
    // not the Glow filter on the tiny particleDot sprite: at the scale this
    // halo is displayed, Glow's fixed pixel-space distance swamped the 8x8
    // texture and squared off into a visible rectangle instead of a halo.
    if (!this.textures.exists('glowHalo')) {
      const size = 64;
      const halo = this.textures.createCanvas('glowHalo', size, size)!;
      const gradient = halo.context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      halo.context.fillStyle = gradient;
      halo.context.fillRect(0, 0, size, size);
      halo.refresh();
    }
    this.activeWormGlow = this.add.image(0, 0, 'glowHalo').setTint(0xffd966).setBlendMode(Phaser.BlendModes.ADD);
    this.worldObjects.push(this.activeWormGlow);

    // A faint darkened edge to frame the arena, not a heavy vignette - it
    // should read as depth, not as a filter someone forgot to remove.
    this.cameras.main.filters.internal.addVignette(0.5, 0.5, 1.0, 0.25);

    // UI camera: screen-space, zoom 1, renders only the HUD/banner/team-name/
    // health-bar layer built up in uiObjects above. The main camera is
    // zoomed out to show the whole (larger) world and must not also render
    // - and shrink - these.
    this.uiCamera = this.cameras.add(0, 0, width, height);
    this.uiCamera.setScroll(0, 0);
    this.cameras.main.ignore(this.uiObjects);
    this.uiCamera.ignore(this.worldObjects);

    // Zoom the main camera out just enough that the whole (larger) world
    // fits the viewport - world and viewport share a 16:9 ratio, so one
    // zoom factor covers both axes exactly. That alone doesn't center the
    // world, though: Phaser zooms a camera about its own midpoint, not the
    // world origin, so with scroll left at (0, 0) the extra world revealed
    // by zooming out past 1 would land off both the right and bottom edges
    // of the viewport instead of being split evenly around it.
    this.cameras.main.setZoom(width / WORLD_WIDTH);
    // Phaser zooms a camera about its own midpoint, not the world origin, so
    // scroll must be offset by half the extra world size on each axis to
    // center the (larger) world in the viewport - not (0,0), which would
    // leave the world's right/bottom edges (and the whole water band) off
    // screen. This scroll is set once here and never touched again, so the
    // "no scrolling/follow" constraint still holds - only the fixed offset
    // changes from the original (0,0).
    this.cameras.main.setScroll((WORLD_WIDTH - width) / 2, (WORLD_HEIGHT - height) / 2);

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
    this.muzzleEmitter = this.add.particles(0, 0, 'particleDot', {
      lifespan: 160,
      speed: { min: 30, max: 120 },
      scale: { start: 1, end: 0 },
      tint: [0xfff2b0, 0xffb347],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.dustEmitter = this.add.particles(0, 0, 'particleDot', {
      lifespan: 320,
      speed: { min: 8, max: 34 },
      angle: { min: -160, max: -20 },
      gravityY: 260,
      scale: { start: 0.45, end: 0 },
      tint: [0xc9a876, 0x9c7b4d],
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
      soundSystem.play('explosion');
      this.emberEmitter.explode(18, ex.x, ex.y);
      this.debrisEmitter.explode(10, ex.x, ex.y);
      const intensity = Phaser.Math.Clamp(ex.radius / 900, 0.002, 0.012);
      this.cameras.main.shake(180, intensity);
      // Warm, brief screen flash so a big dynamite blast reads as a flash of
      // light, not just shake - scaled down enough that a bazooka barely shows.
      const flashStrength = Phaser.Math.Clamp(ex.radius / 90, 0.08, 0.6);
      this.cameras.main.flash(120, 255, 200, 140);
      this.cameras.main.flashEffect.alpha = flashStrength;
    }
    for (const sp of this.rt.splashes) {
      if (this.burstedSplashes.has(sp)) continue;
      this.burstedSplashes.add(sp);
      soundSystem.play('splash');
      this.splashEmitter.explode(14, sp.x, sp.y);
    }
    for (const p of this.rt.projectiles) {
      if (this.burstedProjectiles.has(p)) continue;
      this.burstedProjectiles.add(p);
      soundSystem.play('fire');
      this.muzzleEmitter.explode(8, p.x, p.y);
    }
    const tracer = this.rt.shotgunTracer;
    if (tracer && !this.burstedShotgunTracers.has(tracer)) {
      this.burstedShotgunTracers.add(tracer);
      soundSystem.play('shotgun');
    }
  }

  // A couple of dirt puffs behind the active worm's feet while it's
  // actually crawling on the ground - skipped for jumps/falls/rope swings,
  // where feet aren't in contact with the terrain to kick anything up.
  private triggerMovementDust(deltaMs: number): void {
    this.dustCooldownMs -= deltaMs;
    if (this.dustCooldownMs > 0) return;
    for (const worm of this.allWorms()) {
      if (!worm.alive || worm.dying || !worm.onGround) continue;
      if (Math.abs(worm.vx) < 15) continue;
      this.dustEmitter.explode(2, worm.x - worm.facing * 8, worm.y + 12);
      this.dustCooldownMs = 90;
      break;
    }
  }

  update(time: number, delta: number): void {
    const dt = Math.min(0.05, delta / 1000);
    stepMatch(this.rt, sharedInput, dt);
    if (this.rt.charging && !this.wasCharging) soundSystem.play('charge');
    this.wasCharging = this.rt.charging;

    drawWater(this.waterGraphics, WORLD_WIDTH, WORLD_HEIGHT, time);
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
    drawTeamHealthBars(this.uiGraphics, this.rt.teams, this.scale.width);
    updateHud(this.hudText, this.rt.match, sharedInput.selectedWeapon);
    this.triggerEffectBursts();
    this.triggerMovementDust(delta);
    this.updateActiveWormGlow(time);

    const bannerAlpha = turnBannerAlpha(this.rt.turnBannerTimer ?? 0, TURN_BANNER_DURATION_MS);
    this.turnBannerText.setAlpha(bannerAlpha);
    if (bannerAlpha > 0) this.turnBannerText.setText(turnBannerLabel(currentWorm(this.rt.match).playerId));
    if (bannerAlpha > 0 && !this.bannerWasVisible) {
      soundSystem.play('turn');
      // Pop the banner in with a quick overshoot instead of a hard alpha
      // snap, so a turn switch reads as an announcement, not a glitch.
      this.turnBannerText.setScale(0.7);
      this.tweens.add({ targets: this.turnBannerText, scale: 1, duration: 220, ease: 'Back.Out' });
    }
    this.bannerWasVisible = bannerAlpha > 0;

    const result = checkWinner(this.rt.teams);
    if (result) this.scene.start('EndScene', { winner: result });
  }

  // Slow pulse (not a static glow) so the turn indicator keeps drawing the
  // eye without competing with brighter one-shot effects like explosions.
  // Hidden while the active worm is dead/dying - there's no "your turn" to
  // highlight once it can no longer act.
  private updateActiveWormGlow(timeMs: number): void {
    const active = currentWorm(this.rt.match);
    if (!active.worm.alive || active.worm.dying) {
      this.activeWormGlow.setVisible(false);
      return;
    }
    this.activeWormGlow.setVisible(true);
    this.activeWormGlow.setPosition(active.worm.x, active.worm.y - 1);
    const pulse = 0.75 + Math.sin(timeMs / 260) * 0.25;
    this.activeWormGlow.setScale(0.45 + pulse * 0.1);
    this.activeWormGlow.setAlpha(0.35 + pulse * 0.25);
  }

  private allWorms(): Worm[] {
    return this.rt.teams.flatMap((t) => t.worms);
  }

  private unlockAudio(): void {
    soundSystem.unlock();
    soundSystem.startTheme();
  }
}
