import type { CardGuess } from './ocr';

export interface PendingScan {
  photoUri: string;
  guess: CardGuess;
}

let pending: PendingScan | null = null;

export const setPendingScan = (p: PendingScan | null) => {
  pending = p;
};
export const getPendingScan = () => pending;
