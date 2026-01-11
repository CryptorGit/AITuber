import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.UI_HOST || '127.0.0.1',
    port: Number(process.env.UI_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/viewer': 'http://127.0.0.1:8787',
      '/exports': 'http://127.0.0.1:8787',
      // Pokemon Showdown client assets (served via backend cache/proxy)
      '/style': 'http://127.0.0.1:8787',
      '/js': 'http://127.0.0.1:8787',
      '/data': 'http://127.0.0.1:8787',
      '/config': 'http://127.0.0.1:8787',
      '/sprites': 'http://127.0.0.1:8787',
      '/fx': 'http://127.0.0.1:8787',
      '/images': 'http://127.0.0.1:8787',
      '/audio': 'http://127.0.0.1:8787',
      '/cries': 'http://127.0.0.1:8787',
    },
  },
});
