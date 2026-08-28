import type { Worm } from './types.js';

const MOBILE_WIDTH_THRESHOLD = 820;
const AIM_LIMIT = Math.PI / 2;

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const hasCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const hasTouch = navigator.maxTouchPoints > 0;
  return (hasCoarsePointer && hasTouch) || window.innerWidth <= MOBILE_WIDTH_THRESHOLD;
}

export function aimWormAtPoint(worm: Worm, targetX: number, targetY: number): void {
  const deltaX = targetX - worm.x;
  const deltaY = targetY - worm.y;
  if (deltaX === 0 && deltaY === 0) return;

  worm.facing = deltaX < 0 ? -1 : 1;
  const aimAngle = Math.atan2(deltaY, Math.max(1, Math.abs(deltaX)));
  worm.aimAngle = Math.max(-AIM_LIMIT, Math.min(AIM_LIMIT, aimAngle));
}
