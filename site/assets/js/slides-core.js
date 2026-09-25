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
      { n: '03 · CAPTURE CHECKS', h: 'A usable photo, live.', l: ['Card fills the frame', 'Sharp and well lit', 'Text readable'] },
      { n: '04 · AUTHENTICITY', h: 'Genuine, not a copy.', l: ['Several independent checks', 'Re-scored on the server', 'Never shown to the applicant'] },
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
  { id: 'face', label: 'Face explode', dur: COPY.face.steps.length * STEP },
  { id: 'triage', label: 'Triage console', dur: 12.5 },
  { id: 'close', label: 'Close', dur: 5 },
];
export { STEP };

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
  if (id === 'triage') return triageSlide(el, u);
  return titleSlide(el, u, id === 'close');
}

/* ---------- standalone explode animations (dedicated Canva slides) ----------
 * Just the phone: no brand, no text column, so the deck can add its own copy.
 * Exactly 7 s: open 0.6 s, five layers ~1.18 s each (each one comes forward
 * while the previous is still going back), close 0.5 s. The stack stays
 * still; only the layers move. Starts and ends closed, so it loops.
 */
const ANIM = { dur: 7, open: 0.6, close: 0.5 };

export const ANIMS = [
  { id: 'doc', label: 'Document explode', dur: ANIM.dur },
  { id: 'face', label: 'Face explode', dur: ANIM.dur },
];

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
  const rig = createRig(el.querySelector('.sl-rig'), id, u);
  // Open, every presented layer, close. The face rig has no closing step of its own.
  const shown = rig.spec.steps.filter(st => st.layer != null);
  const steps = [{ layer: null, explode: 1 }, ...shown, { layer: null, explode: 0 }];
  rig.spec = { ...rig.spec, steps };
  const mid = (ANIM.dur - ANIM.open - ANIM.close) / shown.length;
  // time -> fractional step, with short open/close steps and even layer steps
  const stepAt = t => {
    if (t < ANIM.open) return t / ANIM.open;
    const tm = t - ANIM.open;
    if (tm < mid * shown.length) return 1 + tm / mid;
    return Math.min(steps.length - 0.001, 1 + shown.length + (tm - mid * shown.length) / ANIM.close);
  };
  return {
    duration: ANIM.dur,
    render(t) {
      pose(rig, stepAt(clamp(t, 0, ANIM.dur)), {
        rx: 57, rz: -34, scale: 0.9, gap: 92, stackFade: 0.35,
        present: { x: 640, y: 52, scale: 1.16 },
        timing: [-0.12, 0.16, 0.82, 1.1],
      });
    },
  };
}
