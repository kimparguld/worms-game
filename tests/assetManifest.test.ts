import { describe, it, expect } from 'vitest';
import { ASSET_MANIFEST } from '../src/assetManifest.js';

describe('ASSET_MANIFEST', () => {
  it('has no duplicate keys', () => {
    const keys = ASSET_MANIFEST.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every path is unique and lives under assets/', () => {
    const paths = ASSET_MANIFEST.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p.startsWith('assets/')).toBe(true);
  });

  it('every entry has positive width/height', () => {
    for (const e of ASSET_MANIFEST) {
      expect(e.width).toBeGreaterThan(0);
      expect(e.height).toBeGreaterThan(0);
    }
  });

  it('spritesheet entries declare a positive frameCount', () => {
    for (const e of ASSET_MANIFEST) {
      if (e.kind === 'spritesheet') expect(e.frameCount ?? 0).toBeGreaterThan(0);
    }
  });

  it('nineslice entries declare insets', () => {
    for (const e of ASSET_MANIFEST) {
      if (e.kind === 'nineslice') expect(e.nineSlice).toBeDefined();
    }
  });

  it('includes a held image and a projectile image for every weapon key', () => {
    const weaponKeys = [
      'bazooka', 'grenade', 'shotgun', 'ninjaRope', 'dynamite',
      'sniperRifle', 'airstrikeRocket', 'holyHandGrenade', 'mine', 'drill',
    ];
    const keys = new Set(ASSET_MANIFEST.map((e) => e.key));
    for (const w of weaponKeys) {
      expect(keys.has(`${w}_held`)).toBe(true);
      expect(keys.has(`${w}_projectile`)).toBe(true);
    }
  });
});
