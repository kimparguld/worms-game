import { describe, it, expect } from 'vitest';
import {
  createStructure,
  isStructurePlacementValid,
  stampStructure,
  structureRotation,
  STRUCTURE_LENGTH,
  STRUCTURE_PLACE_RANGE,
} from '../src/structures.js';
import { createTerrain, isSolid, carveCircle } from '../src/terrain.js';
import { createWorm } from '../src/worm.js';
import { createMatchRuntime, stepMatch, tryPlaceStructure, WEAPON_KEYS } from '../src/matchLoop.js';
import { currentWorm } from '../src/game.js';
import type { InputState, Terrain } from '../src/types.js';

function emptyTerrain(width = 800, height = 600): Terrain {
  const terrain = createTerrain(width, height);
  terrain.mask.fill(0);
  terrain.decorationMask.fill(0);
  return terrain;
}

const STRUCTURE_SLOT = WEAPON_KEYS.indexOf('steelStructure') + 1;

function input(overrides: Partial<InputState> = {}): InputState {
  return {
    left: false,
    right: false,
    aimUp: false,
    aimDown: false,
    jump: false,
    firing: false,
    endTurnRequested: false,
    selectedWeapon: STRUCTURE_SLOT,
    ...overrides,
  };
}

describe('steel structures', () => {
  it('stamps a solid, destructible bar into the terrain', () => {
    const terrain = emptyTerrain();
    stampStructure(terrain, createStructure(400, 300, 0));
    expect(isSolid(terrain, 400, 300)).toBe(true);
    expect(isSolid(terrain, 400 + STRUCTURE_LENGTH / 2 - 2, 300)).toBe(true);
    expect(isSolid(terrain, 400 + STRUCTURE_LENGTH / 2 + 4, 300)).toBe(false);
    expect(isSolid(terrain, 400, 330)).toBe(false);

    carveCircle(terrain, 400, 300, 20);
    expect(isSolid(terrain, 400, 300)).toBe(false);
    expect(isSolid(terrain, 360, 300)).toBe(true); // only the blasted part is gone
  });

  it('follows its rotation when stamped', () => {
    const terrain = emptyTerrain();
    stampStructure(terrain, createStructure(400, 300, Math.PI / 2)); // vertical
    expect(isSolid(terrain, 400, 300 + STRUCTURE_LENGTH / 2 - 4)).toBe(true);
    expect(isSolid(terrain, 400 + STRUCTURE_LENGTH / 2 - 4, 300)).toBe(false);
  });

  it('tilts upward toward the side the worm faces when it aims up', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    worm.aimAngle = -0.5;
    worm.facing = 1;
    expect(structureRotation(worm)).toBeCloseTo(-0.5);
    worm.facing = -1;
    expect(structureRotation(worm)).toBeCloseTo(0.5);
  });

  it('only allows placement within range, inside the world and clear of every worm', () => {
    const terrain = emptyTerrain();
    const placer = createWorm(400, 400, 'p1', 'A');
    const other = createWorm(400, 250, 'p2', 'B');
    const worms = [placer, other];
    expect(isStructurePlacementValid(terrain, worms, placer, createStructure(450, 330, 0))).toBe(true);
    expect(isStructurePlacementValid(terrain, worms, placer, createStructure(400, 250, 0))).toBe(false); // on a worm
    expect(isStructurePlacementValid(terrain, worms, placer, createStructure(400, 405, 0))).toBe(false); // on the placer
    expect(
      isStructurePlacementValid(terrain, worms, placer, createStructure(400 + STRUCTURE_PLACE_RANGE + 10, 400, 0)),
    ).toBe(false); // out of range
    expect(isStructurePlacementValid(terrain, worms, placer, createStructure(40, 330, 0))).toBe(false); // off the world
  });
});

describe('tryPlaceStructure', () => {
  function setup() {
    const rt = createMatchRuntime(1600, 900);
    rt.turnBannerTimer = null;
    const worm = currentWorm(rt.match).worm;
    return { rt, worm };
  }

  it('places a girder, spends ammo and uses up the turn', () => {
    const { rt, worm } = setup();
    const team = rt.teams.find((t) => t.worms.includes(worm))!;
    const before = team.ammo!.steelStructure!;
    expect(tryPlaceStructure(rt, input(), worm.x, worm.y - 80)).toBe(true);
    expect(rt.structures).toHaveLength(1);
    expect(isSolid(rt.terrain, worm.x, worm.y - 80)).toBe(true);
    expect(team.ammo!.steelStructure).toBe(before - 1);
    expect(rt.retirementTimer).not.toBeNull();
    // Only one action per turn.
    expect(tryPlaceStructure(rt, input(), worm.x, worm.y - 140)).toBe(false);
  });

  it('refuses when another weapon is selected, or the girder is out of ammo', () => {
    const { rt, worm } = setup();
    expect(tryPlaceStructure(rt, input({ selectedWeapon: 1 }), worm.x, worm.y - 80)).toBe(false);
    const team = rt.teams.find((t) => t.worms.includes(worm))!;
    team.ammo!.steelStructure = 0;
    expect(tryPlaceStructure(rt, input(), worm.x, worm.y - 80)).toBe(false);
    expect(rt.structures).toHaveLength(0);
  });

  it('does nothing on the fire key - a girder has to be placed with the mouse', () => {
    const { rt } = setup();
    stepMatch(rt, input({ firing: true }), 0.016);
    expect(rt.structures).toHaveLength(0);
    expect(rt.retirementTimer).toBeNull();
  });
});
