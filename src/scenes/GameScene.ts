import Phaser from 'phaser';
import { createTerrain, findSurfaceY } from '../terrain.js';
import { createWorm, updateWormPhysics, adjustAim, takeDamage } from '../worm.js';
import { createMatch, currentWorm, advanceTurn, tickTurnTimer, checkWinner } from '../game.js';
import { createProjectile, updateProjectile } from '../projectile.js';
import { raycastHit, WEAPONS } from '../weapons.js';
import { fireRope, updateRopeSwing } from '../rope.js';
import { drawTerrain, drawScene, updateHud } from '../render.js';
import { sharedInput } from '../inputState.js';
import { resetInputState } from '../input.js';
import type { Worm, WormInput, Team, Projectile, Rope, WeaponKey, Terrain, MatchState } from '../types.js';

const WEAPON_KEYS: WeaponKey[] = ['bazooka', 'grenade', 'shotgun', 'ninjaRope', 'dynamite'];
const SPAWN_SURFACE_BUFFER = 20;
const WIDTH = 960;
const HEIGHT = 540;

export class GameScene extends Phaser.Scene {
  private terrain!: Terrain;
  private teams!: Team[];
  private match!: MatchState;
  private projectiles: Projectile[] = [];
  private rope: Rope | null = null;
  private charging = false;
  private chargePower = 0;
  private retirementTimer: number | null = null;

  private terrainTexture!: Phaser.Textures.CanvasTexture;
  private graphics!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;

  constructor() {
    super('GameScene');
  }

  create(): void {
    resetInputState(sharedInput);

    this.terrain = createTerrain(WIDTH, HEIGHT);
    const spawnY = (x: number) => findSurfaceY(this.terrain, x) - SPAWN_SURFACE_BUFFER;
    this.teams = [
      { playerId: 'p1', worms: [createWorm(150, spawnY(150), 'p1', 'W1'), createWorm(200, spawnY(200), 'p1', 'W2')] },
      { playerId: 'p2', worms: [createWorm(760, spawnY(760), 'p2', 'W3'), createWorm(810, spawnY(810), 'p2', 'W4')] },
    ];
    this.match = createMatch(this.teams);
    this.projectiles = [];
    this.rope = null;
    this.charging = false;
    this.chargePower = 0;
    this.retirementTimer = null;

    if (this.textures.exists('terrainTex')) this.textures.remove('terrainTex');
    this.terrainTexture = this.textures.createCanvas('terrainTex', WIDTH, HEIGHT)!;
    this.add.image(0, 0, 'terrainTex').setOrigin(0, 0);

    this.graphics = this.add.graphics();
    this.hudText = this.add.text(10, 10, '', { fontSize: '16px', color: '#ffffff' });
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(0.05, delta / 1000);
    this.stepGame(dt);

    drawTerrain(this.terrainTexture, this.terrain);
    drawScene(this.graphics, this.allWorms(), this.projectiles, this.match, this.rope);
    updateHud(this.hudText, this.match, sharedInput.selectedWeapon);

    const result = checkWinner(this.teams);
    if (result) this.scene.start('EndScene', { winner: result });
  }

  private allWorms(): Worm[] {
    return this.teams.flatMap((t) => t.worms);
  }

  private fireWeapon(worm: Worm, weaponKey: WeaponKey, power: number): void {
    const fireAngle = worm.facing === 1 ? worm.aimAngle : Math.PI - worm.aimAngle;

    if (weaponKey === 'shotgun') {
      for (let i = 0; i < WEAPONS.shotgun.pellets; i++) {
        const hit = raycastHit(this.terrain, this.allWorms(), worm.x, worm.y, fireAngle, WEAPONS.shotgun.range!);
        if (hit.type === 'worm' && hit.worm) takeDamage(hit.worm, WEAPONS.shotgun.maxDamage);
      }
      this.retirementTimer = 1;
    } else if (weaponKey === 'ninjaRope') {
      const result = fireRope(worm.x, worm.y, fireAngle, this.terrain, 300);
      this.rope = result.attached ? result : null;
    } else {
      this.projectiles.push(createProjectile(weaponKey, worm.x, worm.y, fireAngle, power));
      this.retirementTimer = 2;
    }
  }

  private stepGame(dt: number): void {
    const active = currentWorm(this.match);
    const worm = active.worm;
    const weaponKey = WEAPON_KEYS[sharedInput.selectedWeapon - 1];

    if (this.rope) {
      updateRopeSwing(worm, this.rope, dt);
      if (sharedInput.jump) this.rope = null;
    }

    const neutralInput: WormInput = { left: false, right: false, jump: false };
    for (const w of this.allWorms()) {
      const wormInput = w === worm ? sharedInput : neutralInput;
      updateWormPhysics(w, this.terrain, wormInput, dt);
    }

    if (sharedInput.aimUp) adjustAim(worm, -1, dt);
    if (sharedInput.aimDown) adjustAim(worm, 1, dt);

    const chargeableWeapon = WEAPONS[weaponKey].chargeable;
    if (sharedInput.firing && chargeableWeapon) {
      this.charging = true;
      this.chargePower = Math.min(1, this.chargePower + dt);
    } else if (this.charging) {
      this.fireWeapon(worm, weaponKey, this.chargePower);
      this.charging = false;
      this.chargePower = 0;
    } else if (sharedInput.firing && !chargeableWeapon) {
      this.fireWeapon(worm, weaponKey, 1);
      sharedInput.firing = false;
    }

    this.projectiles = this.projectiles.filter((p) => p.alive);
    for (const p of this.projectiles) {
      updateProjectile(p, this.terrain, this.allWorms(), this.match.wind, dt);
    }

    if (this.retirementTimer !== null) {
      this.retirementTimer -= dt;
      if (this.retirementTimer <= 0 && this.projectiles.every((p) => !p.alive)) {
        advanceTurn(this.match);
        this.retirementTimer = null;
      }
    }

    tickTurnTimer(this.match, dt * 1000);

    if (sharedInput.endTurnRequested) {
      advanceTurn(this.match);
      sharedInput.endTurnRequested = false;
    }
  }
}
