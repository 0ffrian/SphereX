// Issue #93: a stub WebGL 2 context that records every call and reports the uniforms each fragment shader declares, so
// the world engine's own code runs unchanged in jsdom. COMPLETION_STATUS_KHR turns true after `lateBy` polls per
// program (a never-finishing compile with a huge `lateBy`). Shared by engineCompile.test.ts and the stage tests.
export interface StubOpts {
  /** Polls before COMPLETION_STATUS_KHR turns true (per program). */
  lateBy?: number;
  /** No KHR_parallel_shader_compile. */
  noExt?: boolean;
  /** A fragment shader containing this text fails to link. */
  failOn?: string;
}

export type Call = [string, ...unknown[]];

export function stubGL(o: StubOpts = {}) {
  const calls: Call[] = [];
  const progs: { fs: string; polls: number; linked: boolean }[] = [];
  const shaders = new Map<object, { type: string; src: string }>();
  const progOf = (p: unknown) => progs[(p as { i: number }).i]!;
  const uniformNames = (src: string): string[] => {
    const out: string[] = [];
    for (const m of src.matchAll(/uniform\s+\w+\s+([^;]+);/g))
      for (const n of m[1]!.split(',')) out.push(n.trim().replace(/\[\d+\]$/, ''));
    return out;
  };
  const ext = {
    COMPLETION_STATUS_KHR: 'COMPLETION_STATUS_KHR',
    loseContext: () => calls.push(['loseContext']),
  };
  const api: Record<string, unknown> = {
    getExtension: (n: string) => (n === 'KHR_parallel_shader_compile' && o.noExt ? null : ext),
    createProgram: () => {
      progs.push({ fs: '', polls: 0, linked: false });
      calls.push(['createProgram']);
      return { i: progs.length - 1 };
    },
    createShader: (t: string) => {
      const s = {};
      shaders.set(s, { type: t, src: '' });
      return s;
    },
    shaderSource: (s: object, src: string) => {
      shaders.get(s)!.src = src;
    },
    attachShader: (p: unknown, s: object) => {
      const sh = shaders.get(s)!;
      if (sh.type === 'FRAGMENT_SHADER') progOf(p).fs = sh.src;
    },
    getProgramParameter: (p: unknown, e: string) => {
      const pr = progOf(p);
      calls.push(['getProgramParameter', e]);
      if (e === 'COMPLETION_STATUS_KHR') return ++pr.polls > (o.lateBy ?? 0);
      if (e === 'LINK_STATUS') {
        pr.linked = true;
        return !(o.failOn && pr.fs.includes(o.failOn));
      }
      if (e === 'ACTIVE_UNIFORMS') return uniformNames(pr.fs).length;
      return true;
    },
    getShaderParameter: () => true,
    getProgramInfoLog: () => 'stub link error: varying mismatch',
    getShaderInfoLog: () => '',
    getActiveUniform: (p: unknown, i: number) => ({ name: uniformNames(progOf(p).fs)[i] }),
    getUniformLocation: (_p: unknown, name: string) => ({ name }),
    uniform1f: (loc: { name: string } | null, v: number) => calls.push(['uniform1f', loc?.name, v]),
    drawArrays: () => calls.push(['drawArrays']),
    checkFramebufferStatus: () => 'FRAMEBUFFER_COMPLETE',
  };
  const gl = new Proxy(api, {
    get(t, k) {
      if (typeof k !== 'string') return undefined;
      if (k in t) return t[k];
      if (/^[A-Z_0-9]+$/.test(k)) return k;
      if (/^create/.test(k)) return () => ({});
      return () => {};
    },
  });
  return { gl, calls, progs };
}

export function stubCanvas(gl: unknown, w = 400, h = 300) {
  return {
    clientWidth: w,
    clientHeight: h,
    width: 0,
    height: 0,
    getContext: () => gl,
  } as unknown as HTMLCanvasElement;
}
