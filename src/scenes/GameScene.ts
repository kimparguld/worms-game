import Phaser from 'phaser';
import { createMatchRuntime, stepMatch, WEAPON_KEYS } from '../matchLoop.js';
import { checkWinner, currentWorm } from '../game.js';
import {
  updateHud,
  updateWeaponText,
  turnBannerAlpha,
  turnBannerLabel,
  weaponLabel,
  teamHealthBarX,
  TEAM_BAR_WIDTH,
  teamColorCss,
  tracerAlpha,
  chargeBarLength,
  chargeBarColor,
  DEPTH_BACKDROP,
} from '../render.js';
import { sharedInput } from '../inputState.js';
import { resetInputState } from '../input.js';
import {
  TURN_BANNER_DURATION_MS,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  DEFAULT_WORM_NAMES,
  DEATH_ANIM_DURATION_MS,
  SHOTGUN_TRACER_DURATION,
  WORM_RENDER_SCALE,
} from '../constants.js';
import { soundSystem } from '../sound.js';
import { aimWormAtPoint, isMobileDevice } from '../mobile.js';
import type { Worm, MatchRuntime } from '../types.js';
import { TerrainRenderer } from '../render/TerrainRenderer.js';
import { WaterRenderer } from '../render/WaterRenderer.js';
import { WormRenderer } from '../render/WormRenderer.js';
import { ProjectileRenderer } from '../render/ProjectileRenderer.js';
import { CrateRenderer } from '../render/CrateRenderer.js';
import { EffectsRenderer } from '../render/EffectsRenderer.js';
import { HudRenderer } from '../render/HudRenderer.js';
import { ASSET_MANIFEST } from '../assetManifest.js';

interface GameSceneData {
  team1Name?: string;
  team2Name?: string;
  wormNames?: [string, string, string, string];
}

const MOBILE_WORM_DRAG_RADIUS = 96;
const MOBILE_MOVEMENT_ZONE_WIDTH_FRACTION = 0.35;
const MOBILE_MOVEMENT_ZONE_MIN_Y_FRACTION = 0.45;
const MOBILE_MOVE_DEAD_ZONE = 18;
const MOBILE_JUMP_DRAG_DISTANCE = 42;
const MOBILE_JUMP_PULSE_MS = 140;

export class GameScene extends Phaser.Scene {
  private rt!: MatchRuntime;
  private team1Name = 'Team 1';
  private team2Name = 'Team 2';
  private wormNames: [string, string, string, string] = DEFAULT_WORM_NAMES;

  private terrainRenderer!: TerrainRenderer;
  private waterRenderer!: WaterRenderer;
  private effectsRenderer!: EffectsRenderer;
  private projectileRenderer!: ProjectileRenderer;
  private crateRenderer!: CrateRenderer;
  private wormRenderers = new Map<Worm, WormRenderer>();
  // The one deliberate remaining Graphics object: the rope line, the shotgun
  // tracer line and the aim/charge indicator line are all thin, arbitrary-
  // length, arbitrary-angle lines redrawn every frame, which the design spec
  // keeps as vector strokes rather than forcing into stretched sprites.
  private ropeGraphics!: Phaser.GameObjects.Graphics;
  private hudRenderer!: HudRenderer;
  private uiCamera!: Phaser.Cameras.Scene2D.Camera;
  private hudText!: Phaser.GameObjects.Text;
  private weaponText!: Phaser.GameObjects.Text;
  private weaponIcon!: Phaser.GameObjects.Image;
  private turnBannerText!: Phaser.GameObjects.Text;

  private activeWormArrow!: Phaser.GameObjects.Image;
  private crosshairImage!: Phaser.GameObjects.Image;
  // One label per worm, created once at match start (the roster is fixed -
  // worms die, they're never added) and repositioned/hidden each frame in
  // update() rather than recreated.
  private wormNameTexts = new Map<Worm, Phaser.GameObjects.Text>();
  // Per-turn: has the active worm received a movement key/drag yet? Reset
  // whenever the active worm changes; drives when the turn arrow hides.
  private turnMovementStarted = false;
  private turnArrowWorm: Worm | null = null;

