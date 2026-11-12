// Issue #93 W1 (render notes 1.12): the star close-up with its still star drawn once into a picture.
//
// The star below the flare in `StarCloseUpScene` never moves (its clock is held at 0), so its surface shader gives the
// same picture every frame. This draws that picture into a render target the first time (and again when the drawing
// buffer or the window shape changes), then each frame shows it behind the plasma (`StarCloseUpScene.setStill`). The
// target matches the renderer's own framebuffer target (r187: `getOutputBufferType()`, half float by default, and
// `samples`), so the cached picture is what the direct draw would have produced; only the half-float rounding of
// "star + plasma" can differ, by at most one level in a few pixels (measured in the #93 W1 report).
import { NearestFilter, RenderTarget, Vector2, type WebGPURenderer } from 'three/webgpu';
import type { StarCloseUpScene } from './starCloseUpScene';

export class StillStarCache {
  private rt: RenderTarget | null = null;
  private key = '';
  private readonly size = new Vector2();
  /** How many times the star has been drawn into the picture (tests and the bench read it). */
  bakes = 0;

  constructor(private readonly s: StarCloseUpScene) {}

  /** Draws one frame: the cached star (drawn first when stale), then the plasma over it. */
  render(renderer: WebGPURenderer): void {
    const { x: w, y: h } = renderer.getDrawingBufferSize(this.size);
    if (w < 1 || h < 1) return;
    const key = `${w}x${h}|${renderer.samples}|${this.s.viewVersion}`;
    if (key !== this.key || !this.rt) this.bake(renderer, w, h, key);
    else if (this.s.stillMode !== 'cached') this.s.setStill('cached', this.rt.texture);
    renderer.render(this.s.scene, this.s.camera);
  }

  /** Forgets the picture: the next frame draws the star again. */
  invalidate(): void {
    this.key = '';
  }

  private bake(renderer: WebGPURenderer, w: number, h: number, key: string): void {
    const samples = renderer.samples;
    if (!this.rt || this.rt.samples !== samples) {
      this.rt?.dispose();
      this.rt = new RenderTarget(w, h, {
        type: renderer.getOutputBufferType(),
        samples,
        depthBuffer: true,
        generateMipmaps: false,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
      });
    } else this.rt.setSize(w, h);
    const prev = renderer.getRenderTarget();
    this.s.setStill('bake');
    renderer.setRenderTarget(this.rt);
    renderer.render(this.s.scene, this.s.camera);
    renderer.setRenderTarget(prev);
    this.s.setStill('cached', this.rt.texture);
    this.key = key;
    this.bakes++;
  }

  /** Back to the live star; frees the picture. */
  dispose(): void {
    this.s.setStill('live');
    this.rt?.dispose();
    this.rt = null;
    this.key = '';
  }
}
