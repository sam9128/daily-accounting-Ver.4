import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command, mode }) => ({
  // Keep local development at the root; the production artifact is served by GitHub Pages.
  base: command === 'serve' && mode === 'development' ? '/' : '/daily-accounting-Ver.4/',
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    manifest: { name: '日常記帳 Ver.4', short_name: '日常記帳', theme_color: '#030817', background_color: '#030817', display: 'standalone' },
    workbox: { navigateFallback: '/index.html', globPatterns: ['**/*.{js,css,html,svg,png,ico}'] }
  })]
}));
