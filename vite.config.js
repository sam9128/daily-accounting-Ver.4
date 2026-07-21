import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/daily-accounting-Ver.4/',
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    manifest: { name: '日常記帳 Ver.4', short_name: '日常記帳', theme_color: '#0c634a', background_color: '#ffffff', display: 'standalone' },
    workbox: { navigateFallback: '/index.html', globPatterns: ['**/*.{js,css,html,svg,png,ico}'] }
  })]
});
