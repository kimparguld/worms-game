import Phaser from 'phaser';

interface EndSceneData {
  winner?: string;
  winnerName?: string;
}

export class EndScene extends Phaser.Scene {
  private winner = '';
  private winnerName = '';

  constructor() {
    super('EndScene');
  }

  init(data: EndSceneData): void {
    this.winner = data.winner ?? 'draw';
    this.winnerName = data.winnerName ?? this.winner.toUpperCase();
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#16213f');
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    this.add.image(0, 0, 'sky').setOrigin(0, 0).setDisplaySize(this.scale.width, this.scale.height).setAlpha(0.35);

    const winnerColors: Record<string, string> = { p1: '#2fbfae', p2: '#e85d75', p3: '#ffc55c', p4: '#b388eb' };
    const labelColor = winnerColors[this.winner] ?? '#fff8e7';
    const label = this.winner === 'draw' ? "It's a draw!" : `${this.winnerName} wins!`;

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
      .text(centerX, centerY + 44, 'Press any key to continue', {
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
        this.scene.start('StartScene');
      });
    });

    if (this.winner !== 'draw') this.playConfetti();
  }

  // A shower of team-colored confetti falling from the top of the screen -
  // a draw gets none, since there's no team to celebrate.
  private playConfetti(): void {
    if (!this.textures.exists('particleDot')) {
      const dot = this.make.graphics({ x: 0, y: 0 });
      dot.fillStyle(0xffffff, 1);
      dot.fillCircle(4, 4, 4);
      dot.generateTexture('particleDot', 8, 8);
      dot.destroy();
    }
    const teamTints: Record<string, number[]> = {
      p1: [0x14d6b8, 0xffffff, 0x0c8f7c],
      p2: [0xff3860, 0xffffff, 0xc22346],
      p3: [0xffb627, 0xffffff, 0xd18a00],
      p4: [0x9b5de5, 0xffffff, 0x6a33b8],
    };
    const confetti = this.add.particles(0, 0, 'particleDot', {
      x: { min: 0, max: this.scale.width },
      y: -10,
      lifespan: 2600,
      speedY: { min: 80, max: 160 },
      speedX: { min: -40, max: 40 },
      rotate: { min: 0, max: 360 },
      scale: { start: 1.1, end: 0.6 },
      tint: teamTints[this.winner] ?? [0xffd966, 0xffffff],
      frequency: 40,
    });
    this.time.delayedCall(2200, () => confetti.stop());
  }
}
