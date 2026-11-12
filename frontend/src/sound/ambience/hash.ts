// Spec R13 App. B (contract amendment 1): `hash32`, owned by #113. FNV-1a (32-bit) over the UTF-16 code units of
// `parts.join('|')`, so `hash32(seed, 'S1_land', 0)` hashes the string "<seed>|S1_land|0" (§9.3). Pure and exact:
// only Math.imul, xor and shifts, so every JavaScript engine gives the same value.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit of `parts.join('|')`, as an unsigned integer. */
export function hash32(...parts: (string | number)[]): number {
  const s = parts.join('|');
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}
