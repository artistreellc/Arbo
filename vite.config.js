import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Arbo is a plain client-rendered SPA (no SSG, no marketing pages). All CRM
// pages live behind auth, so nothing here is prerendered. The serverless API
// lives in /api and is served by Vercel, not Vite.
export default defineConfig({
  plugins: [react()],
  resolve: {
    extensions: ['.jsx', '.js', '.json'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '::',
    port: 3000,
  },
});
