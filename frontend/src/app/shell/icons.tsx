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
