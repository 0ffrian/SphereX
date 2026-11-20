// R13.10 lifecycle (§13), table-driven: every transition, every Fading trigger, R12 waiting, noSurface.
import { describe, expect, it } from 'vitest';
import {
  fadeDone,
  step,
  type AmbienceStatus,
  type GateInputs,
  type StepInput,
} from './ambienceState';

const ON: GateInputs = {
  entered: true,
  paused: false,
  hidden: false,
  artistic: true,
  failed: false,
  soundOn: true,
  ambienceOn: true,
  audioRunning: true,
};
const inp = (g: Partial<GateInputs> = {}, o: Partial<StepInput> = {}): StepInput => ({
  gate: { ...ON, ...g },
  placeReady: true,
  selected: 4,
  ready: 2,
  ...o,
});

describe('ambience lifecycle reducer', () => {
  it.each<[AmbienceStatus, StepInput, AmbienceStatus, string[]]>([
    ['idle', inp({}, { placeReady: false }), 'waiting', []],
    ['idle', inp({}, { ready: 0 }), 'baking', ['fadeIn']],
    ['waiting', inp({}, { ready: 0 }), 'baking', ['fadeIn']],
    ['waiting', inp(), 'playing', ['fadeIn']], // B1: back from waiting within the fade revives the group
    ['baking', inp(), 'playing', []],
    ['idle', inp(), 'playing', ['fadeIn']], // B1/m3: a remount of the same world while its group still fades
    ['playing', inp({}, { selected: 0, ready: 0 }), 'playing', []], // nothing to play (all refused): silent, captioned
    ['playing', inp({}, { placeReady: false }), 'waiting', ['fadeOut']],
    ['fading', inp(), 'playing', ['fadeIn']],
    ['fading', inp({}, { ready: 0 }), 'baking', ['fadeIn']],
    ['playing', inp({ failed: true }), 'noSurface', ['fadeOut']],
    ['idle', inp({ failed: true }), 'noSurface', []],
    ['noSurface', inp(), 'playing', ['fadeIn']],
    ['error', inp(), 'error', []],
    ['idle', inp({ soundOn: false }), 'idle', []],
    ['fading', inp({ soundOn: false }), 'fading', []],
  ])('%s + input → %s', (prev, i, next, fx) => {
    expect(step(prev, i)).toEqual({ status: next, effects: fx });
  });

  it.each<[string, Partial<GateInputs>]>([
    ['ambienceOn off (the chip mute)', { ambienceOn: false }],
    ['honesty drops', { artistic: false }],
    ['close-up closed (flyPaused)', { paused: true }],
    ['page hidden', { hidden: true }],
    ['sound off', { soundOn: false }],
    ['context suspended', { audioRunning: false }],
    ['unmount', { entered: false }],
  ])('every Fading trigger fades: %s', (_, g) => {
    for (const prev of ['baking', 'playing'] as const)
      expect(step(prev, inp(g))).toEqual({ status: 'fading', effects: ['fadeOut'] });
  });

  it('the fade timer ends Fading only', () => {
    expect(fadeDone('fading')).toBe('idle');
    expect(fadeDone('playing')).toBe('playing');
  });
});
