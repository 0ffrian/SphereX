// Status line: reports which three r187 backend is active (D-03: WebGPU, WebGL2 fallback [verify]).
import { useAppStore, type RendererStatus } from '@/state/store';

const STATUS_TEXT: Record<RendererStatus, string> = {
  starting: 'Renderer: starting…',
  webgpu: 'Renderer: WebGPU',
  webgl2: 'Renderer: WebGL2 (fallback)',
  unavailable:
    'Renderer: unavailable. This browser has no WebGPU or WebGL2, so the 3D view cannot start.',
};

export function StatusLine() {
  const status = useAppStore((s) => s.rendererStatus);
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="renderer-status"
      data-status={status}
      className="text-sm text-neutral-400"
    >
      {STATUS_TEXT[status]}
    </p>
  );
}
