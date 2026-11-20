// §12.2 caption model and §12.3 air facts.
import { describe, expect, it } from 'vitest';
import {
  airFacts,
  bedDirection,
  caption,
  ceilingCaption,
  CEILING_TEXT,
  EYE_TEXT,
  LAVA_GAP_TEXT,
  levelNote,
  sig2,
} from './captions';
import { earthAir, makePlace, makeWind, marsAir, venusAir } from './fakeEngine.testutil';
import type { MixFrame } from './types';

const frame = (beds: MixFrame['beds'], presentOffsetDb = 0, silent = false): MixFrame => ({
  beds,
  presentOffsetDb,
  silent,
  caption: { line: '', heard: [], levelNote: null, silentReason: null },
});
const level = (id: MixFrame['beds'][number]['id'], trueDb: number) => ({
  id,
  variant: 0,
  trueDb,
  gainDb: trueDb - 70,
  lowpassHz: 16000,
  shelfDb: 0,
  pan: 0,
  playbackRate: 1,
  harmonic: false,
});

describe('captions', () => {
  it('names the loudest beds with direction and wind type', () => {
    const place = makePlace(
      0.3,
      (s) => ({
        cls: s.s_km > 0 && Math.cos(s.bearing) < -0.5 ? 'sea' : 'land',
        coast: s.s_km > 0 && Math.cos(s.bearing) < -0.5,
      }),
      { exposure: 0.6, wind: makeWind({ U10: 10, dirDeg: 45 }) },
    );
    const c = caption(earthAir(), place, frame([level('S1_land', 60), level('S4', 55)]));
    expect(c.line).toBe('Strong trade wind from the north-east on a ridge · surf to the south');
    expect(c.heard.map((h) => h.relDb)).toEqual([0, -5]);
    expect(bedDirection('S4', place)).toBe('to the south');
  });
  it('silence and refusal reasons replace the line', () => {
    const air = {
      ...earthAir(),
      airOK: false,
      refusals: [{ source: 'all' as const, reason: 'No air here, so there is no sound.' }],
    };
    expect(caption(air, makePlace(1), frame([])).line).toBe('No air here, so there is no sound.');
  });
  it('the hurricane eye has its own line', () => {
    const p = makePlace(0.3, () => ({}), {
      cyclone: { delta: 0, r: 0.05, Rm: 0.0075, inEye: true },
    });
    expect(caption(earthAir({ Vmax: 70 }), p, frame([level('S1_land', 40)])).line).toBe(EYE_TEXT);
  });
  it('level notes round to 5 dB and say which way the level moved', () => {
    expect(levelNote(2.9).note).toBeNull();
    expect(levelNote(20.9).note).toBe(
      'Real level: about 20 dB quieter than on Earth (raised so you can hear it)',
    );
    expect(levelNote(-18).note).toBe('Real level: about 20 dB louder than on Earth (lowered)');
  });
  it('red M5: a sea breeze is named from the sea side; a hurricane gets no invented direction', () => {
    const coast = makePlace(
      0.3,
      (s) =>
        s.s_km > 0 && Math.sin(s.bearing) < -0.5 ? { cls: 'sea', T: 290 } : { cls: 'land', T: 300 },
      {
        wind: makeWind({
          U10: 5,
          dirDeg: 45,
          parts: [
            { kind: 'breeze', U: 4 },
            { kind: 'trade', U: 3 },
          ],
        }),
      },
    );
    expect(caption(earthAir(), coast, frame([level('S1_land', 60)])).line).toBe(
      'Steady sea breeze from the west',
    );
    const storm = makePlace(0.3, () => ({}), {
      wind: makeWind({ U10: 40, parts: [{ kind: 'hurricane', U: 40 }] }),
    });
    expect(caption(earthAir({ Vmax: 70 }), storm, frame([level('S1_land', 80)])).line).toBe(
      'Storm-force hurricane wind',
    );
  });
  it('lava around the listener that cannot be heard is captioned honestly', () => {
    const lava = { ...earthAir(), lavaWorld: true };
    const p = makePlace(0.3, () => ({ cls: 'lava' }), { wind: makeWind({ U10: 5 }) });
    const silentS8 = { ...level('S8', -120), gainDb: -120 };
    expect(caption(lava, p, frame([level('S1_land', 50), silentS8])).line.toLowerCase()).toContain(
      LAVA_GAP_TEXT.toLowerCase().slice(0, -1),
    );
  });
  it('the CO2 two-speed fact only at the thin end', () => {
    expect(airFacts(venusAir()).some((f) => f.label === 'Two speeds of sound')).toBe(false);
  });
  it('air facts include the CO2 two-speed note', () => {
    const facts = airFacts(marsAir());
    expect(facts.find((f) => f.label === 'Two speeds of sound')?.text).toContain('240 Hz');
    expect(airFacts({ ...earthAir(), airOK: false })).toEqual([]);
  });

  it('Q-447: the ceiling caption adds the action and the derived height, 2 significant figures', () => {
    expect(sig2(97.16)).toBe('97');
    expect(sig2(1234)).toBe('1200');
    expect(sig2(4.56)).toBe('4.6');
    expect(ceilingCaption(earthAir())).toBe(`${CEILING_TEXT} Fly below about 97 km to hear it.`);
    // Mars-like: 11.1 km × ln(600) ≈ 71 km
    expect(ceilingCaption(marsAir())).toBe(`${CEILING_TEXT} Fly below about 71 km to hear it.`);
    // no usable height (surface already below the floor): the exact §4.1 text alone
    expect(ceilingCaption(earthAir({ P0: 0.5 }))).toBe(CEILING_TEXT);
  });
});
