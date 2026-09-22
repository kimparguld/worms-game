import Phaser from 'phaser';
import { WEAPON_KEYS } from '../matchLoop.js';
import { weaponLabel, weaponPickerLayout, WEAPON_PICKER_TITLE_HEIGHT } from '../render.js';
import type { Team } from '../types.js';

const CELL_FILL = 0x1c2747;
const CELL_HOVER_FILL = 0x2c3a66;
const CELL_STROKE = 0xffffff;
const SELECTED_STROKE = 0xffd966;
const ICON_SIZE = 40;

interface PickerCell {
  slot: number;
  background: Phaser.GameObjects.Rectangle;
  icon: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  ammo: Phaser.GameObjects.Text;
}

// Screen-space overlay listing every weapon as a clickable tile. Built once
// and toggled visible, so GameScene can hand its single container to the
// uiObjects list before the camera-ignore setup runs. The full-screen
// backdrop is interactive too: it swallows clicks meant for the world while
// the picker is open and closes it on a click outside the grid.
export class WeaponPicker {
  private container: Phaser.GameObjects.Container;
  private cells: PickerCell[] = [];

  constructor(
    scene: Phaser.Scene,
    uiObjects: Phaser.GameObjects.GameObject[],
    screenWidth: number,
    screenHeight: number,
    private onSelect: (slot: number) => void,
  ) {
    const layout = weaponPickerLayout(WEAPON_KEYS.length, screenWidth, screenHeight);

    const backdrop = scene.add
      .rectangle(0, 0, screenWidth, screenHeight, 0x000000, 0.35)
      .setOrigin(0, 0)
      .setInteractive();
    backdrop.on('pointerdown', () => this.close());

    const panel = scene.add
      .rectangle(layout.panelX, layout.panelY, layout.panelWidth, layout.panelHeight, 0x0f172e, 0.92)
      .setOrigin(0, 0)
      .setStrokeStyle(2, CELL_STROKE, 0.18)
      // Interactive only so a click in the gaps between tiles lands on the
      // panel rather than falling through to the backdrop and closing it.
      .setInteractive();

    const title = scene.add
      .text(layout.panelX + layout.panelWidth / 2, layout.panelY + WEAPON_PICKER_TITLE_HEIGHT / 2 + 6, 'Choose weapon', {
        fontFamily: "'Baloo 2', sans-serif",
        fontSize: '20px',
        fontStyle: '700',
        color: '#fff8e7',
      })
      .setOrigin(0.5);

    this.container = scene.add.container(0, 0, [backdrop, panel, title]).setDepth(1000).setVisible(false);

    for (const cellLayout of layout.cells) {
      const key = WEAPON_KEYS[cellLayout.slot - 1];
      const centerX = cellLayout.x + layout.cellWidth / 2;
      const background = scene.add
        .rectangle(cellLayout.x, cellLayout.y, layout.cellWidth, layout.cellHeight, CELL_FILL)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });
      const icon = scene.add.image(centerX, cellLayout.y + 30, `${key}_held`).setDisplaySize(ICON_SIZE, ICON_SIZE);
      const label = scene.add
        .text(centerX, cellLayout.y + layout.cellHeight - 8, weaponLabel(cellLayout.slot), {
          fontFamily: "'Baloo 2', sans-serif",
          fontSize: '13px',
          fontStyle: '700',
          color: '#fff8e7',
          align: 'center',
          wordWrap: { width: layout.cellWidth - 8 },
        })
        .setOrigin(0.5, 1);
      const slotNumber = scene.add.text(cellLayout.x + 6, cellLayout.y + 4, String(cellLayout.slot), {
        fontFamily: "'Baloo 2', sans-serif",
        fontSize: '12px',
        color: '#9fb0d8',
      });
      const ammo = scene.add
        .text(cellLayout.x + layout.cellWidth - 6, cellLayout.y + 4, '', {
          fontFamily: "'Baloo 2', sans-serif",
          fontSize: '12px',
          fontStyle: '700',
          color: '#ffd966',
        })
        .setOrigin(1, 0);

      background.on('pointerover', () => background.setFillStyle(CELL_HOVER_FILL));
      background.on('pointerout', () => background.setFillStyle(CELL_FILL));
      background.on('pointerdown', () => {
        this.onSelect(cellLayout.slot);
        this.close();
      });

      this.container.add([background, icon, label, slotNumber, ammo]);
      this.cells.push({ slot: cellLayout.slot, background, icon, label, ammo });
    }

    uiObjects.push(this.container);
  }

  get isOpen(): boolean {
    return this.container.visible;
  }

  open(): void {
    this.container.setVisible(true);
  }

  close(): void {
    this.container.setVisible(false);
    for (const cell of this.cells) cell.background.setFillStyle(CELL_FILL);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  update(selectedWeapon: number, team: Team | undefined): void {
    if (!this.isOpen) return;
    for (const cell of this.cells) {
      const key = WEAPON_KEYS[cell.slot - 1];
      const remaining = team?.ammo?.[key];
      const depleted = remaining !== undefined && remaining <= 0;
      cell.ammo.setText(remaining === undefined ? '' : depleted ? 'OUT' : `x${remaining}`);
      cell.icon.setAlpha(depleted ? 0.35 : 1);
      cell.label.setAlpha(depleted ? 0.5 : 1);
      const selected = cell.slot === selectedWeapon;
      cell.background.setStrokeStyle(selected ? 3 : 1, selected ? SELECTED_STROKE : CELL_STROKE, selected ? 1 : 0.12);
    }
  }
}
