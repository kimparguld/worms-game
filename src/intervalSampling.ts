// Shared by terrain.ts (branches/lakes/buildings/islands vs. spawn columns)
// and terrainDecorations.ts (rocks/trees/bushes/flowers vs. spawn columns):
// both need to place something at a random position while guaranteeing it
// avoids a set of forbidden zones, without ever falling back to
// reroll-and-hope. Unit-agnostic - callers pass fractions-of-width or raw
// pixels consistently and get the same units back.

// Never stamp solid ground above this fraction of the world's height - the
// top-clearance budget every terrain feature and decoration respects (see
// terrain.ts's height-budget comment), so nothing generation builds can ever
// poke into the HUD's reserved space at the top of the screen. Shared here
// (rather than duplicated as a local constant in both terrain.ts and
// terrainDecorations.ts, which it used to be) so the two can't drift apart -
// this module is the one place both already import from without creating a
// circular dependency (terrain.ts imports generateDecorations from
// terrainDecorations.ts, so the reverse import isn't an option).
export const TOP_CLEARANCE_FRACTION = 0.19;

// Clips `forbidden` to [rangeMin, rangeMax], sweep-merges overlapping/
// adjacent intervals, and returns the complement (the allowed sub-intervals)
// within that range.
export function computeAllowedIntervals(
  rangeMin: number,
  rangeMax: number,
  forbidden: Array<[number, number]>,
): Array<[number, number]> {
  const clipped: Array<[number, number]> = [];
  for (const [rawLo, rawHi] of forbidden) {
    const lo = Math.max(rangeMin, rawLo);
    const hi = Math.min(rangeMax, rawHi);
    if (lo < hi) clipped.push([lo, hi]);
  }
  clipped.sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const [lo, hi] of clipped) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1]) {
      last[1] = Math.max(last[1], hi);
    } else {
      merged.push([lo, hi]);
    }
  }

  const allowed: Array<[number, number]> = [];
  let cursor = rangeMin;
  for (const [lo, hi] of merged) {
    if (lo > cursor) allowed.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (cursor < rangeMax) allowed.push([cursor, rangeMax]);
  return allowed;
}

// Samples uniformly from a set of allowed sub-intervals, weighting each by
// its length so the result is uniform over the whole allowed region rather
// than biased toward whichever interval is checked first. Returns null if
// the intervals cover no length at all, rather than throwing.
export function sampleFromIntervals(intervals: Array<[number, number]>): number | null {
  const totalLength = intervals.reduce((sum, [lo, hi]) => sum + (hi - lo), 0);
  if (totalLength <= 0) return null;
  let offset = Math.random() * totalLength;
  for (const [lo, hi] of intervals) {
    const len = hi - lo;
    if (offset < len) return lo + offset;
    offset -= len;
  }
  // Floating-point edge case: offset landed exactly on the total length.
  return intervals[intervals.length - 1][1];
}
