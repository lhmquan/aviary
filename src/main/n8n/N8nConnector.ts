import { createWriteStream } from 'fs'
import { mkdir, rename, unlink, stat } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { app } from 'electron'
import type { PostPayload, WebhookTestResult } from '../../shared/types'
import { getAllSettings } from '../db/settings'
import { muxVideoAudio, muxFromManifest } from '../media/ffmpeg'

// Dạng response Aviary chuẩn hóa. Chấp nhận cả Reddit-style của workflow user.
function normalizePayload(raw: unknown): PostPayload {
  const arr = Array.isArray(raw) ? raw : [raw]
  const items = arr.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]
  if (items.length === 0) return { caption: '', assets: [] }

  // n8n báo link hỏng -> {"Title": "...", "XProceed?": "SKIP"}. Đánh dấu skip + giữ title
  // để app gọi markdone đánh dấu video đó (tránh lấy lại) rồi báo user.
  for (const o of items) {
    const proceed = o['XProceed?'] ?? o['XProceed'] ?? o.xproceed ?? o.proceed
    if (typeof proceed === 'string' && proceed.trim().toUpperCase() === 'SKIP') {
      const title = o.Title ?? o.title ?? o.caption
      const skipId = typeof o.id === 'string' ? o.id : undefined
      return {
        caption: typeof title === 'string' ? title : '',
        assets: [],
        skip: true,
        id: skipId
      }
    }
  }

  let caption = ''
  const assets: PostPayload['assets'] = []
  const videoSpecs: NonNullable<PostPayload['videoSpecs']> = []

  // id link Reddit (ổn định hơn title để markdone khớp đúng dòng sheet — title có thể
  // trùng giữa crosspost và post gốc). Ưu tiên trường id rõ ràng.
  let id: string | undefined
  for (const o of items) {
    if (typeof o.id === 'string' && o.id.trim()) {
      id = o.id.trim()
      break
    }
  }

  // Caption: ưu tiên trường rõ ràng -> title (Reddit) -> text/content.
  for (const o of items) {
    const c = o.caption ?? o.text ?? o.content ?? o.title ?? o.Title
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
      videoSpecs.push({
        videoUrl: o.videoUrl as string,
        audioUrls: dedup,
        dashUrl: typeof o.dashUrl === 'string' ? o.dashUrl : undefined,
        hlsUrl: typeof o.hlsUrl === 'string' ? o.hlsUrl : undefined
      })
      continue
    }

    // 2) Reddit: type = 'single_image'.
    if (t === 'single_image' || t === 'image') {
      const url = (o.imageUrl ?? o.originalUrl ?? o.url) as string | undefined
      if (typeof url === 'string') assets.push({ url, type: 'image' })
      continue
    }

    // 3) Reddit: type = 'gallery' — nhiều ảnh, mỗi ảnh có highResImage.
    // X cho phép tối đa 4 ảnh / tweet nên chỉ lấy 4 ảnh đầu.
    if (t === 'gallery' && Array.isArray(o.images)) {
      const imgs = (o.images as Record<string, unknown>[]).slice(0, 4)
      for (const img of imgs) {
        const url = img.highResImage ?? img.url ?? img.src
        if (typeof url === 'string') assets.push({ url, type: 'image' })
      }
      // Lấy caption từ title của gallery nếu chưa có.
      if (!caption && typeof o.title === 'string' && o.title.trim()) {
        caption = o.title.trim()
      }
      continue
    }

    // 4) Aviary native dạng { caption, assets|media|urls: [...] }.
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

  return { caption, assets, videoSpecs: videoSpecs.length ? videoSpecs : undefined, id }
}

type WebhookEvent = 'publishpost' | 'markdone'

// POST body webhook chung: có event để n8n rẽ nhánh (publishpost | markdone).
function webhookBody(
  event: WebhookEvent,
  data: Record<string, unknown>
): Record<string, unknown> {
  return { event, source: 'aviary', ...data }
}

async function postWebhook(body: Record<string, unknown>): Promise<Response> {
  const { webhookUrl, webhookSecret } = getAllSettings()
  if (!webhookUrl) throw new Error('Chưa cấu hình Webhook URL trong Cài đặt')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (webhookSecret) headers['X-Aviary-Secret'] = webhookSecret
  return fetch(webhookUrl, { method: 'POST', headers, body: JSON.stringify(body) })
}

