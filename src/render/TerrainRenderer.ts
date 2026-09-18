import Phaser from 'phaser';
import type { Terrain } from '../types.js';
import { facadeVariantIndex } from './facadeVariant.js';
import { DEPTH_BACKDROP } from '../render.js';

const BUILDING_FACADE_KEYS = ['terrain_building_1', 'terrain_building_2', 'terrain_building_3'];
const EDGE_OVERLAY_ALPHA = 0.35;

interface BuildingRun {
  startX: number;
  endX: number; // exclusive
  tileSprite: Phaser.GameObjects.TileSprite;
  maskTexture: Phaser.Textures.CanvasTexture;
  maskImageData: ImageData | null;
}

// Two masked ground/building texture layers instead of per-pixel color
// computation, plus a third masked overlay that darkens the exposed edge -
// same redraw economy as the old drawTerrain (src/render.ts:339-444), just
// producing masks instead of computing final pixel colors.
//
// Masking uses Phaser 4's WebGL Mask filter (`enableFilters()` +
// `filters.internal.addMask(textureKey)`), not the Phaser-3-only
// `BitmapMask` an earlier draft of this file used - see the plan's Task 4
// note. The filter maps a mask 1:1 onto the *filtered object's own
// bounds*, so every masked object here is deliberately kept world-sized
// (0,0,width,height) - a differently-sized/positioned object paired with a
// world-sized mask texture would sample the wrong slice of it.
export class TerrainRenderer {
  private groundMaskTexture: Phaser.Textures.CanvasTexture;
  private edgeMaskTexture: Phaser.Textures.CanvasTexture;
  private groundImage: Phaser.GameObjects.TileSprite;
  private edgeOverlay: Phaser.GameObjects.Image;
  private buildingRuns: BuildingRun[] = [];
  private groundMaskImageData: ImageData | null = null;
  private edgeMaskImageData: ImageData | null = null;

  constructor(scene: Phaser.Scene, worldObjects: Phaser.GameObjects.GameObject[], width: number, height: number, terrain: Terrain) {
    for (const key of ['terrainGroundMask', 'terrainEdgeMask']) {
      if (scene.textures.exists(key)) scene.textures.remove(key);
    }
    this.groundMaskTexture = scene.textures.createCanvas('terrainGroundMask', width, height)!;
    this.edgeMaskTexture = scene.textures.createCanvas('terrainEdgeMask', width, height)!;

    // All three terrain layers (and the water/sky behind them) sit in the
    // DEPTH_BACKDROP band so that mid-match spawns - gravestones, splashes -
    // have a depth slot below the worms but still above the terrain to land
    // in. See the band definitions in src/render.ts.
    this.groundImage = scene.add
      .tileSprite(0, 0, width, height, 'terrain_ground')
      .setOrigin(0, 0)
      .setDepth(DEPTH_BACKDROP)
      .enableFilters();
    this.groundImage.filters!.internal.addMask('terrainGroundMask');
    worldObjects.push(this.groundImage);

    // Building facade variety: scan the *initial* mask once for contiguous
    // horizontal runs of building material (mask value 2). Buildings are
    // generated as fixed rectangular blocks (terrain.ts's applyBuildings)
    // and only ever lose mass to carveCircle, never gain it or split into
    // new runs - so this only needs to run once, at construction, matching
    // the "buildings don't move or get re-carved into new runs mid-match"
    // assumption this class already documented (and, before this fix,
    // didn't actually act on).
    //
    // Each run gets its own world-sized TileSprite (tiled, not stretched -
    // fixing the earlier stretched-Image version) and its own world-sized
    // mask texture that's opaque only for *that run's* building pixels, so
    // adjacent buildings can show different facade textures without one
    // run's mask leaking into another's. Per-run mask keys are cleaned up
    // in GameScene's shutdown handler (by prefix, since the run count
    // varies match to match), not here.
    const runs = this.findBuildingRuns(terrain);
    this.buildingRuns = runs.map((run, index) => {
      const maskKey = `terrainBuildingMask${index}`;
      if (scene.textures.exists(maskKey)) scene.textures.remove(maskKey);
      const maskTexture = scene.textures.createCanvas(maskKey, width, height)!;
      const facadeKey = BUILDING_FACADE_KEYS[facadeVariantIndex(run.startX, BUILDING_FACADE_KEYS.length)];
      const tileSprite = scene.add
        .tileSprite(0, 0, width, height, facadeKey)
        .setOrigin(0, 0)
        .setDepth(DEPTH_BACKDROP)
        .enableFilters();
      tileSprite.filters!.internal.addMask(maskKey);
      worldObjects.push(tileSprite);
      return { startX: run.startX, endX: run.endX, tileSprite, maskTexture, maskImageData: null };
    });

    // A flat black overlay, masked to only the exposed edge of solid
    // terrain (either material), drawn after the ground/building layers so
    // it darkens whatever's beneath it there - the "thin darkened trim"
    // the spec calls for. An alpha-mask filter can only reveal/hide what's
    // behind an object, it cannot darken the object's own surface, so this
    // needs to be its own separate darkening layer rather than baked into
    // the ground/building masks (an earlier version of this file tried the
    // latter and it silently did nothing visible).
    if (!scene.textures.exists('terrainEdgeOverlayBase')) {
      const base = scene.textures.createCanvas('terrainEdgeOverlayBase', 1, 1)!;
      base.context.fillStyle = '#000000';
      base.context.fillRect(0, 0, 1, 1);
      base.refresh();
    }
    this.edgeOverlay = scene.add
      .image(0, 0, 'terrainEdgeOverlayBase')
      .setOrigin(0, 0)
      .setDisplaySize(width, height)
      .setAlpha(EDGE_OVERLAY_ALPHA)
      .setDepth(DEPTH_BACKDROP)
      .enableFilters();
    this.edgeOverlay.filters!.internal.addMask('terrainEdgeMask');
    worldObjects.push(this.edgeOverlay);
  }

