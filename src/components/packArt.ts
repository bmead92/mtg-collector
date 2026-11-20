const teeth = (y0: number, y1: number, n = 6) => {
  const step = 36 / n;
  const pts: string[] = [];
  for (let i = 0; i <= n * 2; i++) pts.push(`${6 + (i * step) / 2} ${i % 2 === 0 ? y0 : y1}`);
  return pts.join(' L');
};

export const PACK = {
  viewBox: '0 0 48 64',
  body: 'M6 6 L42 6 L42 58 L6 58 Z',
  topCrimp: `M6 6 L${teeth(3, 1)} L42 6 Z`,
  bottomCrimp: `M6 58 L${teeth(61, 63)} L42 58 Z`,
  sheen: 'M6 34 L42 14 L42 22 L6 42 Z',
  sparkle: 'M24 22 L26.2 29.8 L34 32 L26.2 34.2 L24 42 L21.8 34.2 L14 32 L21.8 29.8 Z',
  gradient: ['#7c5cff', '#4f8cff', '#2ec4b6'] as const,
  crimp: '#c7d2fe',
};
