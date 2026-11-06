// Spectrum haptics, calibration and settings panel of the test page (issue #10). Synthetic spectra
// only. The R11 check ("≥ 3 quiet steps across a known absorption dip") on a phone: at 360 px the
// pad is about 296 px wide, so a narrow dip needs the zoomed λ range, while a broad band (the
// brown-dwarf-like CH₄ trough) is wide enough over the full band (Q-65). Dev only.
import { useEffect, useState } from 'react';
import type { SpectrumPoint } from '@/app/api/types';
import { buttonClass } from '@/app/ui';
import {
  applyStoredCalibration,
  clearCalibration,
  defaultCalibration,
  levelsToVibrate,
  loadCalibration,
  type Calibration,
} from '@/haptics/calibration';
import { CalibrationWizard } from '@/haptics/ui/CalibrationWizard';
import { HapticsSettings } from '@/haptics/ui/HapticsSettings';
import { SpectrumHapticsPad } from '@/haptics/ui/SpectrumHapticsPad';
import type { TestPanelProps } from '../panelProps';

type Variant = 'dip' | 'noisy' | 'brownDwarf';
type Zoom = 'full' | 'dip';

const ZOOM: Record<Zoom, readonly [number, number]> = {
  full: [0.75, 5],
  dip: [3.5, 5],
};

const selectClass = 'min-h-11 rounded-md border border-neutral-500 bg-neutral-900 px-2 text-base';

/**
 * Synthetic, 0.75–5 µm. `dip`: flat at 100 with a 90% Gaussian dip at 4.25 µm (σ 0.2 µm) and a
 * 50% one at 3 µm. `noisy`: the same with σ = 50% of the flux beyond 2 µm. `brownDwarf`: a deep,
 * broad CH₄ trough over 3.0–3.8 µm, as in a T/Y dwarf.
 */
function syntheticSpectrum(variant: Variant): SpectrumPoint[] {
  const sig = (x: number) => 1 / (1 + Math.exp(-x));
  const pts: SpectrumPoint[] = [];
  for (let i = 0; i <= 120; i++) {
    const wavelength_um = 0.75 + (4.25 * i) / 120;
    const dip = (c: number, s: number, depth: number) =>
      depth * Math.exp(-((wavelength_um - c) ** 2) / (2 * s * s));
    const flux =
      variant === 'brownDwarf'
        ? 100 * (1 - 0.95 * sig((wavelength_um - 2.95) / 0.05) * sig((3.85 - wavelength_um) / 0.05))
        : 100 * (1 - dip(4.25, 0.2, 0.9) - dip(3, 0.12, 0.5));
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
  brownDwarf: syntheticSpectrum('brownDwarf'),
};

/** What a calibration (or the defaults) sets on the drivers, as text. */
function describeLevels(cal: Calibration | null): string {
  const c = cal ?? defaultCalibration();
  const levels = levelsToVibrate(c)
    .map((l) => (typeof l === 'number' ? `${l} ms` : `[${l.join(', ')}]`))
    .join(', ');
  const delay =
    c.avOffsetMs > 0
      ? `sound waits ${c.avOffsetMs} ms`
      : c.avOffsetMs < 0
        ? `vibration waits ${-c.avOffsetMs} ms`
        : 'no delay';
  return `Vibrate levels: ${levels}; ${delay}.`;
}

export function SpectrumPanel({ haptics }: TestPanelProps) {
  const [variant, setVariant] = useState<Variant>('dip');
  const [zoom, setZoom] = useState<Zoom>('full');
  const [seed, setSeed] = useState(0);
  const [calibrating, setCalibrating] = useState(false);
  const [saved, setSaved] = useState<Calibration | null>(loadCalibration);

  // Apply this device's calibration (or the defaults) to the drivers.
  useEffect(() => {
    applyStoredCalibration(haptics);
  }, [haptics]);

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
            className={selectClass}
            value={variant}
            onChange={(e) => setVariant(e.target.value as Variant)}
          >
            <option value="dip">Absorption dips at 3 and 4.25 µm</option>
            <option value="noisy">Same, noisy beyond 2 µm (jittered spacing)</option>
            <option value="brownDwarf">Brown dwarf: broad CH₄ trough at 3.0–3.8 µm</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Wavelength range of the pad
          <select
            className={selectClass}
            value={zoom}
            onChange={(e) => setZoom(e.target.value as Zoom)}
          >
            <option value="full">Full band, 0.75–5 µm</option>
            <option value="dip">Zoomed on the 4.25 µm dip, 3.5–5 µm</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Jitter seed
          <input
            type="number"
            className={`${selectClass} w-28`}
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
          />
        </label>
      </div>
      <p className="text-sm text-neutral-400">
        R11 check on a phone: drag across the dip and count the quiet steps (at least 3). On a
        narrow screen, use the zoomed range for the 4.25 µm dip (Q-65).
      </p>

      <SpectrumHapticsPad
        haptics={haptics}
        spectrum={{ spectrum: SPECTRA[variant], tag: 'measured' }}
        objectName={`the synthetic spectrum (${variant})`}
        lambdaDomain={ZOOM[zoom]}
        seed={seed}
      />

      <h3 className="font-semibold">Calibration</h3>
      <p className="text-sm text-neutral-300">
        {saved
          ? `In force: faintest ${saved.minMs} ms, ${saved.levels.length} levels, offset ${saved.avOffsetMs} ms.`
          : 'Nothing saved on this device: the R8.3 defaults apply.'}{' '}
        {describeLevels(saved)}
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
