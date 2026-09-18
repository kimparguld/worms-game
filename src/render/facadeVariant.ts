// Deterministic per-run facade texture choice: each contiguous building
// "run" (identified by the x where it starts) picks one of `variantCount`
// texture variants, so the skyline stays visually varied without any
// per-pixel computation. Same technique as the old windowIsLit hash, kept
// local here since that function is deleted with the rest of the
// per-pixel terrain coloring code.
export function facadeVariantIndex(runStartX: number, variantCount: number): number {
  let hash = runStartX * 2654435761;
  hash = (hash ^ (hash >>> 13)) * 2246822519;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash % variantCount;
}
