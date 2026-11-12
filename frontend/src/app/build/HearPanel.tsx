// "Hear it" panel of the build pane (approved design, panels-preview.html). Two sounds:
//   Atmosphere: the wind you would hear on the surface (artistic, shown as "Default"), from the card's measured
//     surface pressure and temperature and the dominant gas (hearModel.atmosphereOf). Refused when an input is missing.
//   Spectrum: the object's own SPHEREx spectrum played as pitch (measured), 0.75 to 5 um over about 9 s.
// One sound at a time. Leaving the tab, closing the panel or changing object stops it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/state/store';
import { displayName } from '@/app/displayName';
import { SwitchRow, ToggleGroup } from '@/app/PanelControls';
import { useAmbienceStore, type WindMode } from '@/app/sound/ambienceStore';
import {
  atmosphereOf,
  formatPressure,
  L0_UM,
  L1_UM,
  lamAt,
  NO_SPECTRUM_LINE,
  reachFraction,
  reachText,
  spectrumCurve,
  SPEC_POINTS,
} from './hearModel';
import { readWave, startSpectrum, waveSize, type SpectrumHandle } from './hearAudio';

type Mode = 'atmo' | 'spec';
type Playing = Mode | null;
type Wind = WindMode;

const MODE_OPTIONS = [
  { value: 'atmo', label: 'Atmosphere', testId: 'hear-mode-atmo' },
  { value: 'spec', label: 'Spectrum', testId: 'hear-mode-spec' },
] as const;
const WIND_OPTIONS = [
  { value: 'calm', label: 'Calm' },
  { value: 'breezy', label: 'Breezy' },
  { value: 'storm', label: 'Storm' },
] as const;

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Keep the CSS height, set the backing store to width x devicePixelRatio. Returns the ratio, or 0 when not shown. */
function fit(cv: HTMLCanvasElement, cssHeight: number): number {
  const r = cv.getBoundingClientRect();
  const d = window.devicePixelRatio || 1;
  const W = Math.round(r.width * d);
  const H = Math.round(cssHeight * d);
  if (W <= 0) return 0;
  if (cv.width !== W || cv.height !== H) {
    cv.width = W;
    cv.height = H;
  }
  return d;
}

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={playing ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M7 4v16l13-8z'} />
    </svg>
  );
}

