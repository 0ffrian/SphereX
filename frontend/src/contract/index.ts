// Data contract: R3 (TV, ObjectCard, RenderParams) and R8.8 (haptics types). D-02, D-04, D-10, D-12.
export type { Tag, TV } from './tags';
export { TAGS } from './tags';
export type { ObjectType, ObjectCard, LightcurvePoint, CometEpoch } from './objectCard';
export { OBJECT_TYPES } from './objectCard';
export type {
  RenderParams,
  Layer,
  RenderTextures,
  RenderLighting,
  VisibleMode,
  IRMode,
} from './renderParams';
export type {
  HapticKind,
  HapticEvent,
  HapticDriver,
  HapticProfile,
  TextureHaptic,
  DataHaptic,
} from './haptics';
export { assertTagged, isValidlyTagged, ProvenanceError, type Tagged } from './assertTagged';
