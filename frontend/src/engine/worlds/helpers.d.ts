export function clamp(x: number, a: number, b: number): number;
export function lerp(a: number, b: number, t: number): number;
export function sstep(a: number, b: number, x: number): number;
export function fmt(x: number, d?: number): string;
export function rng(seed: number): () => number;
export function planck(lnm: number, T: number): number;
export function planckRGB(T: number): [number, number, number];
export const LMIN: number;
export const LMAX: number;
export const LUT: Uint8Array;
export interface CompileJob {
  p: WebGLProgram;
  vs: WebGLShader;
  fs: WebGLShader;
}
export function compileStart(gl: WebGL2RenderingContext, vs: string, fs: string): CompileJob;
export function compileDone(gl: WebGL2RenderingContext, job: CompileJob, ext: unknown): boolean;
export function compileEnd(gl: WebGL2RenderingContext, job: CompileJob): WebGLProgram;
