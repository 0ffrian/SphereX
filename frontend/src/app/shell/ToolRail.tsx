// Opening a tool. The tools' buttons are in the sky view's dock (SkyDock.tsx); the selected object's
// card and the build view's dock open tools through here too.
import { useAppStore } from '@/state/store';
import { useShellStore, type ToolId } from './shellStore';

/** Opens a tool (also from the selected object's card: "See fingerprint" is the spectrum). */
export function openTool(id: ToolId): void {
  useShellStore.getState().setTool(id);
  if (id === 'spectrum') {
    const sky = useAppStore.getState().sky;
    const hasFrames = sky.status === 'ready' && (sky.frames?.frames.length ?? 0) > 0;
    if (hasFrames && sky.spectrum.status === 'idle') void useAppStore.getState().skyLoadSpectrum();
  }
}
