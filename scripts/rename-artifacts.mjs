/**
 * Gives the universal build the canonical release file names
 * (`GPTN-1.1.0.dmg`, `GPTN-1.1.0.zip`) while the per-architecture builds keep
 * their `-arm64` / `-x64` suffixes.
 *
 * Usage: node scripts/rename-artifacts.mjs   (run after electron-builder)
 */
import { readdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = join(root, 'release')

if (!existsSync(releaseDir)) {
  console.log('[rename] no release directory: nothing to do')
  process.exit(0)
}

const entries = await readdir(releaseDir)
const universal = entries.filter((name) => /-(universal)\.(dmg|zip)$/.test(name))

if (!universal.length) {
  console.log('[rename] no universal artifacts found')
  process.exit(0)
}

for (const name of universal) {
  const target = name.replace('-universal', '')
  await rename(join(releaseDir, name), join(releaseDir, target))
  console.log(`[rename] ${name} → ${target}`)
}
