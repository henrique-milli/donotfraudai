/* DoNotFraudAI showcase: scroll drives the shared explode engine. */
import { createRig, pose } from './explode.js';

const LINKS = {
  repo: 'https://github.com/henrique-milli/donotfraudai',
  // Canva slide deck: paste the public "view" link here.
  slides: '',
};
document.querySelectorAll('[data-link]').forEach(a => {
  const url = LINKS[a.dataset.link];
  if (url) a.href = url;
  else { a.removeAttribute('target'); a.href = 'slides.html'; }
});

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const progressOf = sec => clamp(-sec.getBoundingClientRect().top / (sec.offsetHeight - innerHeight));

// ---------- explode scenes ----------
const scenes = [...document.querySelectorAll('.scene')].map(sec => {
  const rig = createRig(sec.querySelector('.rig-el'), sec.dataset.rig);
  const steps = [...sec.querySelectorAll('.step')];
  const dots = sec.querySelector('.dots');
  dots.innerHTML = steps.map(() => '<i></i>').join('');
  return { sec, rig, steps, dots: [...dots.children], cur: 0, on: -1 };
});

function sceneView() {
  const W = innerWidth, H = innerHeight;
  if (W <= 820) {
    return { rx: 58, rz: -36, scale: 0.36, gap: 58, stackFade: 0.12, present: { x: 0, y: 0, scale: (0.5 * H) / 685 } };
  }
  const originX = 0.22 * W;
  const copyLeft = W - Math.max(18, 0.05 * W) - Math.min(420, 0.34 * W);
  const ps = Math.min((0.7 * H) / 685, 1.1);
  const px = Math.min(0.47 * W, copyLeft - 30 - 160 * ps) - originX;
  return { rx: 58, rz: -36, scale: clamp((H / 900) * 0.6, 0.4, 0.7), gap: 70, stackFade: 0.4, present: { x: px, y: 0.02 * H, scale: ps } };
}

function updateScenes() {
  const view = sceneView();
  for (const s of scenes) {
    const n = s.steps.length;
    const target = clamp(progressOf(s.sec) * n, 0, n - 0.001);
    s.cur = reduce ? target : lerp(s.cur, target, 0.14);
    const st = pose(s.rig, s.cur, view);
    if (st.step !== s.on) {
      s.on = st.step;
      s.steps.forEach((el, i) => el.classList.toggle('on', i === st.step));
      s.sec.style.setProperty('--accent', getComputedStyle(s.steps[st.step]).getPropertyValue('--accent'));
    }
    s.dots.forEach((d, i) => d.style.setProperty('--f', clamp(s.cur - i).toFixed(3)));
  }
}

// ---------- hero: calm exploded stack with parallax ----------
const heroEl = document.getElementById('heroRig');
const hero = heroEl ? createRig(heroEl, 'doc') : null;
let mx = 0, my = 0;
addEventListener('pointermove', e => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });
const heroCur = { rx: 58, rz: -34 };
function updateHero(time) {
  if (!hero) return;
  const t = time / 1000;
  heroCur.rx = lerp(heroCur.rx, reduce ? 58 : 58 + my * 6, 0.06);
  heroCur.rz = lerp(heroCur.rz, reduce ? -34 : -34 + mx * 10 + Math.sin(t * 0.4) * 3, 0.06);
  const small = innerWidth < 1080;
  pose(hero, 0.95, { rx: heroCur.rx, rz: heroCur.rz, scale: small ? Math.min(0.62, innerWidth / 700) : Math.min(0.82, innerHeight / 960), gap: 62, present: null });
}

