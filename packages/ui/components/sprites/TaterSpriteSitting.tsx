import React from 'react';
import spriteSheet from './sitting.png';
import { SpriteSheet } from './SpriteSheet';

// 96x96 native, 12 frames. Perches on the top-right of the document card.
export const TaterSpriteSitting: React.FC = () => (
  <SpriteSheet
    src={spriteSheet}
    nativeW={96}
    nativeH={96}
    frames={12}
    displayH={64}
    durationSec={3}
    animId="tater-sit"
    className="hidden md:block absolute pointer-events-none z-10"
    style={{ top: -40, right: -4 }}
  />
);
