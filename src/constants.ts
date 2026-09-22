export const GRAVITY = 900; // px/s^2
export const WORM_MOVE_ACCEL = 800; // px/s^2
export const WORM_MOVE_SPEED = 120; // px/s max horizontal run speed
export const JUMP_IMPULSE = 320; // px/s upward velocity applied on jump
export const FALL_DAMAGE_VELOCITY_THRESHOLD = 400; // px/s impact speed before fall damage applies
export const FALL_DAMAGE_PER_VELOCITY = 0.1; // damage per px/s of impact speed over the threshold
export const TURN_DURATION_MS = 45000;
export const STARTING_HP = 150;
export const WIND_MAX = 140; // px/s^2, max magnitude of per-turn wind acceleration
export const WORM_STEP_HEIGHT = 10; // px the worm can step up per frame when moving horizontally while grounded
export const TURN_BANNER_DURATION_MS = 1500; // ms the "Player N turn" banner shows on a turn switch, during which stepMatch freezes all input/physics
export const ROPE_HOP_IMPULSE = 120; // px/s upward nudge applied when the ninja rope attaches, so a grounded worm lifts off enough for the swing physics to take over
export const ROPE_ADJUST_SPEED = 150; // px/s the rope reels in/pays out while swinging, from the up/down arrow keys
export const ROPE_MIN_LENGTH = 20; // px - shortest the rope can be reeled in to
export const ROPE_MAX_LENGTH = 400; // px - matches the ninja rope's cast distance, so paying out can never exceed its initial max reach
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
export const WORLD_WIDTH = 4480; // px - the playable world's width; twice as wide as it is tall at 16:9, so the camera scrolls sideways across it (see GameScene)
export const WORLD_HEIGHT = 1260; // px - the camera is zoomed so (almost) this whole height fits the viewport; only the width scrolls
// How much closer than "whole world height fits the viewport" the default
// play zoom sits - also the closest the wheel zoom allows. >1 crops a strip of empty sky off the top (terrain never generates
// into the top 19% - see TOP_CLEARANCE_FRACTION) in exchange for bigger
// worms and terrain on screen.
export const CAMERA_ZOOM_BOOST = 1.15;
// Worms are rendered at this multiple of their native sprite size to cancel
// out the camera's zoom-out - 1600 is the world width the worm art was
// originally tuned at, 2240 the (16:9) world it was last framed for. Fixed
// rather than derived from WORLD_WIDTH now that the world only grows
// sideways and the zoom follows its height instead.
// Purely a render-time scale: worm/terrain collision is a single point
// (see worm.ts's updateWormPhysics), so this has no gameplay effect.
export const WORM_RENDER_SCALE = 2240 / 1600;
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 4;
export const WORMS_PER_TEAM = 3;
// Start screen setting choices; the defaults are the STARTING_HP /
// TURN_DURATION_MS values above.
export const HP_OPTIONS = [50, 100, 150, 200];
export const TURN_TIME_OPTIONS_MS = [30000, 45000, 60000, 90000];
// Fallback team/worm names when the start screen's name fields are left
// blank - also doubles as that screen's field placeholders, so the label
// shown while empty always matches the name a blank field produces. Worms
// are numbered across the whole match (team 2's first worm is "Worm 4").
export function defaultTeamName(teamIndex: number): string {
  return `Team ${teamIndex + 1}`;
}
export function defaultWormName(teamIndex: number, wormIndex: number): string {
  return `Worm ${teamIndex * WORMS_PER_TEAM + wormIndex + 1}`;
}
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
export const MELEE_KNOCKBACK_SPEED = 600; // px/s horizontal shove from the bat
export const MELEE_KNOCKBACK_LIFT = 200; // px/s upward pop, smaller than the shove itself
export const MELEE_KNOCKBACK_DURATION = 0.5; // seconds the shoved worm ignores input and skips the vx clamp/decay
// Radius (px) within which a shot counts as touching a worm - shared by
// raycastHit (shotgun/sniper) and projectile contact checks. Sized against
// the rendered worm (48x56 sprite at WORM_RENDER_SCALE, ~67x78px) rather
// than its single-point physics body, so a shot that visibly crosses the
// worm actually hits it.
export const WORM_HIT_RADIUS = 22;
