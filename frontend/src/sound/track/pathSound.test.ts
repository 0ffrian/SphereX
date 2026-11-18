// #78: Track's path sound (R8.9.2, Q-194, Q-458): the pure mapping and the start / scrub / stop
// controller against a recording fake of the app's sound.
import { describe, expect, it } from 'vitest';
import type { HapticEvent, ToneId, ToneParams } from '@/contract';
import { wavelengthToPitch } from '@/sound/pitch';
import { PATH_VOICE_PITCH, PATH_VOICE_STRENGTH, TRACK_TICK_STRENGTH } from '@/sound/tuning';
import {
  drawnPan,
  exposureFrames,
  exposureTickNotes,
  FRAME_TAG,
  PATH_TAG,
  PathSoundController,
  pathVoiceParams,
  type PathFrame,
  type PathSoundOutput,
} from './pathSound';

const GEOM = {
  x: 28.5,
  y: 29,
  nx: 58,
  ny: 59,
  north: [0, 1] as [number, number],
  east: [1, 0] as [number, number],
};
// Two exposures of two frames each (D1 and D4), midpoints 1 ms apart within an exposure (as Eros).
const A1: PathFrame = { ...GEOM, mjd_avg: 61119.356749534, wl_um: 0.9861 };
const A4: PathFrame = { ...GEOM, mjd_avg: 61119.356749546, wl_um: 3.3319 };
const B1: PathFrame = { ...GEOM, mjd_avg: 61119.358241791, wl_um: 1.0094 };
const B4: PathFrame = { ...GEOM, mjd_avg: 61119.358241791, wl_um: 3.4224 };
const FRAMES = [A1, A4, B1, B4];

