// Parity proof for the D-37 world engine. Usage (one browser at a time):
//   FE=<frontend dir with node_modules/playwright> OUT=<dir> node scripts/engine-parity.cjs proto  [ids]
//   FE=... OUT=... node scripts/engine-parity.cjs engine [ids]    (needs vite on :5185)
//   FE=... OUT=... node scripts/engine-parity.cjs cards
// "proto" renders the approved prototype (sculptor-reference/test/local.html, made by mklocal.py); "engine" renders
// frontend/engine-parity.html with the same preset, canvas size and settled step count. The prototype's frame-time
// resolution scaler is switched off in the prototype copy (the engine page passes adaptive:false) and it starts paused.
const fs = require('fs');
const { chromium } = require((process.env.FE || '.') + '/node_modules/playwright');
const OUT = process.env.OUT;
const REF = process.env.REF;
if (!REF)
  throw new Error('Set REF to the sculptor-reference folder that holds the prototype HTML.');
const BASE = process.env.BASE || 'http://localhost:5185';
const ARGS = [
  '--use-angle=swiftshader',
  '--enable-webgl',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];
const mode = process.argv[2];
const IDS = (process.argv[3] || 't1e,rivers,earth,k218,tit,jup,sat,hd').split(',');
const FLY = (process.env.FLY || 'rivers,earth').split(',');
fs.mkdirSync(OUT, { recursive: true });
const sizesFile = OUT + '/sizes.json';
const sizes = fs.existsSync(sizesFile) ? JSON.parse(fs.readFileSync(sizesFile)) : {};

async function protoPage(b) {
  const p = await b.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
  p.setDefaultTimeout(600000);
  await p.addInitScript(() => {
    window.__sxPin = true;
  });
  let html = fs.readFileSync(REF + '/test/local.html', 'utf8');
  // The orchestrator's local.html widens the spin-up budget (4000 ms, 2000 steps); undo that so both sides run the artifact's own 14 ms / 40 steps on the same virtual clock.
  html = html
    .replace('performance.now() - t0 < 4000', 'performance.now() - t0 < 14')
    .replace(
      'budget = st ? 4000 : 7; while ((playing || st) && k < (st ? 2000 : 4)',
      'budget = st ? 14 : 7; while ((playing || st) && k < (st ? 40 : 4)',
    );
  html = html.replace('playing: !reduced, m: null, step: 0', 'playing: false, m: null, step: 0');
  fs.writeFileSync(REF + '/test/local_parity.html', html);
  await p.goto('file://' + REF + '/test/local_parity.html');
  await p.waitForTimeout(500);
  const clk = (s) => p.evaluate((s) => document.querySelector(s).click(), s);
  await clk('#star-pause');
  await clk('#fl-play');
  await clk('#rock-pause');
  for (const id of ['#surface', '#flares', '#rocks', '#score', '#gas'])
    await p.evaluate((s) => {
      const e = document.querySelector(s);
      if (e) e.style.display = 'none';
    }, id);
  await p.evaluate(() => document.querySelector('#world-stage').scrollIntoView());
  return p;
}
const savePng = (f, d) => fs.writeFileSync(f, Buffer.from(d.split(',')[1], 'base64'));
const settled = (p) =>
  p.waitForFunction(() => window.W && window.W.spinup === 0 && window.W.m, null, {
    timeout: 600000,
    polling: 500,
  });

