// The Eros card (mock-up `knErosCard`) in the refined Flipbook card style: the SPHEREx cutout with
// tabs over it (name, minimise, close; a back chevron from Discovery), the date with a wavelength
// dot and n / N, the Wavelength and Taken rows, the four layer checkboxes, the brightness against
// wavelength chart and a collapsed Detectors row. The top-left player drives the exposure
// (shell/Transport.tsx). Issue #130: for a known object the frame list, the counts and the sky path
// are the backend's (`/frames`, `/path`); the cutouts, masks and brightness stay DEMO DATA (Demo tag),
// see areaService.ts. MoverDemoCard is the same layout for the
// made-up movers, with no frames.
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '@/app/shell/icons';
import { PanelCard } from '@/app/shell/PanelCard';
import { currentHop, erosList, useAreaStore, type ErosOverlays } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { wavelengthColor } from '@/app/flipbook/wavelengthColor';
import type { ErosDemo, ErosHop } from './areaService';
import { ProvenanceBadge } from '@/app/Badge';
import { DEMO_CUTOUT_NOTE, DemoTag } from './DemoTag';
import { HearTheShift } from '@/app/sound/HearTheShift';
import { drawCutout } from './erosDraw';
import { useAppStore } from '@/state/store';
import { effectiveHonesty } from '@/viewer/honesty';
import { MEASURED_ONLY_NOTE } from './KnownPositionsLayer';
import { DETECTORS, detectorIndex, detectorsWithFrames, mjdDay, mjdHM, mjdYear } from './erosModel';

const OVERLAYS: { key: keyof ErosOverlays; label: string }[] = [
  { key: 'mask', label: 'Mask bright peaks' },
  { key: 'pred', label: 'Predicted position' },
  { key: 'path', label: 'Path' },
  { key: 'flags', label: 'Flagged pixels' },
];

/** The cutout's Horizons overlays (predicted position, path): Estimated, hidden in "Measured only". */
const ESTIMATED_OVERLAYS: ReadonlySet<keyof ErosOverlays> = new Set(['pred', 'path']);

/** True in "Measured only" (D-21): every Estimated path and overlay is hidden. */
function useMeasuredOnly(): boolean {
  return useAppStore((s) => effectiveHonesty(s.honesty) === 'measured');
}

function Tabs({ title, back }: { title: string; back?: () => void }) {
  const setMinimised = useAreaStore((s) => s.setMinimised);
  const closePanel = useShellStore((s) => s.closePanel);
  return (
    <div className="fb-over">
      <span className="sx-kn-l">
        {back && (
          <button
            type="button"
            className="fb-x"
            aria-label="Back to the results"
            title="Back to the results"
            onClick={back}
            data-testid="area-back"
          >
            <Icon name="back" className="size-4" />
          </button>
        )}
        <h2 className="fb-name" title={title} data-testid="object-name">
          {title}
        </h2>
      </span>
      <span className="sx-kn-btns">
        <button
          type="button"
          className="fb-x"
          aria-label="Minimise"
          title="Minimise"
          onClick={() => setMinimised(true)}
          data-testid="area-min"
        >
          <Icon name="minimise" className="size-4" />
        </button>
        <button
          type="button"
          className="fb-x"
          aria-label="Close"
          title="Close (Esc)"
          onClick={closePanel}
          data-testid="panel-close"
        >
          <Icon name="close" className="size-4" />
        </button>
      </span>
    </div>
  );
}

function Cutout({ hop }: { hop: ErosHop }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ov = useAreaStore((s) => s.ov);
  const measured = useMeasuredOnly();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      const cur = useAreaStore.getState().ov;
      const alt = drawCutout(c, hop, measured ? { ...cur, pred: false, path: false } : cur, draw);
      c.setAttribute('aria-label', alt);
    };
    draw();
  }, [hop, ov, measured]);
  return <canvas ref={ref} className="sx-kn-canvas" role="img" aria-label="SPHEREx cutout" data-testid="eros-cutout" />;
}

