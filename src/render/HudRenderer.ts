import Phaser from 'phaser';
import type { Team } from '../types.js';
import { teamHealthFraction, teamHealthBarX, TEAM_BAR_WIDTH, TEAM_COLORS } from '../render.js';

const TEAM_BAR_HEIGHT = 16;
const TEAM_BAR_TOP = 30;

// One life bar per team across the top of the screen - first team left-
// aligned, second team right-aligned, matching the old drawTeamHealthBars
// (src/render.ts:1499-1519) layout exactly, just built from a nineslice
// frame + a plain colored Rectangle fill instead of Graphics fillRoundedRect.
export class HudRenderer {
  private frames: Phaser.GameObjects.NineSlice[] = [];
  private fills: Phaser.GameObjects.Rectangle[] = [];

  constructor(scene: Phaser.Scene, uiObjects: Phaser.GameObjects.GameObject[], canvasWidth: number) {
    for (let i = 0; i < 2; i++) {
      const x = teamHealthBarX(i, canvasWidth);
      const frame = scene.add.nineslice(x, TEAM_BAR_TOP, 'health_bar_frame', undefined, TEAM_BAR_WIDTH + 4, TEAM_BAR_HEIGHT + 4, 6, 6, 6, 6).setOrigin(0, 0);
      const fill = scene.add.rectangle(x, TEAM_BAR_TOP, TEAM_BAR_WIDTH, TEAM_BAR_HEIGHT, 0xffffff).setOrigin(0, 0);
      this.frames.push(frame);
      this.fills.push(fill);
      uiObjects.push(frame, fill);
    }
  }

  update(teams: Team[]): void {
    teams.forEach((team, index) => {
      const fraction = teamHealthFraction(team);
      const color = TEAM_COLORS[team.playerId] ?? 0xdddddd;
      this.fills[index].setSize(Math.max(0, TEAM_BAR_WIDTH * fraction), TEAM_BAR_HEIGHT).setFillStyle(color);
    });
  }
}
