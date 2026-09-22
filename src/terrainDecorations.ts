import { computeAllowedIntervals, sampleFromIntervals, TOP_CLEARANCE_FRACTION } from './intervalSampling.js';
import type { TerrainDecoration } from './types.js';

// Native pixel size of each cropped prop sprite (see public/assets/terrain/props
// and assetManifest.ts) - needed to compute a per-instance display scale from
// a target world-space height, since the source icons come in wildly
// different native sizes (a big rock pile vs. a single pebble).
interface PropSize {
  key: string;
  width: number;
  height: number;
}

const ROCK_PROPS: PropSize[] = [
  { key: 'terrain_rock_0', width: 473, height: 407 },
  { key: 'terrain_rock_1', width: 369, height: 461 },
  { key: 'terrain_rock_2', width: 470, height: 342 },
  { key: 'terrain_rock_3', width: 312, height: 226 },
  { key: 'terrain_rock_4', width: 278, height: 204 },
  { key: 'terrain_rock_5', width: 321, height: 234 },
  { key: 'terrain_rock_6', width: 328, height: 160 },
  { key: 'terrain_rock_7', width: 260, height: 141 },
  { key: 'terrain_rock_8', width: 215, height: 104 },
  { key: 'terrain_rock_9', width: 187, height: 107 },
  { key: 'terrain_rock_10', width: 204, height: 109 },
  { key: 'terrain_rock_11', width: 149, height: 94 },
  { key: 'terrain_rock_12', width: 117, height: 61 },
  { key: 'terrain_rock_13', width: 59, height: 42 },
];

const TREE_PROPS: PropSize[] = [
  { key: 'terrain_tree_0', width: 532, height: 614 },
  { key: 'terrain_tree_1', width: 260, height: 604 },
  { key: 'terrain_tree_2', width: 486, height: 560 },
  { key: 'terrain_tree_3', width: 233, height: 337 },
  { key: 'terrain_tree_4', width: 301, height: 353 },
  { key: 'terrain_tree_5', width: 278, height: 266 },
];

const BUSH_PROPS: PropSize[] = [
  { key: 'terrain_bush_0', width: 273, height: 229 },
  { key: 'terrain_bush_1', width: 283, height: 172 },
  { key: 'terrain_bush_2', width: 271, height: 216 },
  { key: 'terrain_bush_3', width: 282, height: 253 },
  { key: 'terrain_bush_4', width: 222, height: 188 },
  { key: 'terrain_bush_5', width: 272, height: 221 },
  { key: 'terrain_bush_6', width: 230, height: 251 },
  { key: 'terrain_bush_7', width: 213, height: 263 },
  { key: 'terrain_bush_8', width: 272, height: 182 },
  { key: 'terrain_bush_9', width: 269, height: 186 },
  { key: 'terrain_bush_10', width: 280, height: 247 },
  { key: 'terrain_bush_11', width: 262, height: 197 },
  { key: 'terrain_bush_12', width: 290, height: 179 },
  { key: 'terrain_bush_13', width: 258, height: 177 },
  { key: 'terrain_bush_14', width: 259, height: 211 },
  { key: 'terrain_bush_15', width: 279, height: 228 },
  { key: 'terrain_bush_16', width: 294, height: 199 },
  { key: 'terrain_bush_17', width: 232, height: 200 },
  { key: 'terrain_bush_18', width: 238, height: 153 },
  { key: 'terrain_bush_19', width: 259, height: 194 },
];

const FLOWER_PROPS: PropSize[] = [
  { key: 'terrain_flower_0', width: 181, height: 234 },
  { key: 'terrain_flower_1', width: 181, height: 228 },
  { key: 'terrain_flower_2', width: 237, height: 198 },
  { key: 'terrain_flower_3', width: 248, height: 263 },
  { key: 'terrain_flower_4', width: 181, height: 204 },
  { key: 'terrain_flower_5', width: 228, height: 214 },
  { key: 'terrain_flower_6', width: 217, height: 272 },
  { key: 'terrain_flower_7', width: 215, height: 187 },
  { key: 'terrain_flower_8', width: 181, height: 187 },
  { key: 'terrain_flower_9', width: 223, height: 184 },
  { key: 'terrain_flower_10', width: 219, height: 233 },
  { key: 'terrain_flower_11', width: 149, height: 236 },
  { key: 'terrain_flower_12', width: 210, height: 167 },
  { key: 'terrain_flower_13', width: 186, height: 195 },
  { key: 'terrain_flower_14', width: 168, height: 186 },
  { key: 'terrain_flower_15', width: 234, height: 166 },
  { key: 'terrain_flower_16', width: 212, height: 181 },
  { key: 'terrain_flower_17', width: 163, height: 196 },
  { key: 'terrain_flower_18', width: 222, height: 179 },
  { key: 'terrain_flower_19', width: 200, height: 170 },
  { key: 'terrain_flower_20', width: 174, height: 196 },
  { key: 'terrain_flower_21', width: 214, height: 194 },
  { key: 'terrain_flower_22', width: 164, height: 187 },
  { key: 'terrain_flower_23', width: 193, height: 193 },
];

