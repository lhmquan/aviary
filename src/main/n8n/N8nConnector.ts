import { createWriteStream } from 'fs'
import { mkdir, rename, unlink, stat } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { app } from 'electron'
import type { PostPayload, WebhookTestResult } from '../../shared/types'
import { getAllSettings } from '../db/settings'
import { muxVideoAudio } from '../media/ffmpeg'

// Dạng response Aviary chuẩn hóa. Chấp nhận cả Reddit-style của workflow user.
function normalizePayload(raw: unknown): PostPayload {
  const arr = Array.isArray(raw) ? raw : [raw]
  const items = arr.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  if (items.length === 0) return { caption: '', assets: [] }

  let caption = ''
  const assets: PostPayload['assets'] = []
  const videoSpecs: NonNullable<PostPayload['videoSpecs']> = []

  // Caption: ưu tiên trường rõ ràng -> title (Reddit) -> text/content.
  for (const o of items) {
    const c = o.caption ?? o.text ?? o.content ?? o.title
    if (typeof c === 'string' && c.trim()) {
      caption = c
      break
    }
  }

  for (const o of items) {
    const t = (o.type as string | undefined) ?? null

    // 1) Reddit: type = 'video' kèm videoUrl + audioUrls/audioUrl1/audioUrl2.
    if (t === 'video' && typeof o.videoUrl === 'string') {
      const audios: string[] = []
      if (Array.isArray(o.audioUrls)) {
        for (const a of o.audioUrls) if (typeof a === 'string') audios.push(a)
      }
      if (typeof o.audioUrl1 === 'string') audios.push(o.audioUrl1)
      if (typeof o.audioUrl2 === 'string') audios.push(o.audioUrl2)
      const dedup = [...new Set(audios)]
      assets.push({ url: o.videoUrl as string, type: 'video' })
      videoSpecs.push({ videoUrl: o.videoUrl as string, audioUrls: dedup })
      continue
    }

    // 2) Reddit: type = 'single_image'.
    if (t === 'single_image' || t === 'image') {
      const url = (o.imageUrl ?? o.originalUrl ?? o.url) as string | undefined
      if (typeof url === 'string') assets.push({ url, type: 'image' })
      continue
    }

    // 3) Aviary native dạng { caption, assets|media|urls: [...] }.
    const rawAssets = o.assets ?? o.media ?? o.urls
    if (Array.isArray(rawAssets)) {
      for (const a of rawAssets) {
        if (typeof a === 'string') assets.push({ url: a })
        else if (a && typeof a === 'object') {
          const x = a as Record<string, unknown>
          const url = x.url ?? x.src ?? x.link
          if (typeof url === 'string') {
            const type = x.type === 'video' || x.type === 'image' ? x.type : undefined
            assets.push({ url, type })
          }
        }
      }
      continue
    }
    if (typeof o.url === 'string') assets.push({ url: o.url })
  }

  return { caption, assets, videoSpecs: videoSpecs.length ? videoSpecs : undefined }
}

async function callWebhook(accountId?: string): Promise<{ status: number; payload: PostPayload }> {
  const { webhookUrl, webhookSecret } = getAllSettings()
  if (!webhookUrl) throw new Error('Chưa cấu hình Webhook URL trong Cài đặt')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (webhookSecret) headers['X-Aviary-Secret'] = webhookSecret

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ accountId: accountId ?? null, source: 'aviary' })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Webhook trả HTTP ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`)
  }

  const json = await res.json().catch(() => {
    throw new Error('Webhook không trả JSON hợp lệ')
  })
  return { status: res.status, payload: normalizePayload(json) }
}

export async function fetchPostPayload(accountId?: string): Promise<PostPayload> {
  const { payload } = await callWebhook(accountId)
  return payload
}

export async function testWebhook(accountId?: string): Promise<WebhookTestResult> {
  try {
    const { status, payload } = await callWebhook(accountId)
    return {
      ok: true,
      status,
      caption: payload.caption,
      assetCount: payload.assets.length,
      hasAudioMerge: !!payload.videoSpecs?.some((v) => v.audioUrls.length > 0)
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function resolveDownloadsRoot(): string {
  const { downloadsDir } = getAllSettings()
  return downloadsDir && downloadsDir.trim() ? downloadsDir : join(app.getPath('userData'), 'downloads')
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Tải lỗi HTTP ${res.status}: ${url}`)
  await pipeline(
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(destPath)
  )
}

function guessExt(url: string, type?: 'image' | 'video'): string {
  const m = url.split('?')[0].match(/\.(mp4|mov|m4a|jpg|jpeg|png|gif|webp|webm)$/i)
  if (m) return '.' + m[1].toLowerCase()
  return type === 'video' ? '.mp4' : '.jpg'
}

// Tải tuần tự nhiều ứng viên audio, trả về path đầu tiên thành công và có size > 0.
async function downloadFirstWorkingAudio(urls: string[], dir: string): Promise<string | null> {
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    const tmp = join(dir, `audio_try${i}${guessExt(url, 'video')}`)
    try {
      await downloadToFile(url, tmp)
      const st = await stat(tmp)
      if (st.size > 0) return tmp
      await unlink(tmp).catch(() => {})
    } catch {
      await unlink(tmp).catch(() => {})
    }
  }
  return null
}

// Tải toàn bộ asset cho 1 job. Với video có audio tách rời (Reddit DASH), dùng ffmpeg mux video+audio.
export async function downloadAssets(
  payload: PostPayload,
  accountId: string,
  jobId: string
): Promise<string[]> {
  const dir = join(resolveDownloadsRoot(), accountId, jobId)
  await mkdir(dir, { recursive: true })

  const out: string[] = []
  const videoSpecMap = new Map<string, { audioUrls: string[] }>()
  for (const v of payload.videoSpecs ?? []) videoSpecMap.set(v.videoUrl, { audioUrls: v.audioUrls })

  for (let i = 0; i < payload.assets.length; i++) {
    const asset = payload.assets[i]
    const ext = guessExt(asset.url, asset.type)

    if (asset.type === 'video' && videoSpecMap.has(asset.url)) {
      const spec = videoSpecMap.get(asset.url)!
      const videoTmp = join(dir, `video_${i}_v${ext}`)
      await downloadToFile(asset.url, videoTmp)

      if (spec.audioUrls.length > 0) {
        const audioTmp = await downloadFirstWorkingAudio(spec.audioUrls, dir)
        if (audioTmp) {
          const finalPath = join(dir, `video_${i}.mp4`)
          try {
            await muxVideoAudio(videoTmp, audioTmp, finalPath)
            await unlink(videoTmp).catch(() => {})
            await unlink(audioTmp).catch(() => {})
            out.push(finalPath)
            continue
          } catch (e) {
            // Mux fail - fallback dùng video thuần (im lặng) + log để dev biết.
            console.warn('[n8n] mux fail, fallback video-only:', (e as Error).message)
          }
        }
      }
      // Không có audio hoặc mux fail: dùng video gốc làm output.
      const finalPath = join(dir, `video_${i}${ext}`)
      await rename(videoTmp, finalPath).catch(async () => {
        await downloadToFile(asset.url, finalPath)
      })
      out.push(finalPath)
      continue
    }

    // Ảnh hoặc video không tách audio.
    const filePath = join(dir, `asset_${i}${ext}`)
    await downloadToFile(asset.url, filePath)
    out.push(filePath)
  }
  return out
}
