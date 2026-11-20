import { Directory, File, Paths } from 'expo-file-system';

const scansDir = new Directory(Paths.document, 'scans');

function toFile(pathOrUri: string) {
  return new File(pathOrUri.startsWith('file://') ? pathOrUri : `file://${pathOrUri}`);
}

export function deleteAllSavedPhotos(): number {
  let removed = 0;
  try {
    if (!scansDir.exists) return 0;
    for (const entry of scansDir.list()) {
      if (entry instanceof File) {
        entry.delete();
        removed++;
      }
    }
    scansDir.delete();
  } catch {
  }
  return removed;
}

const TEMP_PHOTO = /^(nitro_image_|VisionCamera_).*\.jpe?g$/i;

export function cleanupTempPhotos(olderThanMs = 60 * 60 * 1000): number {
  let removed = 0;
  try {
    const cutoff = Date.now() - olderThanMs;
    for (const entry of new Directory(Paths.cache).list()) {
      if (!(entry instanceof File) || !TEMP_PHOTO.test(entry.name)) continue;
      let modified = entry.modificationTime ?? 0;
      if (modified > 0 && modified < 1e11) modified *= 1000; // tolerate seconds instead of ms
      if (modified && modified < cutoff) {
        entry.delete();
        removed++;
      }
    }
  } catch {
  }
  return removed;
}

export function deletePhoto(uri: string) {
  try {
    const f = toFile(uri);
    if (f.exists) f.delete();
  } catch {
  }
}
