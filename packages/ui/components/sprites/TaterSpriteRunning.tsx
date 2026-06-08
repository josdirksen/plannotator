import React from 'react';
import spriteSheet from './running.png';
import { SpriteSheet } from './SpriteSheet';

// 176x96 native, 24 frames. Runs across the bottom of the screen: the frame
// animation plays while a second 'traverse' animation slides it left → right.
const NATIVE_W = 176;
const NATIVE_H = 96;
const DISPLAY_H = 64;
const DISPLAY_W = (NATIVE_W * DISPLAY_H) / NATIVE_H; // ~117px
const TRAVERSE_SEC = 18; // time to cross the screen

export const TaterSpriteRunning: React.FC = () => (
  <SpriteSheet
    src={spriteSheet}
    nativeW={NATIVE_W}
    nativeH={NATIVE_H}
    frames={24}
    displayH={DISPLAY_H}
    durationSec={5}
    animId="tater-run-sprite"
    className="fixed pointer-events-none hidden md:block"
    style={{ bottom: 0, right: -DISPLAY_W, zIndex: 5 }}
    extraAnimation={`tater-run-across ${TRAVERSE_SEC}s linear infinite`}
    extraKeyframes={`@keyframes tater-run-across { from { right: -${DISPLAY_W}px; } to { right: 100vw; } }`}
  />
);
