// Placeholder: issue #11 replaces this file with the texture "feel pad" per body type and the
// Listen sweep. Only #11 edits it.
import type { TestPanelProps } from '../panelProps';

export function TexturePanel({ haptics }: TestPanelProps) {
  return (
    <section aria-labelledby="texture-panel" className="rounded-md border border-neutral-700 p-4">
      <h2 id="texture-panel" className="text-lg font-semibold">
        Texture haptics and sound
      </h2>
      <p className="text-neutral-400">
        Not built yet (issue #11). Engine has {haptics.engine.activeDrivers.length} active drivers.
      </p>
    </section>
  );
}
