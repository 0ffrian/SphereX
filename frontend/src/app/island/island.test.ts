import { describe, expect, it } from 'vitest';
import { useAppStore, type SkyState } from '@/state/store';
import { PATTERNS } from './GridLoader';
import { IDLE_LOOK, SEARCHING_LOOK } from './loaderLooks';
import { isThinking, thinkingRetry, thinkingSentence } from './islandText';

const sky = (over: Partial<SkyState>): SkyState => ({ ...useAppStore.getState().sky, ...over });

describe('grid loader looks', () => {
  it('every pattern is a 3x3 matrix of 0 and 1', () => {
    for (const m of Object.values(PATTERNS)) {
      expect(m).toHaveLength(3);
      for (const row of m) expect(row.every((c) => c === 0 || c === 1)).toBe(true);
    }
  });
  it('at rest it pulses slowly (Q-407); searching steps through a known pattern', () => {
    expect(IDLE_LOOK.pattern).toBe('heartbeat');
    expect(IDLE_LOOK.mode).toBe('pulse');
    expect(IDLE_LOOK.speed).toBe('idle');
    expect(SEARCHING_LOOK.pattern).toBe('sparkle');
    expect(typeof SEARCHING_LOOK.pattern === 'string' && SEARCHING_LOOK.pattern in PATTERNS).toBe(true);
  });
});

describe('island thinking', () => {
  it('thinks while the object is found and its frames searched, and not otherwise', () => {
    expect(isThinking('resolving')).toBe(true);
    expect(isThinking('loading_frames')).toBe(true);
    for (const s of ['idle', 'ready', 'error'] as const) expect(isThinking(s)).toBe(false);
  });
  it('says what the loading box said, never blank while it thinks', () => {
    expect(
      thinkingSentence(
        sky({ status: 'resolving', query: { q: 'RW Aur', kind: 'name', origin: 'input' } }),
      ),
    ).toBe('Finding “RW Aur”…');
    const loading = thinkingSentence(
      sky({
        status: 'loading_frames',
        resolved: { ra: 76.95653, dec: 30.40144 } as SkyState['resolved'],
      }),
    );
    expect(loading).toBe(
      'Searching the archive for SPHEREx frames at RA 76.95653°, Dec +30.40144°… IRSA can be slow.',
    );
  });
  it('has no sentence and no retry line when nothing is loading', () => {
    expect(thinkingSentence(sky({ status: 'ready' }))).toBeNull();
    expect(thinkingRetry(sky({ status: 'ready' }))).toBeNull();
    expect(thinkingRetry(sky({ status: 'loading_frames', progress: null }))).toBeNull();
  });
});
