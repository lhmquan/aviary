// Generate Aviary app icon (256x256) + tray icon (16x16) as anti-aliased PNGs.
// Modern squircle background + diagonal gradient + stylized feather.
// Edges are supersampled (SSAA) then box-downsampled with premultiplied alpha
// so the squircle rim and feather stay crisp with no jaggies or dark fringing.
// Usage: node scripts/generate-icons.js
// Outputs: build/icon.png (256x256), build/tray-16x16.png (16x16)

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

// ---- Palette (khớp biến --accent / --accent-2 trong styles.css) ----
const ACCENT = [91, 124, 250] // #5b7cfa
const ACCENT_2 = [167, 139, 250] // #a78bfa
const FEATHER_TOP = [255, 255, 255]
const FEATHER_BOT = [214, 224, 255]

const DEG = Math.PI / 180

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
function lerp(a, b, t) {
  return a + (b - a) * t
}
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]
}

// Hình lông vũ ở toạ độ chuẩn hoá [0,1]². Trả về độ phủ (0..1) + sắc độ dọc thân.
// Thân dọc trong hệ local, nghiêng ~26° để tip hướng lên phải. Vane rộng nhất ở
// khoảng giữa trên; có rãnh thân (rachis) sáng hơn + các khe barb tạo cảm giác lông thật.
function featherAt(nx, ny) {
  const phi = 26 * DEG
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const fx = nx - 0.5
  const fy = ny - 0.53
  // Xoay về hệ local (thân lông thẳng đứng).
  const lx = fx * cos + fy * sin
  const ly = -fx * sin + fy * cos

  const halfLen = 0.35
  const u = (ly + halfLen) / (2 * halfLen) // 0 = tip (trên), 1 = gốc (dưới)
  if (u < 0 || u > 1) return null

  const wMax = 0.132
  const w = wMax * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.9)
  const ax = Math.abs(lx)
  if (ax > w || w <= 0) return null

  const shade = clamp01(u) // trên sáng → dưới đậm nhẹ
  const shaftW = 0.0075

  // Rãnh thân: dải giữa luôn đặc và sáng hơn (gợi khối nổi của rachis).
  if (ax < shaftW) return { cover: 1, shade: shade * 0.35 }

  // Khe barb: cắt các rãnh mảnh chéo ở phần ngoài + nửa dưới để tạo texture lông.
  const outFrac = ax / w // 0 ở thân → 1 ở mép
  if (u > 0.14 && outFrac > 0.22) {
    const phase = (u - 0.34 * outFrac) * 27
    const frac = phase - Math.floor(phase)
    if (frac > 0.8) return null // khe hở → lộ nền gradient
  }
  // Mép ngoài mềm: giảm phủ nhẹ ở sát rìa để bớt gắt (SSAA lo phần còn lại).
  const edge = clamp01((w - ax) / (w * 0.06))
  return { cover: edge, shade }
}

// Màu 1 subpixel tại toạ độ chuẩn hoá. Trả về [r,g,b,a] (a: 0..255).
function sample(nx, ny) {
  const dx = nx - 0.5
  const dy = ny - 0.5
  // Nền squircle (superellipse) — bo góc mượt kiểu icon hiện đại.
  const a = 0.46
  const n = 4.3
  const se = Math.pow(Math.abs(dx / a), n) + Math.pow(Math.abs(dy / a), n)
  if (se > 1) return [0, 0, 0, 0] // ngoài squircle → trong suốt (SSAA làm mượt viền)

  // Gradient chéo accent → accent-2 (trên-trái sáng, dưới-phải tím).
  const g = clamp01((nx * 0.55 + ny * 0.45))
  let col = mix(ACCENT, ACCENT_2, g)

  // Vệt sáng nhẹ góc trên-trái cho có chiều sâu.
  const hl = clamp01(1 - Math.hypot(nx - 0.3, ny - 0.26) * 1.7)
  col = mix(col, [255, 255, 255], hl * 0.12)
  // Tối nhẹ góc dưới-phải.
  const sh = clamp01(1 - Math.hypot(nx - 0.78, ny - 0.8) * 1.9)
  col = mix(col, [40, 44, 90], sh * 0.14)

  const f = featherAt(nx, ny)
  if (f) {
    const fcol = mix(FEATHER_TOP, FEATHER_BOT, f.shade)
    col = mix(col, fcol, f.cover)
  }
  return [Math.round(col[0]), Math.round(col[1]), Math.round(col[2]), 255]
}

// Render ở độ phân giải `size` với SSAA (mỗi pixel lấy ss×ss mẫu), gộp theo
// alpha-premultiplied để viền trong suốt không bị viền tối.
function render(size, ss) {
  const pixels = Buffer.alloc(size * size * 4, 0)
  const inv = 1 / (size * ss)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ar = 0
      let ag = 0
      let ab = 0
      let aa = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const nx = (x * ss + sx + 0.5) * inv
          const ny = (y * ss + sy + 0.5) * inv
          const [r, g, b, a] = sample(nx, ny)
          const af = a / 255
          ar += r * af
          ag += g * af
          ab += b * af
          aa += af
        }
      }
      const i = (y * size + x) * 4
      const n = ss * ss
      if (aa > 0) {
        pixels[i] = Math.round(ar / aa)
        pixels[i + 1] = Math.round(ag / aa)
        pixels[i + 2] = Math.round(ab / aa)
      }
      pixels[i + 3] = Math.round((aa / n) * 255)
    }
  }
  return pixels
}

// ---- PNG encoder (RGBA, không nén filter) ----
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

function makeChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeB = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeB, data])) >>> 0, 0)
  return Buffer.concat([len, typeB, data, crc])
}

function encodePNG(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const rowStride = 1 + width * 4
  const rawData = Buffer.alloc(height * rowStride)
  for (let y = 0; y < height; y++) {
    rawData[y * rowStride] = 0 // filter: None
    pixels.copy(rawData, y * rowStride + 1, y * width * 4, (y + 1) * width * 4)
  }
  const compressed = zlib.deflateSync(rawData, { level: 9 })

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ])
}

// ---- Xuất file ----
const buildDir = path.join(__dirname, '..', 'build')
if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true })

const appPng = encodePNG(256, 256, render(256, 4))
fs.writeFileSync(path.join(buildDir, 'icon.png'), appPng)
console.log('✓ build/icon.png (256x256, SSAA x4)')

const trayPng = encodePNG(16, 16, render(16, 16))
fs.writeFileSync(path.join(buildDir, 'tray-16x16.png'), trayPng)
console.log('✓ build/tray-16x16.png (16x16, SSAA x16)')

console.log('Done!')
