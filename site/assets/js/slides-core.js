/* Pitch slides as pure functions of time, shared by slides.html (live
 * presenter) and pitch-clips/ (Remotion video + PNG export for Canva).
 * mountSlide(el, id, url) builds a 1920x1080 slide inside `el` and returns
 * { render(t) } where t is seconds since the slide started. Nothing depends
 * on wall-clock time or previous frames, so every export is repeatable.
 */
import { createRig, pose } from './explode.js';
import { consoleHTML } from './console-mock.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const pop = (t, at, len = 0.5) => { const k = clamp((t - at) / len); return 1 - Math.pow(1 - k, 3); };

const STEP = 3.2; // seconds per explode step

const SHIELD = u => `<img class="sl-shield" src="${u('img/shield.svg')}" alt="" />`;
const brand = u => `<div class="sl-brand">${SHIELD(u)}<span>DoNotFraud<b>AI</b></span></div>`;

const COPY = {
  doc: {
    kicker: 'Document · taken apart',
    steps: [
      { n: 'ONE PHOTO', h: 'Five layers check every frame.', p: 'The phone comes apart. Each layer steps forward.' },
      { n: '01 · DEVICE TRUST', h: 'Is this a real phone?', l: ['Hardware key attestation', 'Boot state catches hidden root', 'Emulators, hooks, virtual cameras'] },
      { n: '02 · CAMERA', h: 'The raw frame.', p: 'Real footage from our Pixel 6. Captured after two good frames in a row.' },
      { n: '03 · QUALITY GATES', h: 'Seven gates, live.', l: ['Card fills the frame', 'Light, glare, sharpness', 'No fingers, text readable'] },
      { n: '04 · ATTACK DETECTION', h: 'Screen, print or real?', l: ['Scene model: physical 0.64', 'Moiré and colour checks', 'Photo tampering on the portrait'], red: true },
      { n: '05 · MRZ + CHIP', h: 'Read it, then prove it.', l: ['MRZ check digits valid', 'Chip data matches the print', "Issuer's signature verified"] },
      { n: 'SEALED', h: 'Sealed on the phone. Scored on the server.', p: 'Signed by the attested key. The phone only learns the route.' },
    ],
  },
  face: {
    kicker: 'Face · taken apart',
    steps: [
      { n: 'ONE SELFIE', h: 'Live. Matching. Unique.', p: 'A person, right now, the holder, and nobody else.' },
      { n: '01 · DEVICE TRUST', h: 'The same attested phone.', p: 'The key that signs the challenge lives in StrongBox.' },
      { n: '02 · SELFIE', h: 'A clean, frontal face.', l: ['Face detection (YuNet)', 'Centered, lit, eyes open', 'Passive liveness every frame'] },
      { n: '03 · RANDOM CHALLENGE', h: "Moves nobody can pre-record.", p: 'Three actions drawn by the server, always one head turn. Face swaps lose tracking on the turn.' },
      { n: '04 · FACE ↔ DOCUMENT', h: 'Is it the holder? Not this time.', p: "Matched against the chip's signed photo. In our run it wasn't the holder.", red: true },
      { n: '05 · UNIQUENESS', h: 'One face, how many identities?', p: 'Four attempts by one person, linked into one cluster.' },
    ],
  },
};

