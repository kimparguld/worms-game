import Phaser from 'phaser';

interface EndSceneData {
  winner?: string;
}

export class EndScene extends Phaser.Scene {
  private winner = '';

  constructor() {
    super('EndScene');
  }

  init(data: EndSceneData): void {
    this.winner = data.winner ?? 'draw';
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1b2430');
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    const label = this.winner === 'draw' ? 'Draw!' : `${this.winner.toUpperCase()} wins!`;
    this.add.text(centerX, centerY - 20, label, { fontSize: '40px', color: '#ffffff' }).setOrigin(0.5);

    this.add
      .text(centerX, centerY + 40, 'Press any key to restart', { fontSize: '20px', color: '#ffee58' })
      .setOrigin(0.5);

    this.time.delayedCall(750, () => {
      this.input.keyboard!.once('keydown', () => {
        this.scene.start('GameScene');
      });
    });
  }
}
