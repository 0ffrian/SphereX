// Left tool rail (mock-up `.rail.left`): icon buttons that open real tools only. Sky is the sky
// view alone; Flipbook and Spectrum open the object panel at that section; 3D viewer opens the
// existing ViewerPanel. Haptics are not wired into the app until M5, so there is no Haptics tool.
import { useAppStore } from '@/state/store';
import { Icon, type IconName } from './icons';
import { useShellStore, type ToolId } from './shellStore';

const TOOLS: { id: ToolId; label: string; icon: IconName; hint: string }[] = [
  { id: 'sky', label: 'Sky', icon: 'sky', hint: 'The sky view alone' },
  { id: 'flipbook', label: 'Flipbook', icon: 'flipbook', hint: 'SPHEREx frames of the object' },
  { id: 'spectrum', label: 'Spectrum', icon: 'spectrum', hint: 'Spectrum of the object' },
  { id: 'viewer', label: '3D viewer', icon: 'viewer', hint: '3D view of a loaded body' },
];

export function ToolRail() {
  const tool = useShellStore((s) => s.tool);
  const setTool = useShellStore((s) => s.setTool);
  const loadSpectrum = useAppStore((s) => s.skyLoadSpectrum);

  const choose = (id: ToolId) => {
    setTool(id);
    if (id === 'spectrum') {
      const sky = useAppStore.getState().sky;
      const hasFrames = sky.status === 'ready' && (sky.frames?.frames.length ?? 0) > 0;
      if (hasFrames && sky.spectrum.status === 'idle') void loadSpectrum();
    }
  };

  return (
    <nav aria-label="Tools" className="sx-rail">
      <ul className="m-0 flex list-none gap-1 p-0 sm:flex-col">
        {TOOLS.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className="sx-tool"
              aria-pressed={tool === t.id}
              aria-label={t.label}
              aria-description={t.hint}
              onClick={() => choose(t.id)}
              data-testid={`tool-${t.id}`}
            >
              <Icon name={t.icon} />
              <span className="sx-tool-tip" aria-hidden="true">
                {t.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <span className="sx-rail-label" aria-hidden="true">
        TOOLS
      </span>
    </nav>
  );
}
