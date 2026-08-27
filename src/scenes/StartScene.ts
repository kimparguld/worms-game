import Phaser from 'phaser';

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
    const centerX = this.scale.width / 2;

    this.add.text(centerX, 60, 'WORMS', { fontSize: '48px', color: '#ffffff' }).setOrigin(0.5, 0);

    this.add
      .text(centerX, 150, CONTROLS.join('\n'), { fontSize: '18px', color: '#e0e0e0', align: 'center' })
      .setOrigin(0.5, 0);

    this.add
      .text(centerX, 460, 'Press any key to start', { fontSize: '20px', color: '#ffee58' })
      .setOrigin(0.5, 0);

    this.input.keyboard!.once('keydown', () => {
      this.scene.start('GameScene');
    });
  }
}
