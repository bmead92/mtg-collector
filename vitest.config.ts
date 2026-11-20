import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const stub = (name: string) => fileURLToPath(new URL(`./tests/stubs/${name}.ts`, import.meta.url));

// Unit + simulation tests for the app's logic (src/lib). Native modules are replaced with small stubs;
// expo-sqlite runs on Node's built-in SQLite so database code is tested for real.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      'expo-sqlite': stub('expo-sqlite'),
      'expo-file-system': stub('expo-file-system'),
      'react-native-nitro-modules': stub('native'),
      'react-native-nitro-image': stub('native'),
      'react-native-vision-camera': stub('native'),
    },
  },
});
