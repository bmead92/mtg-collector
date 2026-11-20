import { clearPhotoReferences, mergeDuplicateRows } from './db';
import { deleteAllSavedPhotos } from './photos';

export async function runMaintenance(): Promise<void> {
  await clearPhotoReferences();
  deleteAllSavedPhotos();
  await mergeDuplicateRows();
}
