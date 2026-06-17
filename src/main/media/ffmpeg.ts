import { spawn } from 'child_process'
import { existsSync } from 'fs'
import ffmpegStatic from 'ffmpeg-static'

// Tìm ffmpeg theo thứ tự: ffmpeg trên PATH (system, vd C:\FFmpeg\bin\ffmpeg.exe), rồi fallback ffmpeg-static.
let cached: string | null | undefined
export function resolveFfmpeg(): string | null {
  if (cached !== undefined) return cached
  // ffmpeg-static expose path tới binary đi kèm.
  const fromStatic = (ffmpegStatic as unknown as string) || null
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
