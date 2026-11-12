// D-37: can this browser run the prototype's world engine (WebGL 2 with float render targets)? Cached; no context is kept.
let cached: boolean | null = null;

export function worldEngineSupported(): boolean {
  if (cached !== null) return cached;
  try {
    if (typeof document === 'undefined') return (cached = false);
    const gl = document.createElement('canvas').getContext('webgl2');
    cached = !!gl && !!gl.getExtension('EXT_color_buffer_float');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}
