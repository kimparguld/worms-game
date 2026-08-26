import { isSolid } from './terrain.js';
import { GRAVITY } from './constants.js';

export function fireRope(originX, originY, angle, terrain, maxLength) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const step = 2;
  for (let d = 0; d <= maxLength; d += step) {
    const x = originX + dx * d;
    const y = originY + dy * d;
    if (isSolid(terrain, x, y)) {
      return { attached: true, anchorX: x, anchorY: y, length: d };
    }
  }
  return { attached: false, anchorX: null, anchorY: null, length: 0 };
}

export function updateRopeSwing(worm, rope, dt) {
  const dx = worm.x - rope.anchorX;
  const dy = worm.y - rope.anchorY;
  const currentAngle = Math.atan2(dy, dx);

  const tangentX = -Math.sin(currentAngle);
  const tangentY = Math.cos(currentAngle);
  const tangentialSpeed = worm.vx * tangentX + worm.vy * tangentY;
  const gravityTorque = GRAVITY * Math.cos(currentAngle) * dt;

  const newTangentialSpeed = tangentialSpeed + gravityTorque;
  const newAngle = currentAngle + (newTangentialSpeed / rope.length) * dt;

  worm.x = rope.anchorX + Math.cos(newAngle) * rope.length;
  worm.y = rope.anchorY + Math.sin(newAngle) * rope.length;
  worm.vx = -Math.sin(newAngle) * newTangentialSpeed;
  worm.vy = Math.cos(newAngle) * newTangentialSpeed;
}
