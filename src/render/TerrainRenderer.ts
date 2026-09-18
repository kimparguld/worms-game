import Phaser from 'phaser';
import type { Terrain } from '../types.js';
import { facadeVariantIndex } from './facadeVariant.js';

const BUILDING_FACADE_KEYS = ['terrain_building_1', 'terrain_building_2', 'terrain_building_3'];

// Two masked texture layers instead of per-pixel color computation: a ground
// Image (mask value 1) and a building Image (mask value 2), each clipped by
// a texture-based mask redrawn from terrain.mask only when terrain.dirty -
// same redraw economy as the old drawTerrain (src/render.ts:339-444), just
// producing a mask instead of computing final pixel colors.
//
// DEVIATION FROM BRIEF: the brief's original code used
// `new Phaser.Display.Masks.BitmapMask(scene, maskImage)` + `.setMask(...)`,
// which was Phaser 3 API. Phaser 4.2.1 (the version actually installed -
// see package.json) removed BitmapMask entirely; `Phaser.Display.Masks` now
// only exposes GeometryMask (shape-based, not per-pixel-alpha, so it can't
// read an arbitrary CanvasTexture). The Phaser-4-native equivalent for
// "clip this Game Object by the alpha channel of a texture" is the WebGL
// Mask *filter*: `gameObject.enableFilters()` then
// `gameObject.filters.internal.addMask(textureKey)`, which multiplies the
// object's color/alpha by the named texture's alpha - exactly the semantics
// paintMask() below paints into groundMaskTexture/buildingMaskTexture. This
// also means masking is a WebGL-only feature in this Phaser version
// (enableFilters() no-ops under the Canvas renderer fallback).
export class TerrainRenderer {
  private groundMaskTexture: Phaser.Textures.CanvasTexture;
  private buildingMaskTexture: Phaser.Textures.CanvasTexture;
  private groundImage: Phaser.GameObjects.TileSprite;
  private buildingImage: Phaser.GameObjects.Image;
  private groundMaskImageData: ImageData | null = null;
  private buildingMaskImageData: ImageData | null = null;

  constructor(scene: Phaser.Scene, worldObjects: Phaser.GameObjects.GameObject[], width: number, height: number) {
    for (const key of ['terrainGroundMask', 'terrainBuildingMask']) {
      if (scene.textures.exists(key)) scene.textures.remove(key);
    }
    this.groundMaskTexture = scene.textures.createCanvas('terrainGroundMask', width, height)!;
    this.buildingMaskTexture = scene.textures.createCanvas('terrainBuildingMask', width, height)!;

    // Building facade variety is picked once per match at construction time
    // (buildings don't move or get re-carved into new runs mid-match), by
    // scanning the initial mask for contiguous building runs along y=0.
    // Simplicity here matches the spec: "one ground + one set of building
    // facade variants for v1", not a live-recomputed skyline.
    this.groundImage = scene.add.tileSprite(0, 0, width, height, 'terrain_ground').setOrigin(0, 0).enableFilters();
    this.groundImage.filters!.internal.addMask('terrainGroundMask');
    this.buildingImage = scene.add
      .image(0, 0, this.pickBuildingKey(width))
      .setOrigin(0, 0)
      .setDisplaySize(width, height)
      .enableFilters();
    this.buildingImage.filters!.internal.addMask('terrainBuildingMask');

    worldObjects.push(this.groundImage, this.buildingImage);
  }

  private pickBuildingKey(width: number): string {
    return BUILDING_FACADE_KEYS[facadeVariantIndex(width, BUILDING_FACADE_KEYS.length)];
  }

  update(terrain: Terrain): void {
    if (terrain.dirty === false) return; // explicit false only - undefined means "treat as dirty", matching the old drawTerrain contract

    this.paintMask(this.groundMaskTexture, terrain, 1);
    this.paintMask(this.buildingMaskTexture, terrain, 2);
    terrain.dirty = false;
  }

  // Opaque where mask[i] === targetValue (plus a thin darkened trim along the
  // exposed edge so a fresh crater reads as cut into the material), transparent
  // elsewhere - code-only, no extra art required.
  private paintMask(texture: Phaser.Textures.CanvasTexture, terrain: Terrain, targetValue: number): void {
    const { width, height, mask } = terrain;
    const isGround = targetValue === 1;
    let imageData = isGround ? this.groundMaskImageData : this.buildingMaskImageData;
    if (!imageData) {
      imageData = texture.context.createImageData(width, height);
      if (isGround) this.groundMaskImageData = imageData;
      else this.buildingMaskImageData = imageData;
    }
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const solid = mask[i] === targetValue;
        const idx = i * 4;
        if (!solid) {
          data[idx + 3] = 0;
          continue;
        }
        const exposed =
          (x > 0 && mask[i - 1] !== targetValue) ||
          (x < width - 1 && mask[i + 1] !== targetValue) ||
          (y > 0 && mask[i - width] !== targetValue) ||
          (y < height - 1 && mask[i + width] !== targetValue);
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = exposed ? 220 : 255; // slightly translucent trim on the exposed edge reads as a darkened lip once composited over the tinted ground/building art
      }
    }

    texture.context.putImageData(imageData, 0, 0);
    texture.refresh();
  }
}
