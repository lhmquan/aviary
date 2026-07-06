import { getAllSettings } from '../db/settings'
import type { AiTestResult } from '../../shared/types'

// Kết nối AI theo chuẩn OpenAI-compatible (/v1/chat/completions). Dùng được với
// OpenAI thật lẫn proxy bên thứ 3 (vietapi.tech...) — chỉ khác base URL + model + key.
// Không dùng SDK: gọi thẳng REST bằng fetch (Node 18+/Electron có sẵn).

// Tuỳ chọn sinh bình luận — tone/lang/format cấu hình RIÊNG từng tài khoản (Account).
export interface CommentOptions {
  tone: string // 'random' | 'friendly' | 'humorous' | 'neutral' | 'concise'
  lang: string // 'auto' | 'vi' | 'en'
  format: string // 'random' | 'normal' | 'question' | 'debate' | 'info'
  // Text của tối đa 10 reply đầu bài viết (nếu có) — cho AI ngữ cảnh chính xác hơn để
  // bình luận sát cuộc trò chuyện. Trống -> chỉ dùng caption.
  replies?: string[]
}

// Các preset thật để bốc khi user chọn 'random'.
const TONE_CHOICES = ['friendly', 'humorous', 'neutral', 'concise'] as const
const FORMAT_CHOICES = ['normal', 'question', 'debate', 'info'] as const

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

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

// Map preset định dạng -> chỉ dẫn dạng nội dung bình luận.
function formatInstruction(format: string): string {
  switch (format) {
    case 'question':
      return 'Trình bày bình luận dưới dạng một câu hỏi liên quan tới bài viết.'
    case 'debate':
      return 'Nêu một quan điểm tranh luận, phản biện nhẹ nhàng về nội dung bài viết.'
    case 'info':
      return 'Bổ sung một thông tin hoặc góc nhìn hữu ích liên quan tới bài viết.'
    case 'normal':
    default:
      return 'Viết một bình luận tự nhiên như người dùng mạng xã hội bình thường.'
  }
}

// Cắt cứng bình luận về tối đa maxLen ký tự (giữ nguyên nội dung, không thêm "…").
// Ưu tiên cắt ở ranh giới khoảng trắng gần nhất để không vỡ giữa từ; nếu không có
// khoảng trắng phù hợp thì cắt thẳng theo ký tự.
function clampLength(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const slice = text.slice(0, maxLen)
  const lastSpace = slice.lastIndexOf(' ')
  // Chỉ cắt theo từ nếu khoảng trắng nằm đủ xa đầu (tránh cắt còn 1-2 từ khi maxLen nhỏ).
  if (lastSpace >= maxLen * 0.6) return slice.slice(0, lastSpace).trimEnd()
  return slice.trimEnd()
}

// Map preset ngôn ngữ -> chỉ dẫn BẮT BUỘC (đặt cuối system prompt để model coi trọng
// nhất). Với 'vi'/'en' phải cấm rõ ngôn ngữ khác, nếu không model dễ "bắt chước" ngôn
// ngữ của bài feed (vd bài tiếng Việt → comment tiếng Việt dù đã chọn English).
function langInstruction(lang: string): string {
  switch (lang) {
    case 'vi':
      return 'BẮT BUỘC viết bình luận HOÀN TOÀN bằng tiếng Việt, dù bài viết dùng ngôn ngữ nào. Tuyệt đối không dùng ngôn ngữ khác.'
    case 'en':
      return 'You MUST write the comment ENTIRELY in English, regardless of the language of the post. Never use Vietnamese or any other language.'
    case 'auto':
    default:
      return 'Viết bình luận bằng đúng ngôn ngữ của bài viết.'
  }
}

