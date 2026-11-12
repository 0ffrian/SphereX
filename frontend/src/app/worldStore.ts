// Issue #71, D-37 (stream Y): the world engine's two canvases and what they share. A planet is drawn on TWO
// WorldEngine instances (Q-313): the globe in the build pane (fly view off, the globe fills its canvas) and the
// fly view in the close-up pane (fly view on; only the left 60% of that canvas is shown). The controls live in the
// build pane; this store applies each change to both, remembers what was applied so a close-up that opens later
// starts in the same state, and carries the "go there" target from a globe click to the fly view.
import { create } from 'zustand';
import type { CardToWorldOk } from '@/engine/worlds/cardToWorld';
import type { EngineOverrides, WorldEngine } from '@/engine/worlds/WorldEngine';

export interface WorldTarget {
  lon: number;
  lat: number;
  /** Bumps on every click so the same place can be picked twice. */
  seq: number;
}

interface WorldStoreState {
  world: CardToWorldOk | null;
  globe: WorldEngine | null;
  fly: WorldEngine | null;
  /**
   * Render-performance roadmap 0.7: the fly engine stays mounted while the close-up is closed, paused.
   * A paused fly engine takes every control change (so it reopens in step) but is not redrawn.
   */
  flyPaused: boolean;
  setFlyPaused(p: boolean): void;
  /** Everything applied since the world was loaded (the artifact's slider and pill state). */
  applied: EngineOverrides;
  playing: boolean;
  target: WorldTarget | null;
  /** Bumped when something the panels read changed, so they re-read the engine. */
  rev: number;
  /** `engineKey` of a world whose engine could not start; the old path draws it. A new object has another key. */
  failedId: string | null;
  fail(key: string): void;
  /** The same for a star engine. */
  starFailedId: string | null;
  failStar(key: string): void;
  load(world: CardToWorldOk | null): void;
  setGlobe(e: WorldEngine | null): void;
  setFly(e: WorldEngine | null): void;
  /** Apply the artifact's control change to both canvases and redraw them. */
  apply(o: EngineOverrides): void;
  setPlaying(p: boolean): void;
  pick(lon: number, lat: number): void;
  redraw(): void;
  bump(): void;
}

/** A gas giant is not drawn while it spins up (the artifact hides it); a rocky world is drawn as it forms. */
export function drawReady(e: WorldEngine): boolean {
  return !(e.state().gas && e.spinup > 0);
}

/** Globe turn per CSS pixel of drag, radians, at zoom 1 (the artifact's value). */
const DRAG_RAD_PER_PX = 0.006;

/**
 * The globe turn for a drag of (dx, dy) CSS pixels: the surface follows the hand, like grabbing a ball (issue #93
 * regression fix). In the engine a larger yaw turns the surface to the left on screen and a larger pitch moves the
 * front of the globe up (WORLD_FS: b = ry(rx(n, tilt + pitch), spin + yaw)), so both are subtracted. The Sun turns
 * with the yaw (core.js rotates the light by -yaw), so the terminator stays where it is.
 */
export function globeTurn(s: { yaw: number; pitch: number; zoom: number }, dx: number, dy: number) {
  return globeTurnBy(s, (dx * DRAG_RAD_PER_PX) / s.zoom, (dy * DRAG_RAD_PER_PX) / s.zoom);
}

/** Turn the globe so its surface moves right by `right` and down by `down` radians (pitch kept within +-1.4). */
export function globeTurnBy(s: { yaw: number; pitch: number }, right: number, down: number) {
  return { yaw: s.yaw - right, pitch: Math.max(-1.4, Math.min(1.4, s.pitch - down)) };
}

/** Arrow keys move the surface the way the arrow points, as a drag in that direction would. */
export const GLOBE_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-0.1, 0],
  ArrowRight: [0.1, 0],
  ArrowUp: [0, -0.1],
  ArrowDown: [0, 0.1],
};

/**
 * What a failure belongs to: the card and the preset it maps to. A failure must not carry over to the
 * next object (the old flag was sticky), so every reader compares the key of what it is about to draw.
 */
export function engineKey(cardId: string | null | undefined, presetId: string): string {
  return `${cardId ?? ''}|${presetId}`;
}

export const useWorldStore = create<WorldStoreState>((set, get) => ({
  world: null,
  globe: null,
  fly: null,
  flyPaused: false,
  setFlyPaused: (flyPaused) => set({ flyPaused }),
  applied: {},
  playing: true,
  target: null,
  rev: 0,
  failedId: null,
  fail: (failedId) => set({ failedId }),
  starFailedId: null,
  failStar: (starFailedId) => set({ starFailedId }),
  load: (world) => set({ world, applied: {}, target: null, playing: true }),
  setGlobe: (globe) => set({ globe }),
  setFly: (fly) => set({ fly }),
  apply: (o) => {
    const { globe, fly } = get();
    globe?.setOverrides(o);
    fly?.setOverrides(o);
    set((s) => ({ applied: { ...s.applied, ...o }, rev: s.rev + 1 }));
    get().redraw();
  },
  setPlaying: (playing) => {
    const { globe, fly } = get();
    if (globe) globe.playing = playing;
    if (fly) fly.playing = playing;
    set((s) => ({ playing, rev: s.rev + 1 }));
  },
  pick: (lon, lat) => set((s) => ({ target: { lon, lat, seq: (s.target?.seq ?? 0) + 1 } })),
  redraw: () => {
    const { globe, fly, flyPaused } = get();
    for (const e of [globe, flyPaused ? null : fly]) if (e && drawReady(e)) e.draw();
  },
  bump: () => set((s) => ({ rev: s.rev + 1 })),
}));

/** The world on screen for sound and queries (was the haptics' view, D-39): CPU arrays of the globe engine, or null when the engine is not drawing. */
export function worldCpuFields() {
  return useWorldStore.getState().globe?.cpuFields() ?? null;
}
