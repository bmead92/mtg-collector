// Renders the app icons from a hand-written SVG: a fanned stack of three card outlines with the front
// card filled (an art window and two text lines cut out), orange gradient on the app's dark background.
// Plain geometry, no external artwork.
//
// Usage: node scripts/make-icons.cjs <out-dir>     (then copy the PNGs into assets/)
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const OUT = process.argv[2] ?? path.join(__dirname, '..', 'assets');
const BG = '#0d0d12';
const ORANGE_TOP = '#ff9a3c';
const ORANGE_BOTTOM = '#e5501b';

// The glyph, in a 100 x 100 box. Cards are 46 x 64 (close to a real card's 63:88), fanned around a point
// below the bottom edge so the stack opens like a hand of cards.
const CARD = { x: 27, y: 18, w: 46, h: 64, r: 6 };
const PIVOT = '50 100';
const ANGLE = 15;
const GAP = 3.5; // clear space between the front card and the cards behind it

function glyph(fill, uid) {
  const { x, y, w, h, r } = CARD;
  const rect = (extra) => `<rect x='${x}' y='${y}' width='${w}' height='${h}' rx='${r}' ${extra}/>`;
  return `
  <defs>
    <mask id='front${uid}'>
      ${rect("fill='white'")}
      <rect x='${x + 6}' y='${y + 8}' width='${w - 12}' height='${h * 0.4}' rx='3' fill='black'/>
      <rect x='${x + 6}' y='${y + 8 + h * 0.4 + 7}' width='${w - 12}' height='4' rx='2' fill='black'/>
      <rect x='${x + 6}' y='${y + 8 + h * 0.4 + 15}' width='${(w - 12) * 0.62}' height='4' rx='2' fill='black'/>
    </mask>
    <mask id='behind${uid}'>
      <rect x='-50' y='-50' width='200' height='200' fill='white'/>
      <rect x='${x - GAP}' y='${y - GAP}' width='${w + 2 * GAP}' height='${h + 2 * GAP}' rx='${r + GAP}' fill='black'/>
    </mask>
  </defs>
  <g mask='url(#behind${uid})'>
    <g transform='translate(0 6) rotate(-${ANGLE} ${PIVOT})'>${rect(`fill='none' stroke='${fill}' stroke-width='4.5'`)}</g>
    <g transform='translate(0 6) rotate(${ANGLE} ${PIVOT})'>${rect(`fill='none' stroke='${fill}' stroke-width='4.5'`)}</g>
  </g>
  ${rect(`fill='${fill}' mask='url(#front${uid})'`)}`;
}

let n = 0;
/** size: canvas px; scale: fraction of the canvas the 100-unit glyph box takes; background or null. */
function svg({ size, scale, background, fill }) {
  const s = (size * scale) / 100;
  const off = (size - size * scale) / 2;
  const fillAttr = fill === 'gradient' ? 'url(#g)' : fill;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>
  <defs>
    <linearGradient id='g' gradientUnits='userSpaceOnUse' x1='0' y1='10' x2='0' y2='90'>
      <stop offset='0' stop-color='${ORANGE_TOP}'/>
      <stop offset='1' stop-color='${ORANGE_BOTTOM}'/>
    </linearGradient>
  </defs>
  ${background ? `<rect width='${size}' height='${size}' fill='${background}'/>` : ''}
  <g transform='translate(${off} ${off}) scale(${s})'>${scale > 0 ? glyph(fillAttr, n++) : ''}</g>
</svg>`;
}

function render(name, opts) {
  const png = new Resvg(svg(opts), { fitTo: { mode: 'original' } }).render().asPng();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(`${name}  ${opts.size}x${opts.size}`);
}

// Store / legacy icon: full-bleed dark square.
render('icon.png', { size: 1024, scale: 0.78, background: BG, fill: 'gradient' });
// Adaptive icon (Android 8+): the foreground stays inside the ~61% safe zone so masks never clip it.
render('android-icon-foreground.png', { size: 512, scale: 0.6, background: null, fill: 'gradient' });
render('android-icon-background.png', { size: 512, scale: 0, background: BG, fill: 'none' });
// Themed icon (Android 13+): one-colour silhouette, tinted by the system.
render('android-icon-monochrome.png', { size: 432, scale: 0.6, background: null, fill: '#ffffff' });
render('favicon.png', { size: 48, scale: 0.9, background: BG, fill: 'gradient' });
render('splash-icon.png', { size: 512, scale: 0.7, background: null, fill: 'gradient' });
