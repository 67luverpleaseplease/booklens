import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// base: './' so the same build runs from GitHub Pages, Cloudflare, or file://
export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: '书镜 BookLens',
        short_name: 'BookLens',
        description: 'Point your camera at a Chinese book, get summaries you can say out loud.',
        theme_color: '#0B0B0D',
        background_color: '#0B0B0D',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Noto Serif SC ships ~360 unicode-range subsets. Precaching them all
        // would mean a 10MB install for fonts the browser may never request, so
        // they are cached on demand instead (see runtimeCaching below).
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        globIgnores: ['**/noto-serif-sc-*'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Immutable and content-hashed — keep whatever we actually load.
            urlPattern: /\.(?:woff2?|ttf)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'booklens-fonts',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // The dictionary is big and immutable — cache it hard once fetched.
            urlPattern: /cedict\.min\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'booklens-dict',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
