// The sky view's motion feed: SkyPane calls publishMotion() whenever the camera (centre or field of
// view) changes, at most once per animation frame. The island listens and shows a short "Updating"
// pill while the view moves (Moon, 11 Nov 2026: a presentation cue, not a data load).

type Listener = () => void;
const listeners = new Set<Listener>();

export function publishMotion(): void {
  for (const l of listeners) l();
}

export function subscribeMotion(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
