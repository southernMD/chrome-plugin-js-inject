import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import { resolve } from 'path';
import { cpSync } from 'fs';

export default defineConfig({
  plugins: [
    vue(),
    crx({ manifest }),
    {
      name: 'copy-native-host',
      closeBundle() {
        try {
          cpSync(resolve(__dirname, 'native-host'), resolve(__dirname, 'dist/native-host'), { recursive: true });
          console.log('Successfully copied native-host to dist/native-host');
        } catch (err) {
          console.error('Failed to copy native-host:', err);
        }
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        guide: resolve(__dirname, 'src/guide/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
