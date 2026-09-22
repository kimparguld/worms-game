import { waterLevelY } from './terrain.js';
import type { SteelStructure, Terrain, Worm } from './types.js';

// Where the girder actually sits inside steelStructure_placed.png - the
// art has generous transparent padding around it, so rendering crops to
// this rect and collision is sized from it.
export const STEEL_STRUCTURE_ART = { cropX: 109, cropY: 160, cropWidth: 574, cropHeight: 108 };

export const STRUCTURE_LENGTH = 150; // world px
export const STRUCTURE_THICKNESS = Math.round(
  (STRUCTURE_LENGTH * STEEL_STRUCTURE_ART.cropHeight) / STEEL_STRUCTURE_ART.cropWidth,
);
// How far from the placing worm the girder's centre may go.
export const STRUCTURE_PLACE_RANGE = 220;
// Extra room kept between a girder and any worm, so a placement can never
// wedge a worm inside solid material.
const STRUCTURE_WORM_CLEARANCE = 14;

// The girder tilts with the worm's aim (up/down keys): aimed up, it rises
// toward the side the worm faces.
export function structureRotation(worm: Worm): number {
  return worm.facing === 1 ? worm.aimAngle : -worm.aimAngle;
}

export function createStructure(x: number, y: number, rotation: number): SteelStructure {
  return { x, y, rotation, length: STRUCTURE_LENGTH, thickness: STRUCTURE_THICKNESS };
}

// Point (px, py) in the structure's own frame: x along its length, y across it.
function toLocal(structure: SteelStructure, px: number, py: number): { x: number; y: number } {
  const dx = px - structure.x;
  const dy = py - structure.y;
  const cos = Math.cos(structure.rotation);
  const sin = Math.sin(structure.rotation);
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

function halfExtents(structure: SteelStructure): { x: number; y: number } {
  const cos = Math.abs(Math.cos(structure.rotation));
  const sin = Math.abs(Math.sin(structure.rotation));
  const hl = structure.length / 2;
  const ht = structure.thickness / 2;
  return { x: hl * cos + ht * sin, y: hl * sin + ht * cos };
}

export function isStructurePlacementValid(
  terrain: Terrain,
  worms: Worm[],
  placer: Worm,
  structure: SteelStructure,
): boolean {
  if (Math.hypot(structure.x - placer.x, structure.y - placer.y) > STRUCTURE_PLACE_RANGE) return false;
  const extents = halfExtents(structure);
  if (structure.x - extents.x < 0 || structure.x + extents.x > terrain.width) return false;
  if (structure.y - extents.y < 0 || structure.y + extents.y > waterLevelY(terrain)) return false;
  return !worms.some((worm) => {
    if (!worm.alive) return false;
    const local = toLocal(structure, worm.x, worm.y);
    return (
      Math.abs(local.x) < structure.length / 2 + STRUCTURE_WORM_CLEARANCE &&
      Math.abs(local.y) < structure.thickness / 2 + STRUCTURE_WORM_CLEARANCE
    );
  });
}

// Solid bar, not the art's see-through lattice: worm collision is a single
// point (see worm.ts), which could otherwise drop into the gaps. Stamped
// into decorationMask so it is destructible terrain like any other, and its
// art (drawn by TerrainRenderer) erodes with it.
export function stampStructure(terrain: Terrain, structure: SteelStructure): void {
  const extents = halfExtents(structure);
  const minX = Math.max(0, Math.floor(structure.x - extents.x));
  const maxX = Math.min(terrain.width - 1, Math.ceil(structure.x + extents.x));
  const minY = Math.max(0, Math.floor(structure.y - extents.y));
  const maxY = Math.min(terrain.height - 1, Math.ceil(structure.y + extents.y));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const local = toLocal(structure, x + 0.5, y + 0.5);
      if (Math.abs(local.x) <= structure.length / 2 && Math.abs(local.y) <= structure.thickness / 2) {
        terrain.decorationMask[y * terrain.width + x] = 1;
      }
    }
  }
  terrain.dirty = true;
}
