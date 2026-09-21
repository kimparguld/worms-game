export const GRAVITY = 900; // px/s^2
export const WORM_MOVE_ACCEL = 800; // px/s^2
export const WORM_MOVE_SPEED = 120; // px/s max horizontal run speed
export const JUMP_IMPULSE = 320; // px/s upward velocity applied on jump
export const FALL_DAMAGE_VELOCITY_THRESHOLD = 400; // px/s impact speed before fall damage applies
export const FALL_DAMAGE_PER_VELOCITY = 0.1; // damage per px/s of impact speed over the threshold
export const TURN_DURATION_MS = 45000;
export const STARTING_HP = 100;
export const WIND_MAX = 140; // px/s^2, max magnitude of per-turn wind acceleration
export const WORM_STEP_HEIGHT = 10; // px the worm can step up per frame when moving horizontally while grounded
export const TURN_BANNER_DURATION_MS = 1500; // ms the "Player N turn" banner shows on a turn switch, during which stepMatch freezes all input/physics
export const ROPE_HOP_IMPULSE = 120; // px/s upward nudge applied when the ninja rope attaches, so a grounded worm lifts off enough for the swing physics to take over
export const ROPE_ADJUST_SPEED = 150; // px/s the rope reels in/pays out while swinging, from the up/down arrow keys
export const ROPE_MIN_LENGTH = 20; // px - shortest the rope can be reeled in to
export const ROPE_MAX_LENGTH = 300; // px - matches the ninja rope's cast distance, so paying out can never exceed its initial max reach
export const DEATH_ANIM_DURATION_MS = 900; // ms a worm spends doing its death wiggle/poof before leaving a gravestone
export const SHOTGUN_TRACER_DURATION = 0.15; // seconds the shotgun's tracer line stays visible after firing
export const EXPLOSION_EFFECT_DURATION = 0.5; // seconds the fireball/shockwave visual plays after a projectile detonates
// Fraction (not fixed px) so it scales with any canvas/terrain size, like
// every other terrain-shape constant in terrain.ts. At 0.07, the water line
// sits at 0.93 * height - comfortably below the deepest a natural valley
// (worst case ~0.63 * height, see terrain.ts's height-budget comment) or
// even a maxed-out cliff (0.72 * height) can reach, so water is only ever
// revealed where terrain has been dug or blown away down to it.
export const WATER_BAND_HEIGHT_FRACTION = 0.07;
export const SPLASH_EFFECT_DURATION = 0.6; // seconds the splash visual plays when a worm hits the water
export const WORLD_WIDTH = 2240; // px - the playable world's width; larger than the 1280 viewport so the zoomed-out camera (see GameScene) reveals more terrain
export const WORLD_HEIGHT = 1260; // px - same 16:9 ratio as the viewport, so the zoomed-out camera fits the whole world with no scrolling needed
// Worms are rendered at this multiple of their native sprite size to cancel
// out the extra zoom-out the camera applies as the world above got bigger
// (see GameScene's camera.setZoom) - 1600 is the world width the worm art
// and camera framing were originally tuned at, so worms keep the same
// on-screen size as before even though there's now more map around them.
// Purely a render-time scale: worm/terrain collision is a single point
// (see worm.ts's updateWormPhysics), so this has no gameplay effect.
export const WORM_RENDER_SCALE = WORLD_WIDTH / 1600;
// Fallback worm names (2 per team) when the start screen's name fields are
// left blank - also doubles as that screen's field placeholders, so the
// label shown while empty always matches the name a blank field produces.
export const DEFAULT_WORM_NAMES: [string, string, string, string] = ['W1', 'W2', 'W3', 'W4'];
// px/s of upward launch per point of blast damage actually dealt (post
// falloff), so a graze barely lifts a worm while a point-blank hit sends it
// flying. Vertical only - vx gets re-clamped to WORM_MOVE_SPEED every
// physics tick regardless of source, so a horizontal shove here would just
// be crushed back down within a frame or two and never read as knockback.
export const EXPLOSION_KNOCKBACK_PER_DAMAGE = 7;
// A worm's death is itself a small blast - worms crowded around a kill are
// at risk, same as standing near any other explosive. Deliberately weaker
// than a purpose-built weapon (compare bazooka: 40/60) since it's a side
// effect of every death, not something a player chose to detonate.
export const DEATH_EXPLOSION_RADIUS = 35;
export const DEATH_EXPLOSION_DAMAGE = 30;
