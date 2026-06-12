import spriteSheet from './sidebar.png';
import { SpriteSheet } from './SpriteSheet';

// New sidebar sprite: 224x256 native per frame, 24 frames (5376x256 sheet).
// Smooth (non-pixel) art, so pixelated rendering is off. displayH / durationSec
// are tuned for the sidebar header — adjust freely.
export function TaterSpriteSidebar() {
  return (
    <SpriteSheet
      src={spriteSheet}
      nativeW={224}
      nativeH={256}
      frames={24}
      displayH={44}
      durationSec={3.5}
      animId="tater-sidebar"
      pixelated={false}
      flipX
    />
  );
}
