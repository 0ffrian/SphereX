// Placeholder: issue #10 replaces this file with the spectrum haptics, calibration and settings
// panel (synthetic spectrum with a dip). Only #10 edits it.
import type { TestPanelProps } from '../panelProps';

export function SpectrumPanel({ haptics }: TestPanelProps) {
  return (
    <section aria-labelledby="spectrum-panel" className="rounded-md border border-neutral-700 p-4">
      <h2 id="spectrum-panel" className="text-lg font-semibold">
        Spectrum haptics
      </h2>
      <p className="text-neutral-400">
        Not built yet (issue #10). Engine has {haptics.engine.activeDrivers.length} active drivers.
      </p>
    </section>
  );
}
