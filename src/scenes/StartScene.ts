import Phaser from 'phaser';
import { soundSystem } from '../sound.js';
import { isMobileDevice } from '../mobile.js';
import { DEFAULT_WORM_NAMES } from '../constants.js';
import { loadManifestAssets } from '../assetLoader.js';

const CONTROLS = [
  'Arrow Left/Right or A/D - Move',
  'Arrow Up/Down or W/S - Aim',
  'Enter - Jump',
  'Space (hold) - Charge and fire weapon',
  '1-9, 0 - Select weapon (Bazooka, Grenade, Shotgun, Ninja Rope, Dynamite,',
  'Sniper Rifle, Airstrike Rocket, Holy Hand Grenade, Mine, Drill)',
  'Backspace / Esc - End turn',
];

const MOBILE_CONTROLS = [
  'Drag active worm - Move',
  'Drag upward - Jump',
  'Prev/Next - Select weapon',
  'Hold anywhere else - Aim and fire',
  'Release - Fire',
];

const TEAM_NAME_MAX_LENGTH = 14;
const WORM_NAME_MAX_LENGTH = 12;
const NAME_CHAR_PATTERN = /^[a-zA-Z0-9 ]$/;

type FieldRef = { kind: 'team'; index: 0 | 1 } | { kind: 'worm'; index: 0 | 1 | 2 | 3 };

// Tab cycle order: each team's name, immediately followed by its two
// worms' names, so tabbing through the form reads top-to-bottom the same
// way the fields are laid out on screen.
const FIELD_ORDER: FieldRef[] = [
  { kind: 'team', index: 0 },
  { kind: 'worm', index: 0 },
  { kind: 'worm', index: 1 },
  { kind: 'team', index: 1 },
  { kind: 'worm', index: 2 },
  { kind: 'worm', index: 3 },
];

function fieldMaxLength(field: FieldRef): number {
  return field.kind === 'team' ? TEAM_NAME_MAX_LENGTH : WORM_NAME_MAX_LENGTH;
}

export class StartScene extends Phaser.Scene {
  private teamNames: [string, string] = ['', ''];
  private wormNames: [string, string, string, string] = ['', '', '', ''];
  private activeField = 0; // index into FIELD_ORDER
  private cursorVisible = true;
  private teamNameText!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private wormNameText!: [
    Phaser.GameObjects.Text,
    Phaser.GameObjects.Text,
    Phaser.GameObjects.Text,
    Phaser.GameObjects.Text,
  ];
  private mobileForm: HTMLFormElement | null = null;

  constructor() {
    super('StartScene');
  }

  preload(): void {
    loadManifestAssets(this);
  }

