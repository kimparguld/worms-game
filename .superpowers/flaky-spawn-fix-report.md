# Flaky spawn-exclusion terrain generation - fix report

## Root cause

`pickCliffCenterFraction` and `pickBuildingStartX` in `src/terrain.ts` used a
bounded random-reroll: pick a random position, check `isNearSpawnColumn` /
`spanNearSpawnColumn`, and if it's forbidden, reroll - up to
`SPAWN_EXCLUSION_MAX_ATTEMPTS = 10` times - falling back to whatever the last
roll happened to be if all 10 attempts landed in a forbidden zone.

The forbidden zone around each of the 4 fixed spawn columns
(`SPAWN_EXCLUSION_FRACTIONS = [0.156, 0.208, 0.792, 0.844]`) is roughly
`itemWidth + 2 * SPAWN_EXCLUSION_MARGIN_FRACTION` wide. For a building up to
`BUILDING_WIDTH_MAX_FRACTION = 0.11` wide, that's up to ~0.19 of fraction
space forbidden per spawn column, and adjacent columns' zones overlap and
merge (0.156 and 0.208 merge into one zone, as do 0.792 and 0.844), so a
single random roll over the building's placement range can have a rejection
probability well above 50% in the affected sub-range. With independent
rerolls, the probability that all 10 attempts land in a forbidden zone is
non-negligible - and once that happens, the code falls back to the *last*
(forbidden) roll instead of anything safe. This is a genuine, reproducible
bug, not a one-off fluke: the user measured 7 failures out of 60 runs of
`npx vitest run tests/terrain.test.ts -t spawn` before the fix (a ~12%
failure rate), with failures like a real cliff/building-sized height jump
landing right next to a spawn column.

## Fix: deterministic sampling

Replaced the reroll loop with `sampleExcludingSpawnColumns(rangeMin, rangeMax,
halfWidthFraction)`, a single reusable helper that:

1. Builds the forbidden `[lo, hi]` sub-interval for each of the 4 spawn
   columns: `[spawn - halfWidthFraction - margin, spawn + halfWidthFraction +
   margin]`, clipped to `[rangeMin, rangeMax]`. This is exactly the same
   "does this footprint (own half-width + margin) overlap a spawn column"
   definition the old `isNearSpawnColumn`/`spanNearSpawnColumn` used - verified
   algebraically equivalent before removing them.
2. Sorts and sweep-merges overlapping/adjacent forbidden intervals (the 0.156
   / 0.208 pair and 0.792 / 0.844 pair do merge for real building widths).
3. Computes the allowed sub-intervals as the complement of the merged
   forbidden intervals within `[rangeMin, rangeMax]`.
4. If the allowed region is empty, returns `(rangeMin + rangeMax) / 2` as a
   defensive, crash-proof fallback (verified below that this branch is
   unreachable with the project's actual constants).
5. Otherwise samples uniformly over the *union* of allowed intervals by
   drawing a random offset in `[0, totalAllowedLength)` and walking the
   interval list, weighting each interval by its own length - so the result
   stays uniform over the whole allowed region rather than biased toward
   whichever interval happens to be checked first.

`pickCliffCenterFraction(min, max)` now just calls
`sampleExcludingSpawnColumns(min, max, CLIFF_WIDTH_FRACTION / 2)`.

`pickBuildingStartX(width, buildingWidth)` reframes the building's placement
as choosing its *center* fraction (reusing the same helper, so there's only
one interval-math implementation) over the valid center range
`[halfWidthFraction, 1 - halfWidthFraction]` where `halfWidthFraction =
(buildingWidth / width) / 2`, then converts the returned center fraction back
to a pixel `startX = round(centerFraction * width - buildingWidth / 2)`,
clamped to `[0, width - buildingWidth]`.

Removed: `SPAWN_EXCLUSION_MAX_ATTEMPTS` (no longer used - no retry loop),
`spanNearSpawnColumn`, `isNearSpawnColumn` (superseded by the forbidden-zone
math built directly into `sampleExcludingSpawnColumns`; no other call sites
existed, confirmed via grep across `src/` and `tests/`).

Nothing about `applyCliff`'s rise math, the height-budget constants, or any
other terrain logic was touched.

## Feasibility check (empty-region analysis)

Verified numerically (script run against the real constants) that the
allowed region is never close to empty for any of this project's actual
placement ranges:

| Case | Range | half-width | Forbidden (merged) | Allowed length |
|---|---|---|---|---|
| Cliff range 1 | [0.15, 0.45] | 0.05 | [0.15, 0.298] | 0.152 (of 0.30, ~51%) |
| Cliff range 2 | [0.55, 0.85] | 0.05 | [0.702, 0.85] | 0.152 (of 0.30, ~51%) |
| Building, min width (0.06) | [0.03, 0.97] | 0.03 | [0.086,0.278] + [0.722,0.914] | 0.556 (of 0.94, ~59%) |
| Building, mid width (0.08) | [0.04, 0.96] | 0.04 | [0.076,0.288] + [0.712,0.924] | 0.496 (of 0.92, ~54%) |
| Building, max width (0.11) | [0.055, 0.945] | 0.055 | [0.061,0.303] + [0.697,0.939] | 0.406 (of 0.89, ~46%) |

In every real case the allowed region is 46-59% of the range - nowhere near
empty. The defensive `(rangeMin + rangeMax) / 2` fallback is unreachable
given the project's current constants; it exists purely so a future constant
change (e.g. a much wider building, or a much narrower cliff range) fails
safe (a well-defined midpoint) instead of throwing or looping forever.

No case was found where the allowed region is empty or dangerously small
with current constants - no range needed widening.

## Flakiness test: 120 runs

Ran `npx vitest run tests/terrain.test.ts -t spawn` **120 times** in a bash
loop after the fix (exceeds the requested 100+):

```
PASS=120 FAIL=0
```

Zero failures out of 120 runs (each run exercises the spawn-columns test's
internal 40 iterations, so this covers 4,800 independent terrain
generations).

## Full suite / typecheck / build

```
npm test          -> 12 test files, 86 tests, all passed
npm run typecheck -> tsc --noEmit, no errors
npm run build     -> tsc --noEmit && vite build, succeeded (only a pre-existing
                      chunk-size warning, unrelated to this change)
```

The cliff-invariant test (`generateSilhouetteMask cliffs`, checks the rise
clamp never eats the whole cliff jump) and the height-budget test
(`generateSilhouetteMask height budget`) both still pass unmodified, since
`applyCliff`'s rise math and the height-budget constants were not touched.

## Files changed

- `src/terrain.ts`: replaced the random-reroll spawn-exclusion mechanism with
  deterministic interval-sampling (`sampleExcludingSpawnColumns`), rewired
  `pickCliffCenterFraction` and `pickBuildingStartX` to use it, removed the
  now-dead `SPAWN_EXCLUSION_MAX_ATTEMPTS`, `spanNearSpawnColumn`, and
  `isNearSpawnColumn`.
