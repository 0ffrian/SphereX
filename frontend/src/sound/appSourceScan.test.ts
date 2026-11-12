// #76 (Q-132): the event app has one sound engine and no vibrate driver. A source scan of the app
// tree and the provider, so a second `createSoundEngine`, a `vibrate: true` or a WebVibrateDriver in
// app code, or a lost `<SoundProvider>` wrap in App.tsx, fails here (precedent: layout.test.ts).
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob(
  ['../app/**/*.{ts,tsx}', './SoundProvider.tsx', '!../app/**/*.test.{ts,tsx}'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const entries = Object.entries(sources);
const count = (re: RegExp) => entries.reduce((n, [, text]) => n + (text.match(re)?.length ?? 0), 0);
const where = (re: RegExp) => entries.filter(([, text]) => re.test(text)).map(([path]) => path);

describe('the event app builds one audio-only sound engine (Q-132)', () => {
  it('scans the app tree and the provider (and no test files)', () => {
    expect(entries.length).toBeGreaterThan(20);
    expect(Object.keys(sources)).toContain('./SoundProvider.tsx');
    expect(Object.keys(sources).some((p) => /\.test\.tsx?$/.test(p))).toBe(false);
  });

  it('never mentions WebVibrateDriver or { vibrate: true } in app code', () => {
    expect(where(/WebVibrateDriver/)).toEqual([]);
    expect(where(/vibrate\s*:\s*true/)).toEqual([]);
  });

  it('never calls createSoundEngine( in app code: only createAppSound does', () => {
    const appOnly = entries.filter(([p]) => p.startsWith('../app/'));
    expect(appOnly.filter(([, t]) => /createSoundEngine\s*\(/.test(t)).map(([p]) => p)).toEqual([]);
    expect(where(/createSoundEngine\s*\(/)).toEqual([]);
  });

  it('calls createAppSound( exactly once, in SoundProvider.tsx', () => {
    expect(count(/createAppSound\s*\(/g)).toBe(1);
    expect(where(/createAppSound\s*\(/)).toEqual(['./SoundProvider.tsx']);
  });

  it('App.tsx wraps the app in <SoundProvider>', () => {
    const app = sources['../app/App.tsx'];
    expect(app).toBeTypeOf('string');
    expect(app).toMatch(/<SoundProvider>/);
    expect(app).toMatch(/<\/SoundProvider>/);
  });
});
