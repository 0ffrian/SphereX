// R13.9 sound check page (dev only, #116): bake and play each demo world's beds at presentation level with a meter,
// tune by ear, and copy the result as tuning.ts lines. Not part of the build (scripts/check-dist.js).
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { WorldEngine as WorldEngineT } from '@/engine/worlds/WorldEngine';
import { SoundCheckController, type MeterReading } from './controller';
import { DEFAULT_TUNE, tuningText, type TuneState } from './tune';
import {
  CHECK_ALTS,
  engineWorld,
  enginePresets,
  fixtureWorlds,
  type CheckAlt,
  type CheckWorld,
} from './worlds';
import { SOUND_CHECK_MARKER } from './marker';
import type { SourceId } from '@/sound/ambience/types';

const fmt = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(d);

export function SoundCheck() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [tune, setTune] = useState<TuneState>(DEFAULT_TUNE);
  const ctl = useMemo(() => new SoundCheckController(DEFAULT_TUNE, rerender), []);
  const [meter, setMeter] = useState<MeterReading | null>(null);
  const [mode, setMode] = useState<'fixture' | 'engine'>('fixture');
  const [alt, setAlt] = useState<CheckAlt>('low');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>('');
  const [copied, setCopied] = useState('');
  const engineRef = useRef<WorldEngineT | null>(null);
  const fixtures = useMemo(() => fixtureWorlds(), []);
  const presets = useMemo(() => enginePresets(), []);

  useEffect(() => () => ctl.dispose(), [ctl]);
  useEffect(() => ctl.setTune(tune), [ctl, tune]);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 33) return; // 30 fps
      last = t;
      setMeter(ctl.meter(t / 1000));
    };
    raf = requestAnimationFrame(loop);
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        ctl.stopAll();
        rerender();
      }
    };
    window.addEventListener('keydown', esc);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', esc);
    };
  }, [ctl]);

  const st = ctl.status();
  const frame = ctl.frame();

  const loadFixture = (w: CheckWorld) => {
    setNote('');
    ctl.load(w);
  };
  const loadEngine = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setNote('Starting the world engine (the fly shader can take 20 to 60 s on a cold cache)…');
    try {
      if (!engineRef.current) {
        const { WorldEngine } = await import('@/engine/worlds/WorldEngine');
        const cv = document.createElement('canvas');
        cv.width = 320;
        cv.height = 200;
        cv.style.display = 'none';
        document.body.appendChild(cv);
        engineRef.current = new WorldEngine(cv, { role: 'fly' });
        await engineRef.current.whenReady();
      }
      const w = await engineWorld(engineRef.current, id, alt, setNote);
      if ('error' in w) setNote(w.error);
      else {
        setNote('');
        ctl.load(w);
      }
    } catch (err) {
      setNote(`The world engine is unavailable here (${String(err)}). Use the fixture worlds.`);
    } finally {
      setBusy(false);
    }
  };

  const bedTrim = (id: SourceId, v: number) =>
    setTune((t) => ({ ...t, bedTrimDb: { ...t.bedTrimDb, [id]: v } }));
  const toggleMute = (id: SourceId) =>
    setTune((t) => {
      const m = new Set(t.muted);
      if (m.has(id)) m.delete(id);
      else m.add(id);
      return { ...t, muted: m };
    });

  const text = tuningText(tune);
  return (
    <main data-marker={SOUND_CHECK_MARKER}>
      <h1>Sound check (dev only)</h1>
      <p className="muted">
        Each world&rsquo;s beds through the app&rsquo;s own chain: bake worker → mixer → ambience
        bus → 35 Hz high-pass → duck → level → master → limiter. Escape stops everything.
      </p>

      <section aria-label="Output">
        {!st.started ? (
          <button type="button" onClick={() => void ctl.start()}>
            Start sound
          </button>
        ) : (
          <p>
            Sample rate {st.sampleRate} Hz · output latency{' '}
            {fmt(st.outputLatency ? st.outputLatency * 1000 : null, 0)} ms · base latency{' '}
            {fmt(st.baseLatency ? st.baseLatency * 1000 : null, 0)} ms
            {st.bluetooth && (
              <strong className="warn">
                {' '}
                · High latency: Bluetooth? Use the wired output on stage.
              </strong>
            )}
          </p>
        )}
        <button type="button" className="panic" onClick={() => (ctl.stopAll(), rerender())}>
          Stop all
        </button>
        <button type="button" disabled={!st.started} onClick={() => ctl.tone('sine')}>
          1 kHz −20 dBFS
        </button>
        <button type="button" disabled={!st.started} onClick={() => ctl.tone('pink')}>
          Pink noise −24
        </button>
        <button type="button" disabled={!st.started} onClick={() => ctl.tone('lr')}>
          Left / Right
        </button>
      </section>

      <section aria-label="Meter" className="meter">
        <Bar label="RMS" db={meter?.rms ?? -100} />
        <Bar label="Peak" db={meter?.peak ?? -100} hold={meter?.hold} />
        <p>
          RMS {fmt(meter?.rms)} dBFS · peak {fmt(meter?.peak)} dBFS · hold {fmt(meter?.hold)} ·
          clips {meter?.clips ?? 0} · tap: {meter?.tap ?? '–'} · targets: beds ≈ −24, data −18,
          thunder ≤ −10 dBFS peak
        </p>
        {st.step && <p className="step">Now: {st.step}</p>}
      </section>

      <section aria-label="Worlds">
        <div role="radiogroup" aria-label="World source">
          <label>
            <input type="radio" checked={mode === 'fixture'} onChange={() => setMode('fixture')} />{' '}
            Fixtures (no WebGL)
          </label>
          <label>
            <input type="radio" checked={mode === 'engine'} onChange={() => setMode('engine')} />{' '}
            Live engine (one hidden engine)
          </label>
        </div>
        {mode === 'engine' && (
          <label>
            Listener height{' '}
            <select
              value={alt}
              disabled={busy}
              onChange={(e) => setAlt(e.target.value as CheckAlt)}
            >
              {CHECK_ALTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="worlds">
          {mode === 'fixture'
            ? fixtures.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  disabled={!st.started}
                  onClick={() => loadFixture(w)}
                >
                  {w.label}
                </button>
              ))
            : presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={!st.started || busy}
                  onClick={() => void loadEngine(p.id)}
                >
                  {p.label}
                </button>
              ))}
        </div>
        {note && <p className="warn">{note}</p>}
      </section>

      {st.world && (
        <section aria-label="World">
          <h2>{st.world}</h2>
          <p>
            Baked {st.ready.length} of {st.specs.length} ·{' '}
            <button type="button" onClick={() => ctl.playSequence(false)}>
              Play sequence (5 s per bed, thunder, data sound)
            </button>{' '}
            <button type="button" onClick={() => ctl.playMix()}>
              Play full mix
            </button>
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Bed</th>
                  <th>Baked ms</th>
                  <th>True dB</th>
                  <th>Gain dB (tuned)</th>
                  <th>Low-pass Hz</th>
                  <th>Pan</th>
                  <th>Trim dB</th>
                  <th>Mute</th>
                </tr>
              </thead>
              <tbody>
                {st.specs.map((s) => {
                  const k = `${s.id}|${s.variant}`;
                  const b = frame?.beds.find((x) => x.id === s.id && x.variant === s.variant);
                  return (
                    <tr key={k}>
                      <td>{k}</td>
                      <td>{st.ready.includes(k) ? fmt(st.bakeMs[k], 0) : 'baking…'}</td>
                      <td>
                        {b
                          ? fmt(b.trueDb)
                          : s.id === 'thunder' || (s.id === 'S8' && s.variant === 1)
                            ? 'event'
                            : '–'}
                      </td>
                      <td>{b ? fmt(b.gainDb) : '–'}</td>
                      <td>{b ? fmt(b.lowpassHz, 0) : '–'}</td>
                      <td>{b ? fmt(b.pan, 2) : '–'}</td>
                      <td>
                        <input
                          type="range"
                          min={-24}
                          max={24}
                          step={0.5}
                          value={tune.bedTrimDb[s.id] ?? 0}
                          aria-label={`Trim ${k}`}
                          onChange={(e) => bedTrim(s.id, Number(e.target.value))}
                        />{' '}
                        {fmt(tune.bedTrimDb[s.id] ?? 0)}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={tune.muted.has(s.id)}
                          aria-label={`Mute ${k}`}
                          onChange={() => toggleMute(s.id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {st.refusals.length > 0 && (
            <ul>
              {st.refusals.map((r, i) => (
                <li key={i}>
                  Not heard: {r.source}: {r.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-label="Tuning">
        <h2>Tuning</h2>
        <label>
          Stage window {tune.windowDb} dB{' '}
          <input
            type="range"
            min={6}
            max={40}
            step={1}
            value={tune.windowDb}
            onChange={(e) => setTune({ ...tune, windowDb: Number(e.target.value) })}
          />
        </label>
        <label>
          Global bed trim {tune.trimDb} dB{' '}
          <input
            type="range"
            min={-24}
            max={12}
            step={0.5}
            value={tune.trimDb}
            onChange={(e) => setTune({ ...tune, trimDb: Number(e.target.value) })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={tune.harmonicOn}
            onChange={() => setTune({ ...tune, harmonicOn: !tune.harmonicOn })}
          />{' '}
          Harmonic branch
        </label>
        <label>
          Harmonic send {tune.harmonicSendDb} dB{' '}
          <input
            type="range"
            min={-24}
            max={12}
            step={1}
            value={tune.harmonicSendDb}
            onChange={(e) => setTune({ ...tune, harmonicSendDb: Number(e.target.value) })}
          />
        </label>
        <p>
          <button
            type="button"
            onClick={() => {
              const t = text || '// nothing changed';
              void navigator.clipboard?.writeText(t).then(
                () => setCopied('Copied.'),
                () => setCopied('Copy failed; select the text below.'),
              );
            }}
          >
            Copy as tuning.ts
          </button>{' '}
          {copied}
        </p>
        <pre>{text || '// nothing changed'}</pre>
      </section>
    </main>
  );
}

function Bar({ label, db, hold }: { label: string; db: number; hold?: number }) {
  const pct = (x: number) => `${Math.max(0, Math.min(100, ((x + 60) / 60) * 100))}%`;
  return (
    <div className="bar" aria-label={`${label} ${db.toFixed(1)} dBFS`}>
      <span>{label}</span>
      <div className="track">
        <div className={`fill ${db > -3 ? 'hot' : ''}`} style={{ width: pct(db) }} />
        {hold !== undefined && <div className="hold" style={{ left: pct(hold) }} />}
      </div>
    </div>
  );
}
