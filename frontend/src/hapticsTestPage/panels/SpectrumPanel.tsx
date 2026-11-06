// Spectrum haptics, calibration and settings panel of the test page (issue #10). Synthetic spectra
// only: a flat continuum with a deep absorption dip at 4.25 µm (R11: ≥ 3 quiet steps), and a
// noisy variant whose large σ makes the tick spacing jitter (R8.3). Dev only.
import { useState } from 'react';
import type { SpectrumPoint } from '@/app/api/types';
import { buttonClass } from '@/app/ui';
import { applyStoredCalibration, clearCalibration, type Calibration } from '@/haptics/calibration';
import { CalibrationWizard } from '@/haptics/ui/CalibrationWizard';
import { HapticsSettings } from '@/haptics/ui/HapticsSettings';
import { SpectrumHapticsPad } from '@/haptics/ui/SpectrumHapticsPad';
import type { TestPanelProps } from '../panelProps';

type Variant = 'dip' | 'noisy';

/** Synthetic: 0.75–5 µm, flat at 100, a 90% Gaussian dip at 4.25 µm (σ 0.2 µm), plus a weaker
 * one at 3 µm. `noisy` gives every point beyond 2 µm σ = 50% of its flux. */
function syntheticSpectrum(variant: Variant): SpectrumPoint[] {
  const pts: SpectrumPoint[] = [];
  for (let i = 0; i <= 120; i++) {
    const wavelength_um = 0.75 + (4.25 * i) / 120;
    const dip = (c: number, s: number, depth: number) =>
      depth * Math.exp(-((wavelength_um - c) ** 2) / (2 * s * s));
    const flux = 100 * (1 - dip(4.25, 0.2, 0.9) - dip(3, 0.12, 0.5));
    const noisy = variant === 'noisy' && wavelength_um > 2;
    pts.push({
      wavelength_um,
      flux,
      error: noisy ? flux * 0.5 : 2,
      flagged: false,
      frame_id: `synthetic-${i}`,
    });
  }
  return pts;
}

const SPECTRA: Record<Variant, SpectrumPoint[]> = {
  dip: syntheticSpectrum('dip'),
  noisy: syntheticSpectrum('noisy'),
};

function describeLevels({ haptics }: TestPanelProps): string {
  const levels = haptics.vibrate.levels
    .map((l) => (typeof l === 'number' ? `${l} ms` : `[${l.join(', ')}]`))
    .join(', ');
  return (
    `Vibrate levels: ${levels}. Vibration delay ${haptics.vibrate.delayMs} ms; ` +
    `audio delay ${haptics.audio.offsetMs} ms.`
  );
}

export function SpectrumPanel({ haptics }: TestPanelProps) {
  const [variant, setVariant] = useState<Variant>('dip');
  const [seed, setSeed] = useState(0);
  const [calibrating, setCalibrating] = useState(false);
  // Apply this device's calibration (or the defaults) to the drivers on first render; idempotent.
  const [saved, setSaved] = useState<Calibration | null>(() => applyStoredCalibration(haptics));

  return (
    <section
      aria-labelledby="spectrum-panel"
      className="flex flex-col gap-4 rounded-md border border-neutral-700 p-4"
    >
      <h2 id="spectrum-panel" className="text-lg font-semibold">
        Spectrum haptics
      </h2>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          Synthetic spectrum
          <select
            className="min-h-11 rounded-md border border-neutral-500 bg-neutral-900 px-2 text-base"
            value={variant}
            onChange={(e) => setVariant(e.target.value as Variant)}
          >
            <option value="dip">Absorption dips at 3 and 4.25 µm</option>
            <option value="noisy">Same, noisy beyond 2 µm (jittered spacing)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Jitter seed
          <input
            type="number"
            className="min-h-11 w-28 rounded-md border border-neutral-500 bg-neutral-900 px-2 text-base"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
          />
        </label>
      </div>

      <SpectrumHapticsPad
        haptics={haptics}
        spectrum={{ spectrum: SPECTRA[variant], tag: 'measured' }}
        objectName={`the synthetic spectrum (${variant})`}
        seed={seed}
      />

      <h3 className="font-semibold">Calibration</h3>
      <p className="text-sm text-neutral-300">
        {saved
          ? `Saved: faintest ${saved.minMs} ms, ${saved.levels.length} levels, offset ${saved.avOffsetMs} ms.`
          : 'Nothing saved on this device: the R8.3 defaults apply.'}{' '}
        {describeLevels({ haptics })}
      </p>
      {calibrating ? (
        <div className="rounded-md border border-neutral-700 p-3">
          <CalibrationWizard
            haptics={haptics}
            onDone={(cal) => setSaved(cal)}
            onCancel={() => setCalibrating(false)}
          />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              clearCalibration();
              applyStoredCalibration(haptics);
              setSaved(null);
            }}
          >
            Clear the saved calibration
          </button>
        </div>
      )}

      <HapticsSettings
        canVibrate={haptics.vibrate.supported}
        onCalibrate={() => setCalibrating(true)}
      />
    </section>
  );
}
