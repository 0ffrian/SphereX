// Test helper (issue #71 stream H): builds a NodeMaterial's fragment shader to WGSL with three's own
// WGSLNodeBuilder and a stub renderer, so the TSL graph (and every `Fn` body, which only runs at
// build time) is exercised without a GPU. It catches graph and type errors, not visual ones.
import { NodeMaterial, QuadMesh, Scene, WGSLNodeBuilder } from 'three/webgpu';
import { context } from 'three/tsl';

export function buildWgsl(fragmentNode: unknown): string {
  const material = new NodeMaterial();
  material.fragmentNode = fragmentNode as never;
  const quad = new QuadMesh(material);
  const stub = {
    contextNode: context({}),
    library: { fromMaterial: (m: unknown) => m },
    debug: { diagnostics: { keywords: false } },
    backend: {
      utils: { getTextureSampleData: () => ({ primarySamples: 1, samples: 1, isMSAA: false }) },
      get: () => ({}),
    },
    outputColorSpace: 'srgb',
    toneMapping: 0,
    coordinateSystem: 2000,
    hasFeature: () => true,
    getRenderTarget: () => null,
    getMRT: () => null,
    getDrawingBufferSize: () => ({ x: 1, y: 1 }),
  };
  const b = new WGSLNodeBuilder(quad, stub as never) as unknown as {
    material: unknown;
    camera: unknown;
    scene: unknown;
    build(): void;
    fragmentShader: string;
  };
  b.material = material;
  b.camera = quad.camera;
  b.scene = new Scene();
  b.build();
  return b.fragmentShader;
}
