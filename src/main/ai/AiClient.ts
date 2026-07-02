import { getAllSettings } from '../db/settings'
import type { AiTestResult } from '../../shared/types'

// Kết nối AI theo chuẩn OpenAI-compatible (/v1/chat/completions). Dùng được với
// OpenAI thật lẫn proxy bên thứ 3 (vietapi.tech...) — chỉ khác base URL + model + key.
// Không dùng SDK: gọi thẳng REST bằng fetch (Node 18+/Electron có sẵn).

// Map preset tone -> chỉ dẫn phong cách (tiếng Việt).
function toneInstruction(tone: string): string {
  switch (tone) {
    case 'humorous':
      return 'giọng điệu hài hước, dí dỏm'
    case 'neutral':
      return 'giọng điệu trung lập, lịch sự'
    case 'concise':
      return 'giọng điệu ngắn gọn, đi thẳng vào ý'
    case 'friendly':
    default:
      return 'giọng điệu thân thiện, tự nhiên'
  }
}

// Map preset ngôn ngữ -> chỉ dẫn.
function langInstruction(lang: string): string {
  switch (lang) {
    case 'vi':
      return 'Viết bằng tiếng Việt.'
    case 'en':
      return 'Write in English.'
    case 'auto':
    default:
      return 'Viết bằng đúng ngôn ngữ của bài viết.'
  }
}

// System prompt cho việc sinh 1 bình luận ngắn từ nội dung bài.
function buildSystemPrompt(tone: string, lang: string): string {
  return [
    `Bạn viết một bình luận mạng xã hội ngắn (dưới 15 từ), ${toneInstruction(tone)}.`,
    langInstruction(lang),
    'Không dùng hashtag, không emoji quá đà, không lặp lại nguyên văn nội dung bài.',
    'Chỉ trả về đúng câu bình luận, không giải thích, không thêm dấu ngoặc kép.'
  ].join(' ')
}

// Chuẩn hoá base URL -> endpoint /chat/completions đầy đủ.
// Chấp nhận: '.../v1', '.../v1/', '.../v1/chat/completions'. Bỏ '/' cuối rồi tự thêm nếu thiếu.
function resolveEndpoint(baseUrl: string): string {
  let u = baseUrl.trim().replace(/\/+$/, '')
  if (!/\/chat\/completions$/i.test(u)) {
    u = `${u}/chat/completions`
  }
  return u
}

// Gọi AI sinh 1 bình luận từ nội dung bài. KHÔNG throw — caller (phiên tương tác) bỏ
// qua comment khi lỗi. Trả { ok:false, error } nếu chưa cấu hình / lỗi mạng / parse fail.
export async function generateComment(
  tweetText: string
): Promise<{ ok: boolean; comment?: string; error?: string; status?: number }> {
  const s = getAllSettings()
  if (!s.aiBaseUrl.trim() || !s.aiApiKey.trim() || !s.aiModel.trim()) {
    return { ok: false, error: 'AI chưa được cấu hình (base URL / API key / model).' }
  }
  const text = (tweetText ?? '').trim()
  if (!text) return { ok: false, error: 'Không có nội dung bài để sinh bình luận.' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(resolveEndpoint(s.aiBaseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${s.aiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: s.aiModel,
        max_tokens: 100,
        temperature: 0.9,
        messages: [
          { role: 'system', content: buildSystemPrompt(s.aiCommentTone, s.aiCommentLang) },
          { role: 'user', content: `Bài viết:\n"""${text.slice(0, 1500)}"""\n\nViết 1 bình luận.` }
        ]
      })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, status: res.status, error: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const raw = data?.choices?.[0]?.message?.content ?? ''
    // Bỏ dấu ngoặc kép bao ngoài nếu model tự thêm.
    const comment = raw.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim()
    if (!comment) return { ok: false, error: 'AI trả về nội dung trống.' }
    return { ok: true, comment }
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError') return { ok: false, error: 'AI timeout (20s).' }
    return { ok: false, error: err.message }
  } finally {
    clearTimeout(timer)
  }
}

// Test cấu hình AI từ UI Cài đặt: gửi 1 đoạn text mẫu -> nhận câu bình luận.
export async function testAi(sampleText: string): Promise<AiTestResult> {
  const sample =
    (sampleText ?? '').trim() ||
    'Hôm nay trời đẹp quá, vừa hoàn thành xong dự án lớn, cảm thấy rất vui!'
  const r = await generateComment(sample)
  return { ok: r.ok, comment: r.comment, error: r.error, status: r.status }
}
