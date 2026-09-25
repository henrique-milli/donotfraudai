// Renders every slide to out/<n>-<id>.mp4, plus a PNG still for each explode
// step (at the moment the layer is fully presented) for static Canva slides.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { SLIDES, STEP } from '../../site/assets/js/slides-core.js';

const FPS = 30;
const only = process.argv[2];
mkdirSync(new URL('../out/stills/', import.meta.url), { recursive: true });
const run = args => execFileSync('npx', ['remotion', ...args, '--log=error'], { stdio: 'inherit' });

SLIDES.forEach((s, i) => {
  if (only && s.id !== only) return;
  const n = String(i + 1).padStart(2, '0');
  run(['render', 'src/root.tsx', `slide-${s.id}`, `out/${n}-${s.id}.mp4`, '--codec=h264', '--crf=16', '--image-format=jpeg', '--jpeg-quality=95', '--concurrency=4']);
  const moments = ['doc', 'face'].includes(s.id)
    ? Array.from({ length: Math.round(s.dur / STEP) }, (_, k) => (k + 0.55) * STEP)
    : [s.dur];
  moments.forEach((t, k) => {
    run(['still', 'src/root.tsx', `slide-${s.id}`, `out/stills/${n}-${s.id}-${k + 1}.png`, `--frame=${Math.round(t * FPS)}`]);
  });
});
