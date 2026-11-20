const unavailable = () => {
  throw new Error('native module not available in tests');
};
export const NitroModules = { createHybridObject: unavailable };
export const Images = { loadFromFileAsync: unavailable };
export const CommonResolutions = {};
export const useFrameOutput = unavailable;