  // Identity-tracked (not value-tracked): an explosion/splash's `timer`
  // counts down every frame, so the only reliable "have I already fired a
  // burst for this one" check is object identity, not its current field
  // values. Entries fall out on their own once matchLoop's filter() drops
  // the dead effect and nothing else references it.
  private burstedExplosions = new WeakSet<object>();
  private burstedSplashes = new WeakSet<object>();
  private burstedProjectiles = new WeakSet<object>();
  private burstedShotgunTracers = new WeakSet<object>();
  private burstedCratePickups = new WeakSet<object>();
  private poofedWorms = new WeakSet<Worm>();
  private bannerWasVisible = false;
  private wasCharging = false;
  private movementPointerId: number | null = null;
  private firingPointerId: number | null = null;
  private movementStartX = 0;
  private movementStartY = 0;
  private mobileControls: HTMLDivElement | null = null;
  private mobileWeaponLabel: HTMLOutputElement | null = null;
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
  // How many entries of worldObjects have already been handed to
  // uiCamera.ignore(). Camera.ignore() stamps a filter onto the objects it is
  // given at that moment, so the one-shot call at the end of create() cannot
  // cover the objects the renderers add *later* - EffectsRenderer's one-shot
  // explosion/splash sprites and gravestones, and ProjectileRenderer's lazily
  // pooled images. Anything missed would render on both cameras, i.e. a second
  // unzoomed copy pinned to the screen. ignoreNewWorldObjects() (called once
  // per frame) re-ignores only the new tail, so the cost is proportional to
  // what was just added, not to the whole list.
  private ignoredWorldObjectCount = 0;

  constructor() {
    super('GameScene');
  }

  init(data: GameSceneData): void {
    this.team1Name = data.team1Name ?? 'Team 1';
    this.team2Name = data.team2Name ?? 'Team 2';
    this.wormNames = data.wormNames ?? DEFAULT_WORM_NAMES;
  }

