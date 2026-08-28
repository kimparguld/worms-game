import Phaser from 'phaser';
import { drawSky } from '../render.js';
import { soundSystem } from '../sound.js';
import { isMobileDevice } from '../mobile.js';

const CONTROLS = [
  'Arrow Left / Right - Move',
  'Arrow Up / Down - Aim',
  'Space - Jump',
  'Enter (hold) - Charge and fire weapon',
  '1-5 - Select weapon (Bazooka, Grenade, Shotgun, Ninja Rope, Dynamite)',
  'Backspace / Esc - End turn',
];

const MOBILE_CONTROLS = [
  'Drag active worm - Move',
  'Drag upward - Jump',
  'Hold anywhere else - Aim bazooka',
  'Release - Fire',
];

const TEAM_NAME_MAX_LENGTH = 14;
const NAME_CHAR_PATTERN = /^[a-zA-Z0-9 ]$/;

export class StartScene extends Phaser.Scene {
  private teamNames: [string, string] = ['', ''];
  private activeField = 0;
  private cursorVisible = true;
  private nameText!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private mobileForm: HTMLFormElement | null = null;

  constructor() {
    super('StartScene');
  }

  create(): void {
    const mobileDevice = isMobileDevice();
    this.cameras.main.setBackgroundColor('#16213f');
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    const sky = this.add.graphics();
    drawSky(sky, this.scale.width, this.scale.height);
    sky.setAlpha(0.35);

    this.add
      .text(centerX, 55, 'WORMS', {
        fontFamily: "'Baloo 2', sans-serif",
        fontSize: mobileDevice ? '54px' : '64px',
        fontStyle: '800',
        color: '#fff8e7',
        stroke: '#16213f',
        strokeThickness: 8,
      })
      .setOrigin(0.5, 0);

    const panelWidth = mobileDevice ? Math.min(this.scale.width - 48, 540) : 720;
    const panelHeight = mobileDevice ? 170 : 230;
    const panel = this.add.graphics();
    const panelY = mobileDevice ? 210 : centerY - panelHeight / 2 - 10;
    panel.fillStyle(0x0f172e, 0.72);
    panel.fillRoundedRect(centerX - panelWidth / 2, panelY, panelWidth, panelHeight, 16);
    panel.lineStyle(2, 0xffffff, 0.12);
    panel.strokeRoundedRect(centerX - panelWidth / 2, panelY, panelWidth, panelHeight, 16);

    this.add
      .text(centerX, panelY + 18, (mobileDevice ? MOBILE_CONTROLS : CONTROLS).join('\n'), {
        fontFamily: "'Baloo 2', sans-serif",
        fontSize: mobileDevice ? '17px' : '19px',
        color: '#fff8e7',
        align: 'center',
        lineSpacing: mobileDevice ? 7 : 8,
        wordWrap: { width: panelWidth - 42 },
      })
      .setOrigin(0.5, 0);

    this.nameText = [
      this.add
        .text(centerX, 520, '', {
          fontFamily: "'Baloo 2', sans-serif",
          fontSize: '22px',
          fontStyle: '700',
          color: '#fff8e7',
        })
        .setOrigin(0.5, 0),
      this.add
        .text(centerX, 560, '', {
          fontFamily: "'Baloo 2', sans-serif",
          fontSize: '22px',
          fontStyle: '700',
          color: '#fff8e7',
        })
        .setOrigin(0.5, 0),
    ];
    if (mobileDevice) {
      this.nameText[0].setVisible(false);
      this.nameText[1].setVisible(false);
    }
    this.refreshNameText();

    this.add
      .text(
        centerX,
        mobileDevice ? panelY + panelHeight + 18 : 488,
        mobileDevice ? 'Tap a team field, then start' : 'Type a team name  •  Tab to switch  •  Enter to start',
        {
          fontFamily: "'Baloo 2', sans-serif",
          fontSize: '16px',
          fontStyle: '700',
          color: '#ffd966',
        },
      )
      .setOrigin(0.5, 0);

    if (mobileDevice) this.createMobileTeamForm();

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

    this.events.once('shutdown', () => this.destroyMobileTeamForm());
  }

  private createMobileTeamForm(): void {
    const container = document.getElementById('game-container');
    if (!container) return;

    const form = document.createElement('form');
    form.className = 'mobile-team-form';
    form.innerHTML = `
      <input name="team1" maxlength="${TEAM_NAME_MAX_LENGTH}" autocomplete="off" inputmode="text" placeholder="Team 1" />
      <input name="team2" maxlength="${TEAM_NAME_MAX_LENGTH}" autocomplete="off" inputmode="text" placeholder="Team 2" />
      <button type="submit">Start match</button>
    `;

    const inputs = Array.from(form.querySelectorAll('input'));
    inputs.forEach((input, index) => {
      input.addEventListener('focus', () => {
        this.activeField = index;
        this.refreshNameText();
      });
      input.addEventListener('input', () => {
        this.teamNames[index] = input.value.slice(0, TEAM_NAME_MAX_LENGTH);
        this.refreshNameText();
      });
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.startGame();
    });

    container.appendChild(form);
    this.mobileForm = form;
  }

  private handleKey(event: KeyboardEvent): void {
    soundSystem.unlock();
    soundSystem.startBackgroundMusic();
    if (event.key === 'Tab') {
      event.preventDefault();
      this.activeField = this.activeField === 0 ? 1 : 0;
    } else if (event.key === 'Enter') {
      this.startGame();
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

  private startGame(): void {
    soundSystem.unlock();
    soundSystem.startBackgroundMusic();
    const team1Name = this.teamNames[0].trim() || 'Team 1';
    const team2Name = this.teamNames[1].trim() || 'Team 2';
    this.scene.start('GameScene', { team1Name, team2Name });
  }

  private destroyMobileTeamForm(): void {
    this.mobileForm?.remove();
    this.mobileForm = null;
  }

  private refreshNameText(): void {
    [0, 1].forEach((i) => {
      const cursor = this.activeField === i && this.cursorVisible ? '_' : '';
      this.nameText[i].setText(`Team ${i + 1}: ${this.teamNames[i]}${cursor}`);
      this.nameText[i].setColor(this.activeField === i ? '#ffd966' : '#fff8e7');
    });
  }
}
