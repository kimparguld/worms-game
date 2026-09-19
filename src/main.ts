import Phaser from 'phaser';
import { StartScene } from './scenes/StartScene.js';
import { GameScene } from './scenes/GameScene.js';
import { EndScene } from './scenes/EndScene.js';
import { isMobileDevice } from './mobile.js';
import { createMusicControls } from './musicControls.js';

const mobileDevice = isMobileDevice();

new Phaser.Game({
  type: Phaser.AUTO,
  width: mobileDevice ? window.innerWidth : 1280,
  height: mobileDevice ? window.innerHeight : 720,
  parent: 'game-container',
  backgroundColor: '#6ec3f4',
  pixelArt: true,
  scale: {
    mode: mobileDevice ? Phaser.Scale.RESIZE : Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    fullscreenTarget: 'game-container',
  },
  scene: [StartScene, GameScene, EndScene],
});

// Created once, outside the Phaser scene graph, so it survives every scene
// transition the same way the background music itself already does.
createMusicControls();