function explodeSlide(el, id, u) {
  const copy = COPY[id];
  el.innerHTML = `
    ${brand(u)}
    <div class="sl-kicker">${copy.kicker}</div>
    <div class="sl-stage"><div class="sl-origin"><div class="sl-rig"></div></div></div>
    <div class="sl-copy">${copy.steps.map(s => `
      <div class="sl-step${s.red ? ' red' : ''}">
        <div class="n">${s.n}</div><h3>${s.h}</h3>
        ${s.p ? `<p>${s.p}</p>` : ''}
        ${s.l ? `<ul>${s.l.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
      </div>`).join('')}
    </div>
    <div class="sl-dots">${copy.steps.map(() => '<i><b></b></i>').join('')}</div>`;
  const rig = createRig(el.querySelector('.sl-rig'), id, u);
  const cards = [...el.querySelectorAll('.sl-step')];
  const dots = [...el.querySelectorAll('.sl-dots b')];
  const n = cards.length;
  const view = { rx: 58, rz: -36, scale: 0.72, gap: 82, stackFade: 0.4, present: { x: 500, y: 26, scale: 1.2 } };
  return {
    duration: n * STEP,
    render(t) {
      const stepF = clamp(t / STEP, 0, n - 0.001);
      const { step, f } = pose(rig, stepF, view);
      cards.forEach((c, i) => {
        const inn = i === step ? smooth(0, 0.14, f) : 0;
        const out = i === step && i < n - 1 ? smooth(0.9, 1, f) : 0;
        c.style.opacity = (inn * (1 - out)).toFixed(3);
        c.style.transform = `translateY(${((1 - inn) * 24 - out * 16).toFixed(1)}px)`;
      });
      dots.forEach((d, i) => { d.style.width = `${clamp(stepF - i) * 100}%`; });
    },
  };
}

function fraudSlide(el, u) {
  el.innerHTML = `
    ${brand(u)}
    <div class="sl-head"><div class="sl-kicker static red">Fraud path · real run</div><h2>We filmed the card off a laptop. <span class="red">Caught.</span></h2></div>
    <div class="sl-fraud">
      <div class="col">
        <div class="lab">Real card</div>
        <div class="ph"><img class="a" src="${u('img/doc-front.jpg')}" alt="" /><img class="b" src="${u('img/pad-front.jpg')}" alt="" /></div>
        <div class="vd ok">✓ No attack detected</div>
      </div>
      <div class="mid">
        <h5>SCENE MODEL</h5>
        ${['Physical card', 'Screen', 'Paper'].map((k, i) => `
          <div class="cmp"><span>${k}</span>
            <div class="bars"><div class="bar g"><i data-g="${i}"></i></div><div class="bar r"><i data-r="${i}"></i></div></div>
            <em data-gv="${i}"></em><em class="r" data-rv="${i}"></em>
          </div>`).join('')}
        <div class="legend"><span class="g">real card</span><span class="r">screen replay</span></div>
        <p>The moiré check alone missed it. The scene model saw a screen.</p>
      </div>
      <div class="col">
        <div class="lab red">Screen replay</div>
        <div class="ph alarm"><img class="a" src="${u('img/attack-screen.jpg')}" alt="" /><img class="b" src="${u('img/attack-detected.jpg')}" alt="" /></div>
        <div class="vd bad">✕ Attack detected</div>
      </div>
    </div>`;
  const G = [0.64, 0, 0.36], R = [0, 1, 0];
  const [pa, pb] = el.querySelectorAll('.col .ph');
  const vds = el.querySelectorAll('.vd');
  return {
    duration: 9,
    render(t) {
      pa.querySelector('.b').style.opacity = smooth(2.2, 2.7, t);
      pb.querySelector('.b').style.opacity = smooth(4.4, 4.9, t);
      pb.classList.toggle('on', t > 4.6);
      const g = smooth(0.8, 2.0, t), r = smooth(3.0, 4.2, t);
      G.forEach((v, i) => {
        el.querySelector(`[data-g="${i}"]`).style.width = `${Math.max(1, v * g * 100)}%`;
        el.querySelector(`[data-gv="${i}"]`).textContent = (v * g).toFixed(2);
        el.querySelector(`[data-r="${i}"]`).style.width = `${Math.max(1, R[i] * r * 100)}%`;
        el.querySelector(`[data-rv="${i}"]`).textContent = (R[i] * r).toFixed(2);
      });
      vds[0].style.opacity = pop(t, 2.6); vds[0].style.transform = `scale(${0.8 + 0.2 * pop(t, 2.6)})`;
      vds[1].style.opacity = pop(t, 4.8); vds[1].style.transform = `scale(${0.8 + 0.2 * pop(t, 4.8)})`;
    },
  };
}

function triageSlide(el, u) {
  const CALLOUTS = [
    { hot: 'queue', h: 'Risk-sorted queue', p: 'Real cases first. Demo fixtures are flagged.' },
    { hot: 'face', h: 'Face 1:1 and 1:N', p: 'Selfie vs chip photo, plus the face cluster across sessions.' },
    { hot: 'ladder', h: 'The four steps', p: 'Each with a confidence and a one-line reason.' },
    { hot: 'rec', h: 'Why not approve? Why not reject?', p: 'A recommendation that argues both sides.' },
  ];
  el.innerHTML = `
    ${brand(u)}
    <div class="sl-head center"><div class="sl-kicker static">Triage console</div><h2>Every signal. One decision.</h2></div>
    <div class="sl-console-stage"><div class="console-rig sl-console">${consoleHTML(u)}</div></div>
    <div class="sl-callout"><b></b><span></span><i></i></div>`;
  const rig = el.querySelector('.sl-console');
  const head = el.querySelector('.sl-head');
  const call = el.querySelector('.sl-callout');
  const targets = CALLOUTS.map(c => rig.querySelector(`[data-hot="${c.hot}"]`));
  return {
    duration: 12.5,
    render(t) {
      const k = smooth(0.4, 2.6, t);
      rig.style.transform = `translateY(${(1 - k) * 40}px) rotateX(${(1 - k) * 50}deg) rotateZ(${(1 - k) * -20}deg) scale(${0.62 + k * 0.36})`;
      head.style.opacity = 1 - smooth(2.4, 3.0, t);
      const idx = t < 3.2 ? -1 : Math.min(3, Math.floor((t - 3.2) / 2.3));
      targets.forEach((tg, i) => { tg.style.outline = i === idx ? '4px solid #DD1122' : ''; tg.style.outlineOffset = '4px'; });
      if (idx >= 0) {
        const c = CALLOUTS[idx];
        call.querySelector('b').textContent = `${idx + 1}/4  ${c.h}`;
        call.querySelector('span').textContent = c.p;
        const local = t - 3.2 - idx * 2.3;
        call.style.opacity = smooth(0, 0.3, local);
      } else call.style.opacity = 0;
    },
  };
}

function titleSlide(el, u, closing) {
  el.innerHTML = `
    <div class="sl-title${closing ? ' closing' : ''}">
      ${SHIELD(u)}
      <h1>DoNotFraud<b>AI</b></h1>
      <p>${closing ? 'Make every fraud attempt cost a <span class="red">new human.</span>' : 'Neutralizing AI Fraud Era Threats.'}</p>
      <div class="chips"><span>Proof of Human</span><span>Proof of Uniqueness</span></div>
      ${closing ? '<div class="repo">github.com/henrique-milli/donotfraudai</div>' : ''}
      <div class="event">Zürich Hackathon 2026</div>
    </div>`;
  const sh = el.querySelector('.sl-shield');
  const parts = [...el.querySelectorAll('h1, p, .chips, .repo, .event')];
  return {
    duration: 5,
    render(t) {
      const s = pop(t, 0.1, 0.7);
      sh.style.transform = `scale(${0.6 + 0.4 * s})`;
      sh.style.opacity = s;
      parts.forEach((p, i) => {
        const k = pop(t, 0.5 + i * 0.25, 0.6);
        p.style.opacity = k;
        p.style.transform = `translateY(${(1 - k) * 20}px)`;
      });
    },
  };
}

/** Slide order and length in seconds (the video export needs them up front). */
export const SLIDES = [
  { id: 'title', label: 'Title', dur: 5 },
  { id: 'doc', label: 'Document explode', dur: COPY.doc.steps.length * STEP },
  { id: 'fraud', label: 'Fraud path', dur: 9 },
  { id: 'face', label: 'Face explode', dur: COPY.face.steps.length * STEP },
  { id: 'triage', label: 'Triage console', dur: 12.5 },
  { id: 'close', label: 'Close', dur: 5 },
];
export { STEP, ANIM_STEP };

/**
 * @param {HTMLElement} el
 * @param {string} id
 * @param {string | ((p: string) => string)} [base]
 * @returns {{ duration: number, render: (t: number) => void }}
 */
export function mountSlide(el, id, base = 'assets/') {
  const u = typeof base === 'function' ? base : p => base + p;
  el.classList.add('sl');
  el.dataset.slide = id;
  if (id === 'doc' || id === 'face') return explodeSlide(el, id, u);
  if (id === 'fraud') return fraudSlide(el, u);
  if (id === 'triage') return triageSlide(el, u);
  return titleSlide(el, u, id === 'close');
}

/* ---------- standalone explode animations (dedicated Canva slides) ----------
 * Just the phone: no brand, no text column, so the deck can add its own copy.
 * Each clip opens from a closed phone and closes again, so it loops cleanly.
 * The stack drifts slowly the whole time so the frame never sits still.
 */
const ANIM_STEP = 3.4;

export const ANIMS = [
  { id: 'doc', label: 'Document explode', steps: 7 },
  { id: 'face', label: 'Face explode', steps: 7 },
].map(a => ({ ...a, dur: a.steps * ANIM_STEP }));

/**
 * @param {HTMLElement} el
 * @param {'doc' | 'face'} id
 * @param {string | ((p: string) => string)} [base]
 * @param {{ transparent?: boolean }} [opts]
 */
export function mountAnim(el, id, base = 'assets/', opts = {}) {
  const u = typeof base === 'function' ? base : p => base + p;
  el.classList.add('sl', 'sl-anim');
  if (opts.transparent) el.classList.add('sl-clear');
  el.innerHTML = `<div class="sl-stage anim"><div class="sl-origin anim"><div class="sl-rig"></div></div></div>`;
  const origin = el.querySelector('.sl-origin');
  const rig = createRig(el.querySelector('.sl-rig'), id, u);
  // The face rig ends on uniqueness; close the phone again so the clip loops.
  const steps = rig.spec.steps.at(-1).explode === 0 ? rig.spec.steps : [...rig.spec.steps, { layer: null, explode: 0 }];
  rig.spec = { ...rig.spec, steps };
  const n = steps.length;
  return {
    duration: n * ANIM_STEP,
    render(t) {
      const stepF = clamp(t / ANIM_STEP, 0, n - 0.001);
      const drift = Math.sin((t / (n * ANIM_STEP)) * Math.PI * 2);
      // Camera: the closed phone sits centre frame; while layers are being
      // presented the stack slides left to make room on the right.
      const s = Math.floor(stepF), f = stepF - s;
      const has = i => (steps[i] && steps[i].layer != null ? 1 : 0);
      const w = has(s) + (has(s + 1) - has(s)) * smooth(s === 0 ? 0.55 : 0.82, 1, f);
      const ox = 960 - 340 * clamp(w);
      origin.style.left = `${ox.toFixed(1)}px`;
      pose(rig, stepF, {
        rx: 57 + drift * 2,
        rz: -34 + drift * 6,
        scale: 0.9,
        gap: 92,
        stackFade: 0.35,
        present: { x: 1260 - ox, y: 52, scale: 1.16 },
      });
    },
  };
}
