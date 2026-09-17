import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }

export default defineConfig({
  // Kept in sync with the builds, so a module that reads it works under test too.
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Test files use the automatic JSX runtime, like the renderer.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    // Node by default; UI tests opt into jsdom with a `@vitest-environment` docblock.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globals: false,
    testTimeout: 15_000,
    hookTimeout: 15_000
  }
})