// A downsampled (24-sample) alpha-silhouette profile per prop sprite: for N
// evenly spaced x positions across the sprite's own width, the fraction of
// its own height that's opaque there (0 = fully transparent gap, e.g.
// between two rock lobes; ~1 = solid all the way to the top there, e.g. the
// widest point of a rock pile or tree canopy). Computed once offline from
// the actual cropped PNGs in public/assets/terrain/props (topmost opaque
// pixel per sampled column, alpha > 40) - see stampFootprint, which uses
// this instead of a generic dome so the collision it adds is hidden almost
// entirely underneath the sprite's own art instead of bulging out past it
// as a separate, differently-shaped mound of plain dirt.
const HEIGHT_PROFILES: Record<string, number[]> = {
  terrain_bush_0: [
    0.45, 0.555, 0.603, 0.633, 0.659, 0.843, 0.908, 0.948, 0.969, 0.983, 0.983, 0.974, 0.948, 0.904, 0.834, 0.834,
    0.821, 0.79, 0.721, 0.624, 0.581, 0.515, 0.48, 0.397,
  ],
  terrain_bush_1: [
    0.308, 0.407, 0.453, 0.581, 0.663, 0.692, 0.709, 0.837, 0.907, 0.948, 0.971, 0.983, 0.977, 0.959, 0.924, 0.86,
    0.762, 0.762, 0.738, 0.68, 0.57, 0.547, 0.494, 0.39,
  ],
  terrain_bush_10: [
    0.636, 0.66, 0.676, 0.68, 0.68, 0.68, 0.68, 0.68, 0.68, 0.68, 0.753, 0.826, 0.879, 0.923, 0.955, 0.976, 0.988,
    0.943, 0.599, 0.599, 0.599, 0.599, 0.599, 0.591,
  ],
  terrain_bush_11: [
    0.609, 0.68, 0.716, 0.741, 0.756, 0.756, 0.756, 0.756, 0.756, 0.756, 0.827, 0.893, 0.944, 0.97, 0.98, 0.975, 0.888,
    0.645, 0.645, 0.645, 0.635, 0.614, 0.574, 0.503,
  ],
  terrain_bush_12: [
    0.291, 0.38, 0.419, 0.587, 0.642, 0.665, 0.67, 0.771, 0.86, 0.916, 0.95, 0.972, 0.978, 0.972, 0.944, 0.883, 0.749,
    0.749, 0.737, 0.704, 0.603, 0.514, 0.464, 0.369,
  ],
  terrain_bush_13: [
    0.294, 0.588, 0.65, 0.684, 0.701, 0.859, 0.927, 0.927, 0.927, 0.927, 0.927, 0.927, 0.927, 0.955, 0.977, 0.977,
    0.893, 0.774, 0.621, 0.616, 0.588, 0.435, 0.395, 0.311,
  ],
  terrain_bush_14: [
    0.379, 0.412, 0.427, 0.673, 0.673, 0.673, 0.673, 0.725, 0.725, 0.962, 0.976, 0.924, 0.858, 0.858, 0.858, 0.858,
    0.754, 0.754, 0.754, 0.754, 0.616, 0.45, 0.45, 0.45,
  ],
  terrain_bush_15: [
    0.268, 0.417, 0.693, 0.838, 0.886, 0.899, 0.93, 0.969, 0.982, 0.978, 0.952, 0.899, 0.89, 0.864, 0.864, 0.851, 0.785,
    0.75, 0.614, 0.614, 0.614, 0.605, 0.561, 0.395,
  ],
  terrain_bush_16: [
    0.508, 0.533, 0.794, 0.794, 0.794, 0.794, 0.794, 0.794, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.965, 0.809,
    0.809, 0.809, 0.809, 0.809, 0.538, 0.528, 0.508,
  ],
  terrain_bush_17: [
    0.63, 0.7, 0.735, 0.76, 0.78, 0.785, 0.785, 0.785, 0.785, 0.785, 0.785, 0.785, 0.92, 0.97, 0.985, 0.985, 0.965,
    0.93, 0.93, 0.92, 0.885, 0.58, 0.52, 0.0,
  ],
  terrain_bush_18: [
    0.386, 0.471, 0.51, 0.536, 0.81, 0.81, 0.81, 0.81, 0.915, 0.98, 0.961, 0.902, 0.882, 0.882, 0.882, 0.882, 0.882,
    0.699, 0.699, 0.699, 0.686, 0.471, 0.438, 0.359,
  ],
  terrain_bush_19: [
    0.521, 0.619, 0.66, 0.758, 0.814, 0.856, 0.943, 0.969, 0.979, 0.979, 0.959, 0.923, 0.861, 0.763, 0.763, 0.763,
    0.737, 0.696, 0.593, 0.51, 0.505, 0.485, 0.454, 0.376,
  ],
  terrain_bush_2: [
    0.523, 0.523, 0.523, 0.866, 0.866, 0.866, 0.866, 0.866, 0.866, 0.866, 0.866, 0.866, 0.866, 0.866, 0.884, 0.977,
    0.741, 0.741, 0.741, 0.741, 0.741, 0.449, 0.449, 0.449,
  ],
  terrain_bush_3: [
    0.261, 0.34, 0.375, 0.692, 0.763, 0.794, 0.798, 0.798, 0.798, 0.798, 0.838, 0.913, 0.957, 0.976, 0.984, 0.98, 0.968,
    0.941, 0.881, 0.688, 0.68, 0.664, 0.632, 0.549,
  ],
  terrain_bush_4: [
    0.245, 0.303, 0.324, 0.617, 0.649, 0.654, 0.654, 0.92, 0.973, 0.984, 0.973, 0.947, 0.899, 0.824, 0.761, 0.761,
    0.755, 0.713, 0.559, 0.559, 0.559, 0.532, 0.303, 0.261,
  ],
  terrain_bush_5: [
    0.258, 0.471, 0.484, 0.62, 0.633, 0.769, 0.769, 0.851, 0.887, 0.887, 0.919, 0.973, 0.986, 0.959, 0.887, 0.878, 0.76,
    0.738, 0.738, 0.683, 0.566, 0.552, 0.425, 0.38,
  ],
  terrain_bush_6: [
    0.602, 0.665, 0.689, 0.709, 0.713, 0.713, 0.713, 0.713, 0.956, 0.98, 0.988, 0.984, 0.98, 0.98, 0.952, 0.9, 0.797,
    0.797, 0.757, 0.757, 0.757, 0.757, 0.749, 0.558,
  ],
  terrain_bush_7: [
    0.141, 0.175, 0.437, 0.468, 0.665, 0.76, 0.779, 0.779, 0.844, 0.924, 0.962, 0.985, 0.989, 0.981, 0.962, 0.928,
    0.871, 0.776, 0.741, 0.741, 0.726, 0.677, 0.365, 0.335,
  ],
  terrain_bush_8: [
    0.396, 0.418, 0.626, 0.626, 0.626, 0.753, 0.753, 0.967, 0.934, 0.874, 0.868, 0.868, 0.868, 0.846, 0.819, 0.819,
    0.819, 0.725, 0.725, 0.725, 0.725, 0.555, 0.555, 0.319,
  ],
  terrain_bush_9: [
    0.253, 0.5, 0.597, 0.634, 0.651, 0.758, 0.801, 0.806, 0.806, 0.935, 0.973, 0.984, 0.973, 0.941, 0.866, 0.839, 0.839,
    0.801, 0.683, 0.629, 0.538, 0.522, 0.473, 0.226,
  ],
  terrain_flower_0: [
    0.0, 0.641, 0.679, 0.705, 0.718, 0.872, 0.936, 0.966, 0.983, 0.983, 0.979, 0.962, 0.936, 0.936, 0.936, 0.936, 0.936,
    0.936, 0.932, 0.919, 0.893, 0.701, 0.679, 0.0,
  ],
  terrain_flower_1: [
    0.618, 0.68, 0.702, 0.873, 0.917, 0.939, 0.947, 0.947, 0.947, 0.947, 0.947, 0.947, 0.952, 0.974, 0.982, 0.982,
    0.965, 0.934, 0.829, 0.825, 0.811, 0.75, 0.417, 0.338,
  ],
  terrain_flower_10: [
    0.515, 0.588, 0.622, 0.639, 0.648, 0.648, 0.648, 0.648, 0.82, 0.906, 0.948, 0.97, 0.983, 0.987, 0.983, 0.97, 0.948,
    0.901, 0.554, 0.554, 0.549, 0.536, 0.506, 0.438,
  ],
  terrain_flower_11: [
    0.165, 0.898, 0.911, 0.97, 0.983, 0.983, 0.979, 0.979, 0.979, 0.975, 0.924, 0.919, 0.89, 0.691, 0.691, 0.691, 0.691,
    0.691, 0.691, 0.691, 0.682, 0.64, 0.631, 0.174,
  ],
  terrain_flower_12: [
    0.335, 0.401, 0.725, 0.76, 0.772, 0.772, 0.772, 0.772, 0.79, 0.868, 0.916, 0.952, 0.97, 0.982, 0.97, 0.922, 0.647,
    0.647, 0.635, 0.611, 0.539, 0.527, 0.503, 0.18,
  ],
  terrain_flower_13: [
    0.523, 0.554, 0.554, 0.8, 0.851, 0.867, 0.928, 0.938, 0.944, 0.974, 0.974, 0.974, 0.979, 0.969, 0.969, 0.964, 0.918,
    0.913, 0.872, 0.682, 0.682, 0.682, 0.682, 0.569,
  ],
  terrain_flower_14: [
    0.484, 0.57, 0.591, 0.597, 0.597, 0.597, 0.844, 0.898, 0.941, 0.968, 0.978, 0.984, 0.978, 0.957, 0.871, 0.731,
    0.731, 0.731, 0.731, 0.731, 0.72, 0.699, 0.651, 0.0,
  ],
  terrain_flower_15: [
    0.548, 0.572, 0.578, 0.578, 0.578, 0.675, 0.675, 0.675, 0.675, 0.807, 0.91, 0.97, 0.976, 0.861, 0.801, 0.801, 0.801,
    0.801, 0.801, 0.801, 0.783, 0.512, 0.512, 0.488,
  ],
  terrain_flower_16: [
    0.729, 0.801, 0.845, 0.901, 0.917, 0.95, 0.972, 0.972, 0.972, 0.972, 0.978, 0.972, 0.961, 0.934, 0.873, 0.873,
    0.873, 0.862, 0.834, 0.773, 0.702, 0.685, 0.635, 0.569,
  ],
  terrain_flower_17: [
    0.321, 0.439, 0.48, 0.505, 0.883, 0.923, 0.949, 0.964, 0.974, 0.98, 0.98, 0.974, 0.964, 0.944, 0.913, 0.857, 0.75,
    0.75, 0.75, 0.75, 0.745, 0.735, 0.719, 0.668,
  ],
  terrain_flower_18: [
    0.318, 0.693, 0.709, 0.709, 0.777, 0.777, 0.777, 0.916, 0.961, 0.961, 0.961, 0.961, 0.961, 0.978, 0.961, 0.844,
    0.844, 0.844, 0.743, 0.737, 0.547, 0.547, 0.536, 0.503,
  ],
  terrain_flower_19: [
    0.359, 0.459, 0.518, 0.565, 0.6, 0.618, 0.688, 0.759, 0.812, 0.859, 0.894, 0.929, 0.953, 0.971, 0.982, 0.982, 0.971,
    0.959, 0.929, 0.888, 0.835, 0.759, 0.682, 0.559,
  ],
  terrain_flower_2: [
    0.49, 0.626, 0.702, 0.773, 0.828, 0.879, 0.919, 0.949, 0.97, 0.98, 0.985, 0.97, 0.939, 0.879, 0.808, 0.758, 0.722,
    0.687, 0.626, 0.47, 0.47, 0.424, 0.333, 0.258,
  ],
  terrain_flower_20: [
    0.658, 0.719, 0.745, 0.755, 0.755, 0.755, 0.755, 0.755, 0.755, 0.893, 0.959, 0.98, 0.985, 0.98, 0.959, 0.898, 0.781,
    0.781, 0.781, 0.781, 0.77, 0.75, 0.505, 0.184,
  ],
  terrain_flower_21: [
    0.598, 0.598, 0.598, 0.598, 0.598, 0.598, 0.845, 0.948, 0.948, 0.948, 0.969, 0.969, 0.979, 0.923, 0.923, 0.923,
    0.758, 0.531, 0.531, 0.49, 0.49, 0.49, 0.49, 0.485,
  ],
  terrain_flower_22: [
    0.364, 0.385, 0.39, 0.711, 0.791, 0.802, 0.802, 0.802, 0.802, 0.802, 0.802, 0.85, 0.898, 0.93, 0.957, 0.979, 0.963,
    0.893, 0.647, 0.647, 0.647, 0.647, 0.647, 0.556,
  ],
  terrain_flower_23: [
    0.301, 0.368, 0.389, 0.399, 0.865, 0.886, 0.886, 0.886, 0.886, 0.886, 0.917, 0.974, 0.984, 0.969, 0.881, 0.881,
    0.881, 0.881, 0.86, 0.596, 0.456, 0.44, 0.409, 0.337,
  ],
  terrain_flower_3: [
    0.532, 0.548, 0.696, 0.749, 0.787, 0.859, 0.871, 0.886, 0.886, 0.886, 0.886, 0.939, 0.989, 0.947, 0.905, 0.703,
    0.703, 0.703, 0.681, 0.62, 0.544, 0.502, 0.323, 0.304,
  ],
  terrain_flower_4: [
    0.672, 0.74, 0.76, 0.775, 0.775, 0.873, 0.941, 0.971, 0.985, 0.985, 0.971, 0.951, 0.907, 0.858, 0.858, 0.858, 0.858,
    0.858, 0.848, 0.828, 0.779, 0.49, 0.49, 0.0,
  ],
  terrain_flower_5: [
    0.388, 0.626, 0.64, 0.64, 0.771, 0.78, 0.78, 0.935, 0.967, 0.967, 0.967, 0.967, 0.967, 0.986, 0.939, 0.808, 0.808,
    0.808, 0.78, 0.678, 0.678, 0.659, 0.491, 0.453,
  ],
  terrain_flower_6: [
    0.445, 0.658, 0.662, 0.662, 0.662, 0.662, 0.923, 0.978, 0.941, 0.923, 0.919, 0.919, 0.919, 0.919, 0.919, 0.919,
    0.919, 0.919, 0.919, 0.614, 0.614, 0.614, 0.61, 0.5,
  ],
  terrain_flower_7: [
    0.203, 0.561, 0.572, 0.572, 0.572, 0.759, 0.759, 0.759, 0.759, 0.979, 0.957, 0.92, 0.904, 0.904, 0.904, 0.904,
    0.904, 0.904, 0.904, 0.904, 0.717, 0.717, 0.369, 0.353,
  ],
  terrain_flower_8: [
    0.487, 0.604, 0.663, 0.722, 0.77, 0.813, 0.861, 0.893, 0.925, 0.947, 0.968, 0.979, 0.984, 0.979, 0.968, 0.952,
    0.914, 0.872, 0.829, 0.775, 0.738, 0.69, 0.647, 0.54,
  ],
  terrain_flower_9: [
    0.565, 0.652, 0.707, 0.75, 0.793, 0.842, 0.88, 0.913, 0.94, 0.962, 0.973, 0.984, 0.984, 0.973, 0.951, 0.908, 0.848,
    0.788, 0.734, 0.674, 0.5, 0.478, 0.435, 0.342,
  ],
  terrain_rock_0: [
    0.219, 0.295, 0.577, 0.69, 0.813, 0.865, 0.887, 0.926, 0.948, 0.958, 0.971, 0.983, 0.99, 0.99, 0.971, 0.941, 0.912,
    0.875, 0.786, 0.71, 0.671, 0.558, 0.479, 0.174,
  ],
  terrain_rock_1: [
    0.124, 0.223, 0.262, 0.427, 0.618, 0.659, 0.746, 0.868, 0.902, 0.952, 0.987, 0.987, 0.961, 0.837, 0.822, 0.783,
    0.599, 0.551, 0.458, 0.347, 0.302, 0.234, 0.176, 0.126,
  ],
  terrain_rock_10: [
    0.495, 0.587, 0.642, 0.651, 0.706, 0.789, 0.844, 0.881, 0.927, 0.945, 0.963, 0.963, 0.936, 0.89, 0.826, 0.761,
    0.679, 0.578, 0.578, 0.578, 0.578, 0.532, 0.468, 0.376,
  ],
  terrain_rock_11: [
    0.362, 0.553, 0.649, 0.713, 0.766, 0.819, 0.862, 0.894, 0.926, 0.947, 0.968, 0.968, 0.947, 0.926, 0.883, 0.83,
    0.777, 0.691, 0.574, 0.436, 0.404, 0.372, 0.309, 0.0,
  ],
  terrain_rock_12: [
    0.0, 0.377, 0.443, 0.492, 0.508, 0.525, 0.525, 0.525, 0.525, 0.541, 0.672, 0.754, 0.803, 0.852, 0.902, 0.918, 0.934,
    0.934, 0.918, 0.902, 0.852, 0.803, 0.721, 0.295,
  ],
  terrain_rock_13: [
    1.0, 1.0, 1.0, 1.0, 0.929, 0.929, 0.929, 0.929, 0.929, 0.929, 0.929, 0.929, 0.905, 0.905, 0.881, 0.857, 0.833,
    0.786, 0.738, 0.714, 0.643, 0.595, 0.476, 0.0,
  ],
  terrain_rock_2: [
    0.319, 0.48, 0.573, 0.769, 0.825, 0.863, 0.901, 0.936, 0.965, 0.988, 0.991, 0.968, 0.93, 0.924, 0.924, 0.904, 0.857,
    0.798, 0.74, 0.623, 0.594, 0.497, 0.442, 0.158,
  ],
  terrain_rock_3: [
    0.204, 0.288, 0.336, 0.695, 0.832, 0.96, 0.987, 0.978, 0.951, 0.925, 0.898, 0.872, 0.845, 0.814, 0.765, 0.704,
    0.633, 0.562, 0.491, 0.434, 0.372, 0.292, 0.212, 0.142,
  ],
  terrain_rock_4: [
    0.216, 0.324, 0.387, 0.775, 0.873, 0.917, 0.946, 0.966, 0.98, 0.98, 0.975, 0.966, 0.951, 0.931, 0.912, 0.882, 0.848,
    0.809, 0.75, 0.686, 0.613, 0.549, 0.48, 0.181,
  ],
  terrain_rock_5: [
    0.256, 0.325, 0.338, 0.402, 0.551, 0.59, 0.658, 0.791, 0.829, 0.863, 0.893, 0.923, 0.949, 0.97, 0.983, 0.983, 0.966,
    0.923, 0.662, 0.62, 0.385, 0.385, 0.325, 0.261,
  ],
  terrain_rock_6: [
    0.194, 0.331, 0.569, 0.631, 0.688, 0.75, 0.806, 0.863, 0.925, 0.963, 0.975, 0.981, 0.975, 0.956, 0.938, 0.906,
    0.875, 0.838, 0.8, 0.762, 0.725, 0.65, 0.444, 0.331,
  ],
  terrain_rock_7: [
    0.376, 0.468, 0.518, 0.553, 0.603, 0.738, 0.844, 0.922, 0.972, 0.979, 0.965, 0.936, 0.908, 0.865, 0.759, 0.681,
    0.681, 0.674, 0.638, 0.553, 0.433, 0.369, 0.34, 0.277,
  ],
  terrain_rock_8: [
    0.308, 0.452, 0.577, 0.663, 0.75, 0.808, 0.846, 0.865, 0.894, 0.923, 0.942, 0.962, 0.971, 0.962, 0.952, 0.942,
    0.923, 0.904, 0.846, 0.635, 0.519, 0.519, 0.481, 0.394,
  ],
  terrain_rock_9: [
    0.393, 0.673, 0.757, 0.804, 0.85, 0.888, 0.925, 0.963, 0.972, 0.944, 0.916, 0.869, 0.832, 0.785, 0.72, 0.617, 0.607,
    0.607, 0.607, 0.589, 0.551, 0.505, 0.439, 0.299,
  ],
  terrain_tree_0: [
    0.694, 0.746, 0.774, 0.788, 0.819, 0.84, 0.888, 0.94, 0.969, 0.987, 0.995, 0.992, 0.982, 0.959, 0.919, 0.902, 0.902,
    0.881, 0.803, 0.787, 0.759, 0.717, 0.712, 0.686,
  ],
  terrain_tree_1: [
    0.452, 0.611, 0.636, 0.738, 0.806, 0.836, 0.848, 0.901, 0.945, 0.97, 0.988, 0.993, 0.985, 0.965, 0.934, 0.921,
    0.912, 0.892, 0.859, 0.795, 0.717, 0.712, 0.689, 0.399,
  ],
  terrain_tree_2: [
    0.641, 0.679, 0.693, 0.713, 0.739, 0.871, 0.921, 0.954, 0.975, 0.988, 0.993, 0.993, 0.984, 0.966, 0.939, 0.895,
    0.887, 0.884, 0.854, 0.811, 0.793, 0.757, 0.698, 0.675,
  ],
  terrain_tree_3: [
    0.739, 0.789, 0.813, 0.825, 0.875, 0.917, 0.941, 0.961, 0.976, 0.985, 0.988, 0.991, 0.988, 0.982, 0.973, 0.953,
    0.926, 0.881, 0.819, 0.801, 0.754, 0.599, 0.582, 0.528,
  ],
  terrain_tree_4: [
    0.83, 0.83, 0.83, 0.83, 0.83, 0.963, 0.989, 0.918, 0.918, 0.912, 0.912, 0.912, 0.912, 0.912, 0.873, 0.836, 0.836,
    0.836, 0.836, 0.836, 0.836, 0.836, 0.836, 0.836,
  ],
  terrain_tree_5: [
    0.699, 0.756, 0.782, 0.823, 0.887, 0.925, 0.955, 0.974, 0.985, 0.989, 0.985, 0.974, 0.955, 0.917, 0.857, 0.778,
    0.726, 0.59, 0.59, 0.579, 0.541, 0.538, 0.523, 0.466,
  ],
};

