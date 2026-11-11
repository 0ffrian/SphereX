// Sky layer extension points, the minimum Area search needs (A21.2, A21.6, A21.13; Q-174, built
// ahead for Area on issue #96's instruction, Q-406). Nothing here knows about Area search, so Track
// (#82) can register the same way.
//
// - SkyViewContext: the SkyView, for a layer in SkyPane's layer slot to listen to its renders.
// - Hit-test chain: SkyPane runs marker buttons first (they are DOM buttons above the canvas), then
//   the registered layers topmost first, then its own pick.
// - Draw handler: while the shell's pointer mode is `draw`, SkyPane sends a primary drag and a click
//   to the one registered handler instead of panning.
// - Described-by ids: a layer's text alternative is appended to the canvas's aria-describedby,
//   never replacing the shell's instructions (A21.12).
import { createContext } from 'react';
import type { SkyView } from '@/viewer/sky/SkyView';

export const SkyViewContext = createContext<SkyView | null>(null);

export interface SkyLayerRegistration {
  id: string;
  /** Higher draws above and is hit-tested first. */
  order: number;
  /** Pane-local CSS px. True when the layer used the click (the sky's pick is skipped). */
  hitTest(x: number, y: number): boolean;
}

const layers = new Map<string, SkyLayerRegistration>();

/**
 * Registers a layer; returns the function that removes it. Registering the same id again replaces
 * the entry, and an old remover never removes a newer entry (StrictMode mounts twice).
 */
export function registerSkyLayer(reg: SkyLayerRegistration): () => void {
  layers.set(reg.id, reg);
  return () => {
    if (layers.get(reg.id) === reg) layers.delete(reg.id);
  };
}

/** Runs the layers' hit tests, topmost first; true when one used the click. */
export function runLayerHits(x: number, y: number): boolean {
  const sorted = [...layers.values()].sort((a, b) => b.order - a.order);
  for (const l of sorted) if (l.hitTest(x, y)) return true;
  return false;
}

// ---- Draw handler --------------------------------------------------------------------------------

export interface SkyDrawPoint {
  x: number;
  y: number;
}

export interface SkyDrawHandler {
  start(p: SkyDrawPoint): void;
  move(p: SkyDrawPoint): void;
  /** `wasClick`: the pointer never moved more than the click slop. */
  end(p: SkyDrawPoint, wasClick: boolean): void;
  /** A second pointer, a pointercancel or Escape: drop the drag in progress. */
  cancel(): void;
}

let drawHandler: SkyDrawHandler | null = null;

export function setSkyDrawHandler(h: SkyDrawHandler): () => void {
  drawHandler = h;
  return () => {
    if (drawHandler === h) drawHandler = null;
  };
}

export function getSkyDrawHandler(): SkyDrawHandler | null {
  return drawHandler;
}

// ---- aria-describedby ----------------------------------------------------------------------------

const describedBy = new Set<string>();
const describedByListeners = new Set<() => void>();

/** Appends an element id to the sky canvas's aria-describedby; returns the remover. */
export function addSkyDescribedBy(id: string): () => void {
  describedBy.add(id);
  for (const l of describedByListeners) l();
  return () => {
    describedBy.delete(id);
    for (const l of describedByListeners) l();
  };
}

export function skyDescribedByIds(): string[] {
  return [...describedBy];
}

export function subscribeSkyDescribedBy(listener: () => void): () => void {
  describedByListeners.add(listener);
  return () => describedByListeners.delete(listener);
}
