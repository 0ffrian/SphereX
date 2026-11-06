// Frame pipeline (plan 10.2, issue #39): scene -> HDR (half-float) target -> bloom -> highlight
// clip (in place of the plan's AgX, see `clipHighlights`) -> anti-alias (TAAU on High and Medium, SMAA on Low). three r187 `RenderPipeline` with the
// TSL display nodes from three/addons. Checked against node_modules/three r187:
//   RenderPipeline (src/renderers/common/RenderPipeline.js): ctor(renderer), .outputNode,
//     .outputColorTransform, .needsUpdate, .render(), .dispose()
//   pass / mrt / output / velocity / renderOutput: three/tsl; PassNode#getTextureNode(name)
//   BloomNode: bloom(node, strength, radius, threshold), .setResolutionScale(s)
//   TAAUNode:  taau(beauty, depth, velocity, camera); needs MRT {output, velocity} from the pass
//   SMAANode:  smaa(node); needs tone-mapped sRGB input, hence outputColorTransform = false
import {
  NoToneMapping,
  RenderPipeline,
  type TextureNode,
  type PerspectiveCamera,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn,
  luminance,
  max,
  min,
  mix,
  mrt,
  output,
  pass,
  renderOutput,
  saturate,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';
import { TIERS, type AntiAlias, type TierName } from './quality';

/**
 * Highlight clip used instead of a tone-mapping curve. AgX (the plan's choice) cut chroma by about
 * 10-20% on the fixture renders and Khronos Neutral raised it by about as much; both would show a
 * derived colour (Teff, teq_K) as a different colour than the data gives. This clip is the
 * identity for every in-gamut pixel, so LDR bodies render exactly as before. A pixel with a channel
 * above 1 is pulled toward grey at its own luminance until the brightest channel is 1 (hue kept);
 * luminance at or above 1 becomes white, and bloom carries the glow. Display choice.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL nodes are untyped proxies
export const clipHighlights = Fn(([c]: [any]) => {
  const rgb = c.rgb;
  const m = max(rgb.r, max(rgb.g, rgb.b));
  const l = min(luminance(rgb), 1);
  const s = saturate(m.sub(1).div(max(m.sub(l), 1e-4)));
  return vec4(mix(rgb, vec3(l), s), c.a);
});

/**
 * Bloom threshold on linear scene luminance. 2.0, not 1.0: additive point clouds (nova core) sum
 * past 1 in LDR content, and a lower threshold drew a faint banded halo disc around them. Only
 * clearly HDR emitters (flares, beams, cores) glow. Display choice.
 */
export const BLOOM_THRESHOLD = 2.0;
export const BLOOM_STRENGTH = 0.7;
export const BLOOM_RADIUS = 0.4;
/** TAAU cycles 32 Halton jitter offsets (TAAUNode.js); a settle burst renders one full cycle. */
export const SETTLE_FRAMES_TAAU = 32;
/** SMAA is spatial: one frame is converged, a second covers bloom target allocation. */
export const SETTLE_FRAMES_SMAA = 2;

export interface ChainConfig {
  aa: AntiAlias;
  bloomScale: number;
  /** TAAU needs a velocity attachment on the scene pass. */
  needsVelocity: boolean;
  /** Frames to render after a change so temporal anti-aliasing converges. */
  settleFrames: number;
}

/** What a tier asks of the pipeline (pure; the unit tests read this). */
export function chainConfig(tier: TierName): ChainConfig {
  const t = TIERS[tier];
  return {
    aa: t.aa,
    bloomScale: t.bloomScale,
    needsVelocity: t.aa === 'taau',
    settleFrames: t.aa === 'taau' ? SETTLE_FRAMES_TAAU : SETTLE_FRAMES_SMAA,
  };
}

export class RenderChain {
  private pipeline: RenderPipeline | null = null;
  private cfg: ChainConfig;

  /** Throws if the pipeline cannot be built; the caller falls back to `renderer.render`. */
  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    tier: TierName,
  ) {
    this.cfg = chainConfig(tier);
    // No curve: the fallback path (plain renderer.render) then draws LDR exactly like the chain.
    renderer.toneMapping = NoToneMapping;
    this.build();
  }

  get config(): ChainConfig {
    return this.cfg;
  }

  setTier(tier: TierName): void {
    this.cfg = chainConfig(tier);
    this.build();
  }

  private build(): void {
    const next = new RenderPipeline(this.renderer);
    const scenePass = pass(this.scene, this.camera);
    if (this.cfg.needsVelocity) scenePass.setMRT(mrt({ output, velocity }));
    const color = scenePass.getTextureNode('output');
    const glow = bloom(color, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    glow.setResolutionScale(this.cfg.bloomScale);
    // The d.ts types taau/smaa inputs as TextureNode; the functions wrap any node (convertToTexture).
    const toneMapped = renderOutput(clipHighlights(color.add(glow))) as unknown as TextureNode;
    next.outputColorTransform = false;
    next.outputNode =
      this.cfg.aa === 'taau'
        ? taau(
            toneMapped,
            scenePass.getTextureNode('depth'),
            scenePass.getTextureNode('velocity'),
            this.camera,
          )
        : smaa(toneMapped);
    next.needsUpdate = true;
    this.pipeline?.dispose();
    this.pipeline = next;
  }

  render(): void {
    this.pipeline?.render();
  }

  dispose(): void {
    this.pipeline?.dispose();
    this.pipeline = null;
  }
}
