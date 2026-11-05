// R9: one polite live region for flipbook and spectrum changes (found, frames loaded, paused at a
// frame, view mode, spectrum loaded). Frames are not announced while playing. Errors use their
// own role="alert" boxes instead.
import { useAppStore } from '@/state/store';

export function LiveAnnouncer() {
  const text = useAppStore((s) => s.sky.announcement);
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="announcer">
      {text}
    </div>
  );
}
