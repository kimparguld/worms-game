import { describe, it, expect } from 'vitest';
import { placeholderSheetFor } from '../src/placeholderArt.js';
import type { AssetManifestEntry } from '../src/assetManifest.js';

describe('placeholderSheetFor', () => {
  it('sizes an image entry to its declared width/height', () => {
    const entry: AssetManifestEntry = { key: 'k', kind: 'image', path: 'assets/k.png', width: 10, height: 20, placeholderColor: 0xff0000 };
    const sheet = placeholderSheetFor(entry);
    expect(sheet.width).toBe(10);
    expect(sheet.height).toBe(20);
    expect(sheet.rgba.length).toBe(10 * 20 * 4);
  });

  it('sizes a spritesheet entry to frameWidth*frameCount by frameHeight', () => {
    const entry: AssetManifestEntry = {
      key: 'k', kind: 'spritesheet', path: 'assets/k.png', width: 8, height: 8, frameCount: 4, placeholderColor: 0x00ff00,
    };
    const sheet = placeholderSheetFor(entry);
    expect(sheet.width).toBe(32);
    expect(sheet.height).toBe(8);
  });

  it('fills every pixel with the entry placeholderColor at full opacity', () => {
    const entry: AssetManifestEntry = { key: 'k', kind: 'image', path: 'assets/k.png', width: 2, height: 1, placeholderColor: 0x102030 };
    const { rgba } = placeholderSheetFor(entry);
    expect([...rgba]).toEqual([0x10, 0x20, 0x30, 255, 0x10, 0x20, 0x30, 255]);
  });

  it('draws a 1px darker border around each frame so adjacent spritesheet frames are visually distinguishable', () => {
    const entry: AssetManifestEntry = {
      key: 'k', kind: 'spritesheet', path: 'assets/k.png', width: 6, height: 6, frameCount: 2, placeholderColor: 0x808080,
    };
    const { rgba, width } = placeholderSheetFor(entry);
    // Top-left pixel of frame 0 is on the border - should be darker than the fill color.
    expect(rgba[0]).toBeLessThan(0x80);
    // Center pixel of frame 0 (3,3) is interior fill.
    const centerIndex = (3 * width + 3) * 4;
    expect(rgba[centerIndex]).toBe(0x80);
  });
});
