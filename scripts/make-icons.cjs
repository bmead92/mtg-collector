// Renders the app icons from a hand-written SVG: a leather spellbook with gold corners and clasp, and five
// plain coloured gems on a gold ring around a card. Plain geometry, no external artwork, no Wizards symbols.
//
// Usage: node scripts/make-icons.cjs <out-dir>     (then copy the PNGs into assets/)
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const OUT = process.argv[2] ?? path.join(__dirname, '..', 'assets');
const BG = '#1b1330';
const LEATHER = ['#9a5530', '#5c2b16'];
const SPINE = '#4a210f';
const LINE = '#24100a';
const GOLD = '#f2c35b';
const GOLD_DARK = '#b8862b';
const PAGES = '#f6ead2';
const GEMS = ['#fbf3dc', '#3a8ee6', '#5b4a66', '#e2483a', '#3fae5a'];

const CX = 54;
const CY = 50;
const RING = 19;
const gemAt = (i) => {
  const a = ((-90 + i * 72) * Math.PI) / 180;
  return [CX + RING * Math.cos(a), CY + RING * Math.sin(a)];
};

function glyph(uid, mono) {
  if (mono) {
    const holes = [0, 1, 2, 3, 4].map((i) => `<circle cx='${gemAt(i)[0]}' cy='${gemAt(i)[1]}' r='6' fill='black'/>`).join('');
    const gems = [0, 1, 2, 3, 4].map((i) => `<circle cx='${gemAt(i)[0]}' cy='${gemAt(i)[1]}' r='3.8' fill='white'/>`).join('');
    return `
  <defs>
    <mask id='m${uid}'>
      <rect x='14' y='10' width='72' height='80' rx='6' fill='white'/>
      <circle cx='${CX}' cy='${CY}' r='${RING}' fill='none' stroke='black' stroke-width='3'/>
      ${holes}
      <rect x='${CX - 6}' y='${CY - 8.5}' width='12' height='17' rx='2' fill='black'/>
      <rect x='25' y='10' width='2.5' height='80' fill='black'/>
    </mask>
  </defs>
  <rect x='14' y='10' width='72' height='80' rx='6' fill='white' mask='url(#m${uid})'/>
  ${gems}
  <rect x='${CX - 3.5}' y='${CY - 6}' width='7' height='12' rx='1.2' fill='white'/>`;
  }
  const corner = (x, y, sx, sy) =>
    `<path d='M${x} ${y} h${14 * sx} l${14 * -sx} ${14 * sy} Z' fill='${GOLD}' stroke='${LINE}' stroke-width='1.2' stroke-linejoin='round'/>`;
  const gems = GEMS.map((c, i) => {
    const [x, y] = gemAt(i);
    return `<circle cx='${x}' cy='${y}' r='5.6' fill='${c}' stroke='${GOLD_DARK}' stroke-width='1.8'/>
  <circle cx='${x - 1.8}' cy='${y - 1.8}' r='1.5' fill='#ffffff' opacity='0.8'/>`;
  }).join('');
  return `
  <defs>
    <linearGradient id='leather${uid}' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='${LEATHER[0]}'/>
      <stop offset='1' stop-color='${LEATHER[1]}'/>
    </linearGradient>
    <clipPath id='cover${uid}'><rect x='14' y='9' width='72' height='80' rx='6'/></clipPath>
  </defs>
  <rect x='20' y='13' width='70' height='80' rx='5' fill='${PAGES}' stroke='${LINE}' stroke-width='2'/>
  <path d='M86 19 V88 M82 92 H26' stroke='#d8c6a3' stroke-width='1.2'/>
  <rect x='14' y='9' width='72' height='80' rx='6' fill='url(#leather${uid})' stroke='${LINE}' stroke-width='2.5'/>
  <rect x='14' y='9' width='13' height='80' rx='6' fill='${SPINE}' stroke='${LINE}' stroke-width='2.5'/>
  <rect x='14' y='22' width='13' height='3' fill='${GOLD}'/>
  <rect x='14' y='73' width='13' height='3' fill='${GOLD}'/>
  <g clip-path='url(#cover${uid})'>${corner(87, 8, -1, 1)}${corner(87, 90, -1, -1)}</g>
  <rect x='14' y='9' width='72' height='80' rx='6' fill='none' stroke='${LINE}' stroke-width='2.5'/>
  <rect x='80' y='43' width='12' height='14' rx='2.5' fill='${GOLD}' stroke='${LINE}' stroke-width='1.6'/>
  <circle cx='86' cy='50' r='2' fill='${GOLD_DARK}'/>
  <circle cx='${CX}' cy='${CY}' r='${RING}' fill='none' stroke='${GOLD}' stroke-width='3'/>
  <circle cx='${CX}' cy='${CY}' r='${RING}' fill='none' stroke='${LINE}' stroke-width='0.8' opacity='0.5'/>
  <rect x='${CX - 6}' y='${CY - 8.5}' width='12' height='17' rx='2' fill='${PAGES}' stroke='${GOLD}' stroke-width='1.8'/>
  <path d='M${CX} ${CY - 4.5} Q${CX + 0.6} ${CY - 0.6} ${CX + 3.6} ${CY} Q${CX + 0.6} ${CY + 0.6} ${CX} ${CY + 4.5} Q${CX - 0.6} ${CY + 0.6} ${CX - 3.6} ${CY} Q${CX - 0.6} ${CY - 0.6} ${CX} ${CY - 4.5} Z' fill='${GOLD_DARK}'/>
  ${gems}`;
}

let n = 0;
function svg({ size, scale, background, mono = false }) {
  const s = (size * scale) / 100;
  const off = (size - size * scale) / 2;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>
  ${background ? `<rect width='${size}' height='${size}' fill='${background}'/>` : ''}
  <g transform='translate(${off} ${off}) scale(${s})'>${scale > 0 ? glyph(n++, mono) : ''}</g>
</svg>`;
}

function render(name, opts) {
  const png = new Resvg(svg(opts), { fitTo: { mode: 'original' } }).render().asPng();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(`${name}  ${opts.size}x${opts.size}`);
}

render('icon.png', { size: 1024, scale: 0.8, background: BG });
// Adaptive icon (Android 8+): the foreground stays inside the ~61% safe zone so masks never clip it.
render('android-icon-foreground.png', { size: 512, scale: 0.6, background: null });
render('android-icon-background.png', { size: 512, scale: 0, background: BG });
render('android-icon-monochrome.png', { size: 432, scale: 0.6, background: null, mono: true });
render('favicon.png', { size: 48, scale: 0.92, background: BG });
render('splash-icon.png', { size: 512, scale: 0.7, background: null });
