import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command, mode }) => ({
  // Keep local development at the root; the production artifact is served by GitHub Pages.
  base: command === 'serve' && mode === 'development' ? '/' : '/daily-accounting-Ver.4/',
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.png', 'apple-touch-icon.png'],
    manifest: {
      name: '日常記帳 Ver.4',
      short_name: '日常記帳',
      description: '離線優先的個人記帳程式；帳目保存在本機 IndexedDB，並可私密同步到 Google Drive。',
      lang: 'zh-Hant-TW',
      // Relative to the manifest so the same build installs from any base path.
      start_url: '.',
      scope: './',
      theme_color: '#111214',
      background_color: '#111214',
      display: 'standalone',
      display_override: ['standalone', 'minimal-ui'],
      categories: ['finance', 'productivity', 'utilities'],
      // Chrome only treats a manifest as installable with a PNG of at least 192px.
      icons: [
        { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: 'pwa-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: { navigateFallback: 'index.html', globPatterns: ['**/*.{js,css,html,svg,png,ico}'] }
  })]
}));
