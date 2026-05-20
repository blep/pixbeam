import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/pixbeam/',
  build: {
    rollupOptions: {
      input: {
        main:     resolve(__dirname, 'index.html'),
        sender:   resolve(__dirname, 'sender.html'),
        receiver: resolve(__dirname, 'receiver.html'),
      },
    },
  },
  // Ensure WASM files are served with correct MIME type
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    exclude: ['raptorq'],
  },
});
