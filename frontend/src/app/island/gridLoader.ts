// The island's 3x3 grid loader (mock-up `GridLoader`, a vanilla port of smoothui's grid-loader):
// which cells are lit for a pattern, and the two looks the island uses. Only the patterns the app
// uses are here; the mock-up's Gemini states (listening, speaking, faces) are not built (#66).

/** Nine cells, row by row; '1' is lit. */
export const PATTERNS = {
  heartbeat: '010111010',
  'ripple-out': '111101111',
  breathing: '000010000',
  'ripple-in': '000010000',
  twinkle: '100001010',
} as const;

export type PatternName = keyof typeof PATTERNS;

/** Milliseconds for one step of a pattern (mock-up SPEEDS). */
export const SPEEDS = { slow: 1500, normal: 800, fast: 400 } as const;

export interface LoaderLook {
  /** `pulse` keeps one pattern; `sequence` steps through `sequence`, one per `speed` period. */
  mode: 'pulse' | 'sequence';
  pattern?: PatternName;
  sequence?: readonly PatternName[];
  speed: keyof typeof SPEEDS;
}

/** At rest: the green heartbeat (mock-up STATES.idle). */
export const IDLE_LOOK: LoaderLook = { mode: 'pulse', pattern: 'heartbeat', speed: 'slow' };

/** While the object is found and its frames searched (mock-up STATES.thinking). */
export const THINKING_LOOK: LoaderLook = {
  mode: 'sequence',
  sequence: ['ripple-out', 'breathing', 'ripple-in', 'twinkle'],
  speed: 'slow',
};

/** The lit cells of the pattern shown at step `idx`. */
export function litCells(look: LoaderLook, idx: number): boolean[] {
  const name =
    look.mode === 'sequence' && look.sequence?.length
      ? look.sequence[idx % look.sequence.length]!
      : (look.pattern ?? 'heartbeat');
  return PATTERNS[name].split('').map((c) => c === '1');
}