async function callWebhook(
  accountId?: string,
  assetUrl?: string | null
): Promise<{ status: number; payload: PostPayload }> {
  const res = await postWebhook(
    webhookBody('publishpost', {
      accountId: accountId ?? null,
      assetUrl: assetUrl ?? null
    })
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Webhook trả HTTP ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`)
  }

  const json = await res.json().catch(() => {
    throw new Error('Webhook không trả JSON hợp lệ')
  })
  return { status: res.status, payload: normalizePayload(json) }
}

export async function fetchPostPayload(
  accountId?: string,
  assetUrl?: string | null
): Promise<PostPayload> {
  const { payload } = await callWebhook(accountId, assetUrl)
  return payload
}

// #3: báo về n8n rằng 1 bài đã xử lý xong -> n8n update sheet đánh dấu video done.
// reason: 'posted' = đăng thành công; 'broken' = link hỏng (403/SKIP) cần đánh dấu để
// không lấy lại. Gửi kèm id (ổn định nhất), title, accountId, assetUrl, postUrl để n8n
// tìm đúng dòng sheet (ưu tiên khớp theo id, fallback title).
export async function markDone(p: {
  accountId: string
  assetUrl: string | null
  title: string
  postUrl: string | null
  reason?: 'posted' | 'broken'
  id?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await postWebhook(
      webhookBody('markdone', {
        accountId: p.accountId,
        assetUrl: p.assetUrl,
        id: p.id ?? null,
        title: p.title,
        postUrl: p.postUrl,
        reason: p.reason ?? 'posted'
      })
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `Webhook markdone HTTP ${res.status}${body ? ': ' + body.slice(0, 200) : ''}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function testWebhook(
  accountId?: string,
  assetUrl?: string | null
): Promise<WebhookTestResult> {
  try {
    const { status, payload } = await callWebhook(accountId, assetUrl)
    return {
      ok: true,
      status,
      caption: payload.caption,
      assetCount: payload.assets.length,
      hasAudioMerge: !!payload.videoSpecs?.some((v) => v.audioUrls.length > 0),
      assetUrl: assetUrl ?? null,
      accountId: accountId ?? null
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function resolveDownloadsRoot(): string {
  const { downloadsDir } = getAllSettings()
  return downloadsDir && downloadsDir.trim() ? downloadsDir : join(app.getPath('userData'), 'downloads')
}

// Lỗi đặc thù: link media hỏng/không tải được (403, 404...). Dùng để postRunNow
// nhận biết -> gọi markdone đánh dấu link đó rồi báo user (không tự lặp tránh loop).
export class BrokenMediaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrokenMediaError'
  }
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

function getAudioUrlsFromDash(dashUrl: string): string[] {
  try {
    const url = new URL(dashUrl)
    const basePath = url.pathname.replace(/\/[^/]*$/, '')
    const names = ['DASH_AUDIO_128.mp4', 'DASH_AUDIO_64.mp4', 'DASH_audio.mp4']
    return names.map(name => `${url.origin}${basePath}/${name}?${url.search}`)
  } catch {
    return []
  }
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
  const videoSpecMap = new Map<string, { audioUrls: string[]; dashUrl?: string; hlsUrl?: string }>()
  for (const v of payload.videoSpecs ?? [])
    videoSpecMap.set(v.videoUrl, { audioUrls: v.audioUrls, dashUrl: v.dashUrl, hlsUrl: v.hlsUrl })

  for (let i = 0; i < payload.assets.length; i++) {
    const asset = payload.assets[i]
    const ext = guessExt(asset.url, asset.type)

    if (asset.type === 'video' && videoSpecMap.has(asset.url)) {
      const spec = videoSpecMap.get(asset.url)!
      const finalPath = join(dir, `video_${i}.mp4`)

      // Cách 1 (ưu tiên): đọc thẳng manifest (DASH/HLS) bằng ffmpeg -> 1 file có cả
      // video+audio. fallback_url của Reddit chỉ chứa video (không audio), còn
      // DASH_AUDIO_*.mp4 tách rời thường 403 -> manifest là cách chắc nhất, chất
      // lượng 720p + AAC stereo. Thử DASH trước, rồi HLS.
      const manifest = spec.dashUrl || spec.hlsUrl
      if (manifest) {
        try {
          await muxFromManifest(manifest, finalPath)
          out.push(finalPath)
          continue
        } catch (e) {
          console.warn('[n8n] manifest mux fail, thử fallback+audio:', (e as Error).message)
        }
      }

      // Cách 2 (fallback cũ): tải video + audio riêng rồi mux.
      const videoTmp = join(dir, `video_${i}_v${ext}`)
      try {
        await downloadToFile(asset.url, videoTmp)
      } catch (e) {
        // Cả manifest lẫn fallback_url đều hỏng -> link Reddit này die (403/404...).
        await unlink(videoTmp).catch(() => {})
        throw new BrokenMediaError(`Link video hỏng: ${(e as Error).message}`)
      }

      let audioTmp: string | null = null
      if (spec.audioUrls.length > 0) {
        audioTmp = await downloadFirstWorkingAudio(spec.audioUrls, dir)
      }
      if (!audioTmp && spec.dashUrl) {
        const dashAudioUrls = getAudioUrlsFromDash(spec.dashUrl)
        if (dashAudioUrls.length > 0) {
          audioTmp = await downloadFirstWorkingAudio(dashAudioUrls, dir)
        }
      }

      if (audioTmp) {
        try {
          await muxVideoAudio(videoTmp, audioTmp, finalPath)
          await unlink(videoTmp).catch(() => {})
          await unlink(audioTmp).catch(() => {})
          out.push(finalPath)
          continue
        } catch (e) {
          console.warn('[n8n] mux fail, fallback video-only:', (e as Error).message)
        }
      }
      // Không có audio hoặc mux fail: dùng video gốc (đã tải được) làm output.
      await unlink(finalPath).catch(() => {})
      await rename(videoTmp, finalPath).catch(async () => {
        await downloadToFile(asset.url, finalPath)
      })
      out.push(finalPath)
      continue
    }

    // Ảnh hoặc video không tách audio.
    const filePath = join(dir, `asset_${i}${ext}`)
    try {
      await downloadToFile(asset.url, filePath)
    } catch (e) {
      throw new BrokenMediaError(`Link media hỏng: ${(e as Error).message}`)
    }
    out.push(filePath)
  }
  return out
}
