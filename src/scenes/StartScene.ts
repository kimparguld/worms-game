import Phaser from 'phaser';
import { soundSystem } from '../sound.js';
import { isMobileDevice } from '../mobile.js';
import {
  MIN_TEAMS,
  MAX_TEAMS,
  WORMS_PER_TEAM,
  HP_OPTIONS,
  TURN_TIME_OPTIONS_MS,
  STARTING_HP,
  TURN_DURATION_MS,
  defaultTeamName,
  defaultWormName,
} from '../constants.js';
import { teamColorCss } from '../render.js';
import { loadManifestAssets } from '../assetLoader.js';
import type { MatchSetup } from '../types.js';

const CONTROLS = [
  'Arrow Left/Right or A/D - Move',
  'Arrow Up/Down or W/S - Aim',
  'Enter - Jump',
  'Space (hold) - Charge and fire weapon',
  '1-9, 0 - Select weapon (Bazooka ... Drill)',
  '[ / ] - Cycle to Homing Missile, Cluster Bomb, Bat',
  'Tab - Open weapon picker',
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

type SettingKey = 'teams' | 'hp' | 'turn';

type FieldRef =
  | { kind: 'setting'; key: SettingKey }
  | { kind: 'team'; team: number }
  | { kind: 'worm'; team: number; worm: number };

const SETTING_KEYS: SettingKey[] = ['teams', 'hp', 'turn'];
const SETTING_LABELS: Record<SettingKey, string> = { teams: 'Teams', hp: 'Health', turn: 'Turn time' };
const TEAM_COUNT_OPTIONS = Array.from({ length: MAX_TEAMS - MIN_TEAMS + 1 }, (_, i) => MIN_TEAMS + i);

const TEAM_COLUMN_WIDTH = 290;
const SETTINGS_Y = 300;
const TEAM_COLUMNS_Y = 372;

const TEXT_COLOR = '#fff8e7';
const ACTIVE_COLOR = '#ffd966';

function fieldMaxLength(field: FieldRef): number {
  return field.kind === 'team' ? TEAM_NAME_MAX_LENGTH : WORM_NAME_MAX_LENGTH;
}

function formatSetting(key: SettingKey, value: number): string {
  if (key === 'turn') return `${value / 1000}s`;
  return `${value}`;
}

export class StartScene extends Phaser.Scene {
  // Names are kept for all MAX_TEAMS teams even while fewer are playing, so
  // dropping the team count and raising it again doesn't lose what was typed.
  private teamNames: string[] = [];
  private wormNames: string[][] = [];
  private settingIndex: Record<SettingKey, number> = {
    teams: 0,
    hp: HP_OPTIONS.indexOf(STARTING_HP),
    turn: TURN_TIME_OPTIONS_MS.indexOf(TURN_DURATION_MS),
  };
  private activeField = 0; // index into fieldOrder()
  private cursorVisible = true;
  private settingTexts = {} as Record<SettingKey, Phaser.GameObjects.Text>;
  private teamNameTexts: Phaser.GameObjects.Text[] = [];
  private wormNameTexts: Phaser.GameObjects.Text[][] = [];
  private mobileForm: HTMLFormElement | null = null;

  constructor() {
    super('StartScene');
  }

  preload(): void {
    loadManifestAssets(this);
  }

  create(): void {
    // Phaser reuses the scene instance across restarts (e.g. after a match),
    // so every per-visit field is reset here rather than in the constructor.
    this.teamNames = Array.from({ length: MAX_TEAMS }, () => '');
    this.wormNames = Array.from({ length: MAX_TEAMS }, () => Array.from({ length: WORMS_PER_TEAM }, () => ''));
    this.activeField = 0;
    this.teamNameTexts = [];
    this.wormNameTexts = [];

    const mobileDevice = isMobileDevice();
    this.cameras.main.setBackgroundColor('#16213f');
    const centerX = this.scale.width / 2;

    this.add.image(0, 0, 'sky').setOrigin(0, 0).setDisplaySize(this.scale.width, this.scale.height).setAlpha(0.35);

    this.add
      .text(centerX, mobileDevice ? 55 : 24, 'WORMS', {
        fontFamily: "'Baloo 2', sans-serif",
        fontSize: mobileDevice ? '54px' : '60px',
        fontStyle: '800',
        color: TEXT_COLOR,
        stroke: '#16213f',
        strokeThickness: 8,
      })
      .setOrigin(0.5, 0);

    if (mobileDevice) this.createMobileControlsPanel(centerX);
    else this.createDesktopControlsPanel(centerX);

    if (mobileDevice) {
      this.createMobileTeamForm();
    } else {
      this.createDesktopForm(centerX);
      this.time.addEvent({
        delay: 500,
        loop: true,
        callback: () => {
          this.cursorVisible = !this.cursorVisible;
          this.refreshDesktopForm();
        },
      });
    }

    // Delaying the listener avoids a keypress held over from the previous
    // scene (e.g. confirming a rematch) leaking straight into this form.
    this.time.delayedCall(750, () => {
      // Non-null: safe unless the Phaser config explicitly disables
      // keyboard input (input.keyboard: false), which it does not here.
      this.input.keyboard!.on('keydown', (event: KeyboardEvent) => this.handleKey(event));
    });

    this.events.once('shutdown', () => this.destroyMobileTeamForm());
  }

  private teamCount(): number {
    return TEAM_COUNT_OPTIONS[this.settingIndex.teams];
  }

  private settingValue(key: SettingKey): number {
    const options = key === 'teams' ? TEAM_COUNT_OPTIONS : key === 'hp' ? HP_OPTIONS : TURN_TIME_OPTIONS_MS;
    return options[this.settingIndex[key]];
  }

  private changeSetting(key: SettingKey, delta: number): void {
    const count = key === 'teams' ? TEAM_COUNT_OPTIONS.length : key === 'hp' ? HP_OPTIONS.length : TURN_TIME_OPTIONS_MS.length;
    this.settingIndex[key] = (this.settingIndex[key] + delta + count) % count;
  }

  // Tab cycle order: the settings row left-to-right, then each playing
  // team's name immediately followed by its worms' names, column by column -
  // the same order the fields are laid out on screen.
  private fieldOrder(): FieldRef[] {
    const fields: FieldRef[] = SETTING_KEYS.map((key) => ({ kind: 'setting', key }));
    for (let team = 0; team < this.teamCount(); team++) {
      fields.push({ kind: 'team', team });
      for (let worm = 0; worm < WORMS_PER_TEAM; worm++) fields.push({ kind: 'worm', team, worm });
    }
    return fields;
  }

  private fieldValue(field: FieldRef): string {
    if (field.kind === 'team') return this.teamNames[field.team];
    if (field.kind === 'worm') return this.wormNames[field.team][field.worm];
    return '';
  }

  private setFieldValue(field: FieldRef, value: string): void {
    if (field.kind === 'team') this.teamNames[field.team] = value;
    else if (field.kind === 'worm') this.wormNames[field.team][field.worm] = value;
  }

  private createDesktopControlsPanel(centerX: number): void {
    const panelWidth = 1000;
    const panelHeight = 150;
    const panelY = 104;
    const panel = this.add.graphics();
    panel.fillStyle(0x0f172e, 0.72);
    panel.fillRoundedRect(centerX - panelWidth / 2, panelY, panelWidth, panelHeight, 16);
    panel.lineStyle(2, 0xffffff, 0.12);
    panel.strokeRoundedRect(centerX - panelWidth / 2, panelY, panelWidth, panelHeight, 16);

    // Two columns so all the controls fit in half the height, leaving room
    // below for the settings row and up to four team columns.
    const half = Math.ceil(CONTROLS.length / 2);
    const columnStyle = {
      fontFamily: "'Baloo 2', sans-serif",
      fontSize: '17px',
      color: TEXT_COLOR,
      lineSpacing: 6,
    };
    this.add.text(centerX - panelWidth / 2 + 36, panelY + 16, CONTROLS.slice(0, half).join('\n'), columnStyle);
    this.add.text(centerX + 16, panelY + 16, CONTROLS.slice(half).join('\n'), columnStyle);
  }

  private createMobileControlsPanel(centerX: number): void {
    const panelWidth = Math.min(this.scale.width - 48, 540);
    const panelHeight = 170;
    const panelY = 140;
    const panel = this.add.graphics();
    panel.fillStyle(0x0f172e, 0.72);
    panel.fillRoundedRect(centerX - panelWidth / 2, panelY, panelWidth, panelHeight, 16);
    panel.lineStyle(2, 0xffffff, 0.12);
    panel.strokeRoundedRect(centerX - panelWidth / 2, panelY, panelWidth, panelHeight, 16);
    this.add
      .text(centerX, panelY + 18, MOBILE_CONTROLS.join('\n'), {
        fontFamily: "'Baloo 2', sans-serif",
        fontSize: '17px',
        color: TEXT_COLOR,
        align: 'center',
        lineSpacing: 7,
        wordWrap: { width: panelWidth - 42 },
      })
      .setOrigin(0.5, 0);
  }

  private createDesktopForm(centerX: number): void {
    const settingStyle = { fontFamily: "'Baloo 2', sans-serif", fontSize: '22px', fontStyle: '700', color: TEXT_COLOR };
    const settingSpacing = 300;
    SETTING_KEYS.forEach((key, i) => {
      const x = centerX + (i - (SETTING_KEYS.length - 1) / 2) * settingSpacing;
      const text = this.add.text(x, SETTINGS_Y, '', settingStyle).setOrigin(0.5, 0);
      // Clicking the left half of a setting steps it down, the right half up.
      text.setInteractive({ useHandCursor: true }).on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.activeField = SETTING_KEYS.indexOf(key);
        this.changeSetting(key, pointer.x < text.x ? -1 : 1);
        this.afterSettingChange();
      });
      this.settingTexts[key] = text;
    });

    const teamStyle = { fontFamily: "'Baloo 2', sans-serif", fontSize: '22px', fontStyle: '800', color: TEXT_COLOR };
    const wormStyle = { fontFamily: "'Baloo 2', sans-serif", fontSize: '18px', fontStyle: '700', color: TEXT_COLOR };
    for (let team = 0; team < MAX_TEAMS; team++) {
      const teamText = this.add.text(0, TEAM_COLUMNS_Y, '', teamStyle).setOrigin(0.5, 0);
      teamText.setStroke('#16213f', 3);
      this.bindFocusOnClick(teamText, { kind: 'team', team });
      this.teamNameTexts.push(teamText);
      const worms: Phaser.GameObjects.Text[] = [];
      for (let worm = 0; worm < WORMS_PER_TEAM; worm++) {
        const wormText = this.add.text(0, TEAM_COLUMNS_Y + 38 + worm * 30, '', wormStyle).setOrigin(0.5, 0);
        this.bindFocusOnClick(wormText, { kind: 'worm', team, worm });
        worms.push(wormText);
      }
      this.wormNameTexts.push(worms);
    }

    this.add
      .text(
        centerX,
        TEAM_COLUMNS_Y + 38 + WORMS_PER_TEAM * 30 + 40,
        'Tab / Shift+Tab to switch field  •  Left/Right to change a setting  •  Type a name  •  Enter to start',
        { fontFamily: "'Baloo 2', sans-serif", fontSize: '16px', fontStyle: '700', color: ACTIVE_COLOR },
      )
      .setOrigin(0.5, 0);

    this.refreshDesktopForm();
  }

  private bindFocusOnClick(text: Phaser.GameObjects.Text, target: FieldRef): void {
    text.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      const index = this.fieldOrder().findIndex(
        (f) =>
          f.kind === target.kind &&
          (f.kind === 'setting' || f.team === (target as { team: number }).team) &&
          (f.kind !== 'worm' || f.worm === (target as { worm: number }).worm),
      );
      if (index !== -1) this.activeField = index;
      this.refreshDesktopForm();
    });
  }

  private afterSettingChange(): void {
    // Lowering the team count can leave the cursor on a field that no longer
    // exists - clamp it back onto the settings row's "Teams" entry.
    if (this.activeField >= this.fieldOrder().length) this.activeField = 0;
    this.refreshDesktopForm();
  }

  private createMobileTeamForm(): void {
    const container = document.getElementById('game-container');
    if (!container) return;

    const form = document.createElement('form');
    form.className = 'mobile-team-form';
    const select = (key: SettingKey, options: number[]) =>
      `<label>${SETTING_LABELS[key]}<select name="${key}">${options
        .map((v, i) => `<option value="${i}"${i === this.settingIndex[key] ? ' selected' : ''}>${formatSetting(key, v)}</option>`)
        .join('')}</select></label>`;
    form.innerHTML = `
      <div class="settings-row">
        ${select('teams', TEAM_COUNT_OPTIONS)}
        ${select('hp', HP_OPTIONS)}
        ${select('turn', TURN_TIME_OPTIONS_MS)}
      </div>
      <div class="team-fields"></div>
      <button type="submit">Start match</button>
    `;

    const teamFields = form.querySelector<HTMLDivElement>('.team-fields')!;
    const renderTeamFields = () => {
      teamFields.innerHTML = '';
      for (let team = 0; team < this.teamCount(); team++) {
        const teamInput = this.createMobileInput(TEAM_NAME_MAX_LENGTH, defaultTeamName(team), this.teamNames[team], (v) => {
          this.teamNames[team] = v;
        });
        teamInput.style.borderLeft = `6px solid ${teamColorCss(`p${team + 1}`)}`;
        const row = document.createElement('div');
        row.className = 'worm-row';
        for (let worm = 0; worm < WORMS_PER_TEAM; worm++) {
          row.appendChild(
            this.createMobileInput(WORM_NAME_MAX_LENGTH, defaultWormName(team, worm), this.wormNames[team][worm], (v) => {
              this.wormNames[team][worm] = v;
            }),
          );
        }
        teamFields.append(teamInput, row);
      }
    };
    renderTeamFields();

    for (const key of SETTING_KEYS) {
      const el = form.querySelector<HTMLSelectElement>(`select[name="${key}"]`)!;
      el.addEventListener('change', () => {
        this.settingIndex[key] = Number(el.value);
        if (key === 'teams') renderTeamFields();
      });
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.startGame();
    });

    container.appendChild(form);
    this.mobileForm = form;
  }

  private createMobileInput(
    maxLength: number,
    placeholder: string,
    value: string,
    onInput: (value: string) => void,
  ): HTMLInputElement {
    const input = document.createElement('input');
    input.maxLength = maxLength;
    input.autocomplete = 'off';
    input.inputMode = 'text';
    input.placeholder = placeholder;
    input.value = value;
    input.addEventListener('input', () => onInput(input.value.slice(0, maxLength)));
    return input;
  }

  private handleKey(event: KeyboardEvent): void {
    soundSystem.unlock();
    soundSystem.startBackgroundMusic();
    // The mobile form is real DOM inputs that handle their own typing.
    if (this.mobileForm) return;
    const fields = this.fieldOrder();
    const field = fields[this.activeField];
    if (event.key === 'Tab') {
      event.preventDefault();
      const delta = event.shiftKey ? -1 : 1;
      this.activeField = (this.activeField + delta + fields.length) % fields.length;
    } else if (event.key === 'Enter') {
      this.startGame();
      return;
    } else if (field.kind === 'setting') {
      if (event.key === 'ArrowLeft') this.changeSetting(field.key, -1);
      else if (event.key === 'ArrowRight') this.changeSetting(field.key, 1);
      else return;
      this.afterSettingChange();
      return;
    } else if (event.key === 'Backspace') {
      this.setFieldValue(field, this.fieldValue(field).slice(0, -1));
    } else if (NAME_CHAR_PATTERN.test(event.key) && this.fieldValue(field).length < fieldMaxLength(field)) {
      this.setFieldValue(field, this.fieldValue(field) + event.key);
    } else {
      return;
    }
    this.refreshDesktopForm();
  }

  private buildSetup(): MatchSetup {
    return {
      teams: Array.from({ length: this.teamCount() }, (_, team) => ({
        name: this.teamNames[team].trim() || defaultTeamName(team),
        wormNames: this.wormNames[team].map((name, worm) => name.trim() || defaultWormName(team, worm)),
      })),
      startingHp: this.settingValue('hp'),
      turnDurationMs: this.settingValue('turn'),
    };
  }

  private startGame(): void {
    soundSystem.unlock();
    soundSystem.startBackgroundMusic();
    this.scene.start('GameScene', { setup: this.buildSetup() });
  }

  private destroyMobileTeamForm(): void {
    this.mobileForm?.remove();
    this.mobileForm = null;
  }

  private refreshDesktopForm(): void {
    if (this.teamNameTexts.length === 0) return;
    const fields = this.fieldOrder();
    const active = fields[this.activeField];
    const isActive = (f: FieldRef) =>
      active.kind === f.kind &&
      (f.kind === 'setting'
        ? (active as { key: SettingKey }).key === f.key
        : (active as { team: number }).team === f.team &&
          (f.kind !== 'worm' || (active as { worm: number }).worm === f.worm));

    for (const key of SETTING_KEYS) {
      const focused = isActive({ kind: 'setting', key });
      this.settingTexts[key]
        .setText(`${SETTING_LABELS[key]}:  ◀ ${formatSetting(key, this.settingValue(key))} ▶`)
        .setColor(focused ? ACTIVE_COLOR : TEXT_COLOR);
    }

    const centerX = this.scale.width / 2;
    const count = this.teamCount();
    for (let team = 0; team < MAX_TEAMS; team++) {
      const playing = team < count;
      const x = centerX + (team - (count - 1) / 2) * TEAM_COLUMN_WIDTH;
      const teamField: FieldRef = { kind: 'team', team };
      const teamFocused = playing && isActive(teamField);
      this.teamNameTexts[team]
        .setVisible(playing)
        .setX(x)
        .setText(this.fieldLabel(teamField, defaultTeamName(team), teamFocused))
        .setColor(teamFocused ? ACTIVE_COLOR : teamColorCss(`p${team + 1}`));
      for (let worm = 0; worm < WORMS_PER_TEAM; worm++) {
        const wormField: FieldRef = { kind: 'worm', team, worm };
        const wormFocused = playing && isActive(wormField);
        this.wormNameTexts[team][worm]
          .setVisible(playing)
          .setX(x)
          .setText(this.fieldLabel(wormField, defaultWormName(team, worm), wormFocused))
          .setColor(wormFocused ? ACTIVE_COLOR : TEXT_COLOR);
      }
    }
  }

  // Shows the typed name, or the bracketed default it falls back to while
  // blank, plus a blinking cursor on the focused field.
  private fieldLabel(field: FieldRef, fallback: string, focused: boolean): string {
    const value = this.fieldValue(field);
    const cursor = focused && this.cursorVisible ? '_' : '';
    return value ? `${value}${cursor}` : `[${fallback}]${cursor}`;
  }
}
