// Issue #93 C4: the engines kill switch reads `?engines=`, remembers it, and never throws on storage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENGINES_KEY, enginesEnabled } from './enginesSwitch';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('enginesEnabled (issue #93 C4)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to on', () => {
    expect(enginesEnabled('')).toBe(true);
  });

  it('?engines=0 turns the engines off and is remembered', () => {
    expect(enginesEnabled('?engines=0')).toBe(false);
    expect(localStorage.getItem(ENGINES_KEY)).toBe('0');
    expect(enginesEnabled('')).toBe(false);
  });

  it('?engines=1 turns them back on', () => {
    enginesEnabled('?engines=0');
    expect(enginesEnabled('?x=2&engines=1')).toBe(true);
    expect(enginesEnabled('')).toBe(true);
  });

  it('ignores an unrecognised value and the hash', () => {
    expect(enginesEnabled('?engines=no')).toBe(true);
    localStorage.setItem(ENGINES_KEY, 'junk');
    expect(enginesEnabled('')).toBe(true);
  });

  it('never throws when storage throws', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom } as unknown as Storage);
    expect(enginesEnabled('?engines=0')).toBe(false);
    expect(enginesEnabled('')).toBe(true);
  });

  it('works with no storage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(enginesEnabled('?engines=0')).toBe(false);
    expect(enginesEnabled('')).toBe(true);
  });
});
