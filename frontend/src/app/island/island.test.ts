import { describe, expect, it } from 'vitest';
import { useAppStore, type SkyState } from '@/state/store';
import { IDLE_LOOK, litCells, PATTERNS, THINKING_LOOK } from './gridLoader';
import { isThinking, thinkingRetry, thinkingSentence } from './islandText';

const sky = (over: Partial<SkyState>): SkyState => ({ ...useAppStore.getState().sky, ...over });

describe('grid loader patterns', () => {
  it('every pattern has nine cells', () => {
    for (const p of Object.values(PATTERNS)) expect(p).toMatch(/^[01]{9}$/);
  });
  it('at rest it is the heartbeat plus-shape', () => {
    expect(litCells(IDLE_LOOK, 0).map(Number).join('')).toBe('010111010');
    expect(litCells(IDLE_LOOK, 7).map(Number).join('')).toBe('010111010');
  });
  it('thinking steps through its sequence and wraps', () => {
    const at = (i: number) => litCells(THINKING_LOOK, i).map(Number).join('');
    expect(at(0)).toBe(PATTERNS['ripple-out']);
    expect(at(1)).toBe(PATTERNS.breathing);
    expect(at(2)).toBe(PATTERNS['ripple-in']);
    expect(at(3)).toBe(PATTERNS.twinkle);
    expect(at(4)).toBe(at(0));
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
