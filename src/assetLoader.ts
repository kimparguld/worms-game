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
  // Named rather than inline so the COMPLETE handler below can hand the exact
  // same function reference to load.off(). This matters because
  // StartScene.preload() re-runs every time the player returns to the start
  // screen and LoaderPlugin.reset() clears the loader's queues but not its
  // listeners - an anonymous listener added here would leave one more stale
  // closure (and one more push into a dead `failedKeys`) behind per visit.
  // `once` would be wrong instead of `off`: a single load pass can fail more
  // than one file, and `once` would only ever record the first.
  const onFileLoadError = (file: Phaser.Loader.File): void => {
    failedKeys.push(file.key);
  };
  scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onFileLoadError);
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onFileLoadError);
    if (failedKeys.length === 0) return;
    console.warn(`[assetLoader] ${failedKeys.length} texture(s) failed to load, using fallback:`, failedKeys);
    const fallbackImage = scene.textures.get(MISSING_TEXTURE_KEY).getSourceImage() as HTMLImageElement;
    for (const key of failedKeys) {
      if (key === MISSING_TEXTURE_KEY) continue; // the fallback itself failing is unrecoverable, don't loop
      // A failed load never reaches the TextureManager, so if this key already
      // exists it is because an earlier preload pass already installed the
      // fallback for it (see the re-run note above). Re-registering would just
      // trip Phaser's "Texture key already in use" console.error and no-op.
      if (scene.textures.exists(key)) continue;
      const entry = ASSET_MANIFEST.find((e) => e.key === key);

      // Spritesheet entries need every declared frame to exist, not just one
      // image: GameScene.create() feeds these keys to
      // anims.generateFrameNumbers(), which silently returns a short/empty
      // frame list for frames that aren't there - and an animation with no
      // frames is a broken sprite.play(), not a visible magenta placeholder.
      // So the fallback for a sheet is a canvas of `frameCount` magenta tiles
      // laid out left-to-right, exactly like the real sheets.
      if (entry?.kind === 'spritesheet') {
        const frameCount = entry.frameCount ?? 1;
        // Created directly under the failed key, not under a temporary one:
        // TextureManager.addSpriteSheet() overwrites its `key` argument with
        // `source.key` whenever `source` is a Texture, so parsing frames into
        // a differently-keyed canvas would leave `key` itself unregistered.
        const sheet = scene.textures.createCanvas(key, entry.width * frameCount, entry.height);
        if (!sheet) continue;
        for (let i = 0; i < frameCount; i++) {
          sheet.context.drawImage(fallbackImage, i * entry.width, 0, entry.width, entry.height);
        }
        sheet.refresh();
        scene.textures.addSpriteSheet(key, sheet, { frameWidth: entry.width, frameHeight: entry.height });
        continue;
      }

      scene.textures.addImage(key, fallbackImage);
    }
  });
}