// Baseline counts/sizes tuned for a 1600px-wide world (the size this project
// shipped with before the terrain was made bigger - see WORLD_WIDTH in
// constants.ts). generateDecorations scales the counts by the actual map
// width so a bigger map gets proportionally more scenery instead of the same
// fixed handful spread thinner.
interface DecorationCategory {
  props: PropSize[];
  countRange: [number, number];
  heightRange: [number, number]; // world px, at any map size
  flippable: boolean;
}

const CATEGORIES: DecorationCategory[] = [
  { props: ROCK_PROPS, countRange: [9, 15], heightRange: [32, 95], flippable: true },
  { props: TREE_PROPS, countRange: [6, 10], heightRange: [85, 165], flippable: true },
  { props: BUSH_PROPS, countRange: [10, 18], heightRange: [26, 52], flippable: true },
  { props: FLOWER_PROPS, countRange: [14, 22], heightRange: [16, 30], flippable: false },
];

// The 16:9 map size these counts/sizes were tuned at. Prop *size* follows
// the map's height and prop *count* follows its width, so a map that's only
// wider (not taller) gets more scenery at the same scale - on a 16:9 map
// the two ratios are equal, as before.
const BASELINE_WORLD_WIDTH = 2240;
const BASELINE_WORLD_HEIGHT = 1260;
// Extra breathing room added on top of the widest possible stamped
// footprint (see spawnClearancePxFor) so a worm's spawn point isn't right up
// against the edge of an obstacle either.
const SPAWN_CLEARANCE_MARGIN_PX = 24;
// Ground below this fraction of the world's height reads as a lake basin
// (see terrain.ts's LAKE_TARGET_HEIGHT_FRACTION) - decorations skip it so
// nothing appears to be growing out of a pond.
const LOW_GROUND_FRACTION = 0.85;
// Minimum gap kept between any two decorations' anchor columns (regardless
// of category). Individual footprints are usually far wider than this (a
// tree/rock can be 100+ px across) so neighbors already overlap well past
// this gap - it just stops two anchors from landing on literally the same
// spot. Lowered from 20: with a limited amount of legal ground once
// buildings/lakes/spawn columns are excluded (see allowedX below), a wider
// gap meant the map's ground filled up (every remaining spot within
// MIN_GAP_PX of something already placed) well before the requested
// rock/tree/bush/flower counts were reached, silently capping density
// regardless of how those counts were tuned or how many placement attempts
// were allowed.
const MIN_GAP_PX = 12;
// Sampling x straight from the spawn-excluded intervals (see allowedX below)
// means every attempt at least starts clear of the one biggest rejection
// reason; what's left to retry against - another decoration's MIN_GAP_PX,
// a building/branch/lake edge crossing the footprint (see
// footprintSpanIsUniformGround) - rejects more often for later categories,
// once earlier ones have filled up more of the map. Raised well past the
// old value of 24 so those later categories (bushes, flowers) don't run out
// of tries and quietly end up sparser than they were asked to be.
const MAX_PLACEMENT_ATTEMPTS = 60;
// TOP_CLEARANCE_FRACTION (imported above) is the same top-clearance budget
// every other terrain feature respects, so a tall tree landing on top of an
// already-maxed-out branch can't poke into the HUD's reserved space.
// A cropped sprite's own bounding-box edge is, by definition, wherever its
// outermost opaque pixel is - not necessarily anywhere near 0 fraction (see
// HEIGHT_PROFILES: rock/tree/bush edges often sit well above half height).
// Stamped as-is, that would let a decoration's collision meet whatever's
// next to it - open ground, or another decoration - with a hard step right
// at its own bounding box edge instead of tapering down to it. This widens
// the *stamped* footprint by this fraction on each side beyond the sprite's
// own rendered width, purely as a zero-height ramp (see profileHeightAt),
// so the collision always reaches 0 a little past the visible art rather
// than stopping abruptly at its last opaque pixel.
const FOOTPRINT_EDGE_PADDING_FRACTION = 0.04;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

