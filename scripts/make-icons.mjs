// Renders the PocketOps mark (a pocket holding a pulse line) into every icon asset the app needs.
//   node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'images');
mkdirSync(root, { recursive: true });

const SIZE = 1024;
const DARK_TOP = '#1f232b';
const DARK_BOTTOM = '#0c0e11';

const defs = `
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${DARK_TOP}"/><stop offset="1" stop-color="${DARK_BOTTOM}"/>
  </linearGradient>
  <linearGradient id="or" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FF8A3D"/><stop offset="1" stop-color="#E8590C"/>
  </linearGradient>
</defs>`;

/**
 * The mark, drawn on the 1024 grid. `scale` shrinks it about the canvas centre (Android's adaptive icons
 * keep only the middle ~61% safe), and the -70 shift re-centres it: the pocket's bounding box sits low
 * on the grid it was designed on.
 */
function glyph({ pocket, pulse, scale = 1 }) {
  return `
<g transform="translate(512 512) scale(${scale}) translate(-512 -512) translate(0 -70)">
  <path d="M262 330 H762 V690 A150 150 0 0 1 612 840 H412 A150 150 0 0 1 262 690 Z"
        fill="none" stroke="${pocket}" stroke-width="56" stroke-linejoin="round"/>
  <path d="M262 330 H762" stroke="${pocket}" stroke-width="56" stroke-linecap="round"/>
  <path d="M340 620 H450 L510 480 L584 720 L640 580 H684"
        fill="none" stroke="${pulse}" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
</g>`;
}

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${defs}${body}</svg>`;

const assets = {
  // iOS and the store listing: full-bleed, no transparency, no rounded corners (the OS masks it).
  'icon.png': svg(`<rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>${glyph({ pocket: '#F4F5F7', pulse: 'url(#or)' })}`),
  'android-icon-background.png': svg(`<rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>`),
  'android-icon-foreground.png': svg(glyph({ pocket: '#F4F5F7', pulse: 'url(#or)', scale: 0.78 })),
  // Android themed icons are tinted by the system from the alpha channel, so one flat colour.
  'android-icon-monochrome.png': svg(glyph({ pocket: '#000000', pulse: '#000000', scale: 0.78 })),
  'splash-icon.png': svg(glyph({ pocket: '#F4F5F7', pulse: 'url(#or)' })),
};

for (const [name, markup] of Object.entries(assets)) {
  const out = join(root, name);
  const png = await sharp(Buffer.from(markup)).png().toBuffer();
  writeFileSync(out, png);
  console.log('wrote', name, `${png.length} bytes`);
}
