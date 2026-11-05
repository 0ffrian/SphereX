// Flipbook keyboard shortcuts (R9). Pure, so the rules are unit-tested:
// - Space or K play/pause, ←/→ step, Home/End first/last frame.
// - Ignored while focus is on a button or form field (they keep their own keys), and when Alt,
//   Ctrl or Meta is held (Alt+← is the browser's Back, Ctrl+K its search box).
// - Play/pause follows the Play button: no toggle while it is disabled (cutouts still loading).
//   Space/K are still consumed then (`block`), so Space does not scroll the page instead.

/** `block`: a flipbook key with nothing to do right now; prevent its default, do nothing else. */
export type FlipbookKeyAction = 'toggle' | 'block' | 'prev' | 'next' | 'first' | 'last';

export interface FlipbookKeyInput {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** Focus is on a button, input, select, textarea, link or summary. */
  onControl: boolean;
  /** The Play/Pause button is enabled. */
  canPlay: boolean;
}

export function flipbookKeyAction(e: FlipbookKeyInput): FlipbookKeyAction | null {
  if (e.onControl || e.altKey || e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case ' ':
    case 'k':
    case 'K':
      return e.canPlay ? 'toggle' : 'block';
    case 'ArrowLeft':
      return 'prev';
    case 'ArrowRight':
      return 'next';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}