// Topmost solid row in column x, and its mask value (1 = ground, 2 =
// building) - mirrors terrain.ts's findSurfaceY, but works directly off a
// freshly generated mask rather than a full Terrain object, since decoration
// placement runs as part of building that very Terrain.
function surfaceAt(mask: Uint8Array, width: number, height: number, x: number): { y: number; value: number } {
  for (let y = 0; y < height; y++) {
    const value = mask[y * width + x];
    if (value !== 0) return { y, value };
  }
  return { y: height, value: 0 };
}

// A jump between adjacent columns' surface heights this large can only be a
// branch wall or a building's edge (both guaranteed to jump by far more than
// this - see terrain.ts's BRANCH_HEIGHT_MIN/MAX_FRACTION and
// BUILDING_RISE_MIN/MAX_FRACTION fractions and the "natural slope" comment
// in terrain.test.ts), never the mountain's own smooth sine-wave silhouette,
// which shifts by at most a couple of px between neighbors no matter how
// steep it looks zoomed out.
const MAX_NATURAL_ADJACENT_SLOPE_FRACTION = 0.05;

// Runs of columns that can never host a decoration's *anchor* - a building
// roof, open sky, or a lake basin (see isFreeColumn's per-column checks,
// which this mirrors) - collapsed into [startX, endX) spans. Buildings alone
// can cover a large chunk of a map's width (up to 4 of them, each up to 11%
// - see terrain.ts's BUILDING_COUNT/WIDTH constants), so folding this into
// the same allowed-interval sampling used for spawn columns (see allowedX
// below) means most attempts land on genuinely plantable ground from the
// start, instead of spending the retry budget on columns that were always
// going to fail the anchor check.
function computeBadGroundIntervals(
  mask: Uint8Array,
  width: number,
  height: number,
  lowGroundY: number,
): Array<[number, number]> {
  const bad: Array<[number, number]> = [];
  let runStart: number | null = null;
  for (let x = 0; x <= width; x++) {
    const isBad = x < width && (() => {
      const { y, value } = surfaceAt(mask, width, height, x);
      return value !== 1 || y >= lowGroundY;
    })();
    if (isBad && runStart === null) {
      runStart = x;
    } else if (!isBad && runStart !== null) {
      bad.push([runStart, x]);
      runStart = null;
    }
  }
  return bad;
}