(async () => {
  const b = await chromium.launch({ args: ARGS });
  const errs = [];
  if (mode === 'proto') {
    const p = await protoPage(b);
    p.on('pageerror', (e) => errs.push('PAGE ' + e.message));
    for (const id of IDS) {
      // Spin-up in one synchronous call with the same virtual clock as WorldEngine.spinUp(1/60, true): same step count on every machine.
      await p.evaluate((id) => {
        window.W.playing = false;
        document.querySelector('#world-presets [data-id="' + id + '"]').click();
        const real = performance.now.bind(performance);
        let t = 0;
        performance.now = () => (t += 1);
        try {
          for (let g = 0; window.W.spinup > 0 && g < 100000; g++)
            window.W.gl.tick(window.W.m, false, 1 / 60);
        } finally {
          performance.now = real;
        }
      }, id);
      const png0 = await p.evaluate(() => {
        window.W.gl.draw(window.W.m);
        return document.querySelector('#world-c').toDataURL('image/png');
      });
      savePng(OUT + '/proto_' + id + '.png', png0);
      const sz = await p.evaluate(() => {
        const c = document.querySelector('#world-c');
        return { w: c.clientWidth, h: c.clientHeight, step: window.W.step };
      });
      sizes[id] = sz;
      console.log('proto', id, JSON.stringify(sz));
      if (FLY.includes(id)) {
        await p.evaluate(() => document.querySelector('#w-fly').click());
        await p.waitForTimeout(1500);
        const pngf = await p.evaluate(() => {
          window.W.gl.draw(window.W.m);
          return document.querySelector('#world-c').toDataURL('image/png');
        });
        savePng(OUT + '/proto_' + id + '_fly.png', pngf);
        const sf = await p.evaluate(() => {
          const c = document.querySelector('#world-c');
          return { w: c.clientWidth, h: c.clientHeight, alt: window.W.flyAlt };
        });
        sizes[id + '_fly'] = sf;
        console.log('proto', id, 'fly', JSON.stringify(sf));
        await p.evaluate(() => document.querySelector('#w-fly').click());
        await p.waitForTimeout(500);
      }
    }
    fs.writeFileSync(sizesFile, JSON.stringify(sizes, null, 1));
  } else if (mode === 'engine' || mode === 'cards') {
    const p = await b.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
    p.setDefaultTimeout(600000);
    p.on('pageerror', (e) => errs.push('PAGE ' + e.message));
    p.on('console', (m) => {
      if (m.type() === 'error') errs.push(m.text().slice(0, 600));
    });
    const shot = async (url, name) => {
      await p.goto(url);
      await p.waitForFunction(() => window.__done, null, { timeout: 600000, polling: 500 });
      const done = await p.evaluate(() => window.__done);
      const info = await p.evaluate(() => ({
        r: window.__cardResult || null,
        msg: document.querySelector('#msg').textContent,
        rd:
          window.__engine && window.__engine.readouts
            ? (() => {
                try {
                  const r = window.__engine.readouts();
                  return { tag: r.tag, rows: r.rows.length, step: r.step, caption: r.caption };
                } catch (e) {
                  return String(e);
                }
              })()
            : null,
      }));
      if (done === 'ok') savePng(OUT + '/' + name + '.png', await p.evaluate(() => window.__png()));
      console.log(name, done, JSON.stringify(info).slice(0, 700));
      return { done, info };
    };
    if (mode === 'engine') {
      for (const id of IDS) {
        const s = sizes[id] || { w: 760, h: 475 };
        await shot(
          BASE +
            '/engine-parity.html?' +
            (process.env.PRE ? 'pre=' + process.env.PRE + '&' : '') +
            'preset=' +
            id +
            '&w=' +
            s.w +
            '&h=' +
            s.h,
          'engine_' + id,
        );
        if (FLY.includes(id) && sizes[id + '_fly']) {
          const f = sizes[id + '_fly'];
          await shot(
            BASE +
              '/engine-parity.html?preset=' +
              id +
              '&fly=1&alt=' +
              f.alt +
              '&w=' +
              f.w +
              '&h=' +
              f.h,
            'engine_' + id + '_fly',
          );
        }
      }
    } else {
      const CARDS = (
        process.env.CARDS ||
        'simbad-trappist-1e,ref-titan,ref-jupiter,simbad-kepler-186f,simbad-kepler-22b,custom-hd209458b'
      ).split(',');
      for (const c of CARDS)
        await shot(
          BASE + '/engine-parity.html?card=' + encodeURIComponent(c) + '&w=760&h=475',
          'card_' + c,
        );
    }
  }
  if (errs.length) console.log('ERRORS\n' + errs.join('\n'));
  else console.log('no console errors');
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
