// @ts-nocheck
// Issue #93 1.5 (hand-written, not extracted): one terrain build per set of inputs for every engine on the page. The
// globe and the fly engine of one world call buildTerrain and routeTerrain with the same inputs; both are pure
// functions of them (terrain.js, D-37), so the second engine takes the first one's result. The key is every input
// buildTerrain reads: the seed (the only field of the preset it uses), the ocean fraction, gravity and the options.
// Results are shared read-only: no engine code writes to a terrain or a route (checked for #93; hydroRaster,
// lavaRaster, ebInit, groundKm, flyAimPeak and the fieldSampler only read). The last 4 inputs are kept.
// Issue #93 3.4: the key also holds a card world's seed3, which buildTerrain does not read but routeTerrain does (t.so).
import { buildTerrain, routeTerrain } from './terrain.js';

var MAX = 4, entries = [], routes = new WeakMap();

function terrainKey(p, oceanFrac, gv, opt) {
  return [p.seed, p.seed3 ? p.seed3.join(',') : '', oceanFrac, gv, !!opt.stagnant, opt.Tf, opt.Tsurf, !!opt.locked, opt.Gam, opt.wet].join('|');
}

/** buildTerrain(p, oceanFrac, gv, opt), built once per key. */
function terrainCached(p, oceanFrac, gv, opt) {
  var key = terrainKey(p, oceanFrac, gv, opt), i;
  for (i = 0; i < entries.length; i++) if (entries[i].key === key) { var hit = entries.splice(i, 1)[0]; entries.push(hit); return hit.terr; }
  var terr = buildTerrain(p, oceanFrac, gv, opt);
  // #93 3.4: a card world's seed offset for routeTerrain's river relief noise (a preset has none: offset 0, as before).
  if (p.seed3) terr.so = p.seed3.slice(0, 3);
  entries.push({ key: key, terr: terr });
  if (entries.length > MAX) entries.shift();
  return terr;
}

/** routeTerrain(t), computed once per terrain object. */
function routeCached(t) {
  var r = routes.get(t);
  if (!r) { r = routeTerrain(t); routes.set(t, r); }
  return r;
}

function clearTerrainCache() { entries = []; routes = new WeakMap(); }

export { terrainCached, routeCached, terrainKey, clearTerrainCache };
