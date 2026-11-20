// §10 the per-tick pipeline (R13.8) and §13 lifecycle wiring (R13.10), free of React and rAF so tests drive it with a
// fake clock (coordinator ruling C9, blue 13). useAmbience owns the 10 Hz rAF throttle and the subscriptions.
//
// Each tick: read the engine through its accessors (never cache its arrays: #93's simulation swaps them), rebuild the
// AirModel while the world forms or waits (C7) or after a debounced physics change, sample the place, run the strike
// scheduler STRIKE_LOOKAHEAD_S ahead and publish the weather snapshot (with or without sound), then, when sound may
// play, select and request beds, pull the ready set from the palette (C4), mix and fire thunder. An audio-graph
// exception logs once and fades the sound for good; a place or sampling exception only skips that tick and retries
// (m1). The fly view never breaks (C9).
import type { CardToWorldOk } from '@/engine/worlds/cardToWorld';
import { airAt } from './air';
import { buildAirModel, isWaiting, REFUSAL_TEXT } from './airModel';
import { airFacts, ceilingCaption } from './captions';
import { isOneShot } from './dsp';
import { bedKey, mixFrame } from './levels';
import type { AmbienceMixer, BufferSource, Timers } from './mixer';
import { worldKeyOf } from './palette';
import { samplePlace, type WorldEngineWithSpinup } from './place';
import { selectBeds } from './sources';
import {
  fadeDone,
  flyLive,
  soundGate,
  step,
  type AmbienceStatus,
  type GateInputs,
} from './ambienceState';
import {
  CAPTION_MIN_S,
  FADE_S,
  REBAKE_DEBOUNCE_MS,
  STOP_MARGIN_S,
  STRIKE_LOOKAHEAD_S,
} from './tuning';
import type {
  AirModel,
  BedSpec,
  MixFrame,
  Place,
  Refusal,
  SourceId,
  Strike,
  TaggedInput,
} from './types';
import {
  lightningRate,
  lightningRule,
  StrikeScheduler,
  weatherVisualFrame,
  type LightningRule,
} from './weather';
import type { WeatherSnapshot } from './weatherBus';
import { windAt } from './wind';

/** What the loop needs from the palette (palette.ts `Palette` satisfies it). */
export interface PaletteLike extends BufferSource {
  request(beds: BedSpec[], air: AirModel): void;
  unavailable(): Refusal[];
}

/** The UI model the chip and the panel read (ambienceStore). Changes at most every CAPTION_MIN_S, or on a state change. */
export interface AmbienceUi {
  status: AmbienceStatus;
  /** The fly view is live at "+ Artistic" (the chip shows). */
  live: boolean;
  caption: string;
  levelNote: string | null;
  heard: { id: SourceId; phrase: string; relDb: number }[];
  /** Hidden while waiting (R12). */
  notHeard: Refusal[];
  airFacts: { label: string; text: string }[];
  inputs: TaggedInput[];
  selected: number;
  ready: number;
}

export const SOUND_UNAVAILABLE = 'Sound unavailable.';

export const IDLE_UI: AmbienceUi = {
  status: 'idle',
  live: false,
  caption: '',
  levelNote: null,
  heard: [],
  notHeard: [],
  airFacts: [],
  inputs: [],
  selected: 0,
  ready: 0,
};

export interface LoopDeps {
  engine: () => WorldEngineWithSpinup | null;
  /** The world with the applied overrides (for buildAirModel). */
  world: () => CardToWorldOk;
  /** The palette (module singleton), or null when none can be made yet. */
  palette: () => PaletteLike | null;
  /** The mixer for the running context, or null (no context). */
  mixer: () => AmbienceMixer | null;
  publish: (s: WeatherSnapshot | null) => void;
  /** Each new strike, ahead of its t0 (weatherBus.publishStrike). */
  strike: (s: Strike) => void;
  onUi: (ui: AmbienceUi) => void;
  /** Seconds on the strike clock (performance.now() / 1000). */
  clockS: () => number;
  timers: Timers;
  /**
   * The soundscape went idle (true) or became active (false). The holder releases the palette and the mixer after
   * KEEP_ALIVE_MS of idle (§13: leaving and returning within 2 minutes reuses the beds), across mounts.
   */
  idle?: (on: boolean) => void;
  log?: (msg: string, err: unknown) => void;
  /** Tests: replace the place sampler and the AirModel builder (default samplePlace with windAt, buildAirModel). */
  sample?: (e: WorldEngineWithSpinup, air: AirModel) => Place | null;
  buildAir?: (world: CardToWorldOk, e: WorldEngineWithSpinup) => AirModel;
}

