import React from 'react';

export interface SpriteSheetProps {
  /** The horizontal sprite-sheet image (imported PNG). */
  src: string;
  /** Native per-frame width/height in px. */
  nativeW: number;
  nativeH: number;
  /** Number of frames laid out horizontally in the sheet. */
  frames: number;
  /** Rendered height in px; width scales to preserve the frame aspect ratio. */
  displayH: number;
  /** Seconds for one full frame cycle. */
  durationSec: number;
  /** Unique @keyframes id for this sprite (avoid collisions across sprites). */
  animId: string;
  /** Mirror horizontally (sprite faces the other way). */
  flipX?: boolean;
  /** Crisp nearest-neighbor scaling — true for pixel-art sheets. Default true. */
  pixelated?: boolean;
  /** Extra CSS animation segment(s) appended after the frame animation. */
  extraAnimation?: string;
  /** Extra @keyframes blocks referenced by `extraAnimation`. */
  extraKeyframes?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * SpriteSheet — the shared core for every Tater sprite. Renders a horizontal
 * sprite sheet as a stepped CSS background animation: a fixed-size div whose
 * background image steps frame-by-frame. Each sprite component supplies its
 * sheet, dimensions, and positioning; the boilerplate lives here once.
 */
export const SpriteSheet: React.FC<SpriteSheetProps> = ({
  src,
  nativeW,
  nativeH,
  frames,
  displayH,
  durationSec,
  animId,
  flipX = false,
  pixelated = true,
  extraAnimation,
  extraKeyframes,
  className,
  style,
}) => {
  const scale = displayH / nativeH;
  const displayW = nativeW * scale;
  const totalW = nativeW * frames * scale;
  const frameAnimation = `${animId} ${durationSec}s steps(${frames}) infinite`;

  return (
    <div
      className={className}
      style={{
        width: displayW,
        height: displayH,
        backgroundImage: `url(${src})`,
        backgroundSize: `${totalW}px ${displayH}px`,
        backgroundPosition: 'left center',
        imageRendering: pixelated ? 'pixelated' : 'auto',
        animation: extraAnimation ? `${frameAnimation}, ${extraAnimation}` : frameAnimation,
        ...(flipX ? { transform: 'scaleX(-1)' } : null),
        ...style,
      }}
    >
      <style>{`
        @keyframes ${animId} { to { background-position: -${totalW}px 0; } }
        ${extraKeyframes ?? ''}
      `}</style>
    </div>
  );
};
