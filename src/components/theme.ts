export const colors = {
  bg: '#0d0d12',
  surface: '#17171f',
  surfaceHigh: '#22222d',
  border: '#2c2c3a',
  text: '#f2f2f5',
  textMuted: '#9a9aab',
  accent: '#4f8cff',
  price: '#4ade80',
  danger: '#f87171',
};

// Wide screens (unfolded foldables, tablets): keep pages and sheets at a readable width. No effect on phones.
export const readable = { width: '100%', maxWidth: 720, alignSelf: 'center' } as const;
export const sheetWidth = { width: '100%', maxWidth: 640, alignSelf: 'center' } as const;