  private findBuildingRuns(terrain: Terrain): Array<{ startX: number; endX: number }> {
    const { width, height, mask } = terrain;
    const isBuildingColumn = (x: number): boolean => {
      for (let y = 0; y < height; y++) {
        if (mask[y * width + x] === 2) return true;
      }
      return false;
    };

    const runs: Array<{ startX: number; endX: number }> = [];
    let runStart: number | null = null;
    for (let x = 0; x <= width; x++) {
      const isBuilding = x < width && isBuildingColumn(x);
      if (isBuilding && runStart === null) {
        runStart = x;
      } else if (!isBuilding && runStart !== null) {
        runs.push({ startX: runStart, endX: x });
        runStart = null;
      }
    }
    return runs;
  }

  update(terrain: Terrain): void {
    if (terrain.dirty === false) return; // explicit false only - undefined means "treat as dirty", matching the old drawTerrain contract

    this.paintGroundMask(terrain);
    for (const run of this.buildingRuns) this.paintBuildingRunMask(run, terrain);
    this.paintEdgeMask(terrain);
    terrain.dirty = false;
  }

  private paintGroundMask(terrain: Terrain): void {
    const { width, height, mask } = terrain;
    if (!this.groundMaskImageData) {
      this.groundMaskImageData = this.groundMaskTexture.context.createImageData(width, height);
    }
    const data = this.groundMaskImageData.data;
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const solid = mask[i] === 1;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = solid ? 255 : 0;
    }
    this.groundMaskTexture.context.putImageData(this.groundMaskImageData, 0, 0);
    this.groundMaskTexture.refresh();
  }

  private paintBuildingRunMask(run: BuildingRun, terrain: Terrain): void {
    const { width, height, mask } = terrain;
    if (!run.maskImageData) {
      // createImageData zero-fills every byte, including alpha - since
      // this run's texture only ever gets pixels written inside its own
      // [startX, endX) column range (below), everything outside that
      // range stays alpha 0 forever with no further writes needed. Cost
      // per dirty frame is proportional to this run's own width, not the
      // whole world - N runs no longer means N full-world passes.
      run.maskImageData = run.maskTexture.context.createImageData(width, height);
    }
    const data = run.maskImageData.data;
    for (let y = 0; y < height; y++) {
      for (let x = run.startX; x < run.endX; x++) {
        const i = y * width + x;
        const idx = i * 4;
        const solid = mask[i] === 2;
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = solid ? 255 : 0;
      }
    }
    run.maskTexture.context.putImageData(run.maskImageData, 0, 0);
    run.maskTexture.refresh();
  }

  // Opaque wherever solid terrain (either material) has at least one empty
  // (mask value 0) neighbor - the "neighbor-emptiness check" the spec calls
  // for, matching the old applyMaterialLighting's intent. (An earlier
  // version of this check compared against a single target material value,
  // which incorrectly flagged the ground/building seam as an "exposed"
  // edge too - a solid-to-solid boundary is not exposed to anything.)
  private paintEdgeMask(terrain: Terrain): void {
    const { width, height, mask } = terrain;
    if (!this.edgeMaskImageData) {
      this.edgeMaskImageData = this.edgeMaskTexture.context.createImageData(width, height);
    }
    const data = this.edgeMaskImageData.data;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const idx = i * 4;
        const solid = mask[i] !== 0;
        const exposed =
          solid &&
          ((x > 0 && mask[i - 1] === 0) ||
            (x < width - 1 && mask[i + 1] === 0) ||
            (y > 0 && mask[i - width] === 0) ||
            (y < height - 1 && mask[i + width] === 0));
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = exposed ? 255 : 0;
      }
    }
    this.edgeMaskTexture.context.putImageData(this.edgeMaskImageData, 0, 0);
    this.edgeMaskTexture.refresh();
  }
}
