// Issue #71 stream G, D-36: the star close-up of the mock-up's build split (mockup/closeup-star.html
// inside #cuPane): a flare at the edge of the star with the star's own surface below, always
// playing, filling its parent box. Self-contained: owns its renderer (three r187, WebGPU with the
// WebGL2 fallback), its clock and its caption; the host only gives it a box and `StarCloseUpProps`
// (see `closeUpFor`). Under reduced motion it shows one still frame (the impulsive stage).
import { useEffect, useRef, useState } from 'react';
import { WebGPURenderer } from 'three/webgpu';
import { StarCloseUpScene, type StarCloseUpProps } from '@/viewer/renderers/starCloseUpScene';
import { StillStarCache } from '@/viewer/renderers/stillStarCache';

/** Seconds the 60 minutes of a flare take on screen (the prototype: 22 s), and where a still frame sits. */
const PLAY_SECONDS = 22;
const STILL_T = 0.36;

const reduced = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export function StarCloseUp(props: StarCloseUpProps & { className?: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [caption, setCaption] = useState('');
  const [failed, setFailed] = useState(false);
  const sceneRef = useRef<StarCloseUpScene | null>(null);
  const { physics, tint, emissive, limbU, seed, flare, className } = props;

  // Build the renderer and scene once per star.
  useEffect(() => {
    const host = box.current;
    if (!host) return;
    let dead = false;
    let raf = 0;
    let renderer: WebGPURenderer | null = null;
    let scene: StarCloseUpScene | null = null;
    // Issue #93 W1 (1.12): the still star is drawn once into a picture and shown behind the plasma.
    let cache: StillStarCache | null = null;
    let draw: (() => void) | null = null;
    const ro = new ResizeObserver(() => size());
    function size() {
      if (!renderer || !scene || !host) return;
      const w = Math.max(2, host.clientWidth);
      const h = Math.max(2, host.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(w, h, false);
      scene.setAspect(w / h);
      // A still frame (reduced motion) has no loop: draw the new size now.
      if (reduced()) draw?.();
    }
    (async () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
        canvas.setAttribute('aria-hidden', 'true');
        host.appendChild(canvas);
        renderer = new WebGPURenderer({ canvas, antialias: true });
        await renderer.init();
        if (dead) return renderer.dispose();
        scene = new StarCloseUpScene({ physics, tint, emissive, limbU, seed, flare });
        sceneRef.current = scene;
        cache = new StillStarCache(scene);
        setCaption(scene.caption);
        size();
        ro.observe(host);
        const still = reduced();
        let t = still ? STILL_T : 0.08;
        let last = performance.now();
        const frame = (now: number) => {
          if (dead || !renderer || !scene) return;
          if (!still) {
            t += Math.min(0.06, (now - last) / 1000) / PLAY_SECONDS;
            if (t > 1) t = 0.08;
          }
          last = now;
          scene.setStage(t);
          draw?.();
          if (!still) raf = requestAnimationFrame(frame);
        };
        draw = () => {
          if (!renderer || !scene) return;
          if (cache) {
            try {
              cache.render(renderer);
              return;
            } catch (err) {
              // Never blank: the live star draws instead.
              console.warn('[close-up] cached star failed; drawing it live', err);
              cache.dispose();
              cache = null;
            }
          }
          renderer.render(scene.scene, scene.camera);
        };
        raf = requestAnimationFrame(frame);
      } catch (err) {
        console.warn('[close-up] could not start the renderer', err);
        if (!dead) setFailed(true);
      }
    })();
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      sceneRef.current = null;
      draw = null;
      cache?.dispose();
      scene?.dispose();
      renderer?.dispose();
      host.replaceChildren();
    };
    // The flare is applied in place below; a new star rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physics, tint, emissive, limbU, seed]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.setFlare(flare);
    setCaption(s.caption);
  }, [flare]);

  return (
    <div
      ref={box}
      className={`relative h-full w-full overflow-hidden bg-black ${className ?? ''}`}
      data-testid="star-closeup"
      role="img"
      aria-label={`Simulated flare at the edge of the star. ${caption}`}
    >
      {failed && (
        <div className="absolute inset-0 grid place-content-center p-5 text-center text-sm text-neutral-400">
          This browser could not start the 3D close-up of the flare.
        </div>
      )}
    </div>
  );
}
