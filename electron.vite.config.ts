import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { productionCspPlugin } from './scripts/plugins/csp'

const shared = resolve('src/shared')
const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': shared, '@main': resolve('src/main') }
    },
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { index: resolve('src/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: { index: resolve('src/preload/index.ts') } }
    }
  },
  renderer: {
    root: 'src/renderer',
    // The window title bar and the About panel read the same number.
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [react(), productionCspPlugin()],
    resolve: {
      alias: { '@shared': shared, '@renderer': resolve('src/renderer/src') }
    },
    server: {
      host: '0.0.0.0',
      port: 5273,
      strictPort: true,
      allowedHosts: true
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } }
    }
  }
})
