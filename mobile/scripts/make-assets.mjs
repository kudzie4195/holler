// Builds the source images for `npm run cap:assets` from the website's own mark (public/icon.svg).
// No new artwork: the same circle and two arcs, in the site's accent color.
//   assets/icon-only.png        1024 x 1024, no alpha, full bleed (iOS masks the corners itself)
//   assets/icon-foreground.png  1024 x 1024, white mark inside Android's adaptive-icon safe zone
//   assets/icon-background.png  1024 x 1024, solid accent
//   assets/splash.png / splash-dark.png  2732 x 2732, off-white with the rounded mark in the middle
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../assets');
mkdirSync(out, { recursive: true });

const ACCENT = '#E8590C';
const PAPER = '#FAF8F3';
const MARK = `
  <circle cx="16" cy="16" r="3.2" fill="#FFFFFF"/>
  <path d="M21.36 11.5A7 7 0 0 1 21.36 20.5M10.64 11.5A7 7 0 0 0 10.64 20.5" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" fill="none"/>
  <path d="M24.81 8.61A11.5 11.5 0 0 1 24.81 23.39M7.19 8.61A11.5 11.5 0 0 0 7.19 23.39" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" opacity="0.7" fill="none"/>`;

const svg = (size, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`);
// The 32-unit mark scaled to `px` and centered on a `size` canvas.
const mark = (size, px) => `<g transform="translate(${(size - px) / 2} ${(size - px) / 2}) scale(${px / 32})">${MARK}</g>`;

await sharp(svg(1024, `<rect width="1024" height="1024" fill="${ACCENT}"/>${mark(1024, 1024)}`))
  .flatten({ background: ACCENT })
  .removeAlpha()
  .png()
  .toFile(path.join(out, 'icon-only.png'));

// Adaptive icons crop to a circle or squircle inside the middle 66%: keep the mark well inside it.
await sharp(svg(1024, mark(1024, 640))).png().toFile(path.join(out, 'icon-foreground.png'));
await sharp(svg(1024, `<rect width="1024" height="1024" fill="${ACCENT}"/>`)).removeAlpha().png().toFile(path.join(out, 'icon-background.png'));

const splash = svg(
  2732,
  `<rect width="2732" height="2732" fill="${PAPER}"/>
   <g transform="translate(1126 1126) scale(15)"><rect width="32" height="32" rx="9" fill="${ACCENT}"/>${MARK}</g>`,
);
for (const name of ['splash.png', 'splash-dark.png']) {
  await sharp(splash).flatten({ background: PAPER }).removeAlpha().png().toFile(path.join(out, name));
}
console.log('make-assets: wrote', out);
