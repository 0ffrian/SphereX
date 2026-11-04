// R4 level 3 (Sky Sculptor) panel: mounts the ViewerApp canvas and the on-screen controls
// (R5.6, WCAG 2.5.7 alternative to dragging). Placeholder until RenderParams loading exists.
import { useEffect, useRef, useState } from 'react';
import { ViewerApp, type RotateDirection } from '@/viewer/ViewerApp';
import { useAppStore } from '@/state/store';

const PLACEHOLDER_LABEL = 'Viewer placeholder: no object loaded';

const ROTATE_BUTTONS: { dir: RotateDirection; label: string; glyph: string }[] = [
  { dir: 'left', label: 'Rotate left', glyph: '←' },
  { dir: 'up', label: 'Rotate up', glyph: '↑' },
  { dir: 'down', label: 'Rotate down', glyph: '↓' },
  { dir: 'right', label: 'Rotate right', glyph: '→' },
];

// Border neutral-500 on neutral-950 is about 4:1, so the button edge passes WCAG 1.4.11 (3:1).
// touch-manipulation stops double-tap zoom when a phone user taps a rotate button quickly.
const buttonClass =
  'min-h-11 min-w-11 touch-manipulation rounded-md border border-neutral-500 bg-neutral-900 ' +
  'px-3 text-base text-neutral-100 enabled:hover:bg-neutral-800 focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed ' +
  'disabled:opacity-40';

export function ViewerPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<ViewerApp | null>(null);
  const setRendererStatus = useAppStore((s) => s.setRendererStatus);
  const rendererStatus = useAppStore((s) => s.rendererStatus);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // The canvas is created per mount, so a StrictMode re-mount never shares a GPU context
    // with a renderer that is still being disposed.
    const canvas = document.createElement('canvas');
    // The canvas takes keyboard focus (arrows, +/−, R), so it needs a visible focus ring. The
    // negative offset keeps the ring inside the rounded, overflow-hidden frame.
    canvas.className =
      'block h-full w-full touch-none focus-visible:outline-2 focus-visible:-outline-offset-4 ' +
      'focus-visible:outline-sky-400';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      `${PLACEHOLDER_LABEL}. 3D view: drag or use the arrow keys to rotate, plus and minus to zoom, R to reset.`,
    );
    host.appendChild(canvas);

    let cancelled = false;
    let app: ViewerApp | null = null;
    setRendererStatus('starting');

    ViewerApp.create(canvas).then(
      (created) => {
        if (cancelled) {
          created.dispose();
          return;
        }
        app = created;
        canvas.dataset.backend = created.backend;
        console.info(`[viewer] three r187 WebGPURenderer backend: ${created.backend}`);
        setRendererStatus(created.backend);
        setViewer(created);
      },
      (err: unknown) => {
        if (cancelled) return;
        canvas.dataset.backend = 'unavailable';
        console.warn('[viewer] no WebGPU or WebGL2 backend available', err);
        setRendererStatus('unavailable');
      },
    );

    return () => {
      cancelled = true;
      app?.dispose();
      app = null;
      setViewer(null);
      canvas.remove();
    };
  }, [setRendererStatus]);

  const disabled = viewer === null;

  return (
    <section aria-labelledby="viewer-heading" className="flex flex-col gap-3">
      <h2 id="viewer-heading" className="text-lg font-medium">
        3D view
      </h2>
      <div className="relative aspect-square w-full max-w-xl overflow-hidden rounded-lg border border-neutral-800 bg-black sm:aspect-[4/3]">
        <div ref={hostRef} className="absolute inset-0" />
        <p className="pointer-events-none absolute left-3 top-3 rounded bg-neutral-900/80 px-2 py-1 text-xs text-neutral-300">
          {PLACEHOLDER_LABEL}
        </p>
        {rendererStatus === 'unavailable' && (
          // Not a live region: the status line already announces this change.
          <p className="absolute inset-x-3 bottom-3 rounded bg-neutral-900/90 px-3 py-2 text-sm text-neutral-100">
            The 3D view can&rsquo;t start in this browser. Try the latest Chrome, Edge or Firefox,
            and check that hardware acceleration is turned on.
          </p>
        )}
      </div>
      <div role="group" aria-label="View controls" className="flex flex-wrap gap-2">
        {ROTATE_BUTTONS.map(({ dir, label, glyph }) => (
          <button
            key={dir}
            type="button"
            className={buttonClass}
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={() => viewer?.rotate(dir)}
          >
            <span aria-hidden="true">{glyph}</span>
          </button>
        ))}
        <button
          type="button"
          className={buttonClass}
          aria-label="Zoom in"
          title="Zoom in"
          disabled={disabled}
          onClick={() => viewer?.zoom('in')}
        >
          <span aria-hidden="true">+</span>
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label="Zoom out"
          title="Zoom out"
          disabled={disabled}
          onClick={() => viewer?.zoom('out')}
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={disabled}
          onClick={() => viewer?.resetView()}
        >
          Reset view
        </button>
      </div>
    </section>
  );
}
