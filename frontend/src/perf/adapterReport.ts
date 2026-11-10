// R12 #1, R11.4 (issue #16): what GPU does Chrome hand three.js on this machine? Dev-only probe
// logic, `GPU` injected so it is testable. Never infers a GPU model from strings: it reports what the
// browser says, or "not reported".

/** three r187 asks for these two extra options (WebGPUBackend.js); lib.dom does not declare them. */
export type ThreeAdapterOptions = GPURequestAdapterOptions & {
  featureLevel?: 'core' | 'compatibility';
  xrCompatible?: boolean;
};

export const NOT_REPORTED = 'not reported';

export interface AdapterDescription {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  isFallbackAdapter: boolean;
}

export interface AdapterProbe {
  /** The powerPreference passed ('default' when none: what three r187 passes). */
  powerPreference: string;
  adapter:
    | (AdapterDescription & {
        coreFeaturesAndLimits: boolean;
        maxTextureDimension2D: number;
      })
    | null;
  /** Why there is no adapter: a null result or the error text. */
  note: string | null;
}

export interface AdapterReport {
  webgpu: AdapterProbe[];
  /** Set when navigator.gpu is missing. */
  webgpuMissing: string | null;
}

interface InfoLike {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  isFallbackAdapter?: boolean;
}

const text = (v: string | undefined): string => (v && v.length > 0 ? v : NOT_REPORTED);

export function describeAdapter(info: InfoLike | undefined | null): AdapterDescription {
  return {
    vendor: text(info?.vendor),
    architecture: text(info?.architecture),
    device: text(info?.device),
    description: text(info?.description),
    isFallbackAdapter: info?.isFallbackAdapter === true,
  };
}

export const POWER_PREFERENCES = [undefined, 'low-power', 'high-performance'] as const;

/** Minimal shape of `navigator.gpu` the probe needs. */
export interface GpuLike {
  requestAdapter(options?: ThreeAdapterOptions): Promise<GPUAdapter | null>;
}

export async function probeAdapters(gpu: GpuLike | undefined): Promise<AdapterReport> {
  if (!gpu)
    return {
      webgpu: [],
      webgpuMissing: 'navigator.gpu missing (not a secure context, or WebGPU off)',
    };
  const webgpu: AdapterProbe[] = [];
  for (const powerPreference of POWER_PREFERENCES) {
    const label = powerPreference ?? 'default';
    // The first request is exactly the one three r187 makes; the others show what a hybrid-GPU
    // machine hands out for each preference.
    const options: ThreeAdapterOptions = {
      powerPreference,
      featureLevel: 'compatibility',
      xrCompatible: false,
    };
    try {
      const adapter = await gpu.requestAdapter(options);
      if (!adapter) {
        webgpu.push({
          powerPreference: label,
          adapter: null,
          note: 'requestAdapter returned null',
        });
        continue;
      }
      webgpu.push({
        powerPreference: label,
        adapter: {
          ...describeAdapter(adapter.info),
          coreFeaturesAndLimits: adapter.features.has('core-features-and-limits'),
          maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
        },
        note: null,
      });
    } catch (err) {
      webgpu.push({
        powerPreference: label,
        adapter: null,
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { webgpu, webgpuMissing: null };
}

/** The unmasked WebGL2 renderer string if the browser exposes it. */
export function webgl2Renderer(canvas: HTMLCanvasElement): string {
  const gl = canvas.getContext('webgl2');
  if (!gl) return 'webgl2 unavailable';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (!ext) return NOT_REPORTED;
  const r = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as unknown;
  return typeof r === 'string' && r.length > 0 ? r : NOT_REPORTED;
}

/** Stable JSON: keys in the order the objects were built (fixed above), two-space indent. */
export function formatReport(report: unknown): string {
  return JSON.stringify(report, null, 2);
}
