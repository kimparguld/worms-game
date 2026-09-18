import { describe, it, expect } from 'vitest';
import { encodePng } from '../src/pngEncoder.js';

describe('encodePng', () => {
  it('starts with the PNG signature', () => {
    const buf = encodePng(2, 2, new Uint8Array(2 * 2 * 4));
    expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('encodes width and height big-endian in the IHDR chunk', () => {
    const buf = encodePng(300, 150, new Uint8Array(300 * 150 * 4));
    // IHDR chunk: 4-byte length, "IHDR", 4-byte width, 4-byte height, ...
    // starts right after the 8-byte signature.
    const ihdrStart = 8;
    expect(buf.toString('ascii', ihdrStart + 4, ihdrStart + 8)).toBe('IHDR');
    const width = buf.readUInt32BE(ihdrStart + 8);
    const height = buf.readUInt32BE(ihdrStart + 12);
    expect(width).toBe(300);
    expect(height).toBe(150);
  });

  it('throws if the rgba buffer length does not match width*height*4', () => {
    expect(() => encodePng(2, 2, new Uint8Array(3))).toThrow();
  });
});
