// Copies the site's images into public/ so staticFile('site/img/...') resolves.
import { cpSync, mkdirSync } from 'node:fs';
const src = new URL('../../site/assets/img/', import.meta.url).pathname;
const dst = new URL('../public/site/img/', import.meta.url).pathname;
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('synced', src, '->', dst);
