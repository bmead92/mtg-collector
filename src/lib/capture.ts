import { Images, type Image } from 'react-native-nitro-image';
import type { CameraOrientation, CameraPhotoOutput, Photo } from 'react-native-vision-camera';
import { recognizeCard, type CardGuess } from './ocr';
import { deletePhoto } from './photos';

const MAX_LONG_SIDE = 2000; // one card fills the frame; this keeps the collector line legible
const JPEG_QUALITY = 90;

export interface CaptureResult {
  photoUri: string;
  guess: CardGuess;
}

function score(g: CardGuess): number {
  return (g.name ? 1 : 0) + (g.setCode ? 1 : 0) + (g.collectorNumber ? 1 : 0);
}

async function toPortrait(image: Image, orientation: CameraOrientation): Promise<Image> {
  if (image.height >= image.width) return image; // already upright (orientation applied by toImage)
  return image.rotateAsync(orientation === 'left' ? -90 : 90, false);
}

async function downscale(image: Image): Promise<Image> {
  const long = Math.max(image.width, image.height);
  if (long <= MAX_LONG_SIDE) return image;
  const s = MAX_LONG_SIDE / long;
  return image.resizeAsync(Math.round(image.width * s), Math.round(image.height * s));
}

async function saveAndRead(image: Image): Promise<CaptureResult> {
  const path = await image.saveToTemporaryFileAsync('jpg', JPEG_QUALITY);
  const photoUri = path.startsWith('file://') ? path : `file://${path}`;
  return { photoUri, guess: await recognizeCard(photoUri) };
}

export interface GuideFrame {
  viewWidth: number;
  viewHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const GUIDE_PADDING_X = 0.03;
const GUIDE_PADDING_Y = 0.05;

async function cropToGuide(image: Image, g: GuideFrame): Promise<Image> {
  const iw = image.width;
  const ih = image.height;
  const s = Math.max(g.viewWidth / iw, g.viewHeight / ih);
  const ox = (g.viewWidth - iw * s) / 2;
  const oy = (g.viewHeight - ih * s) / 2;
  let x0 = (g.x - ox) / s;
  let y0 = (g.y - oy) / s;
  let x1 = (g.x + g.width - ox) / s;
  let y1 = (g.y + g.height - oy) / s;
  const padX = (x1 - x0) * GUIDE_PADDING_X;
  const padY = (y1 - y0) * GUIDE_PADDING_Y;
  x0 = Math.max(0, Math.round(x0 - padX));
  y0 = Math.max(0, Math.round(y0 - padY));
  x1 = Math.min(iw, Math.round(x1 + padX));
  y1 = Math.min(ih, Math.round(y1 + padY));
  if (x1 - x0 < 100 || y1 - y0 < 100) return image; // nonsensical layout; don't make things worse
  return image.cropAsync(x0, y0, x1, y1);
}

export function takePhoto(photoOutput: CameraPhotoOutput): Promise<Photo> {
  return photoOutput.capturePhoto({ flashMode: 'off', enableShutterSound: false }, {});
}

async function processUpright(image: Image, guide?: GuideFrame | null): Promise<CaptureResult> {
  if (guide) image = await cropToGuide(image, guide);
  image = await downscale(image);

  const first = await saveAndRead(image);
  if (score(first.guess) >= 2) return first;

  const flipped = await saveAndRead(await image.rotateAsync(180, false));
  if (score(flipped.guess) > score(first.guess)) {
    deletePhoto(first.photoUri);
    return flipped;
  }
  deletePhoto(flipped.photoUri);
  return first;
}

export async function processPhoto(photo: Photo, guide?: GuideFrame | null): Promise<CaptureResult> {
  const orientation = photo.orientation;
  let image: Image;
  try {
    image = await photo.toImageAsync();
  } finally {
    photo.dispose();
  }
  return processUpright(await toPortrait(image, orientation), guide);
}

const CW_DEGREES: Record<CameraOrientation, number> = { up: 0, right: 270, down: 180, left: 90 };

export interface SavedCapture {
  path: string;
  orientation: CameraOrientation;
}

export async function savePhoto(photo: Photo): Promise<SavedCapture> {
  try {
    const orientation = photo.orientation;
    const path = await photo.saveToTemporaryFileAsync();
    return { path, orientation };
  } finally {
    photo.dispose();
  }
}

export async function processSavedCapture(c: SavedCapture, guide?: GuideFrame | null): Promise<CaptureResult> {
  try {
    let image = await Images.loadFromFileAsync(c.path.replace(/^file:\/\//, ''));
    const deg = CW_DEGREES[c.orientation] ?? 0;
    if (deg) image = await image.rotateAsync(deg, false);
    return await processUpright(await toPortrait(image, c.orientation), guide);
  } finally {
    deletePhoto(c.path);
  }
}

export async function captureAndRecognize(
  photoOutput: CameraPhotoOutput,
  guide?: GuideFrame | null,
): Promise<CaptureResult> {
  return processPhoto(await takePhoto(photoOutput), guide);
}