function drawScope(
  cv: HTMLCanvasElement | null,
  cssHeight: number,
  active: boolean,
  gain: number,
  buf: Float32Array<ArrayBuffer> | null,
): void {
  if (!cv) return;
  const d = fit(cv, cssHeight);
  if (!d) return;
  const c = cv.getContext('2d');
  if (!c) return;
  const W = cv.width;
  const H = cv.height;
  c.clearRect(0, 0, W, H);
  if (active) {
    c.strokeStyle = css('--line');
    c.lineWidth = d;
    c.beginPath();
    c.moveTo(0, H / 2);
    c.lineTo(W, H / 2);
    c.stroke();
  }
  if (!active || !buf || !readWave(buf)) {
    c.fillStyle = css('--muted');
    c.font = `${12 * d}px Inter, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('Waveform shows while it plays', W / 2, H / 2);
    c.textBaseline = 'alphabetic';
    return;
  }
  c.strokeStyle = css('--wave');
  c.lineWidth = 1.4 * d;
  c.beginPath();
  const n = buf.length;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * W;
    const y = H / 2 - buf[i]! * gain * (H / 2);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
}

const SPEC_H = 150;
const SPEC_SCOPE_H = 44;
const ATMO_H = 110;

export function HearPanel({ active, name }: { active: boolean; name: string | undefined }) {
  const card = useAppStore((s) => s.card);
  const spectrum = useAppStore((s) => s.sky.spectrum);
  const resolved = useAppStore((s) => s.sky.resolved);

  const atmo = useMemo(() => atmosphereOf(card), [card]);
  const points = spectrum.status === 'ready' ? (spectrum.data?.spectrum ?? null) : null;
  const curve = useMemo(() => spectrumCurve(points), [points]);

  // The spectrum is asked for when the panel is first opened (the sky session loads it the same way).
  useEffect(() => {
    if (!active || !resolved) return;
    if (spectrum.status === 'idle') void useAppStore.getState().skyLoadSpectrum({ quiet: true });
  }, [active, resolved, spectrum.status]);

  const objectKey = card?.id ?? '';
  const defaultMode: Mode = atmo.ok ? 'atmo' : 'spec';
  const [chosen, setChosen] = useState<{ key: string; mode: Mode } | null>(null);
  const mode: Mode = chosen && chosen.key === objectKey ? chosen.mode : defaultMode;
  const [specPlaying, setSpecPlaying] = useState(false);
  const ambPlaying = useAmbienceStore((s) => s.playing && s.key === objectKey);
  const ambience = useAmbienceStore((s) => s.ambience && s.key === objectKey);
  const local = useAmbienceStore((s) => (s.key === objectKey ? s.local : null));
  const wind = useAmbienceStore((s) => s.wind);
  const playing: Playing = ambPlaying ? 'atmo' : specPlaying ? 'spec' : null;
  const [pos, setPos] = useState(0);

  const atmoCv = useRef<HTMLCanvasElement>(null);
  const specCv = useRef<HTMLCanvasElement>(null);
  const scopeCv = useRef<HTMLCanvasElement>(null);
  const specH = useRef<SpectrumHandle | null>(null);
  const posRef = useRef(0);
  const bufRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const raf = useRef(0);
  const touched = useRef(false); // the spectrum playhead shows once it has been played or scrubbed

  /** Stops the spectrum sound only (no state): what the effects below call. */
  const stopSpecSound = useCallback(() => {
    specH.current?.stop();
    specH.current = null;
  }, []);
  const stopSpec = useCallback(() => {
    stopSpecSound();
    setSpecPlaying(false);
  }, [stopSpecSound]);
  // Another object, or the panel closed: the state is reset while rendering (not in an effect); the
  // effects below stop the sound itself.
  const [seenKey, setSeenKey] = useState(objectKey);
  if (seenKey !== objectKey) {
    setSeenKey(objectKey);
    setSpecPlaying(false);
    setPos(0);
  }
  if (!active && specPlaying) setSpecPlaying(false);
  /** Stops every sound, ambience included. */
  const stopAll = useCallback(() => {
    stopSpec();
    useAmbienceStore.getState().stop();
  }, [stopSpec]);

  // Closing the panel stops what it started, but not the ambience the user asked to keep.
  useEffect(() => {
    if (active) return;
    stopSpecSound();
    if (!useAmbienceStore.getState().ambience) useAmbienceStore.getState().stop();
  }, [active, stopSpecSound]);
  // Another object: stop everything and start the new object from the beginning.
  useEffect(() => {
    stopSpecSound();
    if (useAmbienceStore.getState().key !== objectKey) useAmbienceStore.getState().stop();
    posRef.current = 0;
    touched.current = false;
  }, [objectKey, stopSpecSound]);
  // The build pane closing unmounts the panel: nothing keeps playing.
  useEffect(() => stopAll, [stopAll]);

  const ensureBuf = () => {
    const n = waveSize();
    if (!bufRef.current || bufRef.current.length !== n) bufRef.current = new Float32Array(n);
    return bufRef.current;
  };

  const drawSpec = useCallback(
    (p: number) => {
      const cv = specCv.current;
      if (!cv || !curve) return;
      const d = fit(cv, SPEC_H);
      if (!d) return;
      const c = cv.getContext('2d');
      if (!c) return;
      const W = cv.width;
      const H = cv.height;
      const top = 40 * d;
      const base = H - 18 * d;
      const N = SPEC_POINTS;
      c.clearRect(0, 0, W, H);
      c.strokeStyle = css('--line');
      c.lineWidth = d;
      c.font = `${11 * d}px Inter, sans-serif`;
      c.fillStyle = css('--muted');
      c.textAlign = 'center';
      for (const l of [1, 2, 3, 4, 5]) {
        const x = ((l - L0_UM) / (L1_UM - L0_UM)) * W;
        c.beginPath();
        c.moveTo(x, top);
        c.lineTo(x, base);
        c.stroke();
        c.fillText(`${l} µm`, Math.max(16 * d, Math.min(W - 16 * d, x)), H - 5 * d);
      }
      const ph = p * W;
      c.lineWidth = 1.6 * d;
      for (let pass = 0; pass < 2; pass++) {
        c.save();
        c.beginPath();
        if (pass === 0) c.rect(0, 0, ph, H);
        else c.rect(ph, 0, W - ph, H);
        c.clip();
        c.strokeStyle = pass === 0 ? css('--p-phys') : css('--muted');
        c.beginPath();
        let pen = false;
        for (let i = 0; i < N; i++) {
          const v = curve.values[i];
          if (v === null || v === undefined) {
            pen = false; // a gap where the object has no data
            continue;
          }
          const x = (i / (N - 1)) * W;
          const y = base - v * (base - top);
          if (pen) c.lineTo(x, y);
          else c.moveTo(x, y);
          pen = true;
        }
        c.stroke();
        c.restore();
      }
      if (touched.current) {
        c.strokeStyle = css('--fg');
        c.lineWidth = d;
        c.beginPath();
        c.moveTo(ph, top - 6 * d);
        c.lineTo(ph, base);
        c.stroke();
      }
    },
    [curve],
  );

  // Frame loop, only while a sound plays: gusts, the spectrum position, the waveform canvases.
  useEffect(() => {
    if (!playing || !active) return;
    const frame = () => {
      if (playing === 'atmo') {
        drawScope(atmoCv.current, ATMO_H, true, 2.2, ensureBuf());
      } else if (specH.current) {
        const { pos: p, done } = specH.current.position();
        posRef.current = p;
        setPos(p);
        drawScope(scopeCv.current, SPEC_SCOPE_H, true, 3, ensureBuf());
        if (done) {
          stopSpec();
          return;
        }
      }
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, active, stopSpec]);

  // Idle draws, and a redraw when the size or the pane changes.
  const redrawIdle = useCallback(() => {
    if (!active) return;
    if (mode === 'atmo') drawScope(atmoCv.current, ATMO_H, playing === 'atmo', 2.2, bufRef.current);
    else {
      drawSpec(posRef.current);
      if (playing !== 'spec') drawScope(scopeCv.current, SPEC_SCOPE_H, false, 3, null);
    }
  }, [active, mode, playing, drawSpec]);
  useEffect(() => {
    redrawIdle();
  }, [redrawIdle, pos, atmo.ok, curve]);
  useEffect(() => {
    const els = [atmoCv.current, specCv.current, scopeCv.current].filter(
      (e): e is HTMLCanvasElement => !!e,
    );
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => redrawIdle());
    els.forEach((e) => ro.observe(e));
    return () => ro.disconnect();
  }, [redrawIdle, mode, atmo.ok, curve]);

  const setMode = (m: Mode) => {
    if (m === mode) return;
    stopSpec();
    if (!useAmbienceStore.getState().ambience) useAmbienceStore.getState().stop();
    setChosen({ key: objectKey, mode: m });
  };

  const toggleAtmo = () => {
    const st = useAmbienceStore.getState();
    if (playing === 'atmo') return st.stop();
    if (!atmo.ok) return;
    stopSpec();
    st.play(atmo.model, objectKey);
  };
  const toggleAmbience = (on: boolean) => {
    if (!atmo.ok) return;
    stopSpec();
    useAmbienceStore.getState().setAmbience(on, atmo.model, objectKey);
  };
  const startSpec = (from: number) => {
    if (!curve) return;
    const h = startSpectrum(curve.values, from);
    if (!h) return;
    specH.current = h;
    touched.current = true;
    setSpecPlaying(true);
  };
  const toggleSpec = () => {
    if (playing === 'spec') return stopSpec();
    useAmbienceStore.getState().stop(); // one sound at a time: playing the spectrum ends the ambience
    stopSpec();
    const from = posRef.current >= 0.999 ? 0 : posRef.current;
    posRef.current = from;
    startSpec(from);
  };
  const scrub = (v: number) => {
    const p = v / 1000;
    posRef.current = p;
    touched.current = true;
    setPos(p);
    if (playing === 'spec') {
      specH.current?.stop();
      specH.current = null;
      startSpec(p);
    }
  };

  const label = displayName(name);
  const spectrumLoading =
    !curve &&
    (spectrum.status === 'idle' || spectrum.status === 'waiting' || spectrum.status === 'loading');

  return (
    <>
      <div className="sx-pop-h">
        <b>Hear it</b>
        <span>{label}</span>
      </div>
      <div className="sx-hr">
        <ToggleGroup<Mode>
          label="Sound"
          hideLabel
          options={MODE_OPTIONS}
          value={mode}
          onChange={setMode}
          testId="hear-mode"
        />

        <div hidden={mode !== 'atmo'} className="sx-hr-pane" data-testid="hear-atmo">
          {atmo.ok ? (
            <>
              <div className="sx-hr-viz">
                <span className="sx-hr-cap">Wind at the surface</span>
                <canvas
                  ref={atmoCv}
                  role="img"
                  aria-label="Live waveform of the wind sound"
                  data-testid="hear-atmo-canvas"
                />
              </div>
              <div className="sx-hr-player">
                <button
                  type="button"
                  className="sx-hr-play"
                  aria-pressed={playing === 'atmo'}
                  aria-label={playing === 'atmo' ? 'Pause atmosphere' : 'Play atmosphere'}
                  onClick={toggleAtmo}
                  data-testid="hear-atmo-play"
                >
                  <PlayIcon playing={playing === 'atmo'} />
                </button>
                <div className="sx-hr-grow">
                  <ToggleGroup<Wind>
                    label="Wind"
                    hideLabel
                    options={WIND_OPTIONS}
                    value={wind}
                    onChange={(w) => {
                      useAmbienceStore.getState().setWind(w);
                    }}
                    testId="hear-wind"
                  />
                </div>
              </div>
              <SwitchRow
                label="Ambience"
                checked={ambience}
                onChange={toggleAmbience}
                testId="hear-ambience"
              />
              {ambience && (
                <p className="sx-hr-hint" data-testid="hear-ambience-note">
                  Keeps playing when this panel is closed
                  {local ? `, and follows the place you are looking at (${local.note}).` : '.'}
                </p>
              )}
              <div className="sx-hr-facts">
                <div title={`Surface pressure (${atmo.model.pTag})`}>
                  <span>Pressure</span>
                  <b>{formatPressure(atmo.model.P)}</b>
                </div>
                <div
                  title={`Dominant gas (${atmo.model.gasTag}); surface temperature (${atmo.model.tTag})`}
                >
                  <span>Air</span>
                  <b>
                    {atmo.model.gasLabel}, {Math.round(atmo.model.T)} K
                  </b>
                </div>
                <div title={`${atmo.model.cFormula} (${atmo.model.cTag})`}>
                  <span>Sound speed</span>
                  <b>{Math.round(atmo.model.c)} m/s</b>
                </div>
              </div>
              <div className="sx-hr-reach">
                <div className="sx-hr-reach-h">
                  <span className="sx-eyebrow">Highest pitch that carries</span>
                  <span
                    className="sx-hr-imag"
                    title="The sound is an artist's impression (artistic)"
                  >
                    Default
                  </span>
                </div>
                <div className="sx-hr-bar" aria-hidden="true">
                  <i style={{ width: `${reachFraction(atmo.model.P) * 100}%` }} />
                </div>
                <div className="sx-hr-ax" aria-hidden="true">
                  <span>100 Hz</span>
                  <span>1 kHz</span>
                  <span>10 kHz</span>
                </div>
                <p className="sx-hr-hint">{reachText(atmo.model.P)}</p>
              </div>
            </>
          ) : (
            <p className="sx-hr-empty" data-testid="hear-atmo-none">
              {atmo.line}
            </p>
          )}
        </div>

        <div hidden={mode !== 'spec'} className="sx-hr-pane" data-testid="hear-spec">
          {curve ? (
            <>
              <div className="sx-hr-viz">
                <span className="sx-hr-cap">Light, 0.75 to 5 &micro;m</span>
                <canvas
                  ref={specCv}
                  role="img"
                  aria-label={`Spectrum of ${label || 'the object'}; the playhead moves from short to long wavelengths while it plays`}
                  data-testid="hear-spec-canvas"
                />
              </div>
              <div className="sx-hr-player">
                <button
                  type="button"
                  className="sx-hr-play"
                  aria-pressed={playing === 'spec'}
                  aria-label={playing === 'spec' ? 'Pause spectrum' : 'Play spectrum'}
                  onClick={toggleSpec}
                  data-testid="hear-spec-play"
                >
                  <PlayIcon playing={playing === 'spec'} />
                </button>
                <input
                  type="range"
                  min={0}
                  max={1000}
                  value={Math.round(pos * 1000)}
                  onChange={(e) => scrub(Number(e.target.value))}
                  aria-label="Position in the spectrum"
                  data-testid="hear-spec-scrub"
                />
                <span className="sx-hr-t">{lamAt(pos).toFixed(2)} &micro;m</span>
              </div>
              <div className="sx-hr-viz">
                <canvas ref={scopeCv} aria-hidden="true" />
              </div>
            </>
          ) : (
            <>
              <p className="sx-hr-empty" data-testid="hear-spec-none">
                {spectrumLoading ? 'Loading the spectrum of this object…' : NO_SPECTRUM_LINE}
              </p>
              <div className="sx-hr-player">
                <button type="button" className="sx-hr-play" disabled aria-label="Play spectrum">
                  <PlayIcon playing={false} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
