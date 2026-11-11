// The sky view's bottom-centre dock (mock-up `.dock`): the tools (Sky, Flipbook, Spectrum, 3D viewer)
// with a highlight that slides to the one under the pointer and a small green pip on the active one,
// a divider, then the search, a button that opens into the search field when it takes focus.
// It replaces the left tool rail. Area search is not built, so it has no button here (the build
// view's dock shows it disabled). Haptics are dropped, so there is no Feel tool.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { SearchBar } from '@/app/search/SearchBar';
import { RailIcon } from './railIcons';
import { openTool } from './ToolRail';
import { useShellStore, type ToolId } from './shellStore';

const TOOLS: { id: ToolId; label: string; hint: string }[] = [
  { id: 'sky', label: 'Sky', hint: 'The sky view alone' },
  { id: 'flipbook', label: 'Flipbook', hint: 'SPHEREx frames of the object' },
  { id: 'spectrum', label: 'Spectrum', hint: 'Spectrum of the object' },
  { id: 'viewer', label: '3D viewer', hint: '3D view of a loaded body' },
];

export function SkyDock() {
  const tool = useShellStore((s) => s.tool);
  const buildOpen = useShellStore((s) => s.build.open);
  const innerRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);

  // Mock-up `.hl`: one highlight that slides to the hovered tool, and back to the active one. It is
  // placed by the tool's own box, so the phone tab bar works too.
  const moveHl = (btn: HTMLElement | null) => {
    const hl = hlRef.current;
    if (!hl) return;
    if (!btn) {
      hl.style.opacity = '0';
      return;
    }
    hl.style.opacity = '1';
    hl.style.width = `${btn.offsetWidth}px`;
    hl.style.height = `${btn.offsetHeight}px`;
    hl.style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`;
  };
  const active = () =>
    innerRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? null;
  useLayoutEffect(() => moveHl(active()), [tool, buildOpen]);
  useEffect(() => {
    const on = () => moveHl(active());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  return (
    <div className="sx-fl sx-dock sx-sdock" data-testid="sky-dock">
      <nav aria-label="Tools" className="sx-sdock-tools">
        <div
          className="sx-sdock-inner"
          ref={innerRef}
          onPointerOver={(e) => moveHl((e.target as HTMLElement).closest<HTMLElement>('.sx-dtool'))}
          onPointerLeave={() => moveHl(active())}
        >
          <div className="sx-hl" ref={hlRef} aria-hidden="true" />
          <ul className="m-0 flex list-none gap-1 p-0">
            {TOOLS.map((t) => {
              const pressed = t.id === 'viewer' ? buildOpen : tool === t.id && !buildOpen;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    className="sx-dtool sx-sdock-tool"
                    aria-pressed={pressed}
                    data-active={pressed}
                    aria-label={t.label}
                    aria-description={t.hint}
                    onClick={() => openTool(t.id)}
                    data-testid={`tool-${t.id}`}
                  >
                    <RailIcon id={t.id} />
                    <span className="sx-tool-tip" aria-hidden="true">
                      {t.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
      <i className="sx-vsep" aria-hidden="true" />
      <div className="sx-search-slot">
        <SearchBar />
      </div>
    </div>
  );
}
