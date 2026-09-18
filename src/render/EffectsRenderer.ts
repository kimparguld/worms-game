import Phaser from 'phaser';
import { DEPTH_BEHIND_WORMS } from '../render.js';

export class EffectsRenderer {
  private emberEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private debrisEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private splashEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private muzzleEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private dustEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private poofEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private gravestoneImages: Phaser.GameObjects.Image[] = [];
  private ropeHook: Phaser.GameObjects.Image;

  constructor(
    private scene: Phaser.Scene,
    private worldObjects: Phaser.GameObjects.GameObject[],
  ) {
    this.emberEmitter = scene.add.particles(0, 0, 'particle_spark', {
      lifespan: 450,
      speed: { min: 60, max: 240 },
      scale: { start: 1.2, end: 0 },
      tint: [0xfff2b0, 0xffb347, 0xff5a1a],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.debrisEmitter = scene.add.particles(0, 0, 'particle_debris', {
      lifespan: 700,
      speed: { min: 40, max: 160 },
      angle: { min: -150, max: -30 },
      gravityY: 500,
      scale: { start: 0.9, end: 0.2 },
      tint: [0x96622e, 0x6b4523],
      emitting: false,
    });
    this.splashEmitter = scene.add.particles(0, 0, 'particle_droplet', {
      lifespan: 500,
      speed: { min: 60, max: 180 },
      angle: { min: -150, max: -30 },
      gravityY: 700,
      scale: { start: 0.8, end: 0.1 },
      tint: [0xdff3fb, 0x8fd8f7],
      emitting: false,
    });
    this.muzzleEmitter = scene.add.particles(0, 0, 'fx_muzzle', {
      frame: [0, 1, 2],
      lifespan: 160,
      speed: { min: 30, max: 120 },
      scale: { start: 1, end: 0 },
      tint: [0xfff2b0, 0xffb347],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.dustEmitter = scene.add.particles(0, 0, 'fx_dust', {
      frame: [0, 1, 2],
      lifespan: 320,
      speed: { min: 8, max: 34 },
      angle: { min: -160, max: -20 },
      gravityY: 260,
      scale: { start: 0.45, end: 0 },
      tint: [0xc9a876, 0x9c7b4d],
      emitting: false,
    });
    this.poofEmitter = scene.add.particles(0, 0, 'particle_spark', {
      lifespan: 400,
      speed: { min: 40, max: 160 },
      scale: { start: 1, end: 0 },
      tint: [0xfff8e7, 0xffd966],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.ropeHook = scene.add.image(0, 0, 'rope_hook').setVisible(false);

    worldObjects.push(
      this.emberEmitter,
      this.debrisEmitter,
      this.splashEmitter,
      this.muzzleEmitter,
      this.dustEmitter,
      this.poofEmitter,
      this.ropeHook,
    );
  }

  // The one effect that deliberately keeps the default depth 0: created
  // mid-match, an explosion lands at the front of the display list, which is
  // exactly where the old drawScene drew it (last of everything).
  spawnExplosion(x: number, y: number, radius: number): void {
    const sprite = this.scene.add.sprite(x, y, 'fx_explosion');
    sprite.setScale(Phaser.Math.Clamp(radius / 40, 0.5, 3));
    sprite.play('explode');
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
    this.worldObjects.push(sprite);
    this.emberEmitter.explode(18, x, y);
    this.debrisEmitter.explode(10, x, y);
  }

  spawnSplash(x: number, y: number): void {
    // Splashes and gravestones are created mid-match, so without an explicit
    // depth they would sort in front of the worms - the old drawScene drew
    // both *under* them. See the depth bands in src/render.ts.
    const sprite = this.scene.add.sprite(x, y, 'fx_splash').setDepth(DEPTH_BEHIND_WORMS);
    sprite.play('splash');
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
    this.worldObjects.push(sprite);
    this.splashEmitter.explode(14, x, y);
  }

  spawnPoof(x: number, y: number): void {
    this.poofEmitter.explode(16, x, y);
  }

  spawnGravestone(x: number, y: number): void {
    const image = this.scene.add.image(x, y, 'gravestone').setDepth(DEPTH_BEHIND_WORMS);
    this.gravestoneImages.push(image);
    this.worldObjects.push(image);
  }

  muzzleBurst(x: number, y: number): void {
    this.muzzleEmitter.explode(8, x, y);
  }

  dustBurst(x: number, y: number): void {
    this.dustEmitter.explode(2, x, y);
  }

  // The rope hook Image tracks the current rope's anchor point each frame;
  // GameScene owns the rope's line itself (see Task 11 - a plain Graphics
  // line, per the spec's deliberate exception for thin dynamic-length lines).
  setRopeHook(visible: boolean, x?: number, y?: number): void {
    this.ropeHook.setVisible(visible);
    if (visible && x !== undefined && y !== undefined) this.ropeHook.setPosition(x, y);
  }
}
