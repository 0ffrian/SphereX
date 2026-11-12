// The left rail's icons, in the mock-up's style (`.ai-draw`): one outline, every stroke a path of
// length 1, so that on hover the strokes draw themselves again (index.css `.sx-rail`). Sky is the
// mock-up's reticle and Spectrum its bars; Flipbook and 3D viewer are drawn the same way. The
// mock-up's Comet Breath, Haptics and Band-Hop Linker tools are not built, so they have no icon.
import type { ReactNode } from 'react';
import type { ToolId } from './shellStore';

const SHAPES: Record<ToolId | 'known', ReactNode> = {
  // mock-up `reticle`
  sky: (
    <>
      <circle pathLength="1" cx="12" cy="12" r="7" />
      <path pathLength="1" d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      <circle pathLength="1" cx="12" cy="12" r=".8" />
    </>
  ),
  flipbook: (
    <>
      <rect pathLength="1" x="3" y="5" width="18" height="14" rx="2.5" />
      <path pathLength="1" d="M3 9.5h18M8 5v4.5M16 5v4.5" />
      <path pathLength="1" d="M10.5 12.5l3.2 1.9-3.2 1.9z" />
    </>
  ),
  // mock-up `bars`
  spectrum: <path pathLength="1" d="M3 10v4M7 7v10M11 3v18M15 8v8M19 5v14" />,
  // mock-up `dots` (Discovery)
  area: (
    <>
      <circle pathLength="1" cx="6" cy="7" r="2.2" />
      <circle pathLength="1" cx="16" cy="6" r="2.2" />
      <circle pathLength="1" cx="10" cy="15" r="2.2" />
      <circle pathLength="1" cx="19" cy="17" r="2.2" />
    </>
  ),
  // mock-up `orbit` (Known objects)
  known: (
    <>
      <path pathLength="1" d="M20.341 6.484A10 10 0 0 1 10.266 21.85" />
      <path pathLength="1" d="M3.659 17.516A10 10 0 0 1 13.74 2.152" />
      <circle pathLength="1" cx="12" cy="12" r="3" />
      <circle pathLength="1" cx="19" cy="5" r="2" />
      <circle pathLength="1" cx="5" cy="19" r="2" />
    </>
  ),
  viewer: (
    <>
      <path pathLength="1" d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path pathLength="1" d="M12 12l8-4.5M12 12v9M12 12 4 7.5" />
    </>
  ),
};

export function RailIcon({ id }: { id: ToolId | 'known' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`sx-ico ai-draw size-5 sx-rail-ico-${id}`}
      aria-hidden="true"
    >
      {SHAPES[id]}
    </svg>
  );
}
