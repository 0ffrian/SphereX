// Left tool rail (mock-up `.rail.left`): icon buttons that open real tools only. Sky is the sky
// view alone; Flipbook and Spectrum open the object panel at that section; 3D viewer opens the
// build pane (issue #60) with the current body already built. Area search (A18.1, issue #96) draws
// a square on the sky; it is behind AREA_TOOL_ENABLED. Haptics are not wired into the app until M5,
// so there is no Haptics tool.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { AREA_TOOL_HINT, AREA_TOOL_LABEL } from '@/app/messages';
import { AREA_TOOL_ENABLED, enterAreaTool } from '@/app/sky/area/areaTool';
import { useAppStore } from '@/state/store';
import { RailIcon } from './railIcons';
import { useShellStore, type ToolId } from './shellStore';

export const TOOLS: { id: ToolId; label: string; hint: string }[] = [
  { id: 'sky', label: 'Sky', hint: 'The sky view alone' },
  { id: 'flipbook', label: 'Flipbook', hint: 'SPHEREx frames of the object' },
  { id: 'spectrum', label: 'Spectrum', hint: 'Spectrum of the object' },
  { id: 'viewer', label: '3D viewer', hint: '3D view of a loaded body' },
  ...(AREA_TOOL_ENABLED
    ? [{ id: 'area' as const, label: AREA_TOOL_LABEL, hint: AREA_TOOL_HINT }]
    : []),
];

/** Opens a tool (also from the selected object's card: "See fingerprint" is the spectrum). */
export function openTool(id: ToolId): void {
  if (id === 'area') {
    if (AREA_TOOL_ENABLED) enterAreaTool();
    return;
  }
  useShellStore.getState().setTool(id);
  if (id === 'spectrum') {
    const sky = useAppStore.getState().sky;
    const hasFrames = sky.status === 'ready' && (sky.frames?.frames.length ?? 0) > 0;
    if (hasFrames && sky.spectrum.status === 'idle') void useAppStore.getState().skyLoadSpectrum();
  }
}

export function ToolRail() {
  const tool = useShellStore((s) => s.tool);
  const buildOpen = useShellStore((s) => s.build.open);
  const choose = openTool;
  const innerRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);

  // Mock-up `.hl` (animate-ui "highlight"): one pill that slides to the hovered tool, and back to
  // the active one. It is placed by the tool's own box, so the phone tab bar works too.
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
    <nav aria-label="Tools" className="sx-rail">
      <div
        className="sx-rail-inner"
        ref={innerRef}
        onPointerOver={(e) => moveHl((e.target as HTMLElement).closest<HTMLElement>('.sx-tool'))}
        onPointerLeave={() => moveHl(active())}
      >
        <div className="sx-hl" ref={hlRef} aria-hidden="true" />
        <ul className="m-0 flex list-none gap-1 p-0 sm:flex-col">
          {TOOLS.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="sx-tool"
                aria-pressed={t.id === 'viewer' ? buildOpen : tool === t.id && !buildOpen}
                aria-label={t.label}
                aria-description={t.hint}
                onClick={() => choose(t.id)}
                data-testid={`tool-${t.id}`}
              >
                <RailIcon id={t.id} />
                <span className="sx-tool-tip" aria-hidden="true">
                  {t.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <span className="sx-rail-label" aria-hidden="true">
        TOOLS
      </span>
    </nav>
  );
}
