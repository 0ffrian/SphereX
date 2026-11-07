// DEV/TEST FIXTURES ONLY. A minimal 8-bit grayscale and RGBA PNG encoder in plain TypeScript: CRC-32,
// Adler-32 and stored (uncompressed) deflate blocks, so it needs no zlib and runs the same in
// Node, the browser and Vitest. Same pixels → same bytes.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function chunk(type: string, data: Uint8Array): number[] {
  const typed = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) typed[i] = type.charCodeAt(i);
  typed.set(data, 4);
  return [...u32(data.length), ...typed, ...u32(crc32(typed))];
}

/** zlib stream made of stored deflate blocks (max 65 535 bytes each). */
function zlibStored(raw: Uint8Array): Uint8Array {
  const out: number[] = [0x78, 0x01];
  const MAX = 65535;
  let pos = 0;
  do {
    const len = Math.min(MAX, raw.length - pos);
    const final = pos + len >= raw.length ? 1 : 0;
    out.push(final, len & 0xff, len >>> 8, ~len & 0xff, (~len >>> 8) & 0xff);
    for (let i = 0; i < len; i++) out.push(raw[pos + i]!);
    pos += len;
  } while (pos < raw.length);
  out.push(...u32(adler32(raw)));
  return Uint8Array.from(out);
}

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function encodePng(
  width: number,
  height: number,
  pixels: Uint8Array,
  channels: 1 | 4,
  colorType: 0 | 6,
): Uint8Array {
  const rowBytes = width * channels;
  if (pixels.length !== rowBytes * height) throw new Error('pixel count does not match size');
  const ihdr = Uint8Array.from([...u32(width), ...u32(height), 8, colorType, 0, 0, 0]);
  const raw = new Uint8Array(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter: none
    raw.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  return Uint8Array.from([
    ...PNG_SIGNATURE,
    ...chunk('IHDR', ihdr),
    ...chunk('IDAT', zlibStored(raw)),
    ...chunk('IEND', new Uint8Array(0)),
  ]);
}

/** `pixels` is row-major, `width × height` bytes, 0 = black. */
export function encodePngGray(width: number, height: number, pixels: Uint8Array): Uint8Array {
  return encodePng(width, height, pixels, 1, 0); // 8-bit gray
}

/** `pixels` is row-major RGBA, `width × height × 4` bytes, alpha 0 = transparent. */
export function encodePngRgba(width: number, height: number, pixels: Uint8Array): Uint8Array {
  return encodePng(width, height, pixels, 4, 6); // 8-bit RGBA
}

/** `rgb` is row-major, `width × height × 3` bytes (8-bit RGB, colour type 2). */
export function encodePngRgb(width: number, height: number, rgb: Uint8Array): Uint8Array {
  if (rgb.length !== width * height * 3) throw new Error('pixel count does not match size');
  const ihdr = Uint8Array.from([...u32(width), ...u32(height), 8, 2, 0, 0, 0]); // 8-bit RGB
  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const parts = [
    Uint8Array.from(PNG_SIGNATURE),
    Uint8Array.from(chunk('IHDR', ihdr)),
    Uint8Array.from(chunk('IDAT', zlibStored(raw))),
    Uint8Array.from(chunk('IEND', new Uint8Array(0))),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
