/* eslint-disable */
// @ts-nocheck
// Issue #71, D-37: the approved prototype's star and flare engine, extracted MECHANICALLY and unchanged.
// Source: .claude/worktrees/sculptor-reference/sculptor-preview-next.html, lines 850-1028 (loops and flares on the whole star).
// Not yet imported by the app: it still needs the TypeScript host (DOM removed, `cardToStar`). Do not edit here;
// re-run the slicing instead so the body stays byte-identical to the prototype.
// @verbatim L851-L1029
/* ---------- loops and flares on the whole star, from the same spot groups ---------- */
var OV = {
  clock: 0,
  ev: [],
  next: 0,
  r: rng(1),
  eDraw: 1e30,
  shown: null,
  loops: [],
  rot: 0.55,
  tilt: 0.12,
};
var oc = $('#star-o'),
  ox = oc.getContext('2d');
var b1 = document.createElement('canvas'),
  b2 = document.createElement('canvas'),
  b1x = b1.getContext('2d'),
  b2x = b2.getContext('2d');
var SPEED_DAYS = 1.2,
  MIN_GAP = 1.4;
var VW = {
  cr: 1,
  sr: 0,
  ct: 1,
  st: 0,
  W: 1,
  H: 1,
  half: 1,
  x: 0,
  y: 0,
  z: 0,
  hid: false,
  out: false,
};
function tf(x, y, z) {
  var X = x * VW.cr - z * VW.sr,
    Z = x * VW.sr + z * VW.cr,
    Y = y * VW.ct + Z * VW.st,
    Z2 = -y * VW.st + Z * VW.ct,
    rr = X * X + Y * Y;
  VW.x = VW.W / 2 + ((X / VW.half) * VW.H) / 2;
  VW.y = VW.H / 2 - ((Y / VW.half) * VW.H) / 2;
  VW.z = Z2;
  VW.hid = Z2 < 0 && rr < 1;
  VW.out = rr >= 1;
}
function setView(rot, tilt, half, W, H) {
  VW.cr = Math.cos(rot);
  VW.sr = Math.sin(rot);
  VW.ct = Math.cos(tilt);
  VW.st = Math.sin(tilt);
  VW.half = half;
  VW.W = W;
  VW.H = H;
}
function pt(g, ta, tl, h) {
  var x = g.c[0] + g.es[0] * ta + g.en[0] * tl,
    y = g.c[1] + g.es[1] * ta + g.en[1] * tl,
    z = g.c[2] + g.es[2] * ta + g.en[2] * tl,
    k = (1 + h) / Math.hypot(x, y, z);
  tf(x * k, y * k, z * k);
}
var PT = [0, 0, 0];
function poly(g, steps, fn) {
  var st = false,
    i;
  ox.beginPath();
  for (i = 0; i <= steps; i++) {
    fn(i / steps);
    pt(g, PT[0], PT[1], PT[2]);
    if (VW.hid) {
      st = false;
      continue;
    }
    if (st) ox.lineTo(VW.x, VW.y);
    else {
      ox.moveTo(VW.x, VW.y);
      st = true;
    }
  }
}
function arcFn(A, L, h, sh) {
  return function (s) {
    var c = Math.cos(Math.PI * s);
    PT[0] = -A * c;
    PT[1] = L + sh * c;
    PT[2] = h * Math.sin(Math.PI * s);
  };
}
function rotG(g, ang) {
  var c = Math.cos(ang),
    s = Math.sin(ang);
  return {
    c: g.c,
    sep: g.sep,
    area: g.area,
    es: [g.es[0] * c + g.en[0] * s, g.es[1] * c + g.en[1] * s, g.es[2] * c + g.en[2] * s],
    en: [-g.es[0] * s + g.en[0] * c, -g.es[1] * s + g.en[1] * c, -g.es[2] * s + g.en[2] * c],
  };
}
function sideOn(g) {
  var best = 0,
    low = 9,
    i;
  setView(OV.rot, OV.tilt, 1, 1, 1);
  for (i = -5; i <= 5; i++) {
    var r = rotG(g, (i * 15 * Math.PI) / 180);
    tf(r.es[0], r.es[1], r.es[2]);
    if (Math.abs(VW.z) < low) {
      low = Math.abs(VW.z);
      best = (i * 15 * Math.PI) / 180;
    }
  }
  return rotG(g, best);
}
function emax(g) {
  var Rcm = ST.p.R * 6.96e10,
    A = g.area * 4 * Math.PI * Rcm * Rcm;
  return 0.1 * (1e6 / (8 * Math.PI)) * Math.pow(A, 1.5);
}
function pickGroup(r) {
  var gs = MODEL.groups,
    tot = 0,
    i,
    w = [];
  setView(OV.rot, OV.tilt, 1, 1, 1);
  for (i = 0; i < gs.length; i++) {
    tf(gs[i].c[0], gs[i].c[1], gs[i].c[2]);
    var x = VW.z > -0.12 ? Math.sqrt(gs[i].area) * (1 + 2 * (1 - Math.max(VW.z, 0))) : 0;
    w.push(x);
    tot += x;
  }
  if (!tot) return -1;
  var u = r() * tot;
  for (i = 0; i < w.length; i++) {
    u -= w[i];
    if (u <= 0 && w[i] > 0) return i;
  }
  return -1;
}
function makeEvent(t0, forced) {
  var r = OV.r,
    idx = pickGroup(r);
  if (idx < 0) return null;
  var g = MODEL.groups[idx],
    Em = emax(g),
    Emin = Math.min(OV.eDraw, Em * 0.5);
  var E = forced ? Math.min(forced, Em) : 1 / (1 / Emin - r() * (1 / Emin - 1 / Em));
  var x = clamp(
      (0.45 + 0.6 * Math.log10(E / 1e30) + (r() - 0.5) * 0.5) * Math.pow(0.06 / g.sep, 0.25),
      0.15,
      3,
    ),
    n = (3 * x * x) / (1 + x * x);
  var ev = {
    t0: t0,
    g: idx,
    gx: sideOn(g),
    E: E,
    x: x,
    n: n,
    open: n >= 1.5,
    life: clamp(6 + 2.2 * Math.log10(E / 1e30), 5, 12),
    s: (r() * 1e9) | 0,
  };
  addTubes(ev);
  return ev;
}
function gapNow() {
  var R = MODEL.f / F_SUN / 3;
  var d = 1 / (R * SPEED_DAYS);
  OV.eDraw = 1e30 * Math.max(1, MIN_GAP / d);
  return clamp(d, MIN_GAP, 14);
}
function resetFlares() {
  OV.r = rng(2024);
  OV.ev = [];
  OV.shown = null;
  OV.loops = [];
  OV.clock = OV.clock || 0;
  var r2 = rng(808);
  MODEL.groups.forEach(function (g) {
    var k = Math.round(clamp(6 + Math.sqrt(g.area / 7.5e-5) * 5, 7, 18)),
      arr = [],
      i;
    for (i = 0; i < k; i++) {
      var u = r2();
      arr.push({
        g: rotG(g, (r2() - 0.5) * 2.4),
        A: 0.45 + 1.05 * u,
        L: (r2() - 0.5) * 1.3,
        h: 0.75 + 1.8 * u,
        sh: (r2() - 0.5) * 0.5,
        ph: r2() * 6.28,
        al: 0.14 + 0.2 * r2(),
      });
    }
    OV.loops.push(arr);
  });
  if (!MODEL.groups.length) {
    $('#flare-now').textContent =
      'This star has no spot groups, so it has no sunspot-driven flares.';
    return;
  }
  gapNow();
  var e = makeEvent(OV.clock, 8e31);
  if (e) {
    e.t0 = OV.clock - e.life * 0.34;
    OV.ev.push(e);
  }
  OV.next = OV.clock + 1.6;
}
function sup(n) {
  return String(n)
    .split('')
    .map(function (c) {
      return '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c];
    })
    .join('');
}
function flareText(e) {
  var ex = Math.floor(Math.log10(e.E)),
    mant = e.E / Math.pow(10, ex);
  var cls =
    e.E >= 1e31
      ? 'X' + (e.E / 1e31).toFixed(1)
      : e.E >= 1e30
        ? 'M' + (e.E / 1e30).toFixed(1)
        : 'C' + (e.E / 1e29).toFixed(1);
  return (
    'Class ' +
    cls +
    ', ' +
    mant.toFixed(1) +
    '×10' +
    sup(ex) +
    ' erg. The rope climbs to ' +
    e.x.toFixed(2) +
    ' of the half-distance between the poles, so the decay index is n = ' +
    e.n.toFixed(2) +
    '. ' +
    (e.open
      ? 'That is above 1.5, so the field opens and an eruption leaves the star.'
      : 'That is below 1.5, so the field holds and the flare stays closed.')
  );
}
function updateEvents() {
  if (!MODEL.groups.length) return;
  var gap = gapNow(),
    r = OV.r;
  while (OV.next <= OV.clock) {
    var e = makeEvent(OV.next);
    if (e) OV.ev.push(e);
    OV.next += Math.max(MIN_GAP, gap * (0.5 + r()));
  }
  OV.ev = OV.ev.filter(function (e) {
    return OV.clock - e.t0 < e.life;
  });
}
function hotColor(a) {
  var s = [
      [0, [205, 228, 255]],
      [0.22, [255, 243, 205]],
      [0.55, [255, 170, 55]],
      [0.9, [240, 65, 25]],
      [1.3, [120, 15, 10]],
    ],
    i = 0;
  while (i < s.length - 2 && a > s[i + 1][0]) i++;
  var t = clamp((a - s[i][0]) / (s[i + 1][0] - s[i][0]), 0, 1);
  return s[i][1].map(function (c, k) {
    return Math.round(lerp(c, s[i + 1][1][k], t));
  });
}
function drawEvent(e, boost, lw) {
  var g = e.gx,
    u = (OV.clock - e.t0) / e.life;
  if (u < 0 || u > 1) return;
  var eT = clamp(Math.log10(e.E / 1e30) / 2, 0, 1),
    ad = clamp(
      Math.max(0.012 * boost, g.sep * 0.5 * boost) * Math.pow(e.E / 1e30, 0.1),
      0.012,
      0.2,
    );
  var r = rng(e.s),
    i,
    k,
    pxU = VW.H / 2 / VW.half;
  var imp = smooth(0.08, 0.16, u) * (u < 0.2 ? 1 : Math.exp(-(u - 0.2) / 0.22));
  var fade = 1 - smooth(0.86, 1, u);
  // stretched field of an opening flare
  if (e.open) {
    var ko = smooth(0.12, 0.62, u);
    if (SHOW_LINES)
      for (i = 0; i < 12; i++) {
        var A = ad * e.legs[i].a,
          L = ad * e.legs[i].l;
        poly(g, 30, arcFn(A * (1 - 0.3 * ko), L, ad * (1.8 + 26 * ko * ko * ko), 0));
        ox.strokeStyle = 'rgba(255,225,170,' + 0.17 * (1 - 0.62 * ko) * fade + ')';
        ox.lineWidth = 0.9 * lw;
        ox.stroke();
      }
  }
  // rope
  var zr = e.open
    ? ad * (0.3 + 14 * Math.pow(smooth(0.12, 0.78, u), 2.2))
    : ad * (0.25 + 0.5 * e.x * smooth(0.05, 0.22, u));
  var ropeA = (e.open ? 1 - smooth(0.5, 0.86, u) : 1 - smooth(0.34, 0.62, u)) * smooth(0, 0.06, u);
  if (ropeA > 0.01 && SHOW_LINES)
    for (k = 0; k < 6; k++)
      (function (k) {
        var rad = ad * (0.12 + (e.open ? 1.1 * smooth(0.15, 0.7, u) : 0.05));
        poly(g, 40, function (s) {
          var v = -1 + 2 * s,
            ph = v * 11 + k * 1.05 + u * 8,
            env = Math.pow(Math.max(0, 1 - v * v), 0.55);
          PT[0] = rad * Math.cos(ph) * env;
          PT[1] = v * ad * 1.05;
          PT[2] = zr * env + rad * Math.sin(ph) * env;
        });
        ox.strokeStyle =
          'rgba(255,' +
          Math.round(lerp(95, 205, imp)) +
          ',' +
          Math.round(lerp(40, 170, imp)) +
          ',' +
          0.18 * ropeA +
          ')';
        ox.lineWidth = 0.9 * lw;
        ox.stroke();
      })(k);
  // arcade of hot loops
  var N = Math.round(12 + 26 * eT);
  for (i = 0; i < N; i++) {
    var bs = lerp(0.13, e.open ? 0.72 : 0.5, Math.pow(i / N, 1.1)),
      ag = (u - bs) / 0.34,
      L2 = ad * e.tubes[i].l * 0.95,
      hr = e.tubes[i].h;
    if (ag <= 0 || ag > 1.35 || !SHOW_LINES) continue;
    var A2 = ad * (0.42 + (e.open ? 0.85 : 0.22) * smooth(0.13, 0.85, bs)),
      c = hotColor(ag),
      al = smooth(0, 0.08, ag) * (1 - smooth(0.95, 1.35, ag)) * 0.2;
    poly(g, 24, arcFn(A2, L2, A2 * hr, 0));
    ox.strokeStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + al + ')';
    ox.lineWidth = 0.8 * lw;
    ox.stroke();
  }
  // bright feet and ribbons
  var rA = ad * (0.42 + (e.open ? 0.8 : 0.2) * smooth(0.13, 0.8, u));
  if (imp > 0.01)
    [-1, 1].forEach(function (side) {
      [
        [6.5, 0.14],
        [2.8, 0.5],
        [1.4, 1],
      ].forEach(function (s) {
        poly(g, 16, function (q) {
          PT[0] = side * rA + 0.05 * ad * Math.sin(q * 19 + side);
          PT[1] = (q - 0.5) * ad * 1.9;
          PT[2] = 0.001;
        });
        ox.strokeStyle = 'rgba(255,245,225,' + s[1] * imp + ')';
        ox.lineWidth = s[0] * lw;
        ox.stroke();
      });
      pt(g, side * rA, 0, 0.002);
      if (!VW.hid) {
        var R = ad * pxU * (0.55 + 0.6 * eT),
          gd = ox.createRadialGradient(VW.x, VW.y, 0, VW.x, VW.y, R);
        gd.addColorStop(0, 'rgba(255,250,240,' + 0.7 * imp + ')');
        gd.addColorStop(0.3, 'rgba(255,190,110,' + 0.22 * imp + ')');
        gd.addColorStop(1, 'rgba(255,120,40,0)');
        ox.fillStyle = gd;
        ox.fillRect(VW.x - R, VW.y - R, 2 * R, 2 * R);
      }
    });
  // eruption front (the plasma itself is drawn by the plasma layer)
  if (e.open && u > 0.2) {
    var rho = ad * 0.7 + (0.25 + 0.7 * eT) * Math.pow(smooth(0.2, 1, u), 1.25);
    [1, 0.82].forEach(function (sc, n) {
      var ra = rho * sc;
      poly(g, 56, function (s) {
        var a = Math.PI * (0.06 + 0.88 * s);
        PT[0] = -ra * Math.cos(a);
        PT[1] = 0;
        PT[2] = ra * 0.9 + ra * Math.sin(a) - ra * 0.9 + ra * 0.15;
      });
      ox.strokeStyle = 'rgba(205,225,255,' + (0.32 - n * 0.1) * (1 - smooth(0.6, 1, u)) + ')';
      ox.lineWidth = (2.6 - n) * lw;
      ox.stroke();
    });
  }
}
function drawOverlay(rot, tilt, half) {
  var dpr = Math.min(devicePixelRatio || 1, 1.5),
    W = Math.round(oc.clientWidth * dpr),
    H = Math.round(oc.clientHeight * dpr);
  if (!W || !H) return;
  if (oc.width !== W || oc.height !== H) {
    oc.width = W;
    oc.height = H;
    b1.width = Math.max(2, W >> 3);
    b1.height = Math.max(2, H >> 3);
    b2.width = Math.max(2, W >> 5);
    b2.height = Math.max(2, H >> 5);
  }
  OV.rot = rot;
  OV.tilt = tilt;
  ox.setTransform(1, 0, 0, 1, 0, 0);
  ox.globalAlpha = 1;
  ox.globalCompositeOperation = 'source-over';
  ox.clearRect(0, 0, W, H);
  PL.n = 0;
  if (!MODEL.groups.length || ST.view === 'close' || ST.filter === 0 || ST.filter === 1) {
    if (starPL) starPL.draw(W, H, PL.data, 0);
    return;
  }
  setView(rot, tilt, half, W, H);
  ox.globalCompositeOperation = 'lighter';
  ox.lineCap = 'round';
  ox.lineJoin = 'round';
  var boost = ST.view === 'big' ? 3 : 1,
    lw = H / 620;
  MODEL.groups.forEach(function (g, gi) {
    var ad = Math.max(0.012 * boost, g.sep * 0.5 * boost);
    OV.loops[gi].forEach(function (l) {
      pt(l.g, 0, l.L * ad, l.h * ad);
      if (VW.hid) return;
      var al = l.al * (0.72 + 0.28 * Math.sin(OV.clock * 0.7 + l.ph)) * (VW.out ? 1.5 : 0.8);
      if (SHOW_LINES) {
        poly(l.g, 22, arcFn(l.A * ad, l.L * ad, l.h * ad, l.sh * ad));
        ox.strokeStyle = 'rgba(255,186,84,' + al * 0.5 + ')';
        ox.lineWidth = 0.9 * lw;
        ox.stroke();
      }
      if (starPL) {
        AT.at = atStar;
        AT.g = l.g;
        var m = Math.max(8, Math.round(72 * PL.q)),
          j;
        for (j = 0; j < m; j++) {
          var kk = ((l.ph * 1000) | 0) + j * 5,
            h3 = pr(kk + 2),
            h4 = pr(kk + 3);
          emitArch(
            0,
            l.A * ad,
            l.L * ad,
            l.h * ad,
            l.sh * ad,
            clamp((pr(kk) + OV.clock * 0.04 * (0.5 + pr(kk + 1))) % 1, 0.004, 0.996),
            Math.cos(h4 * 40) * h3 * l.A * ad * 0.13,
            Math.sin(h4 * 40) * h3 * l.A * ad * 0.13,
            1.05 * lw,
            0.42 + 0.22 * h3,
            0.034 * (VW.out ? 1.4 : 1),
            20 * lw,
          );
        }
      }
    });
  });
  OV.ev.forEach(function (e) {
    drawEvent(e, boost, lw);
    if (starPL) plasmaEvent(e, boost, lw);
  });
  if (starPL) starPL.draw(W, H, PL.data, PL.n);
  ox.globalCompositeOperation = 'source-over';
  b1x.clearRect(0, 0, b1.width, b1.height);
  b1x.imageSmoothingEnabled = true;
  b1x.drawImage(oc, 0, 0, b1.width, b1.height);
  b2x.clearRect(0, 0, b2.width, b2.height);
  b2x.imageSmoothingEnabled = true;
  b2x.drawImage(b1, 0, 0, b2.width, b2.height);
  ox.globalCompositeOperation = 'lighter';
  ox.imageSmoothingEnabled = true;
  ox.imageSmoothingQuality = 'high';
  ox.globalAlpha = 0.55;
  ox.drawImage(b1, 0, 0, W, H);
  ox.globalAlpha = 0.42;
  ox.drawImage(b2, 0, 0, W, H);
  ox.globalAlpha = 1;
}
function showLatest() {
  var latest = null;
  OV.ev.forEach(function (e) {
    if (e.t0 <= OV.clock && (!latest || e.t0 > latest.t0)) latest = e;
  });
  if (latest && latest !== OV.shown) {
    OV.shown = latest;
    $('#flare-now').textContent = flareText(latest);
  }
}
$('#star-fire').addEventListener('click', function () {
  if (!MODEL.groups.length) return;
  if (ST.view === 'close' || ST.filter === 0) {
    ST.filter = 3;
    if (ST.view === 'close') ST.view = 'big';
    pills($('#star-filters'), FILTERS, 3, onFilter);
    pills($('#star-views'), VIEWS, ST.view, onView);
    caption();
  }
  var e = makeEvent(OV.clock, 3e32);
  if (!e) return;
  if (!ST.playing) e.t0 = OV.clock - e.life * 0.3;
  OV.ev.push(e);
  OV.next = Math.max(OV.next, OV.clock + 2);
  showLatest();
  drawStar();
});
function refreshStar() {
  MODEL = model();
  readouts();
  resetFlares();
  showLatest();
  caption();
}
pills($('#star-presets'), PRESETS, 'g', function (p) {
  ST.p = p;
  ST.P = p.P;
  refreshStar();
  drawStar();
});
var VIEWS = [
  { id: 'big', label: 'Whole star, larger detail' },
  { id: 'true', label: 'Whole star, true scale' },
  { id: 'close', label: 'Close-up' },
];
var FILTERS = [
  { id: 3, label: 'Observatory view' },
  { id: 2, label: 'Enhanced colour' },
  { id: 0, label: 'True colour' },
];
function onView(v) {
  ST.view = v.id;
  if (v.id === 'close' && ST.filter === 3) {
    ST.filter = 2;
    pills($('#star-filters'), FILTERS, 2, onFilter);
  }
  caption();
  drawStar();
}
function onFilter(v) {
  ST.filter = v.id;
  if (v.id === 3 && ST.view === 'close') {
    ST.view = 'big';
    pills($('#star-views'), VIEWS, 'big', onView);
  }
  caption();
  drawStar();
}
pills($('#star-views'), VIEWS, 'big', onView);
pills($('#star-filters'), FILTERS, 3, onFilter);
$('#rot').addEventListener('input', function (e) {
  ST.P = Math.exp(lerp(ROT_MIN, ROT_MAX, e.target.value / 1000));
  refreshStar();
  drawStar();
});
function pauseLabel() {
  $('#star-pause').textContent = ST.playing ? 'Pause' : 'Play';
}
$('#star-pause').addEventListener('click', function () {
  ST.playing = !ST.playing;
  pauseLabel();
});
pauseLabel();
refreshStar();

// @end-verbatim
