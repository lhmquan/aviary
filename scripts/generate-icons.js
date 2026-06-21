// Generate Aviary app icon (256x256) and tray icon (16x16) as PNG files.
// Usage: node scripts/generate-icons.js
// Outputs: build/icon.png (256x256), build/tray-16x16.png

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const SIZE = 256
const TRAY_SIZE = 16

// Feather shape coordinates (relative 0-1 coordinate space).
// A stylized quill/feather pointing upper-right, leaning ~30° from vertical.
// Drawn as a filled path with bezier curves approximated by segments.
function drawFeather(size) {
  const pixels = Buffer.alloc(size * size * 4, 0)
  const cx = size * 0.45
  const cy = size * 0.5

  // Helper: check if point is inside the feather shape.
  // The feather is approximated as an elongated leaf shape rotated ~30°.
  function isInFeather(px, py) {
    // Transform to feather-local coordinates (rotate -30°)
    const angle = -Math.PI / 6
    const dx = px - cx
    const dy = py - cy
    const lx = dx * Math.cos(angle) - dy * Math.sin(angle)
    const ly = dx * Math.sin(angle) + dy * Math.cos(angle)

    // Feather body: elongated ellipse, tip at top, wider at bottom
    // Length along Y: -0.42 to +0.42 of size
    // Width along X: varies, max ~0.12 of size at center, tapers
    const ny = ly / (size * 0.42) // -1 to 1
    if (Math.abs(ny) > 1) return false

    // Width envelope: wide in middle, pointed at tip and base
    // Using a custom curve that looks like a feather
    const t = (ny + 1) / 2 // 0 (tip) to 1 (base)
    let widthFrac
    if (t < 0.15) {
      // Tip: very narrow
      widthFrac = 0.04 + t * 0.8
    } else if (t < 0.5) {
      // Upper body: widens
      widthFrac = 0.16 + (t - 0.15) * 0.2
    } else if (t < 0.8) {
      // Mid body: widest
      widthFrac = 0.23 - (t - 0.5) * 0.1
    } else {
      // Base: tapers
      widthFrac = 0.20 - (t - 0.8) * 0.8
    }

    const halfWidth = size * widthFrac / 2
    if (Math.abs(lx) > halfWidth) return false

    // Central shaft (rachis) — always drawn, wider line
    const shaftWidth = size * 0.015
    if (Math.abs(lx) < shaftWidth) return true

    // Barbs: create a slight texture by not filling some pixels near edges
    // This gives the feather a "hairy" edge look at larger sizes
    const edgeDist = halfWidth - Math.abs(lx)
    const edgeRatio = edgeDist / halfWidth
    if (edgeRatio < 0.15) {
      // Near edge: only fill every other "barb"
      const barbSpacing = size * 0.02
      const barbCheck = Math.abs(ly % barbSpacing) < barbSpacing * 0.6
      return barbCheck
    }

    return true
  }

  // Draw feather with gradient
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4

      // 2px rounded border
      const margin = Math.max(2, size * 0.02)
      const inBorder = x >= margin && x < size - margin && y >= margin && y < size - margin &&
        !(x === margin && y === margin) && !(x === margin && y === size - margin - 1) &&
        !(x === size - margin - 1 && y === margin) && !(x === size - margin - 1 && y === size - margin - 1)

      if (inBorder) {
        // Background: subtle gradient
        const bt = (y - margin) / (size - 2 * margin - 1)
        const bg_r = Math.round(15 + 5 * bt)
        const bg_g = Math.round(17 + 6 * bt)
        const bg_b = Math.round(25 + 10 * bt)
        pixels[i] = bg_r
        pixels[i + 1] = bg_g
        pixels[i + 2] = bg_b
        pixels[i + 3] = 255

        if (isInFeather(x, y)) {
          // Feather gradient: accent (#5b7cfa) at top to accent-2 (#a78bfa) at bottom
          const t = (y - margin) / (size - 2 * margin - 1)
          const r = Math.round(91 + (167 - 91) * t)
          const g = Math.round(124 + (139 - 124) * t)
          const b = Math.round(250)
          pixels[i] = r
          pixels[i + 1] = g
          pixels[i + 2] = b
          pixels[i + 3] = 255
        }
      } else if (
        (x >= margin - 1 && x < size - margin + 1 && y >= margin - 1 && y < size - margin + 1)
      ) {
        // Rounded border outline
        pixels[i] = 91
        pixels[i + 1] = 124
        pixels[i + 2] = 250
        pixels[i + 3] = 80
      }
    }
  }

  return pixels
}

// Encode RGBA buffer to PNG
function encodePNG(width, height, pixels) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR chunk
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  // IDAT: filter byte (0 = none) + RGBA for each row
  const rawData = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0 // filter: None
    pixels.copy(rawData, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const compressed = zlib.deflateSync(rawData)

  // IEND
  const iend = Buffer.alloc(0)

  function makeChunk(type, data) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const typeB = Buffer.from(type, 'ascii')
    const crcData = Buffer.concat([typeB, data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(crcData) >>> 0, 0)
    return Buffer.concat([len, typeB, data, crc])
  }

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', iend)
  ])
}

// CRC32 for PNG
function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return crc ^ 0xffffffff
}

// Generate icons
const buildDir = path.join(__dirname, '..', 'build')
if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true })

// 256x256 app icon
const appPixels = drawFeather(SIZE)
const appPng = encodePNG(SIZE, SIZE, appPixels)
fs.writeFileSync(path.join(buildDir, 'icon.png'), appPng)
console.log(`✓ build/icon.png (${SIZE}x${SIZE})`)

// 16x16 tray icon (simple gradient square, no feather detail at this size)
const trayPixels = Buffer.alloc(TRAY_SIZE * TRAY_SIZE * 4, 0)
for (let y = 0; y < TRAY_SIZE; y++) {
  for (let x = 0; x < TRAY_SIZE; x++) {
    const i = (y * TRAY_SIZE + x) * 4
    const inBorder =
      x >= 2 && x < TRAY_SIZE - 2 && y >= 2 && y < TRAY_SIZE - 2 &&
      !(x === 2 && y === 2) && !(x === 2 && y === TRAY_SIZE - 3) &&
      !(x === TRAY_SIZE - 3 && y === 2) && !(x === TRAY_SIZE - 3 && y === TRAY_SIZE - 3)
    if (inBorder) {
      const t = (y - 2) / (TRAY_SIZE - 5)
      trayPixels[i] = Math.round(91 + (167 - 91) * t)
      trayPixels[i + 1] = Math.round(124 + (139 - 124) * t)
      trayPixels[i + 2] = 250
      trayPixels[i + 3] = 255
    }
  }
}
const trayPng = encodePNG(TRAY_SIZE, TRAY_SIZE, trayPixels)
fs.writeFileSync(path.join(buildDir, 'tray-16x16.png'), trayPng)
console.log(`✓ build/tray-16x16.png (${TRAY_SIZE}x${TRAY_SIZE})`)

console.log('Done!')
