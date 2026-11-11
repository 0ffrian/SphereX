// The sky view's bottom-centre dock (mock-up `.dock`): Known objects and Discovery (the mock-up's
// two area tools; each starts a square on the sky and the highlight follows the one that did)
// with a highlight that slides to the one under the pointer and a small green pip on the active one,
// a divider, then the search, a button that opens into the search field when it takes focus.
// Flipbook, Spectrum and the 3D viewer are not dock buttons: the flipbook opens with a search or a
// click on the sky, and the object panel and the selected object's card hold Spectrum and Build it.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { SearchBar } from '@/app/search/SearchBar';
import { RailIcon } from './railIcons';
import { openTool } from './ToolRail';
import { useAreaStore } from './areaStore';
import { useShellStore } from './shellStore';
import type { AreaFlow } from '@/app/area/areaService';

const TOOLS: { id: 'known' | 'area'; flow: AreaFlow; label: string; hint: string }[] = [
  {
    id: 'known',
    flow: 'known',
    label: 'Known objects',
    hint: 'Draw a square on the sky and follow the asteroids and comets on file in it',
  },
  {
    id: 'area',
    flow: 'discovery',
    label: 'Discovery',
    hint: 'Draw a square on the sky and look for dots that move and match nothing on file',
  },
];

export function SkyDock() {
  const tool = useShellStore((s) => s.tool);
  const flow = useAreaStore((s) => s.flow);
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
  useLayoutEffect(() => moveHl(active()), [tool, flow, buildOpen]);
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
              const pressed = tool === 'area' && flow === t.flow && !buildOpen;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    className="sx-dtool sx-sdock-tool"
                    aria-pressed={pressed}
                    data-active={pressed}
                    aria-label={t.label}
                    aria-description={t.hint}
                    onClick={() => {
                      useAreaStore.getState().startFlow(t.flow);
                      openTool('area');
                    }}
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