  create(): void {
    const mobileDevice = isMobileDevice();
    this.cameras.main.setBackgroundColor('#16213f');
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    this.add.image(0, 0, 'sky').setOrigin(0, 0).setDisplaySize(this.scale.width, this.scale.height).setAlpha(0.35);

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
    const panelHeight = mobileDevice ? 170 : 250;
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

    const teamTextStyle = {
      fontFamily: "'Baloo 2', sans-serif",
      fontSize: '22px',
      fontStyle: '700',
      color: '#fff8e7',
    };
    const wormTextStyle = {
      fontFamily: "'Baloo 2', sans-serif",
      fontSize: '18px',
      fontStyle: '700',
      color: '#fff8e7',
    };
    // Each team's name line immediately followed by its two worms' name
    // lines, matching FIELD_ORDER's tab sequence top-to-bottom.
    this.teamNameText = [
      this.add.text(centerX, 514, '', teamTextStyle).setOrigin(0.5, 0),
      this.add.text(centerX, 602, '', teamTextStyle).setOrigin(0.5, 0),
    ];
    this.wormNameText = [
      this.add.text(centerX, 544, '', wormTextStyle).setOrigin(0.5, 0),
      this.add.text(centerX, 570, '', wormTextStyle).setOrigin(0.5, 0),
      this.add.text(centerX, 632, '', wormTextStyle).setOrigin(0.5, 0),
      this.add.text(centerX, 658, '', wormTextStyle).setOrigin(0.5, 0),
    ];
    if (mobileDevice) {
      this.teamNameText.forEach((t) => t.setVisible(false));
      this.wormNameText.forEach((t) => t.setVisible(false));
    }
    this.refreshNameText();

    this.add
      .text(
        centerX,
        mobileDevice ? panelY + panelHeight + 18 : 488,
        mobileDevice ? 'Tap a field, then start' : 'Type a name  •  Tab / Shift+Tab to switch  •  Enter to start',
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
      <div class="worm-row">
        <input name="worm1" maxlength="${WORM_NAME_MAX_LENGTH}" autocomplete="off" inputmode="text" placeholder="${DEFAULT_WORM_NAMES[0]}" />
        <input name="worm2" maxlength="${WORM_NAME_MAX_LENGTH}" autocomplete="off" inputmode="text" placeholder="${DEFAULT_WORM_NAMES[1]}" />
      </div>
      <input name="team2" maxlength="${TEAM_NAME_MAX_LENGTH}" autocomplete="off" inputmode="text" placeholder="Team 2" />
      <div class="worm-row">
        <input name="worm3" maxlength="${WORM_NAME_MAX_LENGTH}" autocomplete="off" inputmode="text" placeholder="${DEFAULT_WORM_NAMES[2]}" />
        <input name="worm4" maxlength="${WORM_NAME_MAX_LENGTH}" autocomplete="off" inputmode="text" placeholder="${DEFAULT_WORM_NAMES[3]}" />
      </div>
      <button type="submit">Start match</button>
    `;

    // DOM order above matches FIELD_ORDER exactly (team1, worm1, worm2,
    // team2, worm3, worm4), so the input's position in the NodeList doubles
    // as its index into FIELD_ORDER.
    const inputs = Array.from(form.querySelectorAll('input'));
    inputs.forEach((input, index) => {
      const field = FIELD_ORDER[index];
      input.addEventListener('focus', () => {
        this.activeField = index;
        this.refreshNameText();
      });
      input.addEventListener('input', () => {
        this.setFieldValue(field, input.value.slice(0, fieldMaxLength(field)));
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

  private fieldValue(field: FieldRef): string {
    return field.kind === 'team' ? this.teamNames[field.index] : this.wormNames[field.index];
  }

  private setFieldValue(field: FieldRef, value: string): void {
    if (field.kind === 'team') this.teamNames[field.index] = value;
    else this.wormNames[field.index] = value;
  }

  private handleKey(event: KeyboardEvent): void {
    soundSystem.unlock();
    soundSystem.startBackgroundMusic();
    const field = FIELD_ORDER[this.activeField];
    if (event.key === 'Tab') {
      event.preventDefault();
      const delta = event.shiftKey ? -1 : 1;
      this.activeField = (this.activeField + delta + FIELD_ORDER.length) % FIELD_ORDER.length;
    } else if (event.key === 'Enter') {
      this.startGame();
      return;
    } else if (event.key === 'Backspace') {
      this.setFieldValue(field, this.fieldValue(field).slice(0, -1));
    } else if (NAME_CHAR_PATTERN.test(event.key) && this.fieldValue(field).length < fieldMaxLength(field)) {
      this.setFieldValue(field, this.fieldValue(field) + event.key);
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
    const wormNames = this.wormNames.map((name, i) => name.trim() || DEFAULT_WORM_NAMES[i]) as [
      string,
      string,
      string,
      string,
    ];
    this.scene.start('GameScene', { team1Name, team2Name, wormNames });
  }

  private destroyMobileTeamForm(): void {
    this.mobileForm?.remove();
    this.mobileForm = null;
  }

  private refreshNameText(): void {
    FIELD_ORDER.forEach((field, i) => {
      const isActive = this.activeField === i;
      const cursor = isActive && this.cursorVisible ? '_' : '';
      const text = field.kind === 'team' ? this.teamNameText[field.index] : this.wormNameText[field.index];
      const label = field.kind === 'team' ? `Team ${field.index + 1}` : DEFAULT_WORM_NAMES[field.index];
      text.setText(`${label}: ${this.fieldValue(field)}${cursor}`);
      text.setColor(isActive ? '#ffd966' : '#fff8e7');
    });
  }
}