/** Brightness against wavelength, one dot per exposure taken so far. */
function Chart({ eros, cur, name }: { eros: ErosDemo; cur: ErosHop; name: string }) {
  const W = 360;
  const H = 118;
  const L = 30;
  const R = 20; // room for the "5 µm" label, centred on the last gridline
  const T = 10;
  const B = 22;
  const x0 = 0.75;
  const x1 = 5;
  // A real frame the demo has no brightness for has no dot (flux NaN).
  const all = eros.hops.filter((h) => Number.isFinite(h.flux));
  const fmax = Math.max(...all.map((h) => h.flux + (h.flux_err ?? 0))) * 1.08;
  const fmin = Math.min(0, ...all.map((h) => h.flux - (h.flux_err ?? 0)));
  const X = (l: number) => L + ((l - x0) / (x1 - x0)) * (W - L - R);
  const Y = (f: number) => T + (1 - (f - fmin) / (fmax - fmin)) * (H - T - B);
  const shown = all.filter((h) => h.mjd_avg <= cur.mjd_avg + 1e-9);
  const label = `Brightness of ${name} against wavelength, ${shown.length} of ${all.length} exposures: ${shown
    .map((h) => `${h.wl_um.toFixed(2)} µm ${h.flux.toFixed(0)}`)
    .join('; ')}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="sx-kn-chart" data-testid="eros-chart">
      {[1, 2, 3, 4, 5].map((l) => (
        <g key={l}>
          <line x1={X(l)} x2={X(l)} y1={T} y2={H - B} className="sx-kn-grid" />
          <text x={X(l)} y={H - 7} textAnchor="middle" className="sx-kn-tick">
            {l} µm
          </text>
        </g>
      ))}
      <text x={6} y={T + 8} className="sx-kn-tick">
        MJy/sr
      </text>
      {shown.map((h) => {
        const x = X(h.wl_um);
        const y = Y(h.flux);
        const c = wavelengthColor(h.wl_um);
        const hollow = h.hw_flags.length > 0;
        return (
          <g key={h.frame_id}>
            {h.flux_err ? (
              <line x1={x} x2={x} y1={Y(h.flux - h.flux_err)} y2={Y(h.flux + h.flux_err)} stroke={c} strokeOpacity={0.35} />
            ) : null}
            <circle cx={x} cy={y} r={3.2} fill={hollow ? 'none' : c} stroke={hollow ? c : undefined} strokeWidth={hollow ? 1.4 : undefined} />
            {h === cur && <circle cx={x} cy={y} r={7} fill="none" className="sx-kn-cur" />}
          </g>
        );
      })}
    </svg>
  );
}

function Detectors({ eros, name }: { eros: ErosDemo; name: string }) {
  const det = useAreaStore((s) => s.det);
  const setDet = useAreaStore((s) => s.setDet);
  const have = detectorsWithFrames(eros);
  return (
    <details className="sx-kn-det" data-testid="eros-detectors">
      <summary>
        <span>Detectors</span>
        <span>{det === null ? 'All' : DETECTORS[det]?.name}</span>
      </summary>
      <div className="sx-kn-dets" role="radiogroup" aria-label="Detector">
        {DETECTORS.map((d, i) => (
          <button
            key={d.name}
            type="button"
            role="radio"
            className="sx-kn-detb"
            aria-checked={det === i}
            disabled={!have.has(i)}
            title={have.has(i) ? undefined : `No ${name} frame in this detector`}
            onClick={() => setDet(det === i ? null : i)}
          >
            <span className="sx-kn-rd" aria-hidden="true" />
            <span>
              <b>{d.name}</b>
              <small>
                {d.lo.toFixed(2)} to {d.hi.toFixed(2)} µm
              </small>
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}

function CheckGroup({ disabled }: { disabled?: boolean }) {
  const ov = useAreaStore((s) => s.ov);
  const toggle = useAreaStore((s) => s.toggleOv);
  const measured = useMeasuredOnly();
  const off = (k: keyof ErosOverlays) => !!disabled || (measured && ESTIMATED_OVERLAYS.has(k));
  return (
    <div className="sx-kn-opts" role="group" aria-label="Show on the image" data-off={disabled ? '' : undefined}>
      {OVERLAYS.map((o) => (
        <label
          key={o.key}
          className="sx-kn-opt"
          title={!disabled && off(o.key) ? `${MEASURED_ONLY_NOTE}: hidden in Measured only` : undefined}
        >
          <input
            type="checkbox"
            checked={off(o.key) ? false : ov[o.key]}
            disabled={off(o.key)}
            onChange={() => toggle(o.key)}
            data-testid={`eros-ov-${o.key}`}
          />
          <span className="sx-kn-cb" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          {o.label}
        </label>
      ))}
    </div>
  );
}

function Shell({ title, children }: { title: string; children: (close: () => void) => ReactNode }) {
  const closePanel = useShellStore((s) => s.closePanel);
  const flow = useAreaStore((s) => s.flow);
  const kind = useAreaStore((s) => s.focus?.kind ?? 'asteroid');
  return (
    <PanelCard
      bare
      title={title}
      subtitle={`Known object · ${kind}`}
      icon="area"
      onClose={closePanel}
      returnFocusTo={flow === 'known' ? '[data-testid="tool-known"]' : '[data-testid="tool-area"]'}
      testId="area-card"
    >
      {children}
    </PanelCard>
  );
}

export function ErosCard({ title: given, back }: { title?: string; back?: () => void }) {
  const focus = useAreaStore((s) => s.focus);
  const real = useAreaStore((s) => s.trackSource === 'real');
  const hasPath = useAreaStore((s) => s.trackPath);
  const pathPending = useAreaStore((s) => s.pathPending);
  const measured = useMeasuredOnly();
  const title = given ?? (focus ? `${focus.id} ${focus.name}`.trim() : '433 Eros');
  const eros = useAreaStore((s) => s.eros);
  const failed = useAreaStore((s) => s.erosFailed);
  const hop = useAreaStore((s) => currentHop(s));
  const n = useAreaStore((s) => erosList(s.eros, s.det).length);
  const index = useAreaStore((s) => s.index);
  const known = useAreaStore((s) => s.flow === 'known');
  // The demo cutouts and their photometry are labelled only when some frame actually shows one.
  const anyCutout = eros?.hops.some((h) => !h.no_cutout) ?? false;
  return (
    <Shell title={title}>
      {() => (
        <div data-testid="eros-card">
          <div className="fb-view" data-testid="frame-viewer">
            <Tabs title={title} back={back} />
            {hop && !hop.no_cutout && <Cutout hop={hop} />}
            {hop?.no_cutout && (
              <p className="sx-kn-demo" role="status" data-testid="eros-no-cutout">
                No cutout for this frame in the demo
              </p>
            )}
            {!hop && (
              <p className="sx-kn-demo" role="status" data-testid="eros-card-status">
                {failed
                  ? focus
                    ? 'The frames of this object could not be loaded.'
                    : 'The demo frames could not be loaded.'
                  : focus
                    ? 'Loading the frames…'
                    : 'Loading the demo frames…'}
              </p>
            )}
            {hop && (
              <>
                <span className="fb-cap fb-cap-l" data-testid="frame-date">
                  <i style={{ background: wavelengthColor(hop.wl_um) }} aria-hidden="true" />
                  {mjdDay(hop.mjd_avg)} {mjdYear(hop.mjd_avg)}
                </span>
                <span className="fb-cap fb-cap-r" data-testid="frame-counter">
                  <span>
                    <b>{Math.min(index, n - 1) + 1}</b>
                    <span className="fb-dim"> / {n}</span>
                  </span>
                </span>
              </>
            )}
          </div>
          <div className="fb-c sx-kn-body">
            <dl className="fb-dl">
              <dt>Wavelength</dt>
              <dd data-testid="eros-wl">
                {hop && <i className="sx-kn-dot" style={{ background: wavelengthColor(hop.wl_um) }} aria-hidden="true" />}
                {hop ? `${hop.wl_um.toFixed(2)} µm · ${DETECTORS[detectorIndex(hop)]?.name ?? ''}` : '-'}
              </dd>
              <dt>Taken</dt>
              <dd data-testid="eros-taken">
                {hop ? `${mjdDay(hop.mjd_avg)} ${mjdHM(hop.mjd_avg)} UTC · exposure ${hop.exposure} of 4` : '-'}
              </dd>
            </dl>
            {real && (
              <p className="fb-muted sx-kn-real" data-testid="eros-real">
                {`${eros?.hops.length ?? 0} frames from the backend`}
              </p>
            )}
            {(real || measured) && (
              <p className="fb-muted sx-kn-real" role="status" data-testid="eros-path">
                {measured ? (
                  `${MEASURED_ONLY_NOTE}: the path is hidden in Measured only`
                ) : hasPath ? (
                  <>
                    <ProvenanceBadge
                      tag="model_dependent"
                      tooltip="Estimated: the path is a JPL Horizons prediction seen from SPHEREx, not a measurement."
                      srText
                      variant="tag"
                    />
                    {' Path from Horizons'}
                  </>
                ) : pathPending ? (
                  'The path is still being prepared. Open the card again shortly.'
                ) : (
                  'No path for this object'
                )}
              </p>
            )}
            {known && (
              <div className="sx-kn-leg" aria-hidden="true">
                <span><i />path so far</span>
                <span><i className="d" />path to come</span>
                <span><i className="dot" />every 6 h</span>
              </div>
            )}
            <CheckGroup />
            <HearTheShift />
            <div className="sx-kn-spec">
              <div className="sx-kn-spec-h">
                <span className="sx-kn-spec-t">
                  Wavelength
                  {anyCutout && (
                    <ProvenanceBadge
                      tag={eros?.provenance?.['hops[].flux']?.tag ?? 'model_dependent'}
                      tooltip={
                        eros?.provenance?.['hops[].flux']?.note ??
                        'Approximate photometry from the demo extraction; not a calibrated SPHEREx flux.'
                      }
                      srText
                      variant="tag"
                    />
                  )}
                </span>
                <small>Brightness of {title} in each exposure so far</small>
              </div>
              {eros && hop && <Chart eros={eros} cur={hop} name={title} />}
            </div>
            {eros && <Detectors eros={eros} name={title} />}
            <div className="sx-kn-foot">
              {!real ? (
                <DemoTag />
              ) : anyCutout ? (
                <DemoTag label="Demo cutouts" note={DEMO_CUTOUT_NOTE} testId="demo-tag" />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

/** The made-up movers (T2, T3): the same layout, with no frames to show. */
export function MoverDemoCard({
  title,
  kind,
  frames,
  back,
}: {
  title: string;
  kind: string;
  frames: number;
  back: () => void;
}) {
  return (
    <Shell title={title}>
      {() => (
        <div data-testid="mover-card">
          <div className="fb-view">
            <Tabs title={title} back={back} />
            <p className="sx-kn-demo" role="status">
              Demo mover: no frames in this demo
            </p>
            <span className="fb-cap fb-cap-l">
              <i style={{ background: 'var(--dim, #6b6b75)' }} aria-hidden="true" />
              {kind}
            </span>
            <span className="fb-cap fb-cap-r">
              <b>-</b>
              <span className="fb-dim"> / {frames}</span>
            </span>
          </div>
          <div className="fb-c sx-kn-body">
            <dl className="fb-dl">
              <dt>Wavelength</dt>
              <dd>no frames</dd>
              <dt>Taken</dt>
              <dd>no frames</dd>
            </dl>
            <CheckGroup disabled />
            <div className="sx-kn-spec">
              <div className="sx-kn-spec-h">
                <span>Wavelength</span>
                <small>Brightness in each exposure</small>
              </div>
              <p className="sx-kn-spec-none">No spectrum for a demo mover</p>
            </div>
            <details className="sx-kn-det" data-off="">
              <summary>
                <span>Detectors</span>
                <span>All</span>
              </summary>
            </details>
            <div className="sx-kn-foot">
              <DemoTag />
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
