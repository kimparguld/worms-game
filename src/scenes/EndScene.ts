import Phaser from 'phaser';
import { drawSky } from '../render.js';

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
    this.cameras.main.setBackgroundColor('#16213f');
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    const sky = this.add.graphics();
    drawSky(sky, this.scale.width, this.scale.height);
    sky.setAlpha(0.35);

    const winnerColors: Record<string, string> = { p1: '#2fbfae', p2: '#e85d75' };
    const labelColor = winnerColors[this.winner] ?? '#fff8e7';
    const label = this.winner === 'draw' ? "It's a draw!" : `${this.winner.toUpperCase()} wins!`;

    this.add
      .text(centerX, centerY - 30, label, {
        fontFamily: "'Baloo 2', sans-serif",
        fontSize: '52px',
        fontStyle: '800',
        color: labelColor,
        stroke: '#16213f',
        strokeThickness: 8,
      })
      .setOrigin(0.5);

    this.add
      .text(centerX, centerY + 44, 'Press any key to restart', {
        fontFamily: "'Baloo 2', sans-serif",
        fontSize: '22px',
        fontStyle: '700',
        color: '#ffd966',
      })
      .setOrigin(0.5);

    this.time.delayedCall(750, () => {
      // Non-null: safe unless the Phaser config explicitly disables
      // keyboard input (input.keyboard: false), which it does not here.
      this.input.keyboard!.once('keydown', () => {
        this.scene.start('GameScene');
      });
    });
  }
}
