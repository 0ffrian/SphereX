// Registers every renderer with the registry. Add one line per renderer family.
import { registerBodyRenderer } from './bodyRenderer';
import { SHADER_KINDS } from './shaderSpec';
import { createShaderBody } from './ShaderBody';

registerBodyRenderer(SHADER_KINDS, createShaderBody);

export { createBodyRenderer } from './bodyRenderer';
