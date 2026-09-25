/* Exploded-phone engine shared by the website, the slides page and the
 * pitch-clip renderer (pitch-clips/). No dependencies, no hidden state:
 * pose(stepF) is a pure function of step progress, so a video frame and a
 * scroll position that map to the same stepF render identically.
 *
 * A rig is a tilted stack of layers (the phone taken apart). On each step
 * one layer slides out of the stack and turns flat toward the viewer at
 * `present`, so its details are readable; the stack stays behind as a map.
 * All overlay coordinates are % of the 576x1232 capture.
 */

export const PLANE = { w: 320, h: 685 };

const C = {
  navy: '#001155', blue: '#086ADB', sky: '#11AAFF', red: '#DD1122',
  green: '#1B8712', orange: '#CF4A0C', sub: '#4A5578',
};

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- overlay helpers ----------
const box = (x, y, w, h, c, label, under) =>
  `<div class="x-box" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%;--c:${c}">${label ? `<span class="x-lbl${under ? ' under' : ''}">${label}</span>` : ''}</div>`;
const card = (x, y, w, c, title, rows) =>
  `<div class="x-card" style="left:${x}%;top:${y}%;width:${w}%;--c:${c}"><h6>${title}</h6>${rows.join('')}</div>`;
const row = (k, v, c = C.green) => `<div class="x-row"><span>${k}</span><b style="color:${c}">${v}</b></div>`;
const bar = (k, v, c) => `<div class="x-row"><span>${k}</span><b>${v.toFixed(2)}</b></div><div class="x-bar"><i style="width:${Math.max(2, v * 100)}%;background:${c}"></i></div>`;
const shot = (u, img, dim) => `<img class="x-shot${dim ? ' dim' : ''}" src="${u(`img/${img}`)}" alt="" />`;

// ---------- layer library ----------
const board = (label) => ({
  id: 'device', title: 'Device trust', accent: C.green,
  html: () => `<div class="x-board">
    <div class="x-part" style="left:34%;top:4%;width:32%;height:7%">${label}<small>camera sensor</small></div>
    <div class="x-part" style="left:12%;top:18%;width:42%;height:14%">SoC<small>scan engine</small></div>
    <div class="x-part key" style="left:60%;top:18%;width:28%;height:14%">StrongBox<small>attested key</small></div>
    <div class="x-part" style="left:12%;top:37%;width:76%;height:8%">IMU<small>hand-held motion</small></div>
    <div class="x-coil" style="left:16%;top:52%;width:68%;height:26%"></div>
    <div class="x-part nfc" style="left:34%;top:60%;width:32%;height:10%">NFC<small>chip reader</small></div>
    <div class="x-note" style="left:8%;top:84%;width:84%">Key minted in StrongBox with the server's challenge inside. Root, hooks and emulators are checked here.</div>
  </div>`,
});

const PHONE = { id: 'phone', title: 'Phone', accent: C.navy, cls: 'chassis', html: () => `<i class="x-cam"></i>` };

export const RIGS = {
  doc: {
    layers: [
      board('CAMERA'),
      PHONE,
      { id: 'camera', title: 'Camera frame', accent: C.blue, cls: 'screen', html: b => shot(b, 'doc-front.jpg') },
      {
        id: 'quality', title: 'Quality gates', accent: C.green,
        html: b => shot(b, 'doc-front.jpg', true) +
          box(4.5, 24, 91, 25.5, C.green, 'CARD DETECTED · FILLS THE FRAME') +
          card(6, 56, 88, C.green, 'LIVE QUALITY GATES', [
            row('Card · Distance', '✓'), row('Light · Glare', '✓'), row('Sharpness', '✓'), row('Fingers · Photo', '✓'),
          ]),
      },
      {
        id: 'pad', title: 'Attack detection', accent: C.red,
        html: b => shot(b, 'doc-front.jpg', true) +
          `<div class="x-scan" style="--c:${C.red}"></div>` +
          box(8, 30, 31, 16.5, C.red, 'PHOTO TAMPERING ✓', true) +
          card(6, 56, 88, C.red, 'SCREEN, PRINT OR REAL?', [
            bar('Physical card', 0.64, C.green), bar('Screen', 0, C.red), bar('Paper', 0.36, C.orange),
            row('Moiré · Colour', '✓'),
          ]),
      },
      {
        id: 'chip', title: 'MRZ + NFC chip', accent: C.blue,
        html: b => shot(b, 'doc-back.jpg', true) +
          box(10, 42.3, 78, 7.3, C.blue, 'MRZ · CHECK DIGITS ✓') +
          `<div class="x-waves" style="left:50%;top:32%"><i></i><i></i><i></i></div>` +
          card(6, 58, 88, C.blue, 'CHIP · ICAO 9303', [
            row('DG1 = printed MRZ', '✓'), row('Issuer signature (SOD)', '✓'), row('Chip photo (DG2)', '✓'),
          ]),
      },
    ],
    steps: [
      { layer: null, explode: 1 },
      { layer: 0 }, { layer: 2 }, { layer: 3 }, { layer: 4 }, { layer: 5 },
      { layer: null, explode: 0 },
    ],
  },
  face: {
    layers: [
      board('FRONT CAM'),
      PHONE,
      {
        id: 'selfie', title: 'Selfie + gates', accent: C.blue, cls: 'screen',
        html: b => shot(b, 'face.jpg') + box(24, 22, 52, 33, C.sky, 'FACE · YUNET') +
          [[36, 32.5], [62.5, 32.5], [50, 38.5], [41, 45.5], [59, 45.5]].map(([x, y]) => `<i class="x-dot" style="left:${x}%;top:${y}%"></i>`).join(''),
      },
      {
        id: 'challenge', title: 'Random challenge', accent: C.blue,
        html: b => shot(b, 'face.jpg', true) +
          `<div class="x-chal" style="left:6%;top:60%;width:88%">
            <h6>SERVER CHALLENGE · SINGLE USE</h6>
            <div class="t"><span>Turn left</span><span>Tilt right</span><span>Move closer</span></div>
            <p>Re-measured on the server: yaw, roll, face size.</p>
          </div>` +
          `<div class="x-arc" style="left:20%;top:14%;width:60%;height:10%"></div>`,
      },
      {
        id: 'match', title: 'Face ↔ document', accent: C.red,
        html: b => shot(b, 'face.jpg', true) +
          `<div class="x-match">
            <div class="pair"><div class="p" style="background-image:url(${b('img/face.jpg')})"></div><span>vs</span><div class="p dg2"><em>CHIP DG2</em></div></div>
            <div class="meter"><i class="thr"></i><i class="needle"></i></div>
            <div class="x-row"><span>similarity</span><b>match ≥ 0.363</b></div>
            <div class="verdict">✕ Not the document holder</div>
          </div>`,
      },
      {
        id: 'unique', title: 'Uniqueness 1:N', accent: C.green,
        html: () => `<div class="x-gallery">${Array.from({ length: 20 }, (_, i) => `<span class="${[6, 7, 11, 12].includes(i) ? 'hit' : ''}"></span>`).join('')}</div>` +
          card(6, 66, 88, C.green, 'ONE FACE, HOW MANY IDS?', [
            row('pgvector · HNSW search', '✓'), row('Cluster F-00001', '4 sessions', C.orange),
          ]),
      },
    ],
    steps: [
      { layer: null, explode: 1 },
      { layer: 0 }, { layer: 2 }, { layer: 3 }, { layer: 4 }, { layer: 5 },
    ],
  },
};

