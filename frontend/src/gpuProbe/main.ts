// Dev-only GPU probe (issue #16, R11.4, R12 #1): which adapter does Chrome give three.js on this
// machine? Served by `npm run dev` at /gpu-probe.html; not an input of the production build
// (vite builds index.html only; scripts/check-dist.js fails if this page or the marker leaks).
import { WebGPURenderer } from 'three/webgpu';
import { describeAdapter, formatReport, probeAdapters, webgl2Renderer } from '@/perf/adapterReport';
import type { GpuLike } from '@/perf/adapterReport';

/** Survives bundling, so check-dist can see this module if it ever reaches dist/. */
export const SX_DEV_ONLY_GPU_PROBE = 'SX_DEV_ONLY_GPU_PROBE';

/** three internals, not in @types/three: read with feature detection, never required. */
interface WebGPUBackendInternals {
  isWebGPUBackend?: boolean;
  compatibilityMode?: boolean;
  device?: { adapterInfo?: Record<string, unknown> };
}

const out = document.getElementById('report') as HTMLPreElement;
const canvas = document.getElementById('c') as HTMLCanvasElement;

async function run(): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {
    marker: SX_DEV_ONLY_GPU_PROBE,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    screen: { width: screen.width, height: screen.height },
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  const gpu = 'gpu' in navigator ? (navigator.gpu as unknown as GpuLike) : undefined;
  report.adapters = await probeAdapters(gpu);

  // As ViewerApp.create does: same options, then init() picks WebGPU or falls back to WebGL2.
  try {
    const renderer = new WebGPURenderer({ canvas, antialias: true });
    await renderer.init();
    const backend = renderer.backend as unknown as WebGPUBackendInternals;
    const isWebGPU = 'isWebGPUBackend' in backend;
    const three: Record<string, unknown> = { backend: isWebGPU ? 'webgpu' : 'webgl2' };
    if (isWebGPU) {
      three.compatibilityMode = backend.compatibilityMode ?? 'not reported';
      three.deviceAdapterInfo = describeAdapter(backend.device?.adapterInfo);
    } else {
      three.webgl2UnmaskedRenderer = webgl2Renderer(document.createElement('canvas'));
    }
    report.three = three;
    await renderer.dispose();
  } catch (err) {
    report.three = { error: err instanceof Error ? err.message : String(err) };
  }
  return report;
}

void run().then((report) => {
  out.textContent = formatReport(report);
});

document.getElementById('copy')?.addEventListener('click', () => {
  void navigator.clipboard.writeText(out.textContent ?? '');
});
