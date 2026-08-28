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

const TEAM_NAME_MAX_LENGTH = 14;
const NAME_CHAR_PATTERN = /^[a-zA-Z0-9 ]$/;

export class StartScene extends Phaser.Scene {
  private teamNames: [string, string] = ['', ''];
  private activeField = 0;
  private cursorVisible = true;
  private nameText!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];

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

    this.nameText = [
      this.add
        .text(centerX, 392, '', {
          fontFamily: "'Baloo 2', sans-serif",
          fontSize: '22px',
          fontStyle: '700',
          color: '#fff8e7',
        })
        .setOrigin(0.5, 0),
      this.add
        .text(centerX, 422, '', {
          fontFamily: "'Baloo 2', sans-serif",
          fontSize: '22px',
          fontStyle: '700',
          color: '#fff8e7',
        })
        .setOrigin(0.5, 0),
    ];
    this.refreshNameText();

    this.add
      .text(centerX, 458, 'Type a team name  •  Tab to switch  •  Enter to start', {
        fontFamily: "'Baloo 2', sans-serif",
        fontSize: '16px',
        fontStyle: '700',
        color: '#ffd966',
      })
      .setOrigin(0.5, 0);

    this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => {
        this.cursorVisible = !this.cursorVisible;
        this.refreshNameText();
      },
    });

    // Delaying the listener avoids a keypress held over from the previous
    // scene (e.g. confirming a rematch) leaking straight into this form.
    this.time.delayedCall(750, () => {
      // Non-null: safe unless the Phaser config explicitly disables
      // keyboard input (input.keyboard: false), which it does not here.
      this.input.keyboard!.on('keydown', (event: KeyboardEvent) => this.handleKey(event));
    });
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.key === 'Tab') {
      event.preventDefault();
      this.activeField = this.activeField === 0 ? 1 : 0;
    } else if (event.key === 'Enter') {
      const team1Name = this.teamNames[0].trim() || 'Team 1';
      const team2Name = this.teamNames[1].trim() || 'Team 2';
      this.scene.start('GameScene', { team1Name, team2Name });
      return;
    } else if (event.key === 'Backspace') {
      this.teamNames[this.activeField] = this.teamNames[this.activeField].slice(0, -1);
    } else if (NAME_CHAR_PATTERN.test(event.key) && this.teamNames[this.activeField].length < TEAM_NAME_MAX_LENGTH) {
      this.teamNames[this.activeField] += event.key;
    } else {
      return;
    }
    this.refreshNameText();
  }

  private refreshNameText(): void {
    [0, 1].forEach((i) => {
      const cursor = this.activeField === i && this.cursorVisible ? '_' : '';
      this.nameText[i].setText(`Team ${i + 1}: ${this.teamNames[i]}${cursor}`);
      this.nameText[i].setColor(this.activeField === i ? '#ffd966' : '#fff8e7');
    });
  }
}
