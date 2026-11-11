// Canvas drawing for the Eros demo: the SPHEREx cutout in the card and the #track window inside
// the drawn square on the sky. Ported from the mock-up (`knCut`, `knDraw`, `discDraw`). Colours come
// from the design tokens (erosModel.tok); the layers' meaning is in the card's checkboxes.
import type { DiscoveryResult, ErosDemo, ErosHop } from './areaService';
import type { ErosOverlays } from '@/app/shell/areaStore';
import { isoToMjd, mjdDay, mjdHM, mjdHour, tok, trackAt } from './erosModel';

// ---- images -----------------------------------------------------------------------------------

const images = new Map<string, HTMLImageElement>();
/** A cached image; `onLoad` runs once when it has decoded (not when it is already there). */
export function getImage(src: string, onLoad?: () => void): HTMLImageElement {
  let im = images.get(src);
  if (!im) {
    im = new Image();
    images.set(src, im);
    if (onLoad) im.addEventListener('load', onLoad, { once: true });
    im.src = src;
  } else if (onLoad && !im.complete) {
    im.addEventListener('load', onLoad, { once: true });
  }
  return im;
}

// ---- the cutout -------------------------------------------------------------------------------

function compass(g: CanvasRenderingContext2D, x: number, y: number, L: number): void {
  const c = tok('--muted', '#9aa4ab');
  g.strokeStyle = c;
  g.fillStyle = c;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - L);
  g.moveTo(x, y);
  g.lineTo(x - L, y);
  g.stroke();
  g.font = '600 10px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('N', x, y - L - 4);
  g.fillText('E', x - L - 7, y + 3.5);
  g.textAlign = 'left';
}

