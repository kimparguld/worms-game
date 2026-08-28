import { isSolid } from './terrain.js';
import { GRAVITY, ROPE_ADJUST_SPEED, ROPE_MIN_LENGTH, ROPE_MAX_LENGTH } from './constants.js';
import type { Terrain, Worm, Rope } from './types.js';

export function fireRope(originX: number, originY: number, angle: number, terrain: Terrain, maxLength: number): Rope {
  if (isSolid(terrain, originX, originY)) {
    return { attached: false, anchorX: null, anchorY: null, length: 0 };
  }
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const step = 2;
  for (let d = step; d <= maxLength; d += step) {
    const x = originX + dx * d;
    const y = originY + dy * d;
    if (isSolid(terrain, x, y)) {
      return { attached: true, anchorX: x, anchorY: y, length: d };
    }
  }
  return { attached: false, anchorX: null, anchorY: null, length: 0 };
}

export function updateRopeSwing(worm: Worm, rope: Rope, dt: number, terrain: Terrain): void {
  if (rope.anchorX == null || rope.anchorY == null || rope.length <= 0) return;
  const dx = worm.x - rope.anchorX;
  const dy = worm.y - rope.anchorY;
  const currentAngle = Math.atan2(dy, dx);

  const tangentX = -Math.sin(currentAngle);
  const tangentY = Math.cos(currentAngle);
  const tangentialSpeed = worm.vx * tangentX + worm.vy * tangentY;
  const gravityTorque = GRAVITY * Math.cos(currentAngle) * dt;

  const newTangentialSpeed = tangentialSpeed + gravityTorque;
  const newAngle = currentAngle + (newTangentialSpeed / rope.length) * dt;

  const newX = rope.anchorX + Math.cos(newAngle) * rope.length;
  const newY = rope.anchorY + Math.sin(newAngle) * rope.length;

  // The pendulum arc is pure geometry with no awareness of the ground - left
  // unchecked, swinging close to a cliff or ledge lets the worm's position
  // jump straight into solid terrain and get stuck there. Halt the swing at
  // the last clear point instead of carrying it through the wall.
  if (isSolid(terrain, newX, newY)) {
    worm.vx = 0;
    worm.vy = 0;
    return;
  }

  worm.x = newX;
  worm.y = newY;
  worm.vx = -Math.sin(newAngle) * newTangentialSpeed;
  worm.vy = Math.cos(newAngle) * newTangentialSpeed;
}

export function adjustRopeLength(rope: Rope, direction: number, dt: number): void {
  rope.length += direction * ROPE_ADJUST_SPEED * dt;
  rope.length = Math.max(ROPE_MIN_LENGTH, Math.min(ROPE_MAX_LENGTH, rope.length));
}
