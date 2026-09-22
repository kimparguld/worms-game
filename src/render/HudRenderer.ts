import Phaser from 'phaser';
import type { Team } from '../types.js';
import { teamHealthFraction, teamHealthBarX, teamHudRowOffset, TEAM_BAR_WIDTH, TEAM_COLORS } from '../render.js';
import { nineSliceInsets } from '../assetManifest.js';

const TEAM_BAR_HEIGHT = 16;
const TEAM_BAR_TOP = 30;
// Read from the manifest rather than hardcoded, so the declared insets and the
// ones actually used can't drift apart. These bars display the frame at
// TEAM_BAR_HEIGHT + 4 = 20px tall against a 24x16 source, so the manifest's
// 6/6/6/6 fit with room to spare. (WormRenderer's much smaller per-worm pill
// deliberately does *not* reuse them - see the note there.)
const HEALTH_BAR_INSETS = nineSliceInsets('health_bar_frame');

// One life bar per team across the top of the screen - first team left-
// aligned, second team right-aligned (teams 3/4 in a second row beneath
// them, see teamHealthBarX/teamHudRowOffset), matching the old drawTeamHealthBars
// (src/render.ts:1499-1519) layout exactly, just built from a nineslice
// frame + a plain colored Rectangle fill instead of Graphics fillRoundedRect.
export class HudRenderer {
  private frames: Phaser.GameObjects.NineSlice[] = [];
  private fills: Phaser.GameObjects.Rectangle[] = [];

  constructor(
    scene: Phaser.Scene,
    uiObjects: Phaser.GameObjects.GameObject[],
    canvasWidth: number,
    teamCount: number,
  ) {
    for (let i = 0; i < teamCount; i++) {
      const x = teamHealthBarX(i, canvasWidth);
      const y = TEAM_BAR_TOP + teamHudRowOffset(i);
      const frame = scene.add
        .nineslice(x, y, 'health_bar_frame', undefined, TEAM_BAR_WIDTH + 4, TEAM_BAR_HEIGHT + 4, ...HEALTH_BAR_INSETS)
        .setOrigin(0, 0);
      const fill = scene.add.rectangle(x, y, TEAM_BAR_WIDTH, TEAM_BAR_HEIGHT, 0xffffff).setOrigin(0, 0);
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
