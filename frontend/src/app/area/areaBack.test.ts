// Issue #173: where each card's ← goes, one level at a time.
import { describe, expect, it } from 'vitest';
import type { AreaState } from '@/app/shell/areaStore';
import { areaBackOf } from './areaBack';

const base = {
  screen: 'disc',
  trackBack: 'list',
  fromScan: false,
  flow: 'discovery',
  step: 5,
  running: false,
  disc: null,
  known: null,
  refusal: null,
} as const;
const where = (o: Partial<Pick<AreaState, keyof typeof base>>) =>
  areaBackOf({ ...base, ...o } as Parameters<typeof areaBackOf>[0])?.label ?? null;

describe('areaBackOf', () => {
  it('a track goes back to the Discovery list', () => {
    expect(where({ screen: 'mover' })).toBe('Back to the Discovery list');
  });
  it('the Track view goes back to where it was opened from', () => {
    expect(where({ screen: 'eros', trackBack: 'mover' })).toBe('Back to the track');
    expect(where({ screen: 'track', trackBack: 'scan' })).toBe('Back to the scan');
    expect(where({ screen: 'eros', trackBack: 'list', flow: 'known' })).toBe(
      'Back to the Known list',
    );
    expect(where({ screen: 'eros', trackBack: 'list', flow: 'discovery' })).toBe(
      'Back to the Discovery list',
    );
  });
  it('a list goes back to the scan when it is a scan square, else to your patch', () => {
    expect(where({ screen: 'disc', fromScan: true })).toBe('Back to the scan');
    expect(where({ screen: 'list', fromScan: true })).toBe('Back to the scan');
    expect(where({ screen: 'disc' })).toBe('Back to your patch');
    expect(where({ screen: 'list' })).toBe('Back to your patch');
  });
  it('no ← while a single square still computes, nor on the first card of a branch', () => {
    expect(where({ screen: 'disc', running: true })).toBeNull();
    expect(where({ screen: 'disc', step: -1 })).toBeNull();
    for (const screen of ['scan', 'live', 'draw', 'search'] as const)
      expect(where({ screen })).toBeNull();
  });
});
