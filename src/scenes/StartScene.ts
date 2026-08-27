import Phaser from 'phaser';
import { drawSky } from '../render.js';

const CONTROLS = [
  'Arrow Left / Right - Move',
  'Arrow Up / Down - Aim',
  'Space - Jump',
  'Enter (hold) - Charge and fire weapon',
  '1-5 - Select weapon (Bazooka, Grenade, Shotgun, Ninja Rope, Dynamite)',
  'Backspace / Esc - End turn',
];

export class StartScene extends Phaser.Scene {
  constructor() {
    super('StartScene');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#16213f');
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    const sky = this.add.graphics();
    drawSky(sky, this.scale.width, this.scale.height);
    sky.setAlpha(0.35);

    this.add
      .text(centerX, 55, 'WORMS', {
        fontFamily: "'Baloo 2', sans-serif",
        fontSize: '64px',
        fontStyle: '800',
        color: '#fff8e7',
        stroke: '#16213f',
        strokeThickness: 8,
      })
      .setOrigin(0.5, 0);

    const panelWidth = 520;
    const panelHeight = 230;
    const panel = this.add.graphics();
    panel.fillStyle(0x0f172e, 0.65);
    panel.fillRoundedRect(centerX - panelWidth / 2, centerY - panelHeight / 2 - 10, panelWidth, panelHeight, 16);
    panel.lineStyle(2, 0xffffff, 0.12);
    panel.strokeRoundedRect(centerX - panelWidth / 2, centerY - panelHeight / 2 - 10, panelWidth, panelHeight, 16);

    this.add
      .text(centerX, centerY - panelHeight / 2 + 16, CONTROLS.join('\n'), {
        fontFamily: "'Baloo 2', sans-serif",
        fontSize: '19px',
        color: '#fff8e7',
        align: 'center',
        lineSpacing: 8,
      })
      .setOrigin(0.5, 0);

    this.add
      .text(centerX, 462, 'Press any key to start', {
        fontFamily: "'Baloo 2', sans-serif",
        fontSize: '22px',
        fontStyle: '700',
        color: '#ffd966',
      })
      .setOrigin(0.5, 0);

    this.time.delayedCall(750, () => {
      // Non-null: safe unless the Phaser config explicitly disables
      // keyboard input (input.keyboard: false), which it does not here.
      this.input.keyboard!.once('keydown', () => {
        this.scene.start('GameScene');
      });
    });
  }
}
