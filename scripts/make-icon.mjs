/**
 * Generates the GPTN app icon (and the .iconset used for iconutil) from a single
 * vector definition, so the artwork stays reproducible and in sync with the
 * in-app brand mark.
 *
 * Usage: node scripts/make-icon.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
const iconsetDir = join(buildDir, 'icon.iconset')

/**
 * macOS style: the artwork is drawn inside a squircle that occupies ~82% of the
 * canvas, leaving the transparent margin Apple's guidelines expect.
 */
function svg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="body" x1="180" y1="120" x2="860" y2="920" gradientUnits="userSpaceOnUse">
      <stop stop-color="#8A90FF"/>
      <stop offset="0.45" stop-color="#5B63F5"/>
      <stop offset="1" stop-color="#3B41C4"/>
    </linearGradient>
    <linearGradient id="sheen" x1="200" y1="100" x2="700" y2="700" gradientUnits="userSpaceOnUse">
      <stop stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>

  <rect x="92" y="92" width="840" height="840" rx="196" fill="url(#body)"/>
  <rect x="92" y="92" width="840" height="840" rx="196" fill="url(#sheen)"/>
  <rect x="92.5" y="92.5" width="839" height="839" rx="195.5" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="3"/>

  <!-- soft inner glow -->
  <ellipse cx="330" cy="300" rx="250" ry="210" fill="#ffffff" fill-opacity="0.14" filter="url(#soft)"/>

  <!-- GPTN mark: a four point star with a companion dot -->
  <path d="M576 268c22 132 70 180 202 202-132 22-180 70-202 202-22-132-70-180-202-202 132-22 180-70 202-202z"
        fill="#ffffff" fill-opacity="0.97"/>
  <circle cx="356" cy="742" r="56" fill="#ffffff" fill-opacity="0.92"/>
</svg>`
}

async function render(size) {
  return sharp(Buffer.from(svg(size))).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
}

async function main() {
  await mkdir(iconsetDir, { recursive: true })

  const master = await render(1024)
  await writeFile(join(buildDir, 'icon.png'), master)
  console.log(`build/icon.png written (${master.length} bytes)`)

  const iconset = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png']
  ]

  for (const [size, name] of iconset) {
    await writeFile(join(iconsetDir, name), await render(size))
  }
  console.log('build/icon.iconset written — run "iconutil -c icns build/icon.iconset" on macOS to get icon.icns')
}

await main()
