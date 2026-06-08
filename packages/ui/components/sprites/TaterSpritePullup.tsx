import React from 'react';
import spriteSheet from './pullup.png';
import { SpriteSheet } from './SpriteSheet';

// 96x96 native, 24 frames. Hangs off the bottom-left of the help dialog.
export const TaterSpritePullup: React.FC = () => (
  <SpriteSheet
    src={spriteSheet}
    nativeW={96}
    nativeH={96}
    frames={24}
    displayH={56}
    durationSec={3.5}
    animId="tater-pullup"
    className="absolute pointer-events-none hidden md:block -z-10"
    style={{ bottom: -49, left: 12 }}
  />
);
