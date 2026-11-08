// The RA/Dec readout feed: the sky pane writes the position under the pointer (or the view centre)
// here, at most once per animation frame, and the readout in the top bar writes it straight into
// its text nodes. Nothing here goes through React state, so moving the pointer re-renders nothing.

export interface ReadoutValue {
  ra: number;
  dec: number;
  fovDeg: number;
  /** 'pointer': under the mouse; 'centre': the view centre (pointer outside, or keyboard). */
  source: 'pointer' | 'centre';
}

type Listener = (v: Readonly<ReadoutValue>) => void;

const listeners = new Set<Listener>();
let last: ReadoutValue | null = null;

export function publishReadout(v: ReadoutValue): void {
  last = v;
  for (const l of listeners) l(v);
}

/** Calls `l` with the latest value at once (if any) and on every later change. */
export function subscribeReadout(l: Listener): () => void {
  listeners.add(l);
  if (last) l(last);
  return () => listeners.delete(l);
}
