// Line icons for the shell (lucide shapes, as in the mock-up's Animate UI set). Decorative only:
// every button that uses one has its own accessible name.

const PATHS = {
  sky: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z',
  flipbook: 'M4 5h16v14H4z M4 9h16 M8 5v4 M16 5v4 M10 13l4 2-4 2z',
  spectrum: 'M2 12h2 M6 8v8 M10 4v16 M14 7v10 M18 10v4 M22 12h-2',
  viewer: 'M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z M12 12l8-4.5 M12 12v9 M12 12 4 7.5',
  close: 'M18 6 6 18M6 6l12 12',
  search: 'm21 21-4.34-4.34 M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z',
  prev: 'M19 5v14L8 12zM5 5v14',
  next: 'M5 5v14l11-7zM19 5v14',
  play: 'M6 3 20 12 6 21Z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  // Issue #60 build pane tools (mock-up `#bpFeel`, `#bpReplay`, `#bpSeed`).
  fingerprint:
    'M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4 M14 13.12c0 2.38 0 6.38-1 8.88 M17.29 21.02c.12-.6.43-2.3.5-3.02 M2 12a10 10 0 0 1 18-6 M2 16h.01 M21.8 16c.2-2 .131-5.354 0-6 M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2 M8.65 22c.21-.66.45-1.32.57-2 M9 6.8a6 6 0 0 1 9 5.2v2',
  replay: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5',
  shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  // Issue #71 stream U: the build view's header and zoom bar, the mock-up's shapes (`#bpAcc`,
  // `#bpHear`, `#zOut`, `#zIn`, the dock's area tool); `details` is lucide's sliders.
  accuracy: 'M3.3 17a10 10 0 1 1 17.4 0 M12 14l4-5 M12 12.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z',
  hear: 'M11 5 6 9H3v6h3l5 4z M15.5 8.5a5 5 0 0 1 0 7 M18.5 5.5a9 9 0 0 1 0 13',
  details: 'M21 4h-7 M10 4H3 M21 12h-9 M8 12H3 M21 20h-5 M12 20H3 M14 2v4 M8 10v4 M16 18v4',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M8 11h6 M21 21l-4.35-4.35',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M8 11h6 M11 8v6 M21 21l-4.35-4.35',
  area: 'M5.5 3.5h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z M9 8.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z M15 12.8a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z M10.4 11.1l3.2 2.3',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  const filled = name === 'play' || name === 'pause';
  return (
    <svg
      viewBox="0 0 24 24"
      className={`sx-ico ${className}`}
      aria-hidden="true"
      style={filled ? { fill: 'currentColor', stroke: 'none' } : undefined}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
