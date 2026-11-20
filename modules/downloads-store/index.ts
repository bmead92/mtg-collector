import { requireOptionalNativeModule } from 'expo';

export interface SavedFile {
  id: string;
  name: string;
  modified: number;
}

interface DownloadsStore {
  isAvailable(): boolean;
  save(sourcePath: string, name: string, folder: string): Promise<string>;
  list(folder: string): Promise<SavedFile[]>;
  remove(id: string): Promise<void>;
}

export default requireOptionalNativeModule<DownloadsStore>('DownloadsStore');
