// Issue #71 stream U (Q-294): the two floating panels of the mock-up's build view that sit at the
// bottom of the screen: the zoom bar (bottom left, `.zoom`: minus, the zoom, plus), and beside it
// "Read paper" (Q-457). The mock-up's tool dock is not drawn in the build view (Moon, 13 Nov 2026,
// Q-457). Drawn only while the build is open, on a desktop width (a phone keeps the tab bar).
//   zoom bar   -> the 3D view (ViewerApp.zoom / resetView; the value is its own zoom, 100% = as opened)
//   Read paper -> the paper on how the bodies are generated (PROCEDURAL_PAPER_URL)
import { useEffect, useState } from 'react';
import { Icon } from '@/app/shell/icons';
import { useViewControls } from '@/app/engineView';

/** "150%": the view's zoom against the view the body opened with. */
export function zoomPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function ZoomBar() {
  const vc = useViewControls();
  const [ratio, setRatio] = useState(1);
  // The view also zooms with the wheel and a pinch, so the value is read, not counted.
  useEffect(() => {
    const read = () => setRatio(vc.ratio());
    read();
    const id = window.setInterval(read, 250);
    return () => window.clearInterval(id);
  }, [vc]);
  const step = (dir: 'in' | 'out') => {
    vc.zoom(dir);
    setRatio(vc.ratio());
  };
  // A control the drawing view cannot do is disabled and says why in its name.
  const named = (label: string, off: string | null) =>
    off ? `${label}. Not available: ${off}` : label;
  return (
    <div
      className="sx-fl sx-zoom"
      role="group"
      aria-label="Zoom the 3D view"
      data-testid="build-zoom"
    >
      <button
        type="button"
        className="sx-btn-i"
        aria-label={named('Zoom out', vc.zoomOff)}
        title={vc.zoomOff ?? 'Zoom out'}
        disabled={vc.zoomOff !== null}
        onClick={() => step('out')}
      >
        <Icon name="zoomOut" className="size-4" />
      </button>
      <button
        type="button"
        className="sx-zval"
        aria-label={
          vc.resetOff
            ? named('Reset the zoom', vc.resetOff)
            : `Reset the zoom. Now ${zoomPercent(ratio)}`
        }
        title={vc.resetOff ?? 'Reset zoom'}
        disabled={vc.resetOff !== null}
        onClick={() => {
          vc.reset();
          setRatio(vc.ratio());
        }}
        data-testid="build-zoom-value"
      >
        {zoomPercent(ratio)}
      </button>
      <button
        type="button"
        className="sx-btn-i"
        aria-label={named('Zoom in', vc.zoomOff)}
        title={vc.zoomOff ?? 'Zoom in'}
        disabled={vc.zoomOff !== null}
        onClick={() => step('in')}
      >
        <Icon name="zoomIn" className="size-4" />
      </button>
    </div>
  );
}

/**
 * The paper on how the generated bodies are made (Moon, 13 Nov 2026, Q-457). The team is still
 * The published paper (Google Drive). Set it to null to bring back the "still being written" note.
 */
export const PROCEDURAL_PAPER_URL: string | null =
  'https://drive.google.com/file/d/17-vdnUqvNrglVh3bVlsuxJ6PKWRMTTpe/view?usp=drive_link';
export const PAPER_PENDING = 'The paper is still being written.';

/** Beside the zoom card: a paper icon that opens out to "Read paper" on hover or focus. */
export function ReadPaper({ url = PROCEDURAL_PAPER_URL }: { url?: string | null }) {
  // Before the paper exists a press says why (a touch screen has no hover and shows no tooltip).
  const [note, setNote] = useState(false);
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(false), 4000);
    return () => window.clearTimeout(id);
  }, [note]);
  const inner = (
    <>
      <Icon name="paper" className="size-[18px] flex-none" />
      <span className="sx-paper-label">Read paper</span>
    </>
  );
  return url ? (
    <a
      className="sx-fl sx-paper"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Read paper: how the bodies are generated (opens in a new tab)"
      data-testid="build-paper"
    >
      {inner}
    </a>
  ) : (
    <>
      <button
        type="button"
        className="sx-fl sx-paper"
        aria-disabled="true"
        aria-label={`Read paper. ${PAPER_PENDING}`}
        title={PAPER_PENDING}
        onClick={() => setNote(true)}
        data-testid="build-paper"
      >
        {inner}
      </button>
      {note && (
        <p className="sx-paper-note" role="status" data-testid="build-paper-note">
          {PAPER_PENDING}
        </p>
      )}
    </>
  );
}
