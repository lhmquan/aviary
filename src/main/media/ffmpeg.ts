import { spawn } from 'child_process'
import { existsSync } from 'fs'
import ffmpegStatic from 'ffmpeg-static'

// Tìm ffmpeg theo thứ tự: binary của ffmpeg-static (đã fix path khi đóng gói asar), rồi fallback 'ffmpeg' trên PATH.
let cached: string | null | undefined
export function resolveFfmpeg(): string | null {
  if (cached !== undefined) return cached
  // ffmpeg-static expose path tới binary đi kèm.
  let fromStatic = (ffmpegStatic as unknown as string) || null
  // Khi đóng gói, binary nằm trong app.asar nhưng không chạy được từ trong asar.
  // electron-builder unpack sang app.asar.unpacked (asarUnpack ffmpeg-static).
  if (fromStatic && fromStatic.includes('app.asar') && !fromStatic.includes('app.asar.unpacked')) {
    fromStatic = fromStatic.replace('app.asar', 'app.asar.unpacked')
  }
  if (fromStatic && existsSync(fromStatic)) {
    cached = fromStatic
    return cached
  }
  // Để 'ffmpeg' nếu có trên PATH (spawn sẽ tự resolve).
  cached = 'ffmpeg'
  return cached
}

export interface FfmpegRunOptions {
  args: string[]
  onLog?: (line: string) => void
}

export function runFfmpeg(opts: FfmpegRunOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = resolveFfmpeg()
    if (!bin) return reject(new Error('Không tìm thấy ffmpeg'))

    const proc = spawn(bin, opts.args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (chunk) => {
      const s = chunk.toString()
      stderr += s
      opts.onLog?.(s)
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`))
    })
  })
}

// Mux video + audio thành 1 file (copy stream, không re-encode).
export async function muxVideoAudio(videoPath: string, audioPath: string, outPath: string): Promise<void> {
  await runFfmpeg({
    args: [
      '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',
      outPath
    ]
  })
}

// Tải video từ manifest (DASH .mpd hoặc HLS .m3u8) và mux video+audio thành 1 file MP4.
// Reddit: fallback_url chỉ chứa video (không audio), còn DASH_AUDIO_*.mp4 tách rời
// thường trả 403. Đọc thẳng manifest bằng ffmpeg là cách chắc có cả video+audio,
// chất lượng 720p + audio AAC stereo.Ưu tiên DASH, fallback HLS.
export async function muxFromManifest(manifestUrl: string, outPath: string): Promise<void> {
  await runFfmpeg({
    args: [
      '-y',
      '-i', manifestUrl,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outPath
    ]
  })
}