// ---------- triage: tilted to flat, then four callouts ----------
const god = document.querySelector('.god');
const consoleRig = document.getElementById('consoleRig');
const hotspots = [...document.querySelectorAll('.hotspot')];
let hotIdx = -2;
function updateGod() {
  if (!god) return;
  const p = progressOf(god);
  consoleRig.style.setProperty('--t', smooth(0.02, 0.4, p).toFixed(4));
  const fit = Math.min(0.86, (innerWidth - 40) / 1320, (innerHeight - 140) / 800);
  consoleRig.style.setProperty('--smax', fit.toFixed(3));
  consoleRig.style.setProperty('--s0', (fit * 0.72).toFixed(3));
  god.querySelector('.copy').style.opacity = String(1 - smooth(0.3, 0.42, p));
  const k = p < 0.46 ? -1 : Math.min(hotspots.length - 1, Math.floor(((p - 0.46) / 0.52) * hotspots.length));
  if (k !== hotIdx) {
    hotIdx = k;
    hotspots.forEach((h, i) => h.classList.toggle('on', i === k));
    consoleRig.querySelectorAll('[data-hot]').forEach(el => { el.style.outline = ''; });
    if (k >= 0) {
      const tg = consoleRig.querySelector(`[data-hot="${hotspots[k].dataset.for}"]`);
      if (tg) { tg.style.outline = '3px solid #11AAFF'; tg.style.outlineOffset = '3px'; }
    }
  }
  if (k >= 0) {
    const h = hotspots[k];
    const tg = consoleRig.querySelector(`[data-hot="${h.dataset.for}"]`);
    const gr = god.querySelector('.sticky').getBoundingClientRect();
    const tr = tg.getBoundingClientRect();
    let x = tr.right + 14 - gr.left;
    if (x + 290 > gr.width - 10) x = tr.left - 290 - gr.left;
    h.style.left = `${Math.max(10, x)}px`;
    h.style.top = `${clamp(tr.top - gr.top + 8, 70, gr.height - 140)}px`;
  }
}

function frame(time) {
  updateScenes();
  updateHero(time);
  updateGod();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- nav, reveal, film ----------
const nav = document.getElementById('nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 20), { passive: true });
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

const film = document.getElementById('filmVideo');
if (film) {
  fetch(film.querySelector('source').src, { method: 'HEAD' })
    .then(r => { if (!r.ok) throw new Error(); })
    .catch(() => { film.removeAttribute('controls'); film.closest('.film').classList.add('pending'); });
}

// ---------- fraud path toggle (real values from both runs) ----------
const MODES = {
  genuine: { phys: 0.64, screen: 0, paper: 0.36, a: 'doc-front.jpg', b: 'pad-front.jpg', verdict: '✓ No attack detected', bad: false },
  attack: { phys: 0, screen: 1, paper: 0, a: 'attack-screen.jpg', b: 'attack-detected.jpg', verdict: '✕ Attack detected: screen replay', bad: true },
};
const toggle = document.querySelector('.toggle');
let picked = false;
function setMode(name) {
  const m = MODES[name];
  toggle.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.mode === name); b.classList.toggle('bad', b.dataset.mode === 'attack'); });
  for (const k of ['phys', 'screen', 'paper']) {
    document.querySelector(`[data-v="${k}"]`).textContent = m[k].toFixed(2);
    document.querySelector(`[data-b="${k}"]`).style.setProperty('--v', `${Math.max(1, m[k] * 100)}%`);
  }
  const v = document.getElementById('verdict');
  v.textContent = m.verdict;
  v.className = `verdict ${m.bad ? 'bad' : 'ok'}`;
  document.querySelector('#fraudA img').src = `assets/img/${m.a}`;
  document.querySelector('#fraudB img').src = `assets/img/${m.b}`;
  document.getElementById('fraudB').classList.toggle('alarm', m.bad);
}
if (toggle) {
  setMode('genuine');
  toggle.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { picked = true; setMode(b.dataset.mode); } });
  let flip = false;
  setInterval(() => {
    const r = toggle.getBoundingClientRect();
    if (picked || r.bottom < 0 || r.top > innerHeight) return;
    flip = !flip;
    setMode(flip ? 'attack' : 'genuine');
  }, 3600);
}
