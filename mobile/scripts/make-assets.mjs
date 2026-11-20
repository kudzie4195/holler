// Builds the source images for `npm run cap:assets` from the website's own mark (public/icon.svg, round 9 brand):
// a hi-vis lime tile with ink signal arcs on both sides of a dot. Same drawing, same proportions; no new artwork.
//   assets/icon-only.png        1024 x 1024, no alpha, full-bleed lime tile with the ink arcs (iOS masks the corners itself)
//   assets/icon-foreground.png  1024 x 1024, transparent, the ink arcs at the same share of the icon as on iOS (see below)
//   assets/icon-background.png  1024 x 1024, solid lime
//   assets/splash.png / splash-dark.png  2732 x 2732, field green with the lime tile in the middle
// Ink on lime is 13.2:1; the lime tile on field green is 9.7:1 (WCAG relative luminance).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../assets');
mkdirSync(out, { recursive: true });

// Brand tokens (app/globals.css and mobile/src/styles.css).
const SIGNAL = '#D9F046';
const INK = '#14201A';
const BRAND = '#1E3A2C';

// public/icon.svg in 32 units: the 24-unit arcs drawing placed inside the 32-unit tile.
const ARCS = `<g transform="translate(6.588 6.588) scale(0.7843)" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" fill="none">
    <circle cx="12" cy="12" r="2"/>
    <path d="M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>
  </g>`;
const TILE = `<rect width="32" height="32" rx="6" fill="${SIGNAL}"/>${ARCS}`;

const svg = (size, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`);
// A 32-unit drawing scaled to `px` and centered on a `size` canvas.
const place = (size, px, body) => `<g transform="translate(${(size - px) / 2} ${(size - px) / 2}) scale(${px / 32})">${body}</g>`;

// iOS: full bleed. The tile's own 6-unit corner is replaced by the system mask, so draw a square lime field with the arcs.
await sharp(svg(1024, `<rect width="1024" height="1024" fill="${SIGNAL}"/>${place(1024, 1024, ARCS)}`))
  .flatten({ background: SIGNAL })
  .removeAlpha()
  .png()
  .toFile(path.join(out, 'icon-only.png'));

// Android adaptive icon: mipmap-anydpi-v26/ic_launcher.xml insets both layers by 16.7%, so each 1024 px image fills the visible
// 72 dp of the 108 dp layer. Map the tile onto the whole image: the arcs take the same share of the icon as on iOS and sit well
// inside the 66 dp safe circle (they span 26% to 74% across).
const visible = 1024;
await sharp(svg(1024, place(1024, visible, ARCS))).png().toFile(path.join(out, 'icon-foreground.png'));
await sharp(svg(1024, `<rect width="1024" height="1024" fill="${SIGNAL}"/>`)).removeAlpha().png().toFile(path.join(out, 'icon-background.png'));

// Splash: field green, the lime tile (480 px of 2732, the old size) in the middle. Dark mode uses the same art.
const splash = svg(2732, `<rect width="2732" height="2732" fill="${BRAND}"/>${place(2732, 480, TILE)}`);
for (const name of ['splash.png', 'splash-dark.png']) {
  await sharp(splash).flatten({ background: BRAND }).removeAlpha().png().toFile(path.join(out, name));
}
console.log('make-assets: wrote', out);
