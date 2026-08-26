export function generateSilhouetteMask(width, height) {
  const mask = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    const groundHeight = height * 0.5 + Math.sin((x / width) * Math.PI * 2) * height * 0.15;
    for (let y = 0; y < height; y++) {
      mask[y * width + x] = y >= height - groundHeight ? 1 : 0;
    }
  }
  return mask;
}

export function createTerrain(width, height) {
  return { width, height, mask: generateSilhouetteMask(width, height) };
}

export function isSolid(terrain, x, y) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= terrain.width || yi < 0 || yi >= terrain.height) return false;
  return terrain.mask[yi * terrain.width + xi] === 1;
}

export function carveCircle(terrain, cx, cy, radius) {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(terrain.width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(terrain.height - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) {
        terrain.mask[y * terrain.width + x] = 0;
      }
    }
  }
}
