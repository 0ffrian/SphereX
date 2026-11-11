/* eslint-disable */
// @ts-nocheck
// Issue #71, D-37: the approved prototype's star and flare engine, extracted MECHANICALLY and unchanged.
// Source: .claude/worktrees/sculptor-reference/sculptor-preview-next.html, lines 1029-1211 (flare close-up and light-curve chart).
// Not yet imported by the app: it still needs the TypeScript host (DOM removed, `cardToStar`). Do not edit here;
// re-run the slicing instead so the body stays byte-identical to the prototype.
// @verbatim L1029-L1211
// @rename (PL.ema=>(!window.__sxPin&&PL.ema
/* ---------- flare ---------- */
var FL = { kind: 'open', cls: 'x', t: 0.36, playing: !reduced };
var CLS = { c: 0.55, m: 0.8, x: 1 };
var CLSLBL = { c: 'about 10²⁹ erg', m: 'about 10³⁰ erg', x: 'about 10³¹ erg or more' };
var PH = [
  { id: 'pre', label: 'Stressed field', at: 0.08, closed: 'A twisted rope of plasma sits low along the line between north and south polarities. Loops above hold it down.', open: 'A twisted rope of plasma sits low along the line between north and south polarities. The field above it is weak.' },
  { id: 'trig', label: 'Rope rises', at: 0.22, closed: 'The rope lifts and starts to squeeze the loops above it. They are strong enough to push back.', open: 'The rope lifts. The field above weakens fast enough that each rise makes the next one easier.' },
  { id: 'imp', label: 'Reconnection', at: 0.34, closed: 'Field lines snap and rejoin low in the corona. Fast electrons hit the surface and two bright ribbons flash. The rope stalls.', open: 'A thin current sheet forms under the escaping rope. Field reconnects through it and two bright ribbons flash at the feet.' },
  { id: 'grad', label: 'Hot loops', at: 0.62, closed: 'Heated plasma fills loops that stay about the same size. They cool from white through gold to red, and plasma rains back down.', open: 'New loops stack higher as reconnection climbs, so the ribbons move apart. Field above stays stretched open, and the eruption leaves the star.' },
  { id: 'end', label: 'Afterwards', at: 0.93, closed: 'The field is still closed. Nothing left the star, so this flare sends no eruption into space.', open: 'A coronal mass ejection is on its way out. The opened field slowly closes again behind it.' }
];
var fc = $('#flare-o'), fx = fc.getContext('2d');
var B0 = 12 * Math.PI / 180, cb = Math.cos(B0), sb = Math.sin(B0), PSI = 25 * Math.PI / 180, cp = Math.cos(PSI), sp = Math.sin(PSI);
var V = { h: 0.17, off: [0, 1.085] };
var FLSP = new Float32Array(48 * 4);
(function () { var a = [[-0.05, 0.03], [0.05, -0.03], [-0.085, 0.06], [0.085, -0.06]]; a.forEach(function (o, i) { var x = o[0] * cp + o[1] * -sp, d = o[0] * sp + o[1] * cp; var y = cb - sb * d, z = sb + cb * d, l = Math.hypot(x, y, z); FLSP[i * 4] = x / l; FLSP[i * 4 + 1] = y / l; FLSP[i * 4 + 2] = z / l; FLSP[i * 4 + 3] = 0.018; }); })();
function proj(A, L, w, W, H) {
  var ex = A * cp - L * sp, de = A * sp + L * cp;
  var x = ex, y = (1 + w) * cb - de * sb;
  return [W / 2 + (x - V.off[0]) / V.h * H / 2, H / 2 - (y - V.off[1]) / V.h * H / 2];
}
function arch(W, H, A0, L0, ht, shear, steps) {
  fx.beginPath();
  for (var i = 0; i <= steps; i++) { var s = i / steps, c = Math.cos(Math.PI * s), p = proj(-A0 * c, L0 + shear * c, ht * Math.sin(Math.PI * s), W, H); if (i) fx.lineTo(p[0], p[1]); else fx.moveTo(p[0], p[1]); }
}
function coolColor(a) {
  var s = [[0, [235, 240, 255]], [0.18, [255, 232, 170]], [0.5, [255, 150, 50]], [0.85, [235, 60, 25]], [1.3, [120, 15, 10]]], i = 0;
  while (i < s.length - 2 && a > s[i + 1][0]) i++;
  var t = clamp((a - s[i][0]) / (s[i + 1][0] - s[i][0]), 0, 1);
  return s[i][1].map(function (c, k) { return Math.round(lerp(c, s[i + 1][1][k], t)); });
}
var OVER = [], CORE = [], POST = [];
(function () { var r = rng(44), i;
  for (i = 0; i < 18; i++) OVER.push({ L: lerp(-0.13, 0.13, i / 17) + 0.006 * r(), a: 0.08 + 0.05 * r(), h: 0.07 + 0.05 * r(), s: 0.1 * r() });
  for (i = 0; i < 26; i++) CORE.push({ L: lerp(-0.1, 0.1, i / 25), a: 0.016 + 0.012 * r(), h: 0.014 + 0.012 * r(), s: 0.016 + 0.012 * r() });
  for (i = 0; i < 90; i++) POST.push({ u: i / 89, L: (r() * 2 - 1) * 0.095, h: 1.15 + 0.3 * r(), p: r() });
})();
function ribbon(t, open) { var s = smooth(0.26, 0.82, t); return open ? 0.014 + 0.046 * s : 0.014 + 0.007 * s; }
function impulse(t) { return smooth(0.255, 0.3, t) * (t < 0.34 ? 1 : Math.exp(-(t - 0.34) / 0.12)); }
function ropeZ(t, open) { return open ? 0.024 + 0.045 * smooth(0.16, 0.28, t) + 1.3 * Math.pow(smooth(0.24, 0.72, t), 2.2) : 0.024 + 0.034 * smooth(0.16, 0.3, t) - 0.018 * smooth(0.42, 0.8, t); }
function drawFlare() {
  var dpr = Math.min(devicePixelRatio || 1, 1.5), W = Math.round(fc.clientWidth * dpr), H = Math.round(fc.clientHeight * dpr);
  if (!W || !H) return;
  if (fc.width !== W || fc.height !== H) { fc.width = W; fc.height = H; }
  fx.clearRect(0, 0, W, H);
  fx.globalCompositeOperation = 'lighter'; fx.lineCap = 'round'; fx.lineJoin = 'round';
  var t = FL.t, open = FL.kind === 'open', e = CLS[FL.cls], lw = H / 620, imp = impulse(t), i, k;
  plasmaStage(W, H, t, open, e, lw);
  // field above
  var ko = open ? smooth(0.2, 0.56, t) : 0;
  OVER.forEach(function (o) {
    var h = open ? o.h * (1 + 42 * ko * ko * ko) : o.h * (1 + 0.14 * smooth(0.14, 0.3, t) - 0.08 * smooth(0.4, 0.72, t));
    var a = o.a * (1 - 0.3 * ko), al = (0.17 + 0.1 * imp) * (1 - 0.55 * ko);
    if (SHOW_LINES) { arch(W, H, a, o.L, h, o.s * a, 40); fx.strokeStyle = 'rgba(255,205,135,' + al * 0.6 + ')'; fx.lineWidth = 0.9 * lw; fx.stroke(); }
  });
  // sheared core
  var coreA = 1 - smooth(0.27, 0.4, t);
  if (coreA > 0.01) CORE.forEach(function (o, n) {
    arch(W, H, o.a, o.L, o.h, o.s, 22); fx.strokeStyle = 'rgba(255,' + (150 + 60 * smooth(0.16, 0.26, t)) + ',80,' + (0.3 * coreA) + ')'; fx.lineWidth = 1.2 * lw; fx.stroke();
  });
  // rope
  var z = ropeZ(t, open), ropeA = open ? 1 - 0.75 * smooth(0.55, 0.85, t) : 1 - smooth(0.42, 0.75, t), Lr = 0.12, hot = smooth(0.22, 0.33, t);
  if (ropeA > 0.01 && SHOW_LINES) for (k = 0; k < 11; k++) {
    fx.beginPath();
    var rad = 0.006 + (open ? 0.05 * smooth(0.25, 0.7, t) : 0.004);
    for (i = 0; i <= 64; i++) {
      var u = -1 + 2 * i / 64, ph = u * 13 + k * 0.571 + t * 5, env = Math.pow(Math.max(0, 1 - u * u), 0.55);
      var p = proj(rad * Math.cos(ph) * env + 0.012 * Math.sin(u * 3.14), u * Lr, z * env + rad * Math.sin(ph) * env, W, H);
      if (i) fx.lineTo(p[0], p[1]); else fx.moveTo(p[0], p[1]);
    }
    fx.strokeStyle = 'rgba(255,' + Math.round(lerp(125, 220, hot)) + ',' + Math.round(lerp(55, 190, hot)) + ',' + (0.13 * ropeA) + ')';
    fx.lineWidth = 0.9 * lw; fx.stroke();
  }
  // current sheet
  var r = ribbon(t, open);
  if (open && t > 0.26 && t < 0.8) {
    var sa = smooth(0.26, 0.32, t) * (1 - smooth(0.62, 0.8, t));
    [-0.055, 0, 0.055].forEach(function (L, n) {
      var a = proj(0, L, r * 1.35, W, H), b = proj(0, L, Math.min(z * 0.92, 0.16), W, H);
      fx.beginPath(); fx.moveTo(a[0], a[1]); fx.lineTo(b[0], b[1]);
      fx.strokeStyle = 'rgba(175,215,255,' + (0.34 * sa * (0.75 + 0.25 * Math.sin(t * 900 + n))) + ')'; fx.lineWidth = 2 * lw; fx.stroke();
    });
  }
  // post-flare loops
  var bEnd = open ? 0.84 : 0.56, life = open ? 0.26 : 0.3, count = Math.round(lerp(38, 90, (e - 0.55) / 0.45));
  for (i = 0; i < count; i++) {
    var P = POST[i], born = lerp(0.285, bEnd, Math.pow(P.u, 1.15)), ag = (t - born) / life;
    if (ag <= 0 || ag > 1.35) continue;
    var a0 = ribbon(born, open), ht = a0 * P.h, c = coolColor(ag), al2 = smooth(0, 0.06, ag) * (1 - smooth(0.95, 1.35, ag)) * (0.4 + 0.45 * e);
    if (SHOW_LINES) { arch(W, H, a0, P.L, ht, 0, 26); fx.strokeStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + al2 * 0.2 + ')'; fx.lineWidth = 0.8 * lw; fx.stroke(); }
  }
  // ribbons
  var rA = smooth(0.25, 0.3, t) * (0.25 + 0.75 * Math.exp(-Math.max(0, t - 0.34) / 0.17)) * (0.55 + 0.45 * e);
  if (rA > 0.01) [-1, 1].forEach(function (side, n) {
    [[7, 0.11], [3.4, 0.3], [1.5, 0.95]].forEach(function (s) {
      fx.beginPath();
      for (i = 0; i <= 50; i++) { var u = -1 + 2 * i / 50, wob = 0.0035 * Math.sin(u * 19 + n * 2 + t * 18) + 0.002 * Math.sin(u * 47 + n); var pp = proj(side * (r + wob), u * 0.105, 0.0015, W, H); if (i) fx.lineTo(pp[0], pp[1]); else fx.moveTo(pp[0], pp[1]); }
      fx.strokeStyle = 'rgba(255,' + (s[1] > .5 ? '250,235,' : '215,160,') + s[1] * rA + ')'; fx.lineWidth = s[0] * lw; fx.stroke();
    });
  });
  // flash
  var c0 = proj(0, 0, 0.02, W, H);
  if (imp > 0.01) { var gr = fx.createRadialGradient(c0[0], c0[1], 0, c0[0], c0[1], H * 0.5); gr.addColorStop(0, 'rgba(255,235,205,' + 0.5 * imp * e + ')'); gr.addColorStop(0.22, 'rgba(255,170,90,' + 0.14 * imp * e + ')'); gr.addColorStop(1, 'rgba(255,120,40,0)'); fx.fillStyle = gr; fx.fillRect(0, 0, W, H); }
  // eruption front and spray
  if (open && t > 0.3) {
    var front = H * (0.15 + 1.55 * smooth(0.3, 0.84, t)), fa = 1 - smooth(0.68, 0.98, t);
    [1, 0.84, 0.7].forEach(function (s, n) { fx.beginPath(); fx.arc(c0[0], c0[1], front * s, Math.PI * 1.08, Math.PI * 1.92); fx.strokeStyle = 'rgba(200,220,255,' + (0.3 - n * 0.08) * fa + ')'; fx.lineWidth = (2.6 - n * 0.6) * lw; fx.stroke(); });  }
}
function flareUi() {
  var open = FL.kind === 'open', t = FL.t, i = 0;
  var bounds = [0.16, 0.27, 0.44, 0.86];
  while (i < 4 && t >= bounds[i]) i++;
  [].forEach.call($('#fl-ph').children, function (b, n) { b.setAttribute('aria-pressed', String(n === i)); });
  $('#fl-cap').textContent = open ? PH[i].open : PH[i].closed;
  $('#fl-tv').textContent = fmt(t * 60) + ' minutes';
  $('#fl-t').value = Math.round(t * 1000);
  $('#flare-tag').textContent = (open ? 'Open (eruptive)' : 'Closed (confined)') + ' · Class ' + FL.cls.toUpperCase() + ', ' + CLSLBL[FL.cls] + ' · Hydrogen-alpha with hot loops';
  chartHead();
}
/* chart */
var CH = { x0: 44, x1: 512, y0: 124, y1: 12 };
function sxrAt(t, open) { var tau = open ? 0.27 : 0.15, r = smooth(0.26, 0.47, t); return t < 0.47 ? r : Math.exp(-(t - 0.47) / tau); }
function series(open) {
  var s = [], h = [], i, mx = 0, n = 240, r = rng(5), sp = [];
  for (i = 0; i <= n; i++) sp.push(0.72 + 0.56 * r());
  for (i = 0; i <= n; i++) { var t = i / n, a = sxrAt(t, open), b = sxrAt(t + 1 / n, open), d = Math.max(0, (b - a) * n); s.push(a); h.push(d * sp[i]); mx = Math.max(mx, h[i]); }
  return { s: s, h: h.map(function (x) { return x / mx; }) };
}
var X = function (t) { return lerp(CH.x0, CH.x1, t); }, Y = function (v) { return lerp(CH.y0, CH.y1, v); };
var SER = null;
function chartBase() {
  var open = FL.kind === 'open'; SER = series(open);
  function path(a) { return a.map(function (v, i) { return (i ? 'L' : 'M') + X(i / 240).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(''); }
  var g = '', i;
  [0, 0.5, 1].forEach(function (v) { g += '<line x1="' + CH.x0 + '" x2="' + CH.x1 + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#2a2a30"/><text x="' + (CH.x0 - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end" fill="#a1a1aa" font-size="11" font-family="monospace">' + v + '</text>'; });
  for (i = 0; i <= 60; i += 15) g += '<text x="' + X(i / 60) + '" y="' + (CH.y0 + 18) + '" text-anchor="middle" fill="#a1a1aa" font-size="11" font-family="monospace">' + i + '</text>';
  g += '<text x="' + CH.x1 + '" y="' + (CH.y0 + 34) + '" text-anchor="end" fill="#a1a1aa" font-size="11">minutes</text>';
  g += '<path d="' + path(SER.h) + '" fill="none" stroke="#2f9bd4" stroke-width="2" stroke-linejoin="round"/>';
  g += '<path d="' + path(SER.s) + '" fill="none" stroke="#c98a08" stroke-width="2" stroke-linejoin="round"/>';
  g += '<line id="ch-h" y1="' + CH.y1 + '" y2="' + CH.y0 + '" stroke="#fafafa" stroke-width="1.5"/><circle id="ch-d" r="4.5" fill="#c98a08" stroke="#111114" stroke-width="2"/>';
  $('#fl-chart').innerHTML = '<svg viewBox="0 0 524 164" role="img" aria-label="Example flare light curve. Hard X-rays peak in short bursts during the rise of the soft X-rays, which then fade slowly."><title>Example flare brightness over 60 minutes</title>' + g + '</svg>';
  var svg = $('#fl-chart svg');
  function move(e) { var b = svg.getBoundingClientRect(), px = (e.clientX - b.left) / b.width * 524; FL.t = clamp((px - CH.x0) / (CH.x1 - CH.x0), 0, 1); FL.playing = false; flPlay(); flareUi(); drawFlare(); drawFlareStar(); }
  svg.addEventListener('pointerdown', function (e) { svg.setPointerCapture(e.pointerId); move(e); });
  svg.addEventListener('pointermove', function (e) { if (e.buttons) move(e); });
}
function chartHead() {
  var h = $('#ch-h'), d = $('#ch-d'); if (!h || !SER) return;
  var x = X(FL.t), i = Math.round(FL.t * 240); h.setAttribute('x1', x); h.setAttribute('x2', x); d.setAttribute('cx', x); d.setAttribute('cy', Y(SER.s[i]));
}
function drawFlareStar() {
  if (!flareGL) return;
  flareGL.draw({ off: V.off, time: ST.time * 0.8 + 4, T: 5772, freq: 500, conv: 1, half: V.h, rot: 0, tilt: 0, filter: 1, spots: FLSP, n: 4 });
}
pills($('#fl-kind'), [{ id: 'closed', label: 'Closed' }, { id: 'open', label: 'Open' }], FL.kind, function (v) { FL.kind = v.id; chartBase(); flareUi(); drawFlare(); });
pills($('#fl-class'), [{ id: 'c', label: 'C' }, { id: 'm', label: 'M' }, { id: 'x', label: 'X' }], FL.cls, function (v) { FL.cls = v.id; flareUi(); drawFlare(); });
PH.forEach(function (p) { var b = document.createElement('button'); b.type = 'button'; b.className = 'b'; b.textContent = p.label; b.addEventListener('click', function () { FL.t = p.at; FL.playing = false; flPlay(); flareUi(); drawFlare(); }); $('#fl-ph').appendChild(b); });
$('#fl-t').addEventListener('input', function (e) { FL.t = e.target.value / 1000; FL.playing = false; flPlay(); flareUi(); drawFlare(); });
function flPlay() { $('#fl-play').textContent = FL.playing ? 'Pause' : 'Play'; }
$('#fl-play').addEventListener('click', function () { FL.playing = !FL.playing; flPlay(); }); flPlay();
chartBase(); flareUi();

/* ---------- loop ---------- */
var vis = { star: true, flare: true };
try {
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { vis[e.target.id === 'star-stage' ? 'star' : 'flare'] = e.isIntersecting; }); });
  io.observe($('#star-stage')); io.observe($('#flare-stage'));
} catch (e) {}
var lastT = 0, tick = 0;
function frame(now) {
  var dt = Math.min(0.06, (now - lastT) / 1000 || 0); lastT = now; tick++;
  PL.ema = PL.ema * 0.93 + dt * 70; if (!window.__sxPin&&PL.ema > 36 && PL.q > 0.3) PL.q *= 0.985; else if (!window.__sxPin&&PL.ema < 20 && PL.q < 1) PL.q = Math.min(coarse ? 0.45 : 1, PL.q * 1.01);
  if (ST.playing) { ST.time += dt * 0.2; OV.clock += dt; updateEvents(); showLatest(); if (vis.star) drawStar(); }
  if (vis.flare) {
    if (FL.playing) { FL.t += dt / 22; if (FL.t > 1) FL.t = 0; flareUi(); drawFlare(); }
    if (ST.playing && tick % 3 === 0) drawFlareStar();
  }
  requestAnimationFrame(frame);
}
drawStar(); drawFlareStar(); drawFlare();
addEventListener('resize', function () { drawStar(); drawFlareStar(); drawFlare(); });
requestAnimationFrame(frame);

// @end-verbatim