describe('path sound mapping (R8.9.2)', () => {
  it('groups the frames of one exposure by midpoint', () => {
    expect(exposureFrames(FRAMES, A1)).toEqual([A1, A4]);
    expect(exposureFrames(FRAMES, B4)).toEqual([B1, B4]);
    expect(exposureFrames([A1, B1], A4)).toEqual([A1]); // a detector filter leaves one frame
  });

  it('pan is the drawn x in the cutout: centre 0, edges ±1, east-left drawing', () => {
    expect(drawnPan(GEOM)).toBeCloseTo(0, 6);
    // East is +x in pixels and drawn to the left: a larger pixel x is further left.
    expect(drawnPan({ ...GEOM, x: 28.5 + 10 })!).toBeLessThan(0);
    expect(drawnPan({ ...GEOM, x: 28.5 - 10 })!).toBeGreaterThan(0);
    expect(drawnPan({ ...GEOM, x: 28.5 - 30.5 })).toBeCloseTo(1, 6); // half the drawn width = (59 + 2) / 2 px
    expect(drawnPan({ ...GEOM, x: 28.5 - 500 })).toBe(1); // clamped
  });

  it('no pan is guessed when the geometry is missing or degenerate', () => {
    expect(drawnPan({ mjd_avg: 1, wl_um: 1 })).toBeNull();
    expect(drawnPan({ ...GEOM, x: Number.NaN })).toBeNull();
    expect(drawnPan({ ...GEOM, north: [1, 0], east: [1, 0] })).toBeNull();
  });

  it('one note per frame, pitched by its own wavelength (long = low), measured, tone, data', () => {
    const notes = exposureTickNotes([A1, A4]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toEqual({
      kind: 'tick',
      strength: TRACK_TICK_STRENGTH,
      tag: FRAME_TAG,
      pitch: wavelengthToPitch(0.9861),
      pan: drawnPan(A1),
      voice: 'tone',
      channel: 'data',
    });
    expect(FRAME_TAG).toBe('measured');
    expect(notes[1]!.pitch!).toBeLessThan(notes[0]!.pitch!); // Q-430
  });

  it('a frame with no usable wavelength gives no note; a frame with no geometry has no pan', () => {
    expect(exposureTickNotes([{ ...A1, wl_um: Number.NaN }, A4])).toHaveLength(1);
    expect(exposureTickNotes([{ ...A1, wl_um: 0 }])).toEqual([]);
    expect(exposureTickNotes([{ mjd_avg: 1, wl_um: 2 }])[0]).not.toHaveProperty('pan');
  });

  it('the path voice: fixed pitch and strength below the ticks, model_dependent, pan from the drawn x', () => {
    const p = pathVoiceParams({ ...GEOM, x: 20, mjd_avg: 1, wl_um: 1 });
    expect(p.pitch).toBe(PATH_VOICE_PITCH);
    expect(p.strength).toBe(PATH_VOICE_STRENGTH);
    expect(PATH_VOICE_STRENGTH).toBeLessThan(TRACK_TICK_STRENGTH);
    expect(p.tag).toBe(PATH_TAG);
    expect(PATH_TAG).toBe('model_dependent');
    expect(p.pan).toBe(drawnPan({ ...GEOM, x: 20, mjd_avg: 1, wl_um: 1 }));
  });
});

// ---------------------------------------------------------------- controller, recording fake

class FakeOut implements PathSoundOutput {
  readonly log: string[] = [];
  readonly groups: HapticEvent[][] = [];
  readonly tones = new Map<ToneId, ToneParams>();
  unlockResult = true;
  private resolveUnlock: ((v: boolean) => void) | null = null;
  /** When true, unlock waits until `finishUnlock()`. */
  holdUnlock = false;

  unlock = (): Promise<boolean> => {
    this.log.push('unlock');
    if (!this.holdUnlock) return Promise.resolve(this.unlockResult);
    return new Promise((r) => (this.resolveUnlock = r));
  };
  finishUnlock(v = true) {
    this.resolveUnlock?.(v);
  }
  startTone = (id: ToneId, p: ToneParams): boolean => {
    this.log.push(`start:${id}`);
    this.tones.set(id, { ...p });
    return true;
  };
  updateTone = (id: ToneId, p: Partial<ToneParams>): boolean => {
    const t = this.tones.get(id);
    if (!t) return false;
    this.log.push(`update:${id}`);
    this.tones.set(id, { ...t, ...p });
    return true;
  };
  stopTone = (id: ToneId): void => {
    if (this.tones.delete(id)) this.log.push(`stop:${id}`);
  };
  hasTone = (id: ToneId): boolean => this.tones.has(id);
  emitTogether = (notes: readonly HapticEvent[]): number => {
    this.groups.push([...notes]);
    return notes.length;
  };
  /** What the engine does on a page hide or a honesty change. */
  dropTones() {
    this.tones.clear();
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('PathSoundController: start / scrub / stop', () => {
  it('is silent until started; start unlocks and sounds the current exposure once', async () => {
    const out = new FakeOut();
    const c = new PathSoundController(out);
    c.scrub({ hop: A1, frames: FRAMES, playing: false });
    expect(out.groups).toEqual([]);
    expect(c.active).toBe(false);
    const p = c.start();
    expect(out.log[0]).toBe('unlock');
    expect(c.active).toBe(true);
    await p;
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]!.map((n) => n.pitch)).toEqual([
      wavelengthToPitch(A1.wl_um),
      wavelengthToPitch(A4.wl_um),
    ]);
    expect(out.tones.size).toBe(0); // not playing: no path voice
  });

  it('waits for the unlock before the first tick (a locked tick would take the 25 ms gap)', async () => {
    const out = new FakeOut();
    out.holdUnlock = true;
    const c = new PathSoundController(out);
    c.scrub({ hop: A1, frames: FRAMES, playing: true });
    const p = c.start();
    c.scrub({ hop: B1, frames: FRAMES, playing: true });
    expect(out.groups).toEqual([]);
    out.finishUnlock(true);
    await p;
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]).toHaveLength(2);
    expect(out.groups[0]![0]!.pitch).toBe(wavelengthToPitch(B1.wl_um));
    expect(out.hasTone('path')).toBe(true);
  });

  it('one tick per exposure: the second frame of the same exposure adds none; a new or earlier exposure ticks', async () => {
    const out = new FakeOut();
    const c = new PathSoundController(out);
    c.scrub({ hop: A1, frames: FRAMES, playing: false });
    await c.start();
    c.scrub({ hop: A4, frames: FRAMES, playing: false });
    expect(out.groups).toHaveLength(1);
    c.scrub({ hop: B1, frames: FRAMES, playing: false });
    expect(out.groups).toHaveLength(2);
    c.scrub({ hop: A4, frames: FRAMES, playing: false }); // stepping back reaches A again
    expect(out.groups).toHaveLength(3);
  });

  it('the path voice plays while the player runs, follows each hop, and stops when it pauses', async () => {
    const out = new FakeOut();
    const c = new PathSoundController(out);
    c.scrub({ hop: A1, frames: FRAMES, playing: true });
    await c.start();
    expect(out.tones.get('path')).toMatchObject({
      pitch: PATH_VOICE_PITCH,
      tag: 'model_dependent',
    });
    c.scrub({ hop: B1, frames: FRAMES, playing: true });
    expect(out.log).toContain('update:path');
    c.scrub({ hop: B1, frames: FRAMES, playing: false });
    expect(out.hasTone('path')).toBe(false);
  });

  it('starts the tone again after the engine dropped it (page hide, honesty change)', async () => {
    const out = new FakeOut();
    const c = new PathSoundController(out);
    c.scrub({ hop: A1, frames: FRAMES, playing: true });
    await c.start();
    out.dropTones();
    c.scrub({ hop: A1, frames: FRAMES, playing: true }); // same hop: the honesty re-feed
    expect(out.hasTone('path')).toBe(true);
    expect(out.log.filter((l) => l === 'start:path')).toHaveLength(2);
    expect(out.groups).toHaveLength(1); // no extra tick for the same exposure
  });

  it('stop releases the tone and silences later scrubs; a stop during the unlock wins', async () => {
    const out = new FakeOut();
    const c = new PathSoundController(out);
    c.scrub({ hop: A1, frames: FRAMES, playing: true });
    await c.start();
    c.stop();
    expect(out.hasTone('path')).toBe(false);
    expect(c.active).toBe(false);
    c.scrub({ hop: B1, frames: FRAMES, playing: true });
    expect(out.groups).toHaveLength(1);

    out.holdUnlock = true;
    const p = c.start();
    c.stop();
    out.finishUnlock(true);
    expect(await p).toBeNull(); // cancelled, not "no audio"
    expect(out.groups).toHaveLength(1);
    expect(out.hasTone('path')).toBe(false);
  });

  it('a refused unlock resolves false (no audio), not null', async () => {
    const out = new FakeOut();
    out.unlockResult = false;
    const c = new PathSoundController(out);
    c.scrub({ hop: A1, frames: FRAMES, playing: false });
    expect(await c.start()).toBe(false);
  });

  it("never stops another owner's path tone", async () => {
    const out = new FakeOut();
    out.startTone('path', pathVoiceParams(A1)); // someone else's tone
    const c = new PathSoundController(out);
    c.scrub({ hop: A1, frames: FRAMES, playing: false });
    await c.start();
    c.scrub({ hop: B1, frames: FRAMES, playing: false });
    c.stop();
    c.scrub({ hop: null, frames: [], playing: false });
    expect(out.hasTone('path')).toBe(true);
    expect(out.log).not.toContain('stop:path');
  });

  it('the list going away turns the sound off; a new list needs a new click', async () => {
    const out = new FakeOut();
    const c = new PathSoundController(out);
    const seen: boolean[] = [];
    c.subscribe(() => seen.push(c.active));
    c.scrub({ hop: A1, frames: FRAMES, playing: true });
    await c.start();
    c.scrub({ hop: null, frames: [], playing: true });
    expect(c.active).toBe(false);
    expect(out.hasTone('path')).toBe(false);
    expect(seen).toEqual([true, false]);
    c.scrub({ hop: B1, frames: FRAMES, playing: true });
    await flush();
    expect(out.groups).toHaveLength(1);
  });
});
