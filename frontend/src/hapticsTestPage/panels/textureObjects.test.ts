// The Texture panel's synthetic bodies build through buildHaptics like the viewer's, and its
// status line is honest about the honesty gate (D-21).
import { describe, expect, it } from 'vitest';
import { buildHaptics } from '@/haptics/profiles';
import { RecordingSink } from '@/test/hapticRecorder';
import { padRegion, touchStatus } from './TexturePanel';
import { BODY_LABEL, syntheticObject, type BodyKind } from './textureObjects';

const EXPECT: Record<BodyKind, [string | null, string | null, string[]]> = {
  gas: ['flow', 'teq_pulse', []],
  water: ['terrain', 'teq_pulse', []],
  rocky: ['terrain', 'teq_pulse', []],
  asteroid: ['height', null, ['crater_rims']],
  comet: [null, 'field', []],
  nebula: [null, 'field', []],
};

function build(kind: BodyKind) {
  const o = syntheticObject(kind, { teqTag: 'measured', epoch: '2025-12' });
  return buildHaptics(new RecordingSink(), o.params, o.card, o.body, o.options);
}

describe('Texture panel synthetic bodies', () => {
  it.each(Object.keys(BODY_LABEL) as BodyKind[])('%s builds through buildHaptics', (kind) => {
    const b = build(kind);
    const [texture, data, missing] = EXPECT[kind];
    expect(b.texture?.id ?? null).toBe(texture);
    expect(b.data?.id ?? null).toBe(data);
    expect(b.missing).toEqual(missing);
  });

  it('the gas giant feels its rings', () => {
    expect(build('gas').rings).toBe(true);
  });

  it('the status line says when the honesty gate silences the texture', () => {
    const b = build('gas');
    expect(touchStatus('idle', b, 'artistic')).toBe('Not touching.');
    expect(touchStatus('moving', b, 'derived')).toBe(
      'Texture silent: shown only with + Artistic (now + Estimated).',
    );
    expect(touchStatus('moving', b, 'artistic')).toMatch(/plays only in \+ Artistic/);
    expect(touchStatus('holding', b, 'measured')).toBe('Holding still: data pulse (measured).');
    const derived = syntheticObject('water', { teqTag: 'derived', epoch: '2025-08' });
    const bw = buildHaptics(
      new RecordingSink(),
      derived.params,
      derived.card,
      derived.body,
      derived.options,
    );
    expect(touchStatus('holding', bw, 'measured')).toBe(
      'Data pulse silent: shown from + Estimated (now Measured only).',
    );
    expect(touchStatus('moving', build('comet'), 'measured')).toMatch(/Data field silent/);
  });

  it('describes the keyboard point in words', () => {
    expect(padRegion(10, 10)).toBe('upper left');
    expect(padRegion(128, 64)).toBe('centre');
    expect(padRegion(250, 120)).toBe('lower right');
  });
});
