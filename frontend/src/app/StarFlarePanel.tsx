// Issue #71 stream G: the star's flare controls. "Field lines" toggle, "Fire a big flare", the
// "Latest flare" card in plain words. The close-up is `StarCloseUp`, mounted by the split-pane host. The card is a
// polite live region and only changes when a new flare starts (at most once per 1.4 s).
import { useEffect, useState } from 'react';
import type { ViewerApp } from '@/viewer/ViewerApp';
import { buttonClass, pressedClass } from './ui';
import { ProvenanceBadge } from './Badge';

export function StarFlarePanel({
  viewer,
  paused,
  fixture,
}: {
  viewer: ViewerApp | null;
  /** Reduced motion or a user pause: the card is read once, not polled. */
  paused: boolean;
  fixture?: boolean;
}) {
  const [lines, setLines] = useState(true);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const read = () => setText(viewer.latestFlareText());
    read();
    if (paused) return;
    const id = window.setInterval(read, 700);
    return () => window.clearInterval(id);
  }, [viewer, paused]);

  return (
    <div className="flex flex-col gap-2" data-testid="star-flares">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`${buttonClass} ${pressedClass}`}
          aria-pressed={lines}
          onClick={() => {
            const next = !lines;
            setLines(next);
            viewer?.setFieldLines(next);
          }}
        >
          Field lines
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            viewer?.fireFlare();
            setText(viewer?.latestFlareText() ?? null);
          }}
        >
          Fire a big flare
        </button>
      </div>
      <p className="text-sm text-neutral-200" data-testid="latest-flare" aria-live="polite">
        <span className="font-medium text-neutral-100">Latest flare: </span>
        {text ?? 'None yet. A flare starts at a spot group on a seeded schedule.'}{' '}
        <ProvenanceBadge tag="inferred_from_analog" fixture={fixture} />
      </p>
    </div>
  );
}