export interface AmbienceLoop {
  tick(): void;
  setGate(g: Partial<GateInputs>): void;
  status(): AmbienceStatus;
  /** Last tick duration, ms (dev overlay, the bench). */
  lastTickMs(): number;
  dispose(): void;
}

/** §9.6: the physics inputs whose change rebakes (Ps, fluid, Tstar, orbit, co2) plus gas and locked. */
function physicsKey(e: WorldEngineWithSpinup): string {
  const s = e.state() as unknown as Record<string, unknown>;
  return [s.Ps, s.fluid, s.gas, s.locked, s.Tstar, s.orbit, s.co2].join('|');
}

export function createAmbienceLoop(
  deps: LoopDeps,
  initial: Partial<GateInputs> = {},
): AmbienceLoop {
  const gate: GateInputs = {
    entered: false,
    paused: false,
    hidden: false,
    artistic: false,
    failed: false,
    soundOn: false,
    ambienceOn: false,
    audioRunning: false,
    ...initial,
  };
  let status: AmbienceStatus = 'idle';
  let air: AirModel | null = null;
  let airKey = '';
  let airSettled = false;
  /** m4: while the world forms or waits, the AirModel is rebuilt only when this signature changes. */
  let formingKey = '';
  let pending: { key: string; since: number } | null = null;
  let place: Place | null = null;
  let placeReady = false;
  let worldKey: string | null = null;
  let specs = new Map<string, BedSpec>();
  let selRefusals: Refusal[] = [];
  let requested: string | null = null;
  let scheduler: StrikeScheduler | null = null;
  let rule: LightningRule | null = null;
  let ruleFor: AirModel | null = null;
  let frame: MixFrame | undefined;
  let ui: AmbienceUi = IDLE_UI;
  let uiAt = -Infinity;
  let published = false;
  let fadeTimer: unknown = null;
  let lastPalette: PaletteLike | null = null;
  let audioBroken = false;
  let logged = false;
  let placeLogged = false;
  /** M1/B2: the next push after this tick's mix skips the CAPTION_MIN_S throttle (a status change, a first frame). */
  let uiDirty = false;
  let tickMs = 0;
  let disposed = false;
  const sample =
    deps.sample ?? ((e: WorldEngineWithSpinup, a: AirModel) => samplePlace(e, a, windAt));
  const build = deps.buildAir ?? buildAirModel;

  const log = (msg: string, err: unknown) => {
    if (logged) return;
    logged = true;
    (deps.log ?? ((m, e) => console.warn(m, e)))(msg, err);
  };

  const readyCount = (p: PaletteLike | null) => {
    if (!p) return 0;
    let n = 0;
    for (const s of specs.values()) if (p.get(s.id, s.variant)) n++;
    return n;
  };

  const publishNull = () => {
    if (!published) return;
    published = false;
    deps.publish(null);
  };

  function setStatus(next: AmbienceStatus, effects: readonly string[]) {
    const m = deps.mixer();
    for (const fx of effects) {
      if (fx === 'fadeOut') {
        m?.fadeOut(FADE_S);
        if (fadeTimer !== null) deps.timers.clear(fadeTimer);
        fadeTimer = deps.timers.set(
          () => {
            fadeTimer = null;
            const was = status;
            status = fadeDone(status);
            if (status !== was) onStatus();
          },
          (FADE_S + STOP_MARGIN_S) * 1000,
        );
      } else if (fx === 'fadeIn') {
        if (fadeTimer !== null) deps.timers.clear(fadeTimer);
        fadeTimer = null;
        m?.fadeIn();
      }
    }
    if (next === status) return;
    status = next;
    onStatus();
  }

  function onStatus() {
    // §13: beds stay cached for KEEP_ALIVE_MS after the soundscape goes idle (the holder owns that timer).
    deps.idle?.(
      status === 'idle' || status === 'noSurface' || status === 'error' || status === 'waiting',
    );
    pushUi(true);
    // M1/B2: a status change pushed before this tick's mix frame existed; push once more, unthrottled, after the mix,
    // so the caption is never left blank or stale for CAPTION_MIN_S.
    uiDirty = true;
  }

  /** Q-447: the listener is above the §4.1 silence ceiling (in an atmosphere that carries sound at the ground). */
  function aboveCeiling(): boolean {
    return !!air && !!place && air.airOK && airAt(air, place.features.z_km).silent;
  }

  function evaluate() {
    if (disposed) return;
    if (audioBroken) {
      setStatus('error', status === 'baking' || status === 'playing' ? ['fadeOut'] : []);
      pushUi(true);
      return;
    }
    const p = deps.palette();
    const r = step(status, { gate, placeReady, selected: specs.size, ready: readyCount(p) });
    setStatus(r.status, r.effects);
  }

  function captionFor(): { caption: string; levelNote: string | null } {
    switch (status) {
      case 'waiting':
        return { caption: REFUSAL_TEXT.waiting, levelNote: null };
      case 'noSurface':
        return { caption: REFUSAL_TEXT.dataGap, levelNote: null };
      case 'error':
        return { caption: SOUND_UNAVAILABLE, levelNote: null };
      case 'baking':
        // Q-447: above the ceiling nothing would play, whatever is baked: say so (and how to hear it) at once.
        if (aboveCeiling()) return { caption: ceilingCaption(air!), levelNote: null };
        return {
          caption: `Preparing sounds (${readyCount(deps.palette())} of ${specs.size})…`,
          levelNote: null,
        };
      case 'playing': {
        if (!frame) return { caption: aboveCeiling() ? ceilingCaption(air!) : '', levelNote: null };
        const c = frame.caption;
        const line = c.silentReason ?? c.line;
        if (!line && specs.size === 0) {
          const all = selRefusals.find((x) => x.source === 'all');
          return { caption: all?.reason ?? '', levelNote: null };
        }
        return { caption: line, levelNote: c.levelNote };
      }
      default:
        return { caption: '', levelNote: null };
    }
  }

  function pushUi(force: boolean) {
    const now = deps.clockS();
    if (!force && now - uiAt < CAPTION_MIN_S) return;
    const { caption, levelNote } = captionFor();
    const waiting = status === 'waiting' || (air !== null && isWaiting(air));
    const notHeard = waiting ? [] : [...selRefusals, ...(deps.palette()?.unavailable() ?? [])];
    const next: AmbienceUi = {
      status,
      live: flyLive(gate),
      caption,
      levelNote,
      heard: status === 'playing' && frame ? frame.caption.heard : [],
      notHeard,
      airFacts: air && !waiting ? airFacts(air) : [],
      inputs: air && !waiting ? air.inputs : [],
      selected: specs.size,
      ready: readyCount(deps.palette()),
    };
    const sig = (u: AmbienceUi) =>
      JSON.stringify([
        u.status,
        u.live,
        u.caption,
        u.levelNote,
        u.heard,
        u.notHeard,
        u.airFacts.length,
        u.inputs.length,
        u.selected,
        u.ready,
      ]);
    uiAt = now;
    if (sig(next) === sig(ui)) return;
    ui = next;
    deps.onUi(ui);
  }

  /**
   * The signature of everything buildAirModel's answer depends on while the world forms or waits (m4): the physics key,
   * the world and its applied overrides, whether the engine still spins up, and whether the climate and hydro fields
   * (R12's readiness) exist yet. All cheap reads: cpuFields() builds a small object of references.
   */
  function formingSig(e: WorldEngineWithSpinup, key: string, w: CardToWorldOk): string {
    const cpu = e.cpuFields();
    return [
      key,
      w.preset.id,
      JSON.stringify(w.overrides),
      e.spinup > 0,
      !!cpu?.climate?.stats,
      !!cpu?.hydro,
    ].join('#');
  }

  /**
   * The AirModel for this tick (C7): while forming or waiting it follows the world as soon as the world changes, but is
   * rebuilt only when formingSig changes (m4: not every tick, since readouts() runs worldUi() during the busiest
   * frames); once settled, on a debounced physics change.
   */
  function airFor(e: WorldEngineWithSpinup, now: number): AirModel {
    const key = physicsKey(e);
    if (!air || !airSettled || e.spinup > 0 || isWaiting(air)) {
      const w = deps.world();
      const sig = formingSig(e, key, w);
      if (!air || sig !== formingKey) {
        air = build(w, e);
        formingKey = sig;
      }
      airSettled = e.spinup === 0 && !isWaiting(air);
      airKey = key;
      pending = null;
      return air;
    }
    if (key === airKey) {
      pending = null;
      return air;
    }
    if (!pending || pending.key !== key) pending = { key, since: now };
    else if ((now - pending.since) * 1000 >= REBAKE_DEBOUNCE_MS) {
      air = build(deps.world(), e);
      airKey = key;
      pending = null;
    }
    return air;
  }

  function tick() {
    if (disposed) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const now = deps.clockS();
    let strikes: ReturnType<StrikeScheduler['next']>;
    // ---- place and weather (sound-independent) ----
    try {
      const e = deps.engine();
      if (!flyLive(gate) || !e) {
        placeReady = false;
        publishNull();
        evaluate();
        return;
      }
      const a = airFor(e, now);
      place = e.spinup > 0 ? null : sample(e, a);
      placeReady = !!place && !isWaiting(a);
      if (!place || !placeReady) {
        publishNull();
        evaluate();
        pushUi(false);
        return;
      }
      const wk = worldKeyOf(a);
      if (wk !== worldKey) {
        worldKey = wk;
        const sel = selectBeds(a, place); // §9.4: at the place where this world (or physics) was first heard
        specs = new Map(sel.beds.map((s) => [bedKey(s.id, s.variant), s]));
        selRefusals = sel.refusals;
        requested = null;
        scheduler = new StrikeScheduler(a.seed);
        frame = undefined;
      }
      if (ruleFor !== a) {
        rule = lightningRule(a, a.presetId);
        ruleFor = a;
      }
      const p = deps.palette();
      if (scheduler && p) {
        scheduler.setVariants(
          [...specs.values()]
            .filter((s) => s.id === 'thunder' && p.get('thunder', s.variant))
            .map((s) => s.variant),
        );
      }
      strikes =
        scheduler && rule
          ? scheduler.next(now + STRIKE_LOOKAHEAD_S, lightningRate(a, place, rule), a, place)
          : [];
      const wf = weatherVisualFrame(a, place, strikes);
      const w = place.features.wind;
      published = true;
      deps.publish({
        frame: wf,
        windDirDeg: w.dirDeg,
        U10: w.U10,
        head: place.head,
        lightning: {
          allowed: rule?.allowed ?? false,
          tag: rule?.tag ?? null,
          reason: rule?.reason ?? null,
        },
        tS: now,
      });
      for (const s of strikes) deps.strike(s);
    } catch (err) {
      // m1: the place part touches no audio; a throw here (for example while #93's simulation swaps its arrays) skips
      // this tick and retries on the next one. It never latches the soundscape off.
      if (!placeLogged && import.meta.env.DEV) {
        placeLogged = true;
        (deps.log ?? ((m, e) => console.warn(m, e)))(
          'Ambience: the place loop failed; skipping this tick.',
          err,
        );
      }
      tickMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      return;
    }
    // ---- sound ----
    try {
      const a = air!;
      const pl = place!;
      const p = deps.palette();
      if (p !== lastPalette) {
        lastPalette = p; // a released palette was replaced: ask again
        requested = null;
      }
      // M16: bake as soon as the fly view is live and the ambience is wanted, before the unlock click.
      if (
        p &&
        worldKey &&
        requested !== worldKey &&
        gate.soundOn &&
        gate.ambienceOn &&
        !audioBroken
      ) {
        p.request([...specs.values()], a);
        requested = worldKey;
      }
      evaluate();
      if (
        !audioBroken &&
        (status === 'baking' || status === 'playing') &&
        soundGate(gate) &&
        p &&
        worldKey
      ) {
        const m = deps.mixer();
        if (m) {
          m.setWorld(worldKey);
          const baked = new Set<string>();
          for (const [k, s] of specs)
            if (!isOneShot(s.id, s.variant) && p.get(s.id, s.variant)) baked.add(k);
          if (!frame) uiDirty = true; // the first frame of this world or status: caption it now (M1)
          frame = mixFrame(a, pl, baked, frame, specs);
          m.apply(frame, p);
          for (const s of strikes)
            m.fire(s, a, p, { nowS: now, z_km: pl.features.z_km, head: pl.head });
        }
      }
      const force = uiDirty;
      uiDirty = false;
      pushUi(force);
    } catch (err) {
      log('Ambience: the mixer failed; the soundscape fades out.', err);
      audioBroken = true;
      evaluate();
    }
    tickMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  }

  return {
    tick,
    setGate(g) {
      Object.assign(gate, g);
      if (!flyLive(gate)) publishNull();
      evaluate();
      pushUi(true);
    },
    status: () => status,
    lastTickMs: () => tickMs,
    dispose() {
      if (disposed) return;
      // Unmount (another object, close, failure): fade on the audio clock now; the mixer's own timer stops it.
      Object.assign(gate, { entered: false });
      evaluate();
      publishNull();
      disposed = true;
      if (fadeTimer !== null) deps.timers.clear(fadeTimer);
      // The holder owns the 2-minute release across mounts (StrictMode, close and reopen).
      deps.idle?.(true);
    },
  };
}
