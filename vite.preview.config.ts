import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { productionCspPlugin } from './scripts/plugins/csp'

/**
 * Browser preview of the GPTN interface.
 *
 * `npm run dev:preview` builds the renderer and serves it with `vite preview`.
 * The renderer detects that the Electron bridge is missing and switches to the
 * clearly labelled preview bridge: layout, theming and interactions are real,
 * Gemini answers are not. The desktop app is the only place with real answers.
 */
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), productionCspPlugin()],
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  build: {
    outDir: resolve('out/preview'),
    emptyOutDir: true,
    rollupOptions: { input: resolve('src/renderer/index.html') }
  },
  preview: {
    host: '0.0.0.0',
    port: 5273,
    strictPort: true,
    // The sandbox serves this preview through a proxy host, so host checking
    // is disabled for this local-only interface preview.
    allowedHosts: true
  }
})