/**
 * Build a rig inside `el`. `base` is the assets folder path ('assets/' on the
 * site) or a function mapping 'img/x.jpg' to a URL (staticFile in the video).
 */
/** @param {HTMLElement} el @param {string} name @param {string | ((p: string) => string)} [base] */
export function createRig(el, name, base = 'assets/') {
  const spec = RIGS[name];
  const url = typeof base === 'function' ? base : p => base + p;
  const order = spec.steps.map(st => st.layer).filter(l => l != null);
  const num = i => (order.includes(i) ? String(order.indexOf(i) + 1).padStart(2, '0') : '');
  el.classList.add('x-rig');
  el.innerHTML = spec.layers.map((l, i) => `
    <div class="x-layer ${l.cls ?? 'ovl'}" style="--accent:${l.accent}">
      ${i === 1 ? '<div class="x-shadow"></div>' : ''}
      <div class="x-plane">${l.html(url)}</div>
      <div class="x-title">${num(i) ? `<b>${num(i)}</b>` : ''}${l.title}</div>
    </div>`).join('');
  const layers = [...el.querySelectorAll('.x-layer')];
  return { el, spec, layers, steps: spec.steps.length };
}

/**
 * Pose the rig for fractional step `stepF` (0 .. steps).
 * view: { rx, rz, scale, gap, present: {x, y, scale} | null, stackFade }
 */
export function pose(rig, stepF, view) {
  const { layers, spec } = rig;
  const n = spec.steps.length;
  const s = clamp(Math.floor(stepF), 0, n - 1);
  const f = clamp(stepF - s);
  const step = spec.steps[s];
  const prev = spec.steps[Math.max(0, s - 1)];

  // explode: step 0 opens the stack; a step with explode:0 closes it.
  let explode;
  if (s === 0) explode = smooth(0.05, 0.7, f);
  else if (step.explode === 0) explode = 1 - smooth(0.1, 0.7, f);
  else explode = 1;

  // the active layer slides out, holds, then slides back before the next step.
  const out = step.layer == null ? 0 : smooth(0, 0.28, f) * (1 - smooth(0.86, 1, f));
  const rx = view.rx, rz = view.rz, sc = view.scale;
  const mid = (layers.length - 1) / 2;
  const P = view.present;

  layers.forEach((layer, i) => {
    const z = (i - mid) * view.gap * explode + i * 0.6;
    const k = i === step.layer && P ? out : 0;
    const t = k === 0
      ? `translateZ(${z.toFixed(2)}px)`
      : `scale(${lerp(1, 1 / sc, k).toFixed(4)}) rotateZ(${(-rz * k).toFixed(3)}deg) rotateX(${(-rx * k).toFixed(3)}deg) ` +
        `translate3d(${(P.x * k).toFixed(2)}px, ${(P.y * k).toFixed(2)}px, ${(z * (1 - k)).toFixed(2)}px) scale(${lerp(1, P.scale, k).toFixed(4)})`;
    layer.style.transform = t;
    layer.style.zIndex = k > 0 ? '10' : '';
    const isOverlay = !layer.classList.contains('chassis') && !layer.classList.contains('screen') && i !== 0;
    const inStack = isOverlay ? smooth(0.3, 0.8, explode) : 1;
    const fade = step.layer != null && i !== step.layer ? lerp(1, view.stackFade ?? 0.55, out) : 1;
    layer.style.opacity = (Math.max(k, inStack) * fade).toFixed(3);
    layer.style.setProperty('--k', k.toFixed(3));
    layer.classList.toggle('presented', k > 0.5);
  });
  rig.el.style.transform = `rotateX(${rx}deg) rotateZ(${rz}deg) scale(${sc})`;
  rig.el.style.setProperty('--rx', `${rx}deg`);
  rig.el.style.setProperty('--rz', `${rz}deg`);
  return { step: s, f, explode, out };
}
