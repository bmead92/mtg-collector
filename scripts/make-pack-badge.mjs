// Usage: node scripts/make-pack-badge.mjs   → docs/screenshots/buy-me-a-pack.png (README donate button)
import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { PACK } from '../src/components/packArt.ts';

const W = 236;
const H = 48;
const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>
  <defs>
    <linearGradient id='pack' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='${PACK.gradient[0]}'/>
      <stop offset='0.55' stop-color='${PACK.gradient[1]}'/>
      <stop offset='1' stop-color='${PACK.gradient[2]}'/>
    </linearGradient>
  </defs>
  <rect x='0.5' y='0.5' width='${W - 1}' height='${H - 1}' rx='12' fill='#17171f' stroke='#2c2c3a'/>
  <g transform='translate(15 6) scale(0.5625)'>
    <path d='${PACK.topCrimp}' fill='${PACK.crimp}'/>
    <path d='${PACK.bottomCrimp}' fill='${PACK.crimp}'/>
    <path d='${PACK.body}' fill='url(#pack)'/>
    <path d='${PACK.sheen}' fill='#ffffff' opacity='0.18'/>
    <path d='${PACK.sparkle}' fill='#ffffff'/>
  </g>
  <text x='54' y='31' font-family='Segoe UI, Helvetica, Arial, sans-serif' font-size='18' font-weight='700' fill='#f2f2f5'>Buy me a pack</text>
</svg>`;

const png = new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 }, font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } })
  .render()
  .asPng();
fs.writeFileSync(new URL('../docs/screenshots/buy-me-a-pack.png', import.meta.url), png);
console.log('docs/screenshots/buy-me-a-pack.png');
