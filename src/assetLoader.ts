import Phaser from 'phaser';
import { ASSET_MANIFEST } from './assetManifest.js';

// Every manifest entry that fails to load (404, decode error, etc.) swaps to
// this shared bright-magenta fallback instead of crashing the scene - the
// placeholder generator guarantees every entry resolves to *some* file
// today, so this path exists mainly to protect against a future manifest
// entry outrunning its art. A console warning lists exactly which keys fell
// back, so a partial art delivery is visible without breaking `npm run dev`.
const MISSING_TEXTURE_KEY = 'missing_texture';

export function loadManifestAssets(scene: Phaser.Scene): void {
  for (const entry of ASSET_MANIFEST) {
    const path = `/${entry.path}`;
    if (entry.kind === 'spritesheet') {
      scene.load.spritesheet(entry.key, path, { frameWidth: entry.width, frameHeight: entry.height });
    } else {
      // 'image' and 'nineslice' both load as a plain image - NineSlice reads
      // its insets from the manifest at construction time, not from the load call.
      scene.load.image(entry.key, path);
    }
  }

  const failedKeys: string[] = [];
  scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
    failedKeys.push(file.key);
  });
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    if (failedKeys.length === 0) return;
    console.warn(`[assetLoader] ${failedKeys.length} texture(s) failed to load, using fallback:`, failedKeys);
    for (const key of failedKeys) {
      if (key === MISSING_TEXTURE_KEY) continue; // the fallback itself failing is unrecoverable, don't loop
      scene.textures.addImage(key, scene.textures.get(MISSING_TEXTURE_KEY).getSourceImage() as HTMLImageElement);
    }
  });
}
