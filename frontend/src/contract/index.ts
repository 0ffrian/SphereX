// Data contract: R3 (TV, ObjectCard, RenderParams) and R8.8 (haptics types). D-02, D-04, D-10, D-12.
// generated.ts comes from shared/schemas/ (D-18); the other files here are hand-written helpers.
import type { VisibleMode } from './generated';

export type { Tag, TV } from './tags';
export { TAGS } from './tags';
export type {
  ObjectType,
  ObjectCard,
  LightcurvePoint,
  CometEpoch,
  GasQ,
  Pair,
  Triple,
  TVNumber,
  TVString,
  TVRgb,
  TVVec3,
  TVPair,
  RenderParams,
  Layer,
  RenderTextures,
  RenderLighting,
  ViewModes,
  VisibleMode,
} from './generated';
export { OBJECT_TYPES } from './generated';
/** D-23: IRMode uses the same shape as VisibleMode; `channels_um` is set on IRMode only. */
export type IRMode = VisibleMode;
export type {
  HapticKind,
  HapticEvent,
  HapticDriver,
  HapticProfile,
  TextureHaptic,
  DataHaptic,
} from './haptics';
export { assertTagged, isValidlyTagged, ProvenanceError, type Tagged } from './assertTagged';