// System prompt cho việc sinh 1 bình luận ngắn từ nội dung bài.
// Yêu cầu ngôn ngữ đặt CUỐI CÙNG (recency) để model tuân thủ chắc nhất.
function buildSystemPrompt(tone: string, lang: string, format: string, maxLen: number): string {
  return [
    `Bạn viết một bình luận mạng xã hội ngắn (DƯỚI ${maxLen} ký tự), ${toneInstruction(tone)}.`,
    formatInstruction(format),
    'Không dùng hashtag, không emoji quá đà, không lặp lại nguyên văn nội dung bài.',
    'Chỉ trả về đúng câu bình luận, không giải thích, không thêm dấu ngoặc kép.',
    langInstruction(lang)
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

// Dựng user message: caption bài chính + (nếu có) trích các reply đầu để AI hiểu ngữ cảnh
// cuộc trò chuyện -> bình luận sát hơn. Reply chỉ để THAM KHẢO ngữ cảnh, KHÔNG lặp lại.
function buildUserPrompt(caption: string, replies: string[] | undefined, lang: string): string {
  let prompt = `Bài viết:\n"""${caption.slice(0, 1500)}"""`
  const cleanReplies = (replies ?? [])
    .map((r) => r.trim())
    .filter(Boolean)
    .slice(0, 10)
  if (cleanReplies.length > 0) {
    // Mỗi reply cắt ngắn để không phình token; đánh số cho dễ đọc.
    const block = cleanReplies.map((r, i) => `${i + 1}. ${r.slice(0, 200)}`).join('\n')
    prompt +=
      `\n\nMột số bình luận hiện có dưới bài (chỉ để hiểu ngữ cảnh, ĐỪNG lặp lại nội dung của chúng):\n"""${block}"""`
  }
  prompt += `\n\nViết 1 bình luận cho chính bài viết (không phải trả lời các bình luận trên).${langReminder(lang)}`
  return prompt
}

// Nhắc lại ngôn ngữ ngay trong yêu cầu (user message) — củng cố cùng system prompt.
function langReminder(lang: string): string {
  switch (lang) {
    case 'vi':
      return ' Trả lời bằng tiếng Việt.'
    case 'en':
      return ' Reply in English.'
    case 'auto':
    default:
      return ''
  }
}

// Gọi AI sinh 1 bình luận từ nội dung bài. KHÔNG throw — caller (phiên tương tác) bỏ
// qua comment khi lỗi. Trả { ok:false, error } nếu chưa cấu hình / lỗi mạng / parse fail.
// tone/lang/format lấy từ cấu hình RIÊNG của tài khoản; maxLen từ settings global.
export async function generateComment(
  tweetText: string,
  opts: CommentOptions
): Promise<{ ok: boolean; comment?: string; error?: string; status?: number }> {
  const s = getAllSettings()
  if (!s.aiBaseUrl.trim() || !s.aiApiKey.trim() || !s.aiModel.trim()) {
    return { ok: false, error: 'AI chưa được cấu hình (base URL / API key / model).' }
  }
  const text = (tweetText ?? '').trim()
  if (!text) return { ok: false, error: 'Không có nội dung bài để sinh bình luận.' }

  // Resolve 'random' NGAY tại đây -> mỗi lần gọi (mỗi bình luận) bốc lại độc lập.
  const tone = opts.tone === 'random' ? pickRandom(TONE_CHOICES) : opts.tone
  const format = opts.format === 'random' ? pickRandom(FORMAT_CHOICES) : opts.format
  const maxLen = Math.max(20, Math.min(280, s.aiCommentMaxLen || 200))

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
          { role: 'system', content: buildSystemPrompt(tone, opts.lang, format, maxLen) },
          {
            role: 'user',
            content: buildUserPrompt(text, opts.replies, opts.lang)
          }
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
    const cleaned = raw.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim()
    if (!cleaned) return { ok: false, error: 'AI trả về nội dung trống.' }
    // Cắt cứng nếu AI vẫn trả vượt giới hạn (dù đã nhắc trong prompt).
    const comment = clampLength(cleaned, maxLen)
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
// Dùng tone/lang/format mặc định (vì cấu hình này giờ theo từng tài khoản).
export async function testAi(sampleText: string): Promise<AiTestResult> {
  const sample =
    (sampleText ?? '').trim() ||
    'Hôm nay trời đẹp quá, vừa hoàn thành xong dự án lớn, cảm thấy rất vui!'
  const r = await generateComment(sample, { tone: 'friendly', lang: 'auto', format: 'normal' })
  return { ok: r.ok, comment: r.comment, error: r.error, status: r.status }
}