// Even where no single adjacent-column step is a "jump" (see
// MAX_NATURAL_ADJACENT_SLOPE_FRACTION above), a long enough run of gentle
// steps in the same direction - a real slope, not a discontinuity - still
// adds up to more total rise/fall across a footprint than the art can
// follow. The art is one flat bitmap drawn once at the anchor's own y (see
// the TerrainRenderer constructor); the collision correctly hugs each
// column's own local ground (see stampFootprint). On steep-but-continuous
// ground those two drift apart the further a column sits from the anchor,
// so a decoration stood on a real slope has its canopy silently masked out
// wherever the local ground has moved too far from the anchor's own height -
// visually identical to the straddling-a-branch-or-building-edge clip this
// same function already rejects, just from smooth terrain instead of a
// sharp edge.
// Expressed as a fraction of the decoration's own rendered height (not a
// flat pixel budget) so a tall tree and a short flower get proportionally
// the same tolerance for how far the ground can drift under them.
const MAX_SURFACE_RANGE_FRACTION_OF_HEIGHT = 0.15;

// True only if every column across [minX, maxX] is plain ground (mask value
// 1, not a building roof or open sky), stays above the lake-basin line,
// never jumps to a neighboring column by more than a natural slope can, and
// never drifts in total by more than a small fraction of the decoration's
// own height - see stampFootprint, which stamps a decoration's collision by
// combining a single anchor-relative height profile with each column's
// *own* surface Y. That combination silently assumes the whole footprint
// sits on one contiguous, close-to-flat patch of ground: previously only
// the anchor column itself was checked, so a decoration whose footprint
// happened to straddle a building edge, a branch wall, a lake basin, or just
// a steep natural slope got its collision (and therefore its visible,
// mask-clipped art) stamped against each column's true - very different -
// local surface, cutting most of the sprite away and leaving only a sliver
// visible.
function footprintSpanIsUniformGround(
  mask: Uint8Array,
  width: number,
  height: number,
  minX: number,
  maxX: number,
  lowGroundY: number,
  footprintHeight: number,
): boolean {
  const maxAdjacentJump = height * MAX_NATURAL_ADJACENT_SLOPE_FRACTION;
  const maxSurfaceRange = footprintHeight * MAX_SURFACE_RANGE_FRACTION_OF_HEIGHT;
  let prevY: number | null = null;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let x = minX; x <= maxX; x++) {
    const { y, value } = surfaceAt(mask, width, height, x);
    if (value !== 1) return false;
    if (y >= lowGroundY) return false;
    if (prevY !== null && Math.abs(y - prevY) > maxAdjacentJump) return false;
    prevY = y;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxY - minY <= maxSurfaceRange;
}

