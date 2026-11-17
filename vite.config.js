import { defineConfig } from 'vite';

const apiTarget = `http://127.0.0.1:${process.env.PORT || 3000}`;

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: Number(process.env.VITE_PORT || 5174),
    strictPort: true,
    proxy: {
      '/api': apiTarget,
      '/data.json': apiTarget,
      '/blacklist.json': apiTarget,
      '/reputations.json': apiTarget,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
