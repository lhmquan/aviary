import { createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { PostPayload, WebhookTestResult } from '../../shared/types'
import { getAllSettings } from '../db/settings'

// Chuẩn hóa response webhook từ n8n thành PostPayload.
// Chấp nhận vài dạng phổ biến để dễ ghép với workflow n8n có sẵn.
function normalizePayload(raw: unknown): PostPayload {
  const data = Array.isArray(raw) ? (raw[0] ?? {}) : raw
  const obj = (data ?? {}) as Record<string, unknown>

  const caption = String(obj.caption ?? obj.text ?? obj.content ?? '')

  let assets: PostPayload['assets'] = []
  const rawAssets = obj.assets ?? obj.media ?? obj.urls
  if (Array.isArray(rawAssets)) {
    assets = rawAssets
      .map((a) => {
        if (typeof a === 'string') return { url: a }
        if (a && typeof a === 'object') {
          const o = a as Record<string, unknown>
          const url = o.url ?? o.src ?? o.link
          if (typeof url === 'string') {
            const type = o.type === 'video' || o.type === 'image' ? o.type : undefined
            return { url, type }
          }
        }
        return null
      })
      .filter((a): a is { url: string; type?: 'image' | 'video' } => a !== null)
  } else if (typeof obj.url === 'string') {
    assets = [{ url: obj.url }]
  }

  return { caption, assets }
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
    return { ok: true, status, caption: payload.caption, assetCount: payload.assets.length }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// Tải các asset về thư mục downloads/<accountId>/<jobId>/, trả về danh sách path local.
export async function downloadAssets(
  payload: PostPayload,
  accountId: string,
  jobId: string
): Promise<string[]> {
  const { downloadsDir } = getAllSettings()
  if (!downloadsDir) throw new Error('Chưa cấu hình thư mục tải (downloads) trong Cài đặt')

  const dir = join(downloadsDir, accountId, jobId)
  await mkdir(dir, { recursive: true })

  const paths: string[] = []
  for (let i = 0; i < payload.assets.length; i++) {
    const asset = payload.assets[i]
    const res = await fetch(asset.url)
    if (!res.ok || !res.body) throw new Error(`Tải asset lỗi HTTP ${res.status}: ${asset.url}`)

    const ext = guessExt(asset.url, res.headers.get('content-type'), asset.type)
    const filePath = join(dir, `asset_${i}${ext}`)
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(filePath))
    paths.push(filePath)
  }
  return paths
}

function guessExt(url: string, contentType: string | null, type?: 'image' | 'video'): string {
  const m = url.split('?')[0].match(/\.(mp4|mov|jpg|jpeg|png|gif|webp|webm)$/i)
  if (m) return '.' + m[1].toLowerCase()
  if (contentType?.includes('mp4')) return '.mp4'
  if (contentType?.includes('webm')) return '.webm'
  if (contentType?.includes('png')) return '.png'
  if (contentType?.includes('gif')) return '.gif'
  if (contentType?.includes('webp')) return '.webp'
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return '.jpg'
  return type === 'video' ? '.mp4' : '.jpg'
}