  create(): void {
    resetInputState(sharedInput);

    // Every spritesheet animation in the manifest, registered once on the
    // game-global AnimationManager. Worm animations are keyed by their
    // manifest texture key ('worm_idle', 'worm_walk', ...) because
    // WormRenderer.playAnimation plays `worm_${state}`; every other
    // spritesheet's animation is keyed by its own anim.name ('explode',
    // 'splash'), which is what EffectsRenderer plays. The real key is computed
    // up front so the "already registered" guard tests the same key create()
    // would otherwise re-create. fx_muzzle/fx_dust carry no `animations` array
    // and fall out of the guard below - their emitters pick a random frame
    // straight from the sheet instead of playing an animation.
    for (const entry of ASSET_MANIFEST) {
      if (entry.kind !== 'spritesheet' || !entry.animations) continue;
      for (const anim of entry.animations) {
        const key = entry.key.startsWith('worm_') ? entry.key : anim.name;
        if (this.anims.exists(key)) continue; // create() reruns across StartScene -> GameScene restarts; the global anim manager persists, don't recreate
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(entry.key, { frames: anim.frames }),
          frameRate: anim.frameRate,
          repeat: anim.repeat,
        });
      }
    }

    // Phaser reuses this Scene instance across restarts (StartScene ->
    // GameScene -> EndScene -> StartScene -> GameScene...), so create() runs
    // more than once over the scene's lifetime while these two arrays are
    // plain class fields initialized only at construction. Without clearing
    // them here, each rematch would push another batch of objects onto
    // arrays still holding references to the previous match's now-destroyed
    // objects - an unbounded leak, and a growing list for every .ignore() call.
    this.worldObjects = [];
    this.uiObjects = [];
    this.ignoredWorldObjectCount = 0;
    // Same reasoning for the two per-worm Maps: a rematch builds a brand new
    // roster of Worm objects, so every entry keyed by the previous match's
    // worms is dead weight whose GameObjects have already been destroyed with
    // the old scene - and update() walks both Maps every frame, so a stale
    // WormRenderer would keep poking at destroyed sprites.
    this.wormRenderers.clear();
    this.wormNameTexts.clear();
    this.input.once('pointerdown', () => this.unlockAudio());
    this.input.once('pointerdown', () => this.enterMobileFullscreen());
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.keyboard?.once('keydown', () => this.unlockAudio());

    const { width, height } = this.scale; // viewport size - UI-space layout only
    this.rt = createMatchRuntime(WORLD_WIDTH, WORLD_HEIGHT, this.team1Name, this.team2Name, this.wormNames);

    // Static sky/cloud backdrop, added once - it never changes during a
    // match, unlike the terrain (destructible) and worms (moving) above it.
    const sky = this.add
      .image(0, 0, 'sky')
      .setOrigin(0, 0)
      .setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT)
      .setDepth(DEPTH_BACKDROP);
    this.worldObjects.push(sky);

    // DEVIATION FROM BRIEF (ordering): the brief's Step 3 listed
    // TerrainRenderer before WaterRenderer, which would put the water band in
    // front of the terrain and leave an opaque blue strip permanently covering
    // the bottom of the map. Display-list order is z-order here, and the
    // behaviour being replaced (the old drawSky/drawWater/drawTerrain
    // sequence) deliberately put water *behind* terrain so it is only ever
    // revealed where terrain has been dug or blown away down to the water
    // line. Constructing WaterRenderer first preserves that.
    this.waterRenderer = new WaterRenderer(this, this.worldObjects, WORLD_WIDTH, WORLD_HEIGHT, this.rt.terrain);
    // The initial terrain is handed in so TerrainRenderer can scan it once for
    // contiguous building runs (one facade TileSprite + mask per run).
    this.terrainRenderer = new TerrainRenderer(this, this.worldObjects, WORLD_WIDTH, WORLD_HEIGHT, this.rt.terrain);
    this.effectsRenderer = new EffectsRenderer(this, this.worldObjects);
    // Between the effects layer and the projectiles, matching the old
    // drawScene ordering where the rope/tracer/aim lines were stroked after
    // the gravestones and splashes but before the worms and projectiles.
    this.ropeGraphics = this.add.graphics();
    this.worldObjects.push(this.ropeGraphics);
    this.projectileRenderer = new ProjectileRenderer(this, this.worldObjects);
    this.crateRenderer = new CrateRenderer(this, this.worldObjects);

    // The HUD panel sits top-centre, in the gap between the two team life
    // bars (which HudRenderer anchors to the left and right edges). Top-left
    // would sit directly on top of the first team's bar and hide it.
    const hudPanelWidth = 320;
    const hudPanelHeight = 94;
    const hudPanelX = Math.round(width / 2 - hudPanelWidth / 2);
    // Insets come from the manifest rather than being re-typed here, so
    // hud_panel's declared nine-slice and the one actually rendered can't drift.

    const hudPanel = this.add.graphics();

    hudPanel.fillStyle(0x0f172e, 0.52);
    hudPanel.fillRoundedRect(hudPanelX, 6, hudPanelWidth, hudPanelHeight, 16);
    hudPanel.lineStyle(2, 0xffffff, 0.12);
    hudPanel.strokeRoundedRect(hudPanelX, 6, hudPanelWidth, hudPanelHeight, 16);

    this.uiObjects.push(hudPanel);
    this.hudRenderer = new HudRenderer(this, this.uiObjects, width);

    this.hudText = this.add.text(hudPanelX + 14, 16, '', {
      fontFamily: "'Baloo 2', sans-serif",
      fontSize: '17px',
      color: '#fff8e7',
      lineSpacing: 4,
    });
    this.uiObjects.push(this.hudText);

    // The weapon line sits below Wind/Time as its own Text object (rather
    // than one more line appended to hudText) specifically so the icon
    // beside it can be pinned to this line alone, instead of drifting if the
    // wind/time text above it ever changes height.
    const weaponLineY = 58;
    const weaponIconSize = 22;
    this.weaponIcon = this.add
      .image(hudPanelX + 14 + weaponIconSize / 2, weaponLineY + 9, 'bazooka_held')
      .setDisplaySize(weaponIconSize, weaponIconSize);
    this.uiObjects.push(this.weaponIcon);

    this.weaponText = this.add.text(hudPanelX + 14 + weaponIconSize + 8, weaponLineY, '', {
      fontFamily: "'Baloo 2', sans-serif",
      fontSize: '17px',
      color: '#fff8e7',
      lineSpacing: 4,
    });
    this.uiObjects.push(this.weaponText);

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

    // A bouncing "it's your turn" arrow above the active worm's head. Hidden
    // the instant the player starts moving that worm (see
    // updateActiveWormArrow), so it only ever marks "it's your turn and you
    // haven't acted yet", not the active worm generally.
    // Origin (0.5, 1): position sets the arrow's tip, so it's trivial to
    // pin just above a worm's head regardless of the texture's own height.
    this.activeWormArrow = this.add.image(0, 0, 'turn_arrow').setOrigin(0.5, 1).setScale(WORM_RENDER_SCALE);
    this.worldObjects.push(this.activeWormArrow);

    // Added before the worm sprites below so it sits behind them, matching the
    // old drawScene, which stroked the crosshair/charge indicator before the
    // worm pass.
    this.crosshairImage = this.add.image(0, 0, 'crosshair').setVisible(false);
    this.worldObjects.push(this.crosshairImage);

    for (const team of this.rt.teams) {
      for (const worm of team.worms) {
        const nameText = this.add
          .text(0, 0, worm.name, {
            fontFamily: "'Baloo 2', sans-serif",
            fontSize: `${Math.round(11 * WORM_RENDER_SCALE)}px`,
            fontStyle: '700',
            color: teamColorCss(team.playerId),
            stroke: '#16213f',
            strokeThickness: 3,
          })
          .setOrigin(0.5, 1);
        this.wormNameTexts.set(worm, nameText);
        this.worldObjects.push(nameText);

        this.wormRenderers.set(worm, new WormRenderer(this, this.worldObjects, worm, team));
      }
    }

    this.createMobileTouchControls();
    this.createMobileControlOverlay();

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
    this.ignoredWorldObjectCount = this.worldObjects.length;

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

    // Release the terrain mask textures' GPU memory when this scene shuts
    // down (on restart, or when EndScene takes over) instead of leaking it.
    // TerrainRenderer creates these world-sized CanvasTextures and also
    // removes any stale copies at construction, so this is belt-and-braces -
    // it just means a finished match doesn't sit on them until the next one
    // starts. (The old 'terrainTex' this replaced is gone with drawTerrain.)
    //
    // The per-building-run mask keys ('terrainBuildingMask0', ...1, ...) are
    // matched by pattern rather than listed: how many runs a match has depends
    // on that match's generated terrain, so the next match may create fewer of
    // them and would leave this one's extras registered forever. The 1x1
    // 'terrainEdgeOverlayBase' is deliberately kept - it is content-
    // independent, so every match reuses the same one.
    this.events.once('shutdown', () => {
      const staleKeys = this.textures
        .getTextureKeys()
        .filter((key) => /^terrainBuildingMask\d+$/.test(key))
        .concat(
          'terrainGroundMask',
          'terrainEdgeMask',
          'terrainGrassMask',
          'terrainDecorationArt',
          'terrainDecorationMask',
        );
      for (const key of staleKeys) {
        if (this.textures.exists(key)) this.textures.remove(key);
      }
      this.clearMobileTouchState();
    });
  }

  private createMobileTouchControls(): void {
    if (!isMobileDevice()) return;
    this.input.addPointer(2);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);
    this.input.on('pointerupoutside', this.handlePointerUp, this);
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.rt.turnBannerTimer !== null) return;
    const worldPoint = this.pointerWorldPoint(pointer);
    if (!isMobileDevice()) return;

    const worm = currentWorm(this.rt.match).worm;
    if (this.isMovementPointer(pointer, worldPoint, worm) && this.movementPointerId === null) {
      this.movementPointerId = pointer.pointerId;
      this.movementStartX = pointer.x;
      this.movementStartY = pointer.y;
      this.updateMovementFromPointer(pointer);
      return;
    }

    if (this.firingPointerId !== null) return;
    this.firingPointerId = pointer.pointerId;
    sharedInput.firing = true;
    aimWormAtPoint(worm, worldPoint.x, worldPoint.y);
  }

  private createMobileControlOverlay(): void {
    if (!isMobileDevice()) return;
    const container = document.getElementById('game-container');
    if (!container) return;

    const controls = document.createElement('div');
    controls.className = 'mobile-game-controls';
    controls.innerHTML = `
      <button type="button" data-action="previous" aria-label="Previous weapon">Prev</button>
      <output aria-live="polite"></output>
      <button type="button" data-action="next" aria-label="Next weapon">Next</button>
      <button type="button" data-action="jump" aria-label="Jump">Jump</button>
      <button type="button" class="mobile-end-turn" data-action="end" aria-label="End turn">End</button>
    `;

    controls.addEventListener('pointerdown', (event) => event.stopPropagation());
    controls.addEventListener('pointerup', (event) => event.stopPropagation());
    controls.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = (event.target as HTMLElement).dataset.action;
      if (action === 'previous') this.selectMobileWeapon(-1);
      if (action === 'next') this.selectMobileWeapon(1);
      if (action === 'end') sharedInput.endTurnRequested = true;
    });

    const jumpButton = controls.querySelector<HTMLButtonElement>('[data-action="jump"]');
    jumpButton?.addEventListener('pointerdown', () => this.triggerMobileJump());

    this.mobileControls = controls;
    this.mobileWeaponLabel = controls.querySelector('output');
    this.updateMobileWeaponLabel();
    container.appendChild(controls);
  }

  private selectMobileWeapon(delta: number): void {
    const maxWeapon = WEAPON_KEYS.length;
    sharedInput.selectedWeapon = ((sharedInput.selectedWeapon - 1 + delta + maxWeapon) % maxWeapon) + 1;
    this.updateMobileWeaponLabel();
  }

  private updateMobileWeaponLabel(): void {
    if (!this.mobileWeaponLabel) return;
    this.mobileWeaponLabel.value = `${sharedInput.selectedWeapon}. ${weaponLabel(sharedInput.selectedWeapon)}`;
  }

  private triggerMobileJump(): void {
    sharedInput.jump = true;
    this.time.delayedCall(MOBILE_JUMP_PULSE_MS, () => {
      sharedInput.jump = false;
    });
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (pointer.pointerId === this.movementPointerId) {
      this.updateMovementFromPointer(pointer);
      return;
    }

    if (pointer.pointerId !== this.firingPointerId) return;
    const worldPoint = this.pointerWorldPoint(pointer);
    aimWormAtPoint(currentWorm(this.rt.match).worm, worldPoint.x, worldPoint.y);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.pointerId === this.movementPointerId) {
      this.movementPointerId = null;
      sharedInput.left = false;
      sharedInput.right = false;
      sharedInput.jump = false;
      return;
    }

    if (pointer.pointerId !== this.firingPointerId) return;
    this.firingPointerId = null;
    sharedInput.firing = false;
  }

  private updateMovementFromPointer(pointer: Phaser.Input.Pointer): void {
    const deltaX = pointer.x - this.movementStartX;
    const deltaY = pointer.y - this.movementStartY;
    sharedInput.left = deltaX < -MOBILE_MOVE_DEAD_ZONE;
    sharedInput.right = deltaX > MOBILE_MOVE_DEAD_ZONE;
    sharedInput.jump = deltaY < -MOBILE_JUMP_DRAG_DISTANCE;
  }

  private isMovementPointer(pointer: Phaser.Input.Pointer, worldPoint: Phaser.Math.Vector2, worm: Worm): boolean {
    const nearActiveWorm = Math.hypot(worldPoint.x - worm.x, worldPoint.y - worm.y) <= MOBILE_WORM_DRAG_RADIUS;
    const inMovementZone =
      pointer.x <= this.scale.width * MOBILE_MOVEMENT_ZONE_WIDTH_FRACTION &&
      pointer.y >= this.scale.height * MOBILE_MOVEMENT_ZONE_MIN_Y_FRACTION;
    return nearActiveWorm || inMovementZone;
  }

  private pointerWorldPoint(pointer: Phaser.Input.Pointer): Phaser.Math.Vector2 {
    return pointer.positionToCamera(this.cameras.main, new Phaser.Math.Vector2()) as Phaser.Math.Vector2;
  }

  private clearMobileTouchState(): void {
    this.movementPointerId = null;
    this.firingPointerId = null;
    sharedInput.left = false;
    sharedInput.right = false;
    sharedInput.jump = false;
    sharedInput.firing = false;
    this.mobileControls?.remove();
    this.mobileControls = null;
    this.mobileWeaponLabel = null;
  }

  private enterMobileFullscreen(): void {
    if (!isMobileDevice() || this.scale.isFullscreen) return;
    this.scale.startFullscreen();
  }

  // Fires the one-shot effect sprite/particle burst + camera shake for any
  // explosion, splash, projectile, tracer, gravestone or completed death
  // animation that appeared since the last frame. Identity (not value) based,
  // see burstedExplosions/burstedSplashes field comment.
  private triggerEffectBursts(): void {
    for (const ex of this.rt.explosions) {
      if (this.burstedExplosions.has(ex)) continue;
      this.burstedExplosions.add(ex);
      soundSystem.play('explosion');
      this.effectsRenderer.spawnExplosion(ex.x, ex.y, ex.radius);
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
      this.effectsRenderer.spawnSplash(sp.x, sp.y);
    }
    for (const p of this.rt.projectiles) {
      if (this.burstedProjectiles.has(p)) continue;
      this.burstedProjectiles.add(p);
      soundSystem.play('fire');
      this.effectsRenderer.muzzleBurst(p.x, p.y);
    }
    const tracer = this.rt.shotgunTracer;
    if (tracer && !this.burstedShotgunTracers.has(tracer)) {
      this.burstedShotgunTracers.add(tracer);
      soundSystem.play('shotgun');
      // The muzzle itself, not just the impacts - the old drawScene filled a
      // small bright circle at the tracer's origin as well as drawing each
      // per-hit line, so without this the shot reads as damage appearing out
      // of nowhere rather than as something leaving the barrel.
      this.effectsRenderer.muzzleBurst(tracer.originX, tracer.originY);
      for (const hit of tracer.hits) this.effectsRenderer.muzzleBurst(hit.x, hit.y);
    }
    for (const pickup of this.rt.cratePickups) {
      if (this.burstedCratePickups.has(pickup)) continue;
      this.burstedCratePickups.add(pickup);
      soundSystem.play('heal');
      this.effectsRenderer.spawnPoof(pickup.x, pickup.y);
    }
    // The poof fires at the exact moment WormRenderer stops drawing the death
    // wiggle and hides the sprite - the same DEATH_ANIM_DURATION_MS / 0.8
    // threshold it applies internally - so the sprite vanishing and the puff
    // of smoke replacing it land on the same frame.
    for (const worm of this.allWorms()) {
      if (!worm.dying || this.poofedWorms.has(worm)) continue;
      const elapsed = DEATH_ANIM_DURATION_MS - (worm.deathTimer ?? 0);
      if (elapsed / DEATH_ANIM_DURATION_MS < 0.8) continue;
      this.poofedWorms.add(worm);
      this.effectsRenderer.spawnPoof(worm.x, worm.y);
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
      this.effectsRenderer.dustBurst(worm.x - worm.facing * 8, worm.y + 12);
      this.dustCooldownMs = 90;
      break;
    }
  }

  // The rope line, the shotgun tracer line and the active worm's aim/charge
  // indicator - the three pieces of the old drawScene that stay hand-stroked
  // vector lines (arbitrary length and angle every frame, per the design
  // spec's stated exception for the rope). The round caps the old code drew at
  // each end are sprites now: the rope's anchor is EffectsRenderer's rope_hook
  // Image, each tracer hit gets a muzzle burst from triggerEffectBursts, and
  // the aim indicator's tip is the crosshair Image.
  private updateRopeAndTracer(active: { worm: Worm }): void {
    this.ropeGraphics.clear();
    const rope = this.rt.rope;
    if (rope && rope.anchorX != null && rope.anchorY != null && active.worm.alive) {
      const worm = active.worm;
      this.ropeGraphics.lineStyle(5, 0x2f2514, 0.22);
      this.ropeGraphics.lineBetween(worm.x + 1, worm.y + 1, rope.anchorX + 1, rope.anchorY + 1);
      this.ropeGraphics.lineStyle(2.5, 0xc49a55, 1);
      this.ropeGraphics.lineBetween(worm.x, worm.y, rope.anchorX, rope.anchorY);
      this.effectsRenderer.setRopeHook(true, rope.anchorX, rope.anchorY);
    } else {
      this.effectsRenderer.setRopeHook(false);
    }

    const tracer = this.rt.shotgunTracer;
    if (tracer) {
      const alpha = tracerAlpha(tracer.timer, SHOTGUN_TRACER_DURATION);
      for (const hit of tracer.hits) {
        this.ropeGraphics.lineStyle(5, 0xff9d42, alpha * 0.18);
        this.ropeGraphics.lineBetween(tracer.originX, tracer.originY, hit.x, hit.y);
        this.ropeGraphics.lineStyle(2, 0xfff2b0, alpha);
        this.ropeGraphics.lineBetween(tracer.originX, tracer.originY, hit.x, hit.y);
      }
    }

    // Skipped for bazooka/shotgun while just aiming (not charging) - their
    // held-weapon sprite already points along the aim angle, so the crosshair
    // would be redundant clutter; the charge bar still matters and stays.
    const activeWeaponKey = WEAPON_KEYS[sharedInput.selectedWeapon - 1] ?? 'bazooka';
    const weaponHasOwnAimIndicator =
      activeWeaponKey === 'bazooka' || activeWeaponKey === 'shotgun' || activeWeaponKey === 'homingMissile';
    if (active.worm.alive && (this.rt.charging || !weaponHasOwnAimIndicator)) {
      const worm = active.worm;
      const fireAngle = worm.facing === 1 ? worm.aimAngle : Math.PI - worm.aimAngle;
      const innerRadius = 16;
      const outerRadius = this.rt.charging ? innerRadius + chargeBarLength(this.rt.chargePower) : 28;
      const color = this.rt.charging ? chargeBarColor(this.rt.chargePower) : 0xffd966;
      const startX = worm.x + Math.cos(fireAngle) * innerRadius;
      const startY = worm.y + Math.sin(fireAngle) * innerRadius;
      const endX = worm.x + Math.cos(fireAngle) * outerRadius;
      const endY = worm.y + Math.sin(fireAngle) * outerRadius;
      this.ropeGraphics.lineStyle(this.rt.charging ? 4 : 2.5, color, 0.95);
      this.ropeGraphics.lineBetween(startX, startY, endX, endY);
      this.crosshairImage.setPosition(endX, endY).setTint(color).setVisible(true);
    } else {
      this.crosshairImage.setVisible(false);
    }
  }

  // See the ignoredWorldObjectCount field comment: Camera.ignore() only marks
  // the objects handed to it, so the renderers' lazily-created world objects
  // need the ignore re-applied to the newly appended tail.
  private ignoreNewWorldObjects(): void {
    if (this.worldObjects.length === this.ignoredWorldObjectCount) return;
    const added = this.worldObjects.slice(this.ignoredWorldObjectCount);
    this.ignoredWorldObjectCount = this.worldObjects.length;
    this.uiCamera.ignore(added);
  }

  update(time: number, delta: number): void {
    const dt = Math.min(0.05, delta / 1000);
    stepMatch(this.rt, sharedInput, dt);
    if (this.rt.charging && !this.wasCharging) soundSystem.play('charge');
    this.wasCharging = this.rt.charging;

    this.waterRenderer.update(time);
    this.terrainRenderer.update(this.rt.terrain);

    const activeWeaponKey = WEAPON_KEYS[sharedInput.selectedWeapon - 1] ?? 'bazooka';
    const active = currentWorm(this.rt.match);
    for (const [worm, renderer] of this.wormRenderers) {
      const isActive = worm === active.worm;
      renderer.update(worm, isActive, isActive ? activeWeaponKey : undefined, this.rt.terrain, time);
    }
    this.projectileRenderer.update(this.rt.projectiles);
    this.crateRenderer.update(this.rt.crates);
    this.effectsRenderer.syncGravestones(this.rt.gravestones);
    this.updateRopeAndTracer(active);
    this.hudRenderer.update(this.rt.teams);
    updateHud(this.hudText, this.rt.match);
    const activeTeam = this.rt.teams.find((t) => t.playerId === active.playerId);
    updateWeaponText(this.weaponText, sharedInput.selectedWeapon, activeTeam?.ammo?.[activeWeaponKey]);
    this.weaponIcon.setTexture(`${activeWeaponKey}_held`);
    this.updateMobileWeaponLabel();
    this.triggerEffectBursts();
    this.triggerMovementDust(delta);
    this.updateActiveWormArrow(time);
    this.updateWormNameTexts();
    // Last, so it also catches whatever this frame's bursts/pool growth just
    // added to worldObjects before the cameras render it.
    this.ignoreNewWorldObjects();

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
    if (result) {
      const winnerName = this.rt.teams.find((team) => team.playerId === result)?.name;
      this.scene.start('EndScene', { winner: result, winnerName });
    }
  }

  // Hidden once the active worm has received any movement input this turn
  // (tracked via turnMovementStarted, reset below when the active worm
  // changes) - the arrow marks "it's your turn, you haven't moved yet", not
  // the active worm generally, so it shouldn't linger once you've started.
  // Also hidden while the active worm is dead/dying - there's no "your
  // turn" left to highlight once it can no longer act.
  private updateActiveWormArrow(timeMs: number): void {
    const active = currentWorm(this.rt.match);
    if (active.worm !== this.turnArrowWorm) {
      this.turnArrowWorm = active.worm;
      this.turnMovementStarted = false;
    }
    if (sharedInput.left || sharedInput.right) this.turnMovementStarted = true;

    if (!active.worm.alive || active.worm.dying || this.turnMovementStarted) {
      this.activeWormArrow.setVisible(false);
      return;
    }
    this.activeWormArrow.setVisible(true);
    const bounce = Math.sin(timeMs / 220) * 4 * WORM_RENDER_SCALE;
    this.activeWormArrow.setPosition(active.worm.x, active.worm.y - 46 * WORM_RENDER_SCALE + bounce);
  }

  private updateWormNameTexts(): void {
    for (const [worm, text] of this.wormNameTexts) {
      if (!worm.alive || worm.dying) {
        text.setVisible(false);
        continue;
      }
      text.setVisible(true);
      text.setPosition(worm.x, worm.y - 31 * WORM_RENDER_SCALE);
    }
  }

  private allWorms(): Worm[] {
    return this.rt.teams.flatMap((t) => t.worms);
  }

  private unlockAudio(): void {
    soundSystem.unlock();
    soundSystem.startBackgroundMusic();
  }
}