/** The SPHEREx cutout, north up and east left, with the checked layers. Returns the alt text. */
export function drawCutout(
  c: HTMLCanvasElement,
  h: ErosHop,
  ov: ErosOverlays,
  redraw: () => void,
): string {
  const cssW = c.clientWidth || 290;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = c.height = Math.round(cssW * dpr);
  const g = c.getContext('2d');
  const alt = `SPHEREx cutout of 433 Eros at ${h.wl_um.toFixed(2)} micrometres, ${h.nx} by ${h.ny} pixels. Eros is ringed, its path is dashed, masked catalogue stars are grey circles.`;
  if (!g) return alt;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, cssW, cssW);
  const im = getImage(h.png, redraw);
  const [e0, e1] = h.east;
  const [n0, n1] = h.north;
  const det = e0 * n1 - n0 * e1;
  const inv = [
    [n1 / det, -n0 / det],
    [-e1 / det, e0 / det],
  ] as const;
  // North up, east left.
  const M = [
    [-inv[0][0], -inv[0][1]],
    [-inv[1][0], -inv[1][1]],
  ] as const;
  const s = cssW / (Math.max(h.nx, h.ny) + 2);
  const cx = (h.nx - 1) / 2;
  const cy = (h.ny - 1) / 2;
  const mid = cssW / 2;
  const P = (x: number, y: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    return [mid + s * (M[0][0] * dx + M[0][1] * dy), mid + s * (M[1][0] * dx + M[1][1] * dy)];
  };
  const drawPlane = (img: HTMLImageElement, alpha: number) => {
    g.save();
    g.setTransform(dpr * s * M[0][0], dpr * s * M[1][0], dpr * s * M[0][1], dpr * s * M[1][1], dpr * mid, dpr * mid);
    g.translate(-(cx + 0.5), -(cy + 0.5));
    g.imageSmoothingEnabled = false;
    g.globalAlpha = alpha;
    g.drawImage(img, 0, 0);
    g.restore();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  if (im.complete && im.naturalWidth) drawPlane(im, 1);
  if (ov.flags) {
    const f = getImage(h.flags_png, redraw);
    if (f.complete && f.naturalWidth) drawPlane(f, 0.9);
  }
  if (ov.mask) {
    for (const st of h.stars) {
      const [x, y] = P(st[0], st[1]);
      const r = s * (st[2] > 60 ? 2 : 1.4);
      g.fillStyle = tok('--s1', '#0f1114');
      g.globalAlpha = 0.92;
      g.beginPath();
      g.arc(x, y, r, 0, 7);
      g.fill();
      g.globalAlpha = 0.4;
      g.strokeStyle = tok('--muted', '#9aa4ab');
      g.lineWidth = 1;
      g.stroke();
      g.globalAlpha = 1;
    }
  }
  if (ov.path && h.seg.length > 1) {
    g.save();
    g.beginPath();
    g.rect(0, 0, cssW, cssW);
    g.clip();
    g.setLineDash([6, 5]);
    g.strokeStyle = tok('--p-phys', '#38bdf8');
    g.globalAlpha = 0.85;
    g.lineWidth = 1.6;
    g.beginPath();
    h.seg.forEach((p, j) => {
      const [x, y] = P(p[0], p[1]);
      if (j) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.stroke();
    g.restore();
    g.setLineDash([]);
  }
  if (ov.pred) {
    const [x, y] = P(h.x, h.y);
    const r = s * 3.4;
    g.strokeStyle = tok('--accent', '#89cff0');
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.stroke();
    g.beginPath();
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      g.moveTo(x + a * (r + 3), y + b * (r + 3));
      g.lineTo(x + a * (r + 10), y + b * (r + 10));
    }
    g.stroke();
    g.font = '600 12px Inter, system-ui, sans-serif';
    g.fillStyle = tok('--bg', '#08090b');
    g.globalAlpha = 0.85;
    g.fillRect(x + r + 8, y - r - 22, 44, 18);
    g.globalAlpha = 1;
    g.fillStyle = tok('--fg', '#e6e9eb');
    g.fillText('Eros', x + r + 13, y - r - 9);
  }
  compass(g, cssW - 24, cssW - 50, 13);
  return alt;
}

// ---- the #track window on the sky -------------------------------------------------------------

export interface TrackRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TrackState {
  mode: 'eros' | 'disc';
  /** Time shown (MJD), already glided. */
  now: number;
  /** Discovery: the step reached and the selected mover. */
  step: number;
  sel: number;
  disc: DiscoveryResult | null;
}

const label = (g: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string, font: string) => {
  g.font = font;
  g.textAlign = 'center';
  const w = g.measureText(text).width + 8;
  g.fillStyle = tok('--bg', '#08090b');
  g.globalAlpha = 0.78;
  g.fillRect(x - w / 2, y - 24, w, 14);
  g.globalAlpha = 1;
  g.fillStyle = colour;
  g.fillText(text, x, y - 13.5);
  g.textAlign = 'left';
};

/**
 * The window inside the drawn square: the demo sky image fitted (same aspect, black bars) and clipped
 * to the square, then the path (Known) or the dots and movers of the steps reached (Discovery).
 */
export function drawTrackWindow(
  g: CanvasRenderingContext2D,
  r: TrackRect,
  eros: ErosDemo,
  st: TrackState,
  redraw: () => void,
): void {
  const x0 = Math.min(r.x0, r.x1);
  const y0 = Math.min(r.y0, r.y1);
  const w = Math.abs(r.x1 - r.x0);
  const h = Math.abs(r.y1 - r.y0);
  if (!(w > 2 && h > 2)) return;
  const sc = Math.min(w / eros.wide.w, h / eros.wide.h);
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  const P = (p: readonly [number, number]): [number, number] => [
    cx + (p[0] - eros.wide.w / 2) * sc,
    cy + (p[1] - eros.wide.h / 2) * sc,
  ];
  const fg = tok('--fg', '#e6e9eb');
  const muted = tok('--muted', '#9aa4ab');
  const phys = tok('--p-phys', '#38bdf8');
  const warn = tok('--warn', '#f2b84b');
  const accent = tok('--accent', '#89cff0');
  g.save();
  g.beginPath();
  g.rect(x0, y0, w, h);
  g.clip();
  g.fillStyle = '#000';
  g.fillRect(x0, y0, w, h);
  const sky = getImage(eros.wide.png, redraw);
  if (sky.complete && sky.naturalWidth) {
    const [ix, iy] = P([0, 0]);
    const [jx, jy] = P([eros.wide.w, eros.wide.h]);
    g.globalAlpha = 0.92;
    g.imageSmoothingEnabled = true;
    g.drawImage(sky, ix, iy, jx - ix, jy - iy);
    g.globalAlpha = 1;
  }
  const T = eros.track;
  const small = '10.5px Inter, system-ui, sans-serif';
  if (st.mode === 'disc') {
    const d = st.disc;
    if (d && st.step >= 0) {
      g.fillStyle = fg;
      g.globalAlpha = 0.55;
      for (const dot of d.dots) {
        if (dot.k === 'glitch' ? st.step >= 1 : dot.k === 'star' ? st.step >= 2 : st.step >= 3) continue;
        const [x, y] = P(dot.p);
        g.beginPath();
        g.arc(x, y, 1.9, 0, 7);
        g.fill();
      }
      g.globalAlpha = 1;
      if (st.step >= 3) {
        g.lineCap = 'round';
        d.movers.forEach((m, i) => {
          const on = st.sel === i;
          const line = m.kind === 'known' ? phys : m.kind === 'unexplained' ? warn : muted;
          const sp = m.pts.map(P);
          g.lineWidth = 2;
          if (sp.length > 1) {
            g.strokeStyle = on ? accent : line;
            g.beginPath();
            g.moveTo(sp[0]![0], sp[0]![1]);
            g.lineTo(sp[1]![0], sp[1]![1]);
            g.stroke();
          }
          for (const [x, y] of sp) {
            g.fillStyle = line;
            g.beginPath();
            g.arc(x, y, 3.2, 0, 7);
            g.fill();
            g.strokeStyle = fg;
            g.lineWidth = 1;
            g.stroke();
          }
          if (on) {
            const [x, y] = sp[sp.length - 1]!;
            g.strokeStyle = fg;
            g.lineWidth = 2;
            g.beginPath();
            g.arc(x, y, 9, 0, 7);
            g.stroke();
            g.globalAlpha = 0.35;
            g.lineWidth = 1;
            g.beginPath();
            g.arc(x, y, 15, 0, 7);
            g.stroke();
            g.globalAlpha = 1;
          }
          const lab = m.known ? (st.step >= 4 ? `${m.id} · ${m.known}` : m.id) : m.pts.length < 2 ? `${m.id} · seen once` : m.id;
          const mx = sp.reduce((a, q) => a + q[0], 0) / sp.length;
          const my = sp.reduce((a, q) => a + q[1], 0) / sp.length;
          label(g, lab, mx, my, line === muted ? fg : line, small);
        });
      }
    }
  } else if (T.length > 1) {
    const now = st.now;
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = phys;
    g.beginPath();
    let started = false;
    for (const p of T) {
      if (isoToMjd(p.t) > now) break;
      const [x, y] = P(p.px);
      if (started) g.lineTo(x, y);
      else g.moveTo(x, y);
      started = true;
    }
    const cur = trackAt(eros, now);
    if (started) {
      const [x, y] = P(cur);
      g.lineTo(x, y);
    }
    g.stroke();
    g.setLineDash([5, 5]);
    g.globalAlpha = 0.65;
    g.beginPath();
    {
      const [x, y] = P(cur);
      g.moveTo(x, y);
    }
    for (const p of T) {
      if (isoToMjd(p.t) <= now) continue;
      const [x, y] = P(p.px);
      g.lineTo(x, y);
    }
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
    for (const p of T) {
      const m = isoToMjd(p.t);
      const hr = mjdHour(m);
      if (hr % 6) continue;
      const [x, y] = P(p.px);
      g.fillStyle = phys;
      g.beginPath();
      g.arc(x, y, 2.6, 0, 7);
      g.fill();
      label(g, `${mjdDay(m)} ${String(hr).padStart(2, '0')}h`, x, y + 2, fg, small);
    }
    const [ex, ey] = P(cur);
    g.strokeStyle = fg;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(ex, ey, 9, 0, 7);
    g.stroke();
    g.globalAlpha = 0.35;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(ex, ey, 15, 0, 7);
    g.stroke();
    g.globalAlpha = 1;
    g.font = '600 12px Inter, system-ui, sans-serif';
    const lab = `Eros · ${mjdHM(now)} UTC`;
    const lw = g.measureText(lab).width + 12;
    g.fillStyle = tok('--bg', '#08090b');
    g.globalAlpha = 0.85;
    g.fillRect(ex + 14, ey + 12, lw, 19);
    g.globalAlpha = 1;
    g.fillStyle = fg;
    g.fillText(lab, ex + 20, ey + 25.5);
  }
  g.restore();
  g.strokeStyle = '#4ade80'; // the mock-up's area-square green
  g.lineWidth = 1.2;
  g.strokeRect(x0, y0, w, h);
}
