/* DoNotFraudAI showcase: exploded-phone rigs, scroll scenes, fraud toggle.
   No dependencies. Every overlay is positioned in % of the 576x1232 capture. */
(() => {
  'use strict';

  // ---------- links (edit here) ----------
  const LINKS = {
    repo: 'https://github.com/henrique-milli/donotfraudai',
    readme: 'https://github.com/henrique-milli/donotfraudai#readme',
    // Canva slide deck: paste the public "view" link here.
    slides: '',
  };
  document.querySelectorAll('[data-link]').forEach(a => {
    const url = LINKS[a.dataset.link];
    if (url) a.href = url;
    else { a.removeAttribute('target'); a.href = '#film'; a.title = 'Slide deck link coming soon'; }
  });

  // ?still pins every animation to a clean pose (used for the social preview).
  const still = new URLSearchParams(location.search).has('still');
  const reduce = still || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- overlay helpers (all % of the screen) ----------
  const box = (x, y, w, h, c, label, under) =>
    `<div class="box" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%;--c:${c}">${label ? `<span class="lbl${under ? ' under' : ''}">${label}</span>` : ''}</div>`;
  const brackets = (x, y, w, h, c) => {
    const s = `--c:${c}`;
    return `<div class="brk tl" style="left:${x}%;top:${y}%;${s}"></div><div class="brk tr" style="left:calc(${x + w}% - 22px);top:${y}%;${s}"></div>` +
      `<div class="brk bl" style="left:${x}%;top:calc(${y + h}% - 22px);${s}"></div><div class="brk br" style="left:calc(${x + w}% - 22px);top:calc(${y + h}% - 22px);${s}"></div>`;
  };
  const hud = (x, y, w, c, title, body) =>
    `<div class="hud" style="left:${x}%;top:${y}%;width:${w}%;--c:${c}"><h6>${title}</h6>${body}</div>`;
  const barRow = (label, v, c, val) =>
    `<div class="row"><span>${label}</span><b>${val ?? v.toFixed(2)}</b></div><div class="bar" style="--c:${c}"><i style="--v:${Math.max(2, v * 100)}%"></i></div>`;
  const kv = (k, v, c = 'var(--green)') => `<div class="row"><span>${k}</span><b style="color:${c}">${v}</b></div>`;

  const G = 'var(--green)', R = 'var(--red)', A = 'var(--amber)', B = 'var(--sky)', V = 'var(--violet)';

  // ---------- layer library ----------
  const PCB = (focus) => ({
    cls: 'pcb', accent: G, tag: `<b>Device trust</b> · silicon`,
    html: `
      <div class="chip-part" style="left:36%;top:4%;width:28%;height:7%">${focus === 'face' ? 'FRONT CAM' : 'CAMERA'}<small>sensor · HAL</small></div>
      <div class="chip-part" style="left:14%;top:20%;width:40%;height:13%">SoC<small>app · scan engine</small></div>
      <div class="chip-part" style="left:60%;top:21%;width:27%;height:11%;border-color:rgba(255,59,47,.6);box-shadow:0 0 26px -6px rgba(255,59,47,.7)">STRONG<br/>BOX<small>attested key</small></div>
      <div class="chip-part" style="left:14%;top:39%;width:26%;height:8%">TEE<small>fallback</small></div>
      <div class="chip-part" style="left:47%;top:39%;width:40%;height:8%">IMU<small>gyro · hand-held</small></div>
      <div class="coil" style="left:16%;top:54%;width:68%;height:26%"></div>
      <div class="chip-part" style="left:36%;top:62%;width:28%;height:9%;border-color:rgba(255,181,71,.6);box-shadow:0 0 22px -6px rgba(255,181,71,.6);color:#ffe2b0">NFC<small style="color:#d9a55a">ISO 14443</small></div>
      <div class="trace" style="left:50%;top:11%;width:2px;height:9%"></div>
      <div class="trace" style="left:54%;top:26%;width:6%;height:2px"></div>
      <div class="trace" style="left:30%;top:33%;width:2px;height:6%"></div>
      <div class="trace" style="left:62%;top:32%;width:2px;height:7%"></div>
      <div class="trace" style="left:50%;top:47%;width:2px;height:15%"></div>
      <div class="chip-part" style="left:14%;top:85%;width:72%;height:7%">KEY ATTESTATION<small>challenge baked into the key · 4-cert chain</small></div>`,
  });
  const CHASSIS = { cls: 'chassis', accent: B, tag: `<b>Phone</b> · Pixel 6`, html: `<i class="cam"></i>` };
  const SCREEN = (img, tag) => ({ cls: 'screen', accent: B, tag, html: `<img src="assets/img/${img}" alt="" />` });

  const DOC_Q = {
    cls: 'ovl', accent: G, tag: `<b>Quality gates</b> · 7 live`,
    html: brackets(4.5, 24, 91, 25.5, G) +
      `<div class="ov" style="left:5%;top:50.4%;width:90%;height:0;border-top:1.5px dashed ${G}"></div>` +
      `<span class="pill" style="position:absolute;left:34%;top:49.2%;--c:${G}">↔ card fills the frame</span>` +
      box(2, 31, 6, 12, G, '', false) + box(92, 31, 6, 12, G, '', false) +
      `<span class="pill" style="position:absolute;left:1%;top:44%;--c:${G}">no fingers</span>` +
      `<div class="heat" style="left:74%;top:25%;width:16%;height:8%"></div><span class="pill" style="position:absolute;left:66%;top:19.5%;--c:${A}">glare ROI</span>` +
      hud(6, 55, 88, G, 'LIVE QUALITY GATES · 2 FRAMES IN A ROW',
        kv('Card detected', '✓') + kv('Distance', '✓') + kv('Lighting', '✓') +
        barRow('Sharpness · high', 0.89, G, '✓') + kv('Glare · Fingers', '✓') + kv('ID photo', '✓')),
  };
  const DOC_PAD = {
    cls: 'ovl', accent: R, tag: `<b>Presentation attack</b> · 4 checks`,
    html: `<div class="scan-line" style="--c:${R};--from:25%;--to:48%"></div>` +
      box(8, 30, 31, 16.5, R, 'ID PHOTO TAMPERING &lt; 0.70 ✓') +
      box(4.5, 24, 91, 25.5, 'rgba(255,59,47,.55)', '') +
      hud(6, 55, 88, R, 'SCENE MODEL · PHYS / SCREEN / PAPER',
        barRow('Physical card', 0.64, G) + barRow('Screen / display', 0, R) + barRow('Paper print', 0.36, A) +
        kv('Moiré', '0.60 ≤ 4.0 ✓') + kv('Colourfulness', 'colour card ✓')),
  };
  const DOC_READ = {
    cls: 'ovl', accent: V, tag: `<b>Document understanding</b> · OCR · MRZ`,
    html: `<img src="assets/img/doc-back.jpg" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.92" />` +
      box(10, 42.3, 78, 7.3, V, 'MRZ · TD1 3×30 · 7-3-1 ✓', true) +
      box(7, 27.5, 44, 3.4, B, 'OCR') + box(7, 31.8, 44, 3.4, B, '') + box(7, 36, 44, 3.4, B, '') +
      hud(6, 58, 88, V, 'SWISS CLASSIFIER · CROSS-CHECKS',
        kv('Document', 'residence permit', 'var(--text)') + kv('Issuer · state marking', 'CHE ✓') +
        kv('Front ↔ MRZ', 'no · birth · name ✓') + kv('Document valid', 'expired ✕', 'var(--red)') +
        kv('ICAO chip symbol', '0.71 ≥ 0.25 → NFC', 'var(--amber)')),
  };
  const DOC_NFC = {
    cls: 'ovl', accent: A, tag: `<b>NFC chip</b> · ICAO 9303`,
    html: `<div class="nfc-waves" style="position:absolute;left:50%;top:34%"><i></i><i></i><i></i></div>` +
      hud(8, 52, 84, A, 'CHIP · PASSIVE AUTHENTICATION',
        kv('PACE / BAC', 'secure channel ✓') + kv('DG1', '= printed MRZ ✓') + kv('SOD hashes', 'DG1/2/11/12/14 ✓') +
        kv('Document Signer', 'signature ✓') + kv('DG2 photo', 'decoded ✓') + kv('Swiss CSCA chain', 'roadmap', 'var(--muted)')),
  };
  const ENVELOPE = {
    cls: 'ovl', accent: R, tag: `<b>Sealed</b> · to the server`,
    html: `<div class="seal">
        <div class="lock">🔒</div>
        <h6>SEALED FOR THE RISK BACKEND</h6>
        <p>ECDH-ES P-256<br/>HKDF-SHA256<br/>AES-256-GCM</p>
        <p class="s">signed · StrongBox-attested key<br/>single-use server challenge</p>
        <div class="route-chip">phone learns: <b>route</b> only</div>
      </div>`,
  };

  const FACE_GATES = {
    cls: 'ovl', accent: B, tag: `<b>Capture gates</b> · YuNet`,
    html: box(24, 22, 52, 33, B, 'FACE · YUNET 0.7') +
      [[36, 32.5], [62.5, 32.5], [50, 38.5], [41, 45.5], [59, 45.5]].map(([x, y]) => `<i class="dot" style="left:${x}%;top:${y}%;--c:${B}"></i>`).join('') +
      hud(8, 61, 84, B, 'PASSIVE CAPTURE · 3 READY FRAMES',
        kv('Face · Centered · Distance', '✓') + kv('Clear · Eyes', '✓') + kv('Light', 'bg ≥ 50 · face ≥ 35 ✓') +
        kv('Pose', 'look 0.07 · tilt 0.33 > 0.3', 'var(--amber)')),
  };
  const FACE_CHAL = {
    cls: 'ovl', accent: V, tag: `<b>Random challenge</b> · PoH`,
    html: `<svg class="gizmo" viewBox="0 0 576 1232" preserveAspectRatio="none">
        <ellipse cx="288" cy="462" rx="232" ry="300" fill="none" stroke="rgba(169,139,255,.25)" stroke-width="3" stroke-dasharray="6 10"/>
        <path d="M150 300 A 180 120 0 0 1 426 300" fill="none" stroke="#a98bff" stroke-width="5" marker-end="url(#ah)"/>
        <path d="M470 520 A 190 190 0 0 1 400 690" fill="none" stroke="#4d9bff" stroke-width="5" marker-end="url(#ah2)"/>
        <defs><marker id="ah" markerWidth="10" markerHeight="10" refX="6" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="#a98bff"/></marker>
        <marker id="ah2" markerWidth="10" markerHeight="10" refX="6" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="#4d9bff"/></marker></defs>
        <text x="288" y="280" fill="#a98bff" font-family="JetBrains Mono" font-size="26" font-weight="700" text-anchor="middle">YAW Δ ≥ 0.12</text>
        <text x="505" y="640" fill="#4d9bff" font-family="JetBrains Mono" font-size="24" font-weight="700" text-anchor="end">ROLL Δ ≥ 6°</text>
      </svg>` +
      `<div class="chal" style="left:6%;top:62%;width:88%">
        <div class="h"><span>SERVER CHALLENGE</span><span>180 s · single use</span></div>
        <div class="t"><span>Turn left</span><span>Tilt right</span><span>Move closer</span></div>
        <div class="f">area ×1.15 closer · ×0.87 further · same face ≥ 0.4</div>
      </div>`,
  };
  const FACE_LIVE = {
    cls: 'ovl', accent: R, tag: `<b>Liveness</b> · MiniFASNet ×2`,
    html: `<div class="texture" style="left:24%;top:22%;width:52%;height:33%"></div>` +
      `<div class="frames" style="left:8%;top:60%;width:84%">${[0, 1, 2, 3, 4].map(i => `<span style="background-position:${46 + i * 2}% ${30 + (i % 2) * 2}%"></span>`).join('')}</div>` +
      hud(8, 69, 84, R, 'EVERY FRAME',
        kv('Passive liveness', 'pass ≥ 0.70 ✓') + kv('Burst consistency', '≥ 0.5 ✓') +
        kv('Face swap / deepfake', 'mock contract', 'var(--amber)')),
  };
  const FACE_ONE = {
    cls: 'ovl', accent: R, tag: `<b>1:1 match</b> · SFace`,
    html: `<div class="match">
        <div class="pair">
          <div class="p selfie"></div>
          <div class="vs">vs</div>
          <div class="p dg2"><span>CHIP DG2<br/>signed</span></div>
        </div>
        <div class="meter"><i class="thr"></i><i class="needle"></i></div>
        <div class="row" style="font-family:var(--mono);font-size:10px;color:var(--muted)"><span>0</span><span>match ≥ 0.363</span><span>1</span></div>
        <div class="nomatch">✕ NOT THE DOCUMENT HOLDER</div>
      </div>`,
  };
  const FACE_N = {
    cls: 'ovl', accent: G, tag: `<b>Uniqueness</b> · 1:N · PoU`,
    html: `<div class="gallery">${Array.from({ length: 20 }, (_, i) => `<span class="${[5, 6, 10, 11].includes(i) ? 'hit' : ''}"></span>`).join('')}</div>` +
      hud(8, 64, 84, G, 'PGVECTOR · HNSW · COSINE',
        kv('Same person', '≥ 0.5') + kv('Cluster', 'F-00001 · 4 sessions', 'var(--amber)') +
        kv('Same face, other docs', '+60', 'var(--amber)') + kv('Doc seen before', '+80', 'var(--amber)')),
  };

  const RIGS = {
    hero: {
      gap: 62, layers: [PCB('doc'), CHASSIS, SCREEN('doc-front.jpg', ''), DOC_Q, DOC_PAD, ENVELOPE], noTags: true,
    },
    doc: {
      gap: 58,
      layers: [PCB('doc'), CHASSIS, SCREEN('doc-front.jpg', `<b>Camera frame</b> · 1920×1080`), DOC_Q, DOC_PAD, DOC_READ, DOC_NFC, ENVELOPE],
      // step -> layer index
      focus: [null, 0, 2, 3, 4, 5, 6, 7],
    },
    face: {
      gap: 58,
      layers: [PCB('face'), CHASSIS, SCREEN('face.jpg', `<b>Selfie</b> · live`), FACE_GATES, FACE_CHAL, FACE_LIVE, FACE_ONE, FACE_N],
      focus: [null, 0, 3, 4, 5, 6, 7],
    },
  };

  // ---------- build rigs ----------
  const rigs = {};
  document.querySelectorAll('[data-rig]').forEach(el => {
    const spec = RIGS[el.dataset.rig];
    el.innerHTML = spec.layers.map((l, i) =>
      `<div class="layer ${l.cls}" style="--accent:${l.accent}" data-i="${i}">
        ${i === 1 ? '<div class="shadow"></div>' : ''}
        <div class="plane">${l.html}</div>
        ${spec.noTags || !l.tag ? '' : `<div class="ltag">${l.tag}</div>`}
      </div>`).join('');
    rigs[el.dataset.rig] = {
      el, spec, layers: [...el.querySelectorAll('.layer')],
      cur: { e: 0, rx: 58, rz: -36, focusZ: 0, s: 1 }, tgt: { e: 0, rx: 58, rz: -36, focusZ: 0, s: 1 }, active: -1,
    };
  });

  function applyRig(r) {
    const { cur, spec, layers, el } = r;
    const n = layers.length;
    const mid = (n - 1) / 2;
    // Overlay layers only appear once the phone comes apart, so the
    // collapsed phone reads as a clean screen.
    const vis = smooth(0.25, 0.75, cur.e);
    layers.forEach((layer, i) => {
      const lift = i === r.active ? 26 * cur.e : 0;
      const z = (i - mid) * spec.gap * cur.e + i * 0.8 + lift;
      layer.style.setProperty('--z', `${z.toFixed(2)}px`);
      if (layer.classList.contains('ovl')) {
        const dim = r.active >= 0 && i !== r.active ? 0.3 : 1;
        layer.style.opacity = (vis * dim).toFixed(3);
      }
    });
    el.style.setProperty('--rx', `${cur.rx.toFixed(2)}deg`);
    el.style.setProperty('--rz', `${cur.rz.toFixed(2)}deg`);
    el.style.transform = `rotateX(${cur.rx}deg) rotateZ(${cur.rz}deg) translateZ(${(-cur.focusZ).toFixed(2)}px) scale(${cur.s})`;
    el.classList.toggle('exploded', cur.e > 0.6);
  }

  function setActive(r, idx) {
    if (r.active === idx) return;
    r.active = idx;
    r.el.classList.toggle('focused', idx >= 0);
    r.layers.forEach((l, i) => {
      l.classList.toggle('active', i === idx);
      l.classList.toggle('dim', idx != null && idx >= 0 && i !== idx && i > 1);
    });
  }

  // ---------- scroll scenes ----------
  const scenes = [...document.querySelectorAll('.scrolly')].map(sec => ({
    sec, rig: rigs[sec.dataset.scene], cards: [...sec.querySelectorAll('.step-card')],
    rails: [...sec.querySelectorAll('.progress-rail i')], step: -1,
  }));

  const progressOf = sec => {
    const r = sec.getBoundingClientRect();
    const total = sec.offsetHeight - innerHeight;
    return clamp(-r.top / total);
  };

  function updateScenes() {
    for (const s of scenes) {
      const p = progressOf(s.sec);
      const n = s.cards.length;
      const stepF = clamp(p * 1.04, 0, 0.9999) * n;
      const step = Math.floor(stepF);
      if (step !== s.step) {
        s.step = step;
        s.cards.forEach((c, i) => c.classList.toggle('on', i === step));
        const fi = s.rig.spec.focus[step];
        setActive(s.rig, fi == null ? -1 : fi);
      }
      s.rails.forEach((r, i) => r.style.setProperty('--f', clamp(stepF - i).toFixed(3)));
      const accent = getComputedStyle(s.cards[step]).getPropertyValue('--accent');
      s.sec.style.setProperty('--accent', accent);
      const r = s.rig;
      const small = innerWidth < 860;
      r.tgt.e = smooth(0.015, 0.085, p);
      r.tgt.rx = 60 - 10 * p;
      r.tgt.rz = -40 + 26 * p;
      const stageW = s.sec.querySelector('.stage').clientWidth;
      r.tgt.s = small ? Math.min(0.6, innerWidth / 640) : Math.min(0.92, innerHeight / 980, stageW / 720);
      const fi = s.rig.spec.focus[step];
      const n2 = r.layers.length;
      r.tgt.focusZ = fi == null ? 0 : (fi - (n2 - 1) / 2) * r.spec.gap * 0.55;
    }
  }

  // ---------- triage god view ----------
  const god = document.querySelector('.god');
  const consoleRig = document.getElementById('consoleRig');
  const hotspots = [...document.querySelectorAll('.hotspot')];
  let hotIdx = -1;
  function updateGod() {
    if (!god) return;
    const p = progressOf(god);
    const t = smooth(0.02, 0.4, p);
    consoleRig.style.setProperty('--t', t.toFixed(4));
    const fit = Math.min(0.88, (innerWidth - 40) / 1320, (innerHeight - 120) / 800);
    consoleRig.style.setProperty('--smax', fit.toFixed(3));
    consoleRig.style.setProperty('--s0', (fit * 0.72).toFixed(3));
    god.querySelector('.copy').style.opacity = String(1 - smooth(0.3, 0.42, p));
    const k = p < 0.44 ? -1 : Math.min(hotspots.length - 1, Math.floor(((p - 0.44) / 0.54) * hotspots.length));
    if (k !== hotIdx) {
      hotIdx = k;
      hotspots.forEach((h, i) => h.classList.toggle('on', i === k));
      consoleRig.querySelectorAll('[data-hot]').forEach(el => { el.style.outline = ''; el.style.outlineOffset = ''; });
      if (k >= 0) {
        const target = consoleRig.querySelector(`[data-hot="${hotspots[k].dataset.for}"]`);
        if (target) { target.style.outline = '3px solid #ff3b2f'; target.style.outlineOffset = '3px'; }
      }
    }
    if (k >= 0) {
      const h = hotspots[k];
      const target = consoleRig.querySelector(`[data-hot="${h.dataset.for}"]`);
      if (target) {
        const tr = target.getBoundingClientRect();
        const gr = god.querySelector('.sticky').getBoundingClientRect();
        const w = 300;
        let x = tr.right + 14 - gr.left;
        if (x + w > gr.width - 10) x = tr.left - w - 14 - gr.left;
        const y = clamp(tr.top - gr.top + 8, 70, gr.height - 140);
        h.style.left = `${x}px`;
        h.style.top = `${y}px`;
      }
    }
  }

  // ---------- hero rig: breathing + parallax ----------
  let mx = 0, my = 0;
  addEventListener('pointermove', e => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });
  function updateHero(time) {
    const r = rigs.hero;
    if (!r) return;
    const t = time / 1000;
    r.tgt.e = reduce ? 0.85 : 0.78 + Math.sin(t * 0.9) * 0.17;
    r.tgt.rx = reduce ? 57 : 57 + my * 8;
    r.tgt.rz = reduce ? -36 : -36 + mx * 14 + Math.sin(t * 0.35) * 4;
    r.tgt.s = innerWidth < 1100 ? Math.min(0.78, innerWidth / 560) : Math.min(0.96, innerHeight / 900);
    const k = reduce ? 1 : Math.floor(t / 2.2) % 3;
    setActive(r, [3, 4, 5][k]);
  }

  // ---------- main loop ----------
  function frame(time) {
    updateScenes();
    updateGod();
    updateHero(time);
    for (const r of Object.values(rigs)) {
      const k = reduce ? 1 : 0.12;
      for (const key of ['e', 'rx', 'rz', 'focusZ', 's']) r.cur[key] = lerp(r.cur[key], r.tgt[key], k);
      applyRig(r);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- nav / reveal ----------
  const nav = document.getElementById('nav');
  addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 20), { passive: true });
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.15 });
  document.querySelectorAll('.reveal, .rung').forEach(el => io.observe(el));

  // ---------- film: fall back to the poster until the render is published ----------
  const film = document.getElementById('filmVideo');
  if (film) {
    fetch(film.querySelector('source').src, { method: 'HEAD' }).then(r => {
      if (!r.ok) throw new Error('missing');
    }).catch(() => {
      film.removeAttribute('controls');
      film.closest('.film').classList.add('pending');
    });
  }

  // ---------- fraud path toggle ----------
  const MODES = {
    genuine: { phys: 0.64, screen: 0, paper: 0.36, moire: '0.60 ≤ 4.0 · pass', a: 'doc-front.jpg', b: 'pad-front.jpg', verdict: '✓ No attack detected on the front', bad: false },
    attack: { phys: 0, screen: 1, paper: 0, moire: '1.06 ≤ 4.0 · missed it', a: 'attack-screen.jpg', b: 'attack-detected.jpg', verdict: '✕ ATTACK DETECTED · not a physical card: screen replay', bad: true },
  };
  const toggle = document.querySelector('.toggle');
  let userPicked = false;
  function setMode(name) {
    const m = MODES[name];
    toggle.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.mode === name); b.classList.toggle('bad', b.dataset.mode === 'attack'); });
    for (const k of ['phys', 'screen', 'paper']) {
      document.querySelector(`[data-v="${k}"]`).textContent = m[k].toFixed(2);
      document.querySelector(`[data-b="${k}"]`).style.setProperty('--v', `${Math.max(1, m[k] * 100)}%`);
    }
    document.querySelector('[data-v="moire"]').textContent = m.moire;
    const v = document.getElementById('verdict');
    v.textContent = m.verdict;
    v.className = `verdict ${m.bad ? 'bad' : 'ok'}`;
    document.querySelector('#fraudA img').src = `assets/img/${m.a}`;
    document.querySelector('#fraudB img').src = `assets/img/${m.b}`;
    document.getElementById('fraudB').classList.toggle('alarm', m.bad);
  }
  if (toggle) {
    setMode('genuine');
    toggle.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      userPicked = true;
      setMode(b.dataset.mode);
    });
    let flip = false;
    setInterval(() => {
      const r = toggle.getBoundingClientRect();
      if (userPicked || r.bottom < 0 || r.top > innerHeight) return;
      flip = !flip;
      setMode(flip ? 'attack' : 'genuine');
    }, 3600);
  }
})();