// Reads a height-fraction profile at an arbitrary fractional position across
// the *padded* footprint (0 = left edge of the padding, 1 = right edge -
// see FOOTPRINT_EDGE_PADDING_FRACTION and stampFootprint, which widens the
// stamped bounds so this padding has somewhere to live). The middle
// (1 - 2*padding) fraction maps onto the profile's 24 samples, linearly
// interpolating between the two nearest ones rather than rounding to the
// nearest one - a worm has to be able to walk up the slope this produces,
// and nearest-sample lookup would turn every gap between samples into a
// small vertical step (up to a whole sample's height delta packed into a
// single pixel) instead of a gradual rise spread across it. The outer
// padding on each side ramps linearly from the profile's own edge sample
// down to 0, so the footprint's true boundary - where it meets open ground
// or another decoration - is always a smooth taper, never a hard step at
// the sprite's own (typically non-zero) bounding-box edge. Flipped
// decorations (see TerrainDecoration.flipX) mirror the whole lookup to
// match the sprite's own horizontal flip.
function profileHeightAt(profile: number[], positionFraction: number, flipX: boolean): number {
  const p = Math.min(1, Math.max(0, flipX ? 1 - positionFraction : positionFraction));
  const pad = FOOTPRINT_EDGE_PADDING_FRACTION;
  if (p < pad) return profile[0] * (p / pad);
  if (p > 1 - pad) return profile[profile.length - 1] * ((1 - p) / pad);

  const inner = (p - pad) / (1 - 2 * pad);
  const scaled = inner * (profile.length - 1);
  const lowIndex = Math.floor(scaled);
  const highIndex = Math.min(profile.length - 1, lowIndex + 1);
  const t = scaled - lowIndex;
  return profile[lowIndex] * (1 - t) + profile[highIndex] * t;
}

