import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../node_modules/camoufox-js/dist/webgl/sample.js', import.meta.url)
const original = 'const DB_PATH = path.join(currentDir, "..", "data-files", "webgl_data.db");'
const patched = `const runtimeDir = currentDir.includes("app.asar")
    ? currentDir.replace("app.asar", "app.asar.unpacked")
    : currentDir;
const DB_PATH = path.join(runtimeDir, "..", "data-files", "webgl_data.db");`
const source = readFileSync(file, 'utf8')

if (source.includes(patched)) process.exit(0)
if (!source.includes(original)) {
  throw new Error('Không tìm thấy đoạn DB_PATH tương thích trong camoufox-js; cần rà lại bản dependency.')
}

writeFileSync(file, source.replace(original, patched), 'utf8')
console.log('Đã vá đường dẫn WebGL DB của Camoufox cho Electron ASAR.')
