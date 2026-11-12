// Issue #60: where focus goes when the selection card or the build pane closes. A plain module (no
// component), so the hash hook and the components can both use it.
import { useAppStore } from '@/state/store';
import { useShellStore } from '@/app/shell/shellStore';

/** Focuses the selected object's marker (after the card or the pane closes); else the sky canvas. */
export function focusSelectedMarker(id: string | null): void {
  requestAnimationFrame(() => {
    const sel = id
      ? document.querySelector<HTMLElement>(
          `[data-testid="sky-marker"][data-target-id="${CSS.escape(id)}"], ` +
            `[data-testid="sky-cached-marker"][data-object-id="${CSS.escape(id)}"]`,
        )
      : null;
    (sel ?? document.querySelector<HTMLElement>('[data-testid="sky-canvas"]'))?.focus();
  });
}

/**
 * Puts focus back where the user came from after the build pane closes: the selected object's
 * marker, or the 3D viewer button if one exists, else the sky, when the pane was opened from the
 * rail (or there is no object). Used by x, Escape and Back alike.
 */
export function focusAfterBuildClose(tool: string): void {
  const sky = useAppStore.getState().sky;
  if (tool === 'viewer' || !sky.resolved) {
    // The dock has no 3D viewer button any more: focus returns to the sky.
    requestAnimationFrame(() =>
      (
        document.querySelector<HTMLElement>('[data-testid="tool-viewer"]') ??
        document.querySelector<HTMLElement>('[data-testid="sky-canvas"]')
      )?.focus(),
    );
  } else focusSelectedMarker(sky.resolved.id);
}

/** Closes the build pane (x, Escape and the dock's Sky button; the hash follows, see useHashSync) and returns focus. */
export function closeBuildPane(): void {
  const { tool } = useShellStore.getState();
  useShellStore.getState().closeBuild();
  focusAfterBuildClose(tool);
}
