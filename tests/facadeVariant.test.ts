import { describe, it, expect } from 'vitest';
import { facadeVariantIndex } from '../src/render/facadeVariant.js';

describe('facadeVariantIndex', () => {
  it('is deterministic for the same run start and variant count', () => {
    expect(facadeVariantIndex(120, 3)).toBe(facadeVariantIndex(120, 3));
  });

  it('stays within [0, variantCount)', () => {
    for (let x = 0; x < 500; x += 7) {
      const v = facadeVariantIndex(x, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
    }
  });

  it('varies across different run start positions', () => {
    const values = new Set<number>();
    for (let x = 0; x < 500; x += 7) values.add(facadeVariantIndex(x, 3));
    expect(values.size).toBeGreaterThan(1);
  });
});
