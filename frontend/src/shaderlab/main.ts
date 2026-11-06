// Dev-only harness (issue #39 WP2): one sphere per shader-library function, fixed seed and time
// from the URL (?seed=7&t=0). Not part of the production build (vite builds index.html only).
import {
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  Scene,
  SphereGeometry,
  WebGPURenderer,
} from 'three/webgpu';
import { float, positionLocal, vec3 } from 'three/tsl';
import {
  OCTAVES,
  animatedCells,
  differentialRotate,
  domainWarp,
  fbm,
  latLon,
  ridged,
  seedNode,
  tangentFrame,
} from '@/viewer/shaders';

/* eslint-disable @typescript-eslint/no-explicit-any */
const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? 7);
const t = Number(q.get('t') ?? 0);
const W = 600;
const H = 400;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const s = seedNode(seed);
const p: any = positionLocal.mul(2.5);
const oct = OCTAVES.medium;
const grey = (n: any) => vec3(n.mul(0.5).add(0.5));

const tiles: { name: string; color: any }[] = [
  { name: 'fbm', color: grey(fbm(p, oct, s)) },
  { name: 'ridged', color: vec3(ridged(p, oct, s)) },
  { name: 'domainWarp', color: grey(fbm(domainWarp(p, float(0.8), oct, s), oct, s)) },
  { name: 'animatedCells', color: vec3(animatedCells(p, float(t), s)) },
  { name: 'differentialRotate', color: grey(fbm(differentialRotate(p, float(t), 1, 0.3), oct, s)) },
  {
    name: 'tangentFrame',
    color: (() => {
      const { east, north } = tangentFrame(positionLocal.normalize());
      const { lat } = latLon(positionLocal);
      return east
        .mul(0.5)
        .add(0.5)
        .mul(0.6)
        .add(north.mul(0.5).add(0.5).mul(0.2))
        .add(lat.mul(0.05));
    })(),
  },
];

async function main(): Promise<void> {
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  await renderer.init();
  const scene = new Scene();
  const cam = new OrthographicCamera(-3, 3, 2, -2, 0.1, 10);
  cam.position.z = 5;
  const geo = new SphereGeometry(0.9, 64, 32);
  const layout: { name: string; cx: number; cy: number; r: number }[] = [];
  tiles.forEach((tile, i) => {
    const x = (i % 3) * 2 - 2;
    const y = i < 3 ? 1 : -1;
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = tile.color;
    const m = new Mesh(geo, mat);
    m.position.set(x, y, 0);
    scene.add(m);
    layout.push({
      name: tile.name,
      cx: ((x + 3) / 6) * W,
      cy: ((2 - y) / 4) * H,
      r: (0.9 / 6) * W,
    });
  });
  await renderer.compileAsync(scene, cam);
  renderer.render(scene, cam);
  (globalThis as any).__shaderlab = { ready: true, seed, t, tiles: layout };
}

main().catch((e: unknown) => {
  console.error('shaderlab failed', e);
  (globalThis as any).__shaderlab = { ready: false, error: String(e) };
});
