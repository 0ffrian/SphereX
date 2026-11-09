// Issue #62: the mean brightness of a loaded texture, so a baked band map can be drawn as brightness
// variation on another colour (the infrared view of a brown dwarf): `luma / mean` is 1 on average, so
// the body keeps its own average colour and only the pattern shows. CPU, once per texture, on a
// 64 x 32 downsample. Without a canvas (a test environment) it answers null and the pattern is
// applied unnormalised (a gain of 1), never guessed.
//
// Display only: the canvas downsample is browser-dependent, so the mean is not byte-identical across
// browsers. The determinism rule is about the baked textures (backend), which this does not touch.

const W = 64;
const H = 32;

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** Mean Rec. 709 luma of an sRGB image, in linear light; null when it cannot be read. */
export function meanLuma(image: unknown): number | null {
  try {
    if (image === null || typeof image !== 'object') return null;
    const canvas: HTMLCanvasElement | OffscreenCanvas | null =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(W, H)
        : typeof document !== 'undefined'
          ? Object.assign(document.createElement('canvas'), { width: W, height: H })
          : null;
    const ctx = canvas?.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image as CanvasImageSource, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum +=
        0.2126 * toLinear(data[i]!) +
        0.7152 * toLinear(data[i + 1]!) +
        0.0722 * toLinear(data[i + 2]!);
    }
    const mean = sum / (W * H);
    return Number.isFinite(mean) && mean > 1e-4 ? mean : null;
  } catch {
    return null;
  }
}
