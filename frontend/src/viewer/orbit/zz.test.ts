import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { DataTexture, FloatType, RGBAFormat } from 'three/webgpu';
import { buildOrbitShader, createOrbitUniforms } from './orbitShader';
import { buildWgsl } from './wgslProbe.testutil';
const tex = () => new DataTexture(new Float32Array(32), 4, 2, RGBAFormat, FloatType);
it('dump', () => {
  const r = buildOrbitShader({ kind: 'rocky', height: tex(), climate: tex(), hydrology: tex(), cloudBase: null, clouds: true, ocean: true, snow: true, velocity: null, bands: null, tracer: null }, createOrbitUniforms());
  writeFileSync('/tmp/claude-1000/-home-moon-Desktop-Projects-SphereX/aa16353e-85ea-43cc-a131-ce208f8d9130/scratchpad/rocky.wgsl', buildWgsl(r.fragment));
  const t = tex();
  const g = buildOrbitShader({ kind: 'gas', height: null, climate: null, hydrology: null, cloudBase: null, clouds: false, ocean: false, snow: false, velocity: t, bands: t, tracer: t }, createOrbitUniforms());
  writeFileSync('/tmp/claude-1000/-home-moon-Desktop-Projects-SphereX/aa16353e-85ea-43cc-a131-ce208f8d9130/scratchpad/gas.wgsl', buildWgsl(g.fragment));
});