// Stamps a decoration's own collision into `decorationMask` - a layer kept
// entirely separate from the natural ground's `mask` (see Terrain.
// decorationMask) - following its own alpha-silhouette profile (see
// HEIGHT_PROFILES) rather than a generic dome, so the collision it adds
// ends up (almost) exactly the shape of the sprite's own opaque pixels.
// Height is always measured from `mask`, the natural terrain, which this
// function never touches - so the ground's own silhouette is never
// reshaped to fit an object standing on it, and two overlapping decorations
// (their footprints are allowed to overlap - see MIN_GAP_PX) can never
// compound into a tower taller than either alone: both measure from the
// same fixed baseline, so overlapping columns simply end up as tall as
// whichever decoration wanted more there, not the sum of both.
function stampFootprint(
  mask: Uint8Array,
  decorationMask: Uint8Array,
  width: number,
  height: number,
  anchorX: number,
  footprintWidth: number,
  footprintHeight: number,
  profile: number[],
  flipX: boolean,
): void {
  // Widened so the sprite's own rendered width maps onto the middle
  // (1 - 2*padding) fraction of the stamped bounds, leaving room on each
  // side for profileHeightAt's zero-taper ramp - see
  // FOOTPRINT_EDGE_PADDING_FRACTION.
  const paddedHalfWidth = footprintWidth / 2 / (1 - 2 * FOOTPRINT_EDGE_PADDING_FRACTION);
  // The *true* (possibly off-map) span - positionFraction below is always
  // measured against this, not the clamped [minX, maxX] loop bounds. A
  // decoration anchored near x=0 or x=width has part of its padded span
  // fall off the map; clamping minX/maxX is only about which columns
  // physically exist to stamp into. Rescaling positionFraction to the
  // *clamped* span instead (as this used to) would stretch the profile to
  // fill just the on-map remainder, silently sampling the wrong part of it -
  // for a flipped sprite this could land exactly on the profile's zero-
  // height taper right at the visible edge, stamping no collision there at
  // all and leaving nothing but a sliver of art poking out of the ground.
  const trueMinX = anchorX - paddedHalfWidth;
  const trueMaxX = anchorX + paddedHalfWidth;
  const minX = Math.max(0, Math.floor(trueMinX));
  const maxX = Math.min(width - 1, Math.ceil(trueMaxX));
  const topClearanceRow = Math.ceil(height * TOP_CLEARANCE_FRACTION) + 1;

  for (let x = minX; x <= maxX; x++) {
    const positionFraction = (x - trueMinX) / Math.max(1, trueMaxX - trueMinX);
    const localHeight = footprintHeight * profileHeightAt(profile, positionFraction, flipX);
    if (localHeight <= 0) continue;
    const { y: surfaceY, value } = surfaceAt(mask, width, height, x);
    if (value !== 1) continue; // don't grow a decoration out of a building roof or open sky
    const topY = Math.max(topClearanceRow, Math.round(surfaceY - localHeight));
    for (let y = topY; y < surfaceY; y++) {
      decorationMask[y * width + x] = 1;
    }
  }
}

