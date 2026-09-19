import Phaser from 'phaser';
import type { Terrain } from '../types.js';
import { facadeVariantIndex } from './facadeVariant.js';
import { DEPTH_BACKDROP } from '../render.js';

const BUILDING_FACADE_KEYS = ['terrain_building_1', 'terrain_building_2', 'terrain_building_3'];
const EDGE_OVERLAY_ALPHA = 0.35;
// How many pixels of a column's original (pre-dig) ground surface render as
// grass rather than plain dirt - see the grassBand comment on the
// constructor for why this has to be captured once up front rather than
// recomputed from the live mask every frame.
const GRASS_BAND_THICKNESS = 13;

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
  private grassMaskTexture: Phaser.Textures.CanvasTexture;
  private groundImage: Phaser.GameObjects.TileSprite;
  private grassImage: Phaser.GameObjects.TileSprite;
  private edgeOverlay: Phaser.GameObjects.Image;
  private buildingRuns: BuildingRun[] = [];
  private groundMaskImageData: ImageData | null = null;
  private edgeMaskImageData: ImageData | null = null;
  private grassMaskImageData: ImageData | null = null;
  // Which pixels were part of each column's original, undug surface (mask
  // value 1, within GRASS_BAND_THICKNESS of the topmost solid pixel at
  // construction time) - captured once and never recomputed from the live
  // mask, so digging into a hillside reveals plain dirt underneath rather
  // than a fresh ring of grass at the new crater floor (carveCircle only
  // ever clears mask bits, so "topmost solid pixel" would otherwise drift
  // downward into subsurface dirt and get mistaken for a new surface).
  private originalGrassBand: Uint8Array;
  private decorationMaskTexture: Phaser.Textures.CanvasTexture;
  private decorationMaskImageData: ImageData | null = null;
  // Every rock/tree/bush/flower's art (see terrainDecorations.ts) pre-drawn
  // once onto a single world-sized canvas at its own generated position/
  // scale/flip, then masked with terrain.decorationMask - a layer kept
  // separate from the ground's own mask (see that field's comment on
  // Terrain), painted every dirty frame the same way paintGroundMask paints
  // the ground's. Masking against a live mask rather than tracking each
  // decoration's own visibility means an explosion erodes a decoration
  // exactly one pixel at a time, the same as it erodes any other hillside:
  // a graze chips off a corner of the art, a solid hit can clear all of it,
  // with nothing in between ever going invisible as an all-or-nothing unit.
  private decorationArtTexture: Phaser.Textures.CanvasTexture;
  private decorationImage: Phaser.GameObjects.Image;

  constructor(
    scene: Phaser.Scene,
    worldObjects: Phaser.GameObjects.GameObject[],
    width: number,
    height: number,
    terrain: Terrain,
  ) {
    for (const key of [
      'terrainGroundMask',
      'terrainEdgeMask',
      'terrainGrassMask',
      'terrainDecorationArt',
      'terrainDecorationMask',
    ]) {
      if (scene.textures.exists(key)) scene.textures.remove(key);
    }
    this.groundMaskTexture = scene.textures.createCanvas('terrainGroundMask', width, height)!;
    this.edgeMaskTexture = scene.textures.createCanvas('terrainEdgeMask', width, height)!;
    this.grassMaskTexture = scene.textures.createCanvas('terrainGrassMask', width, height)!;
    this.decorationMaskTexture = scene.textures.createCanvas('terrainDecorationMask', width, height)!;
    this.originalGrassBand = this.computeOriginalGrassBand(terrain);

    // All three terrain layers (and the water/sky behind them) sit in the
    // DEPTH_BACKDROP band so that mid-match spawns - gravestones, splashes -
    // have a depth slot below the worms but still above the terrain to land
    // in. See the band definitions in src/render.ts.
    this.groundImage = scene.add
      .tileSprite(0, 0, width, height, terrain.groundTextureKey)
      .setOrigin(0, 0)
      .setDepth(DEPTH_BACKDROP)
      .enableFilters();
    this.groundImage.filters!.internal.addMask('terrainGroundMask');
    worldObjects.push(this.groundImage);

    // Grass cap: drawn right after the ground fill (so it sits on top of
    // it) but before the building facades/edge trim below, using the same
    // world-sized-object-plus-world-sized-mask pattern as groundImage.
    this.grassImage = scene.add
      .tileSprite(0, 0, width, height, 'terrain_grass')
      .setOrigin(0, 0)
      .setDepth(DEPTH_BACKDROP)
      .enableFilters();
    this.grassImage.filters!.internal.addMask('terrainGrassMask');
    worldObjects.push(this.grassImage);

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

    // Scattered rocks/trees/bushes/flowers (see terrainDecorations.ts):
    // drawn once, here, onto a world-sized canvas at each one's own
    // generated (x, y, scale, flipX) - "y" is a bottom-center anchor, so
    // each draw is translated there and offset back by half its own drawn
    // width/height. Masked below with 'terrainDecorationMask' (painted every
    // dirty frame by paintDecorationMask from terrain.decorationMask), a
    // layer kept separate from the ground so a decoration is never merged
    // into - or reshapes - the ground's own silhouette; it just stands on it.
    this.decorationArtTexture = scene.textures.createCanvas('terrainDecorationArt', width, height)!;
    const decorationCtx = this.decorationArtTexture.context;
    for (const decoration of terrain.decorations) {
      const source = scene.textures.get(decoration.textureKey).getSourceImage() as
        | HTMLImageElement
        | HTMLCanvasElement;
      const drawWidth = source.width * decoration.scale;
      const drawHeight = source.height * decoration.scale;
      decorationCtx.save();
      decorationCtx.translate(decoration.x, decoration.y);
      if (decoration.flipX) decorationCtx.scale(-1, 1);
      decorationCtx.drawImage(source, -drawWidth / 2, -drawHeight, drawWidth, drawHeight);
      decorationCtx.restore();
    }
    this.decorationArtTexture.refresh();

    this.decorationImage = scene.add
      .image(0, 0, 'terrainDecorationArt')
      .setOrigin(0, 0)
      .setDepth(DEPTH_BACKDROP)
      .enableFilters();
    this.decorationImage.filters!.internal.addMask('terrainDecorationMask');
    worldObjects.push(this.decorationImage);

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

  // Scans the terrain exactly as handed to the constructor - before any
  // carveCircle call - for each column's topmost solid pixel. Only ground
  // columns (mask value 1) get a band; a building column's topmost pixel is
  // always its roof (mask value 2, see terrain.ts's generateSilhouetteMask),
  // so this naturally excludes buildings with no separate check needed.
  private computeOriginalGrassBand(terrain: Terrain): Uint8Array {
    const { width, height, mask } = terrain;
    const band = new Uint8Array(width * height);
    for (let x = 0; x < width; x++) {
      let surfaceY = -1;
      for (let y = 0; y < height; y++) {
        if (mask[y * width + x] !== 0) {
          surfaceY = y;
          break;
        }
      }
      if (surfaceY === -1 || mask[surfaceY * width + x] !== 1) continue;
      const bandEnd = Math.min(height, surfaceY + GRASS_BAND_THICKNESS);
      for (let y = surfaceY; y < bandEnd; y++) band[y * width + x] = 1;
    }
    return band;
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
    this.paintGrassMask(terrain);
    for (const run of this.buildingRuns) this.paintBuildingRunMask(run, terrain);
    this.paintDecorationMask(terrain);
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

  // Opaque wherever terrain.decorationMask says a decoration still occupies
  // this pixel - kept as its own mask (rather than folded into
  // paintGroundMask) precisely because it's a separate layer from the
  // ground (see Terrain.decorationMask): carveCircle clears both together,
  // but a decoration was never part of the ground's own mask to begin with.
  private paintDecorationMask(terrain: Terrain): void {
    const { width, height, decorationMask } = terrain;
    if (!this.decorationMaskImageData) {
      this.decorationMaskImageData = this.decorationMaskTexture.context.createImageData(width, height);
    }
    const data = this.decorationMaskImageData.data;
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const solid = decorationMask[i] !== 0;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = solid ? 255 : 0;
    }
    this.decorationMaskTexture.context.putImageData(this.decorationMaskImageData, 0, 0);
    this.decorationMaskTexture.refresh();
  }

  // Opaque wherever a pixel is both still solid ground *and* part of the
  // original grass band captured at construction - the AND against the
  // live mask is what makes grass disappear as a column gets dug away,
  // without ever having it reappear somewhere new.
  private paintGrassMask(terrain: Terrain): void {
    const { width, height, mask } = terrain;
    if (!this.grassMaskImageData) {
      this.grassMaskImageData = this.grassMaskTexture.context.createImageData(width, height);
    }
    const data = this.grassMaskImageData.data;
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const grass = this.originalGrassBand[i] === 1 && mask[i] === 1;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = grass ? 255 : 0;
    }
    this.grassMaskTexture.context.putImageData(this.grassMaskImageData, 0, 0);
    this.grassMaskTexture.refresh();
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

  // Opaque wherever solid terrain (ground, building, or a decoration
  // standing on either - see Terrain.decorationMask) has at least one empty
  // neighbor (solid in neither mask) - the "neighbor-emptiness check" the
  // spec calls for, matching the old applyMaterialLighting's intent, and
  // extended to decorations so an object's own exposed edge gets the same
  // darkened trim as the rest of the terrain. (An earlier version of this
  // check compared against a single target material value, which
  // incorrectly flagged the ground/building seam as an "exposed" edge too -
  // a solid-to-solid boundary is not exposed to anything.)
  private paintEdgeMask(terrain: Terrain): void {
    const { width, height, mask, decorationMask } = terrain;
    if (!this.edgeMaskImageData) {
      this.edgeMaskImageData = this.edgeMaskTexture.context.createImageData(width, height);
    }
    const data = this.edgeMaskImageData.data;
    const solidAt = (i: number): boolean => mask[i] !== 0 || decorationMask[i] !== 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const idx = i * 4;
        const solid = solidAt(i);
        const exposed =
          solid &&
          ((x > 0 && !solidAt(i - 1)) ||
            (x < width - 1 && !solidAt(i + 1)) ||
            (y > 0 && !solidAt(i - width)) ||
            (y < height - 1 && !solidAt(i + width)));
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
