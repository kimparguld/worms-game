import { createTerrain } from './terrain.js';
import { createWorm, updateWormPhysics, adjustAim, takeDamage } from './worm.js';
import { createMatch, currentWorm, advanceTurn, tickTurnTimer, checkWinner } from './game.js';
import { createInputState, attachInputListeners } from './input.js';
import { createProjectile, updateProjectile } from './projectile.js';
import { raycastHit, WEAPONS } from './weapons.js';
import { fireRope, updateRopeSwing } from './rope.js';
import { renderFrame } from './render.js';

const WEAPON_KEYS = ['bazooka', 'grenade', 'shotgun', 'ninjaRope', 'dynamite'];

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const terrain = createTerrain(canvas.width, canvas.height);
const teams = [
  { playerId: 'p1', worms: [createWorm(150, 100, 'p1', 'W1'), createWorm(200, 100, 'p1', 'W2')] },
  { playerId: 'p2', worms: [createWorm(760, 100, 'p2', 'W3'), createWorm(810, 100, 'p2', 'W4')] },
];
const match = createMatch(teams);
const input = createInputState();
attachInputListeners(input, window);

let projectiles = [];
let rope = null;
let charging = false;
let chargePower = 0;
let retirementTimer = 0;
let winner = null;
let lastTime = performance.now();

function allWorms() {
  return teams.flatMap((t) => t.worms);
}

function fireWeapon(worm, weaponKey, power) {
  const fireAngle = worm.facing === 1 ? worm.aimAngle : Math.PI - worm.aimAngle;

  if (weaponKey === 'shotgun') {
    for (let i = 0; i < WEAPONS.shotgun.pellets; i++) {
      const hit = raycastHit(terrain, allWorms(), worm.x, worm.y, fireAngle, WEAPONS.shotgun.range);
      if (hit.type === 'worm') takeDamage(hit.worm, WEAPONS.shotgun.maxDamage);
    }
    retirementTimer = 1;
  } else if (weaponKey === 'ninjaRope') {
    const result = fireRope(worm.x, worm.y, fireAngle, terrain, 300);
    rope = result.attached ? result : null;
  } else {
    projectiles.push(createProjectile(weaponKey, worm.x, worm.y, fireAngle, power));
    retirementTimer = 2;
  }
}

function update(dt) {
  const active = currentWorm(match);
  const worm = active.worm;
  const weaponKey = WEAPON_KEYS[input.selectedWeapon - 1];

  if (rope) {
    updateRopeSwing(worm, rope, dt);
    if (input.jump) rope = null;
  } else {
    updateWormPhysics(worm, terrain, input, dt);
  }

  if (input.aimUp) adjustAim(worm, -1, dt);
  if (input.aimDown) adjustAim(worm, 1, dt);

  const chargeableWeapon = WEAPONS[weaponKey].chargeable;
  if (input.firing && chargeableWeapon) {
    charging = true;
    chargePower = Math.min(1, chargePower + dt);
  } else if (charging) {
    fireWeapon(worm, weaponKey, chargePower);
    charging = false;
    chargePower = 0;
  } else if (input.firing && !chargeableWeapon) {
    fireWeapon(worm, weaponKey, 1);
    input.firing = false;
  }

  projectiles = projectiles.filter((p) => p.alive);
  for (const p of projectiles) {
    updateProjectile(p, terrain, allWorms(), match.wind, dt);
  }

  if (retirementTimer > 0) {
    retirementTimer -= dt;
    if (retirementTimer <= 0 && projectiles.every((p) => !p.alive)) {
      advanceTurn(match);
    }
  }

  tickTurnTimer(match, dt * 1000);

  if (input.endTurnRequested) {
    advanceTurn(match);
    input.endTurnRequested = false;
  }

  const result = checkWinner(teams);
  if (result) winner = result;
}

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (!winner) update(dt);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderFrame(ctx, terrain, allWorms(), projectiles, match, input.selectedWeapon);

  if (winner) {
    ctx.fillStyle = '#fff';
    ctx.font = '32px sans-serif';
    const label = winner === 'draw' ? 'Draw!' : `${winner} wins!`;
    ctx.fillText(label, canvas.width / 2 - 80, canvas.height / 2);
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