// The widest any stamped footprint can possibly get at this map's size,
// across every category/prop combination - some rocks are almost twice as
// wide as they are tall, so this can't just assume a category's nominal
// height range maps to a modest width. Used to derive how far a decoration's
// anchor must stay from a spawn column so its footprint - not just its
// anchor point - can never reach one.
function maxFootprintHalfWidth(sizeScale: number): number {
  let maxHalfWidth = 0;
  for (const category of CATEGORIES) {
    for (const prop of category.props) {
      const width = category.heightRange[1] * sizeScale * (prop.width / prop.height);
      // /(1 - 2*padding) to match stampFootprint's own widened stamp bounds
      // (see FOOTPRINT_EDGE_PADDING_FRACTION) - the padding is real stamped
      // collision (tapering to 0, but still occasionally nonzero), so the
      // true worst-case half-width includes it.
      const paddedWidth = width / (1 - 2 * FOOTPRINT_EDGE_PADDING_FRACTION);
      maxHalfWidth = Math.max(maxHalfWidth, paddedWidth / 2);
    }
  }
  return maxHalfWidth;
}

// Scatters a random number of rocks/trees/bushes/flowers across the given
// terrain mask's natural-ground surface. `mask` is read-only here - a
// decoration's collision is written into `decorationMask` instead (a
// separate, same-size layer, see Terrain.decorationMask), so the ground's
// own silhouette is never reshaped by anything standing on it. These are
// still physical obstacles a worm has to climb, jump over, walk around, or
// blow up, exactly like the rest of the destructible terrain - they just
// sit *on* the surface as their own layer rather than merging into it.
// Buildings, lake basins, and every spawn column (with a clearance margin)
// are left bare; everywhere else is fair game, so the result varies both in
// how much scenery there is and exactly where it lands.
export function generateDecorations(
  width: number,
  height: number,
  mask: Uint8Array,
  decorationMask: Uint8Array,
  spawnFractions: number[],
): TerrainDecoration[] {
  const lowGroundY = height * LOW_GROUND_FRACTION;
  const sizeScale = height / BASELINE_WORLD_HEIGHT;
  const countScale = width / BASELINE_WORLD_WIDTH;
  const spawnClearancePx = maxFootprintHalfWidth(sizeScale) + SPAWN_CLEARANCE_MARGIN_PX * sizeScale;
  // Precomputed once: every x this map's spawn columns rule out, at the
  // widest possible footprint half-width any category could need. Sampling
  // straight from this (rather than picking a uniformly random x across the
  // *whole* width and rejecting the ones that land too close to a spawn
  // column - as this used to) matters here specifically because the
  // excluded zones are wide relative to the map: with 4 spawn columns each
  // carving out a wide margin, a uniform draw could spend most of
  // MAX_PLACEMENT_ATTEMPTS retries on x's that were always going to fail
  // this one check, starving later categories (whose occupiedX gap check
  // has more to compete with) of the attempts they need.
  const spawnForbidden: Array<[number, number]> = spawnFractions.map((f) => {
    const spawnX = f * width;
    return [spawnX - spawnClearancePx, spawnX + spawnClearancePx];
  });
  // Folds in every building/lake/sky column too (see
  // computeBadGroundIntervals) - between this and spawnForbidden, a sampled
  // x's *anchor* is already guaranteed plantable ground; only the gap check
  // (against other decorations) and the footprint-span check (against a
  // building/branch/lake edge just outside the anchor) can still reject it.
  const badGround = computeBadGroundIntervals(mask, width, height, lowGroundY);
  const allowedX = computeAllowedIntervals(0, width, [...spawnForbidden, ...badGround]);
  const occupiedX: number[] = [];

  const isFreeColumn = (x: number): { y: number } | null => {
    for (const placedX of occupiedX) {
      if (Math.abs(x - placedX) < MIN_GAP_PX) return null;
    }
    const xi = Math.max(0, Math.min(width - 1, Math.round(x)));
    return { y: surfaceAt(mask, width, height, xi).y };
  };

  const decorations: TerrainDecoration[] = [];
  for (const category of CATEGORIES) {
    const count = Math.round(randomInt(...category.countRange) * countScale);
    for (let i = 0; i < count; i++) {
      let placed = false;
      for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS && !placed; attempt++) {
        const x = sampleFromIntervals(allowedX);
        if (x === null) break; // spawn columns and bad ground alone already cover the whole map
        const free = isFreeColumn(x);
        if (!free) continue;
        const prop = category.props[randomInt(0, category.props.length - 1)];
        const targetHeight = randomBetween(...category.heightRange) * sizeScale;
        const scale = targetHeight / prop.height;
        const footprintWidth = prop.width * scale;
        // Same widened bounds stampFootprint itself will stamp into (see
        // FOOTPRINT_EDGE_PADDING_FRACTION) - checked here, before
        // committing to this placement, so a footprint that would straddle
        // a building/branch/lake edge gets rejected and retried instead of
        // silently rendering a clipped sprite.
        const paddedHalfWidth = footprintWidth / 2 / (1 - 2 * FOOTPRINT_EDGE_PADDING_FRACTION);
        const minX = Math.max(0, Math.floor(x - paddedHalfWidth));
        const maxX = Math.min(width - 1, Math.ceil(x + paddedHalfWidth));
        if (!footprintSpanIsUniformGround(mask, width, height, minX, maxX, lowGroundY, targetHeight)) continue;
        const flipX = category.flippable && Math.random() < 0.5;
        decorations.push({
          textureKey: prop.key,
          x,
          y: free.y,
          scale,
          flipX,
        });
        stampFootprint(
          mask,
          decorationMask,
          width,
          height,
          x,
          footprintWidth,
          targetHeight,
          HEIGHT_PROFILES[prop.key],
          flipX,
        );
        occupiedX.push(x);
        placed = true;
      }
    }
  }
  return decorations;
}
