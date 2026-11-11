// Issue #71 stream G, D-36: flares and plasma on the whole star, as three r187 line segments.
// Streaks follow the same arches as the field lines (physics/flares.ts): evaporation, cooling,
// coronal rain, cool surges and siphon flow, each a pure function of the flare's age, so scrubbing
// and reduced motion (one still frame) work. The star's own sphere writes depth, so loops behind
// the disc are hidden by the depth test; `occludedByDisc` is the same rule on the CPU.
//
// ASSUMPTION (Q-271): the prototype accumulates streaks into density and density-times-temperature
// render targets, blurs them and colours by the temperature ramp. Here each streak carries its
// ramp colour and is added to the frame (additive lines, no blur). This runs identically on
// WebGPU and the WebGL2 fallback without render-target plumbing; the bloom of the pipeline gives
// the glow. A render-target pass can replace `StreakLines` without changing the physics module.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicNodeMaterial,
  LineSegments,
} from 'three/webgpu';
import {
  ENLARGE_FACTOR,
  E_REF_ERG,
  STREAK_BUDGET,
  StreakSink,
  emitEvent,
  emitQuiet,
  eventsAt,
  latestEvent,
  makeEvent,
  type FlareEvent,
  type ScheduleContext,
} from '@/physics/flares';
import type { StellarModel } from '@/physics/stellar';
import type { TierName } from '../render/quality';

/** Particle-count scale per quality level: the budget cap is the hard limit, this keeps it filled sensibly. */
const QUALITY_Q: Record<TierName, number> = { high: 1, medium: 0.7, low: 0.4 };

export interface StarPlasmaOptions {
  seed: number;
  physics: StellarModel;
  /** Flares per display second (flare rate times the shown speed-up). */
  ratePerDisplayS: number;
  tier: TierName;
  /** Whole-star scale: loops are enlarged in the enlarged view only (artistic). */
  enlarged: boolean;
}

export class StarPlasma {
  readonly group = new Group();
  private readonly ctx: ScheduleContext;
  private readonly sink: StreakSink;
  private readonly geometry = new BufferGeometry();
  private readonly material: LineBasicNodeMaterial;
  private readonly pos: BufferAttribute;
  private readonly col: BufferAttribute;
  private tier: TierName;
  private lines = true;
  private fired: FlareEvent[] = [];
  private fireCount = 0;
  /** Events drawn in the last frame, for tests and the "Latest flare" card. */
  lastEvents: readonly FlareEvent[] = [];

  constructor(private readonly o: StarPlasmaOptions) {
    this.tier = o.tier;
    this.ctx = {
      seed: o.seed,
      groups: o.physics.groups,
      radiusRsun: o.physics.radiusRsun,
      ratePerDisplayS: o.ratePerDisplayS,
    };
    this.sink = new StreakSink(STREAK_BUDGET.high);
    this.pos = new BufferAttribute(this.sink.pos, 3);
    this.col = new BufferAttribute(this.sink.col, 3);
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('color', this.col);
    this.material = new LineBasicNodeMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const mesh = new LineSegments(this.geometry, this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.group.add(mesh);
  }

  setTier(t: TierName): void {
    this.tier = t;
  }

  /** The "Field lines" toggle: hides every streak and arch when off. */
  setLines(on: boolean): void {
    this.lines = on;
    this.group.visible = on;
  }
  get linesOn(): boolean {
    return this.lines;
  }

  /** Streak budget at the current quality level. */
  get budget(): number {
    return STREAK_BUDGET[this.tier];
  }

  /**
   * "Fire a big flare": starts a flare of 3e31 erg (capped to the largest group's E_max) at the
   * biggest group, now. Event index is negative so it never collides with the schedule.
   */
  fire(tDisplay: number): FlareEvent | null {
    const g = this.ctx.groups[0];
    if (!g) return null;
    this.fireCount++;
    const e = makeEvent(this.ctx, -this.fireCount, tDisplay, g, 30 * E_REF_ERG);
    this.fired.push(e);
    return e;
  }

  /** The newest flare started by display time t (scheduled or fired). */
  latest(tDisplay: number): FlareEvent | null {
    let best = latestEvent(this.ctx, this.stillAdjusted(tDisplay));
    for (const f of this.fired) if (f.t0 <= tDisplay && (!best || f.t0 > best.t0)) best = f;
    return best;
  }

  /** At clock 0 (reduced motion, or just opened) show one still frame: the first flare mid-life. */
  private stillAdjusted(t: number): number {
    if (t > 0 || this.fired.length > 0) return t;
    if (this.still === null) {
      this.still = 0;
      for (let k = 0; k < 400; k++) {
        const ev = eventsAt(this.ctx, k * 0.5);
        if (ev.length) {
          this.still = ev[0]!.t0 + ev[0]!.life * 0.45;
          break;
        }
      }
    }
    return this.still;
  }
  private still: number | null = null;

  /** Poses the plasma at display time `tDisplay` (seconds of the flare schedule). Pure in (state, time). */
  setTime(tDisplay: number): void {
    const sink = this.sink;
    sink.reset();
    const q = QUALITY_Q[this.tier];
    const boost = this.o.enlarged ? ENLARGE_FACTOR : 1;
    const opts = { boost, q, clock: tDisplay };
    const groups = this.o.physics.groups;
    // Respect the budget of the current level.
    const cap = this.budget;
    sink.cap = cap;
    emitQuiet(sink, groups, this.o.seed, opts);
    const t = this.stillAdjusted(tDisplay);
    const events = [
      ...eventsAt(this.ctx, t),
      ...this.fired.filter((f) => tDisplay >= f.t0 && tDisplay < f.t0 + f.life),
    ];
    this.fired = this.fired.filter((f) => tDisplay < f.t0 + f.life + 30);
    for (const e of events) {
      const g = groups.find((x) => x.id === e.groupId);
      if (g) emitEvent(sink, g, e, e.m < 0 ? tDisplay : t, opts);
    }
    this.lastEvents = events;
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.geometry.setDrawRange(0, sink.n * 2);
  }

  get streakCount(): number {
    return this.sink.n;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.group.clear();
  }
}
