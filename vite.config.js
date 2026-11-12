import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        student: resolve(process.cwd(), 'index.html'),
        teacher: resolve(process.cwd(), 'teacher/index.html'),
      },
    },
  },
});
