// Chuẩn hoá URL tweet dùng chung (main + renderer). Mục tiêu: 2 URL trỏ CÙNG 1 bài luôn ra
// cùng 1 chuỗi để so khớp/khử trùng (cache comment, đối chiếu nhật ký đăng thành công).
//
// Quy tắc:
//   - Bỏ query (?...) và hash (#...) — vd tham số ?s=20, ?t=..., /analytics đứng riêng.
//   - Chuẩn host về "x.com" (twitter.com/mobile.twitter.com/www.* -> x.com), thường hoá.
//   - Chỉ giữ phần permalink gốc ".../<handle>/status/<id>" — cắt bỏ đuôi /analytics,
//     /photo/1, /video/1, /retweets, /likes, dấu "/" cuối…
//   - Trả null nếu không phải URL tweet hợp lệ (không có /status/<id>).

// Regex bắt permalink gốc: <host>/<handle>/status/<id> (id chỉ gồm chữ số).
const TWEET_RE = /^https?:\/\/([^/]+)\/([^/]+)\/status\/(\d+)/i

export function canonicalizeTweetUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  let u = String(rawUrl).trim()
  if (!u) return null
  // Thêm scheme nếu thiếu (vd href dạng "/user/status/123" hoặc "x.com/...").
  if (u.startsWith('/')) {
    u = `https://x.com${u}`
  } else if (!/^https?:\/\//i.test(u)) {
    u = `https://${u}`
  }
  const m = u.match(TWEET_RE)
  if (!m) return null
  const handle = m[2]
  const id = m[3]
  // Bỏ qua các path đặc biệt bị hiểu nhầm là handle (i/web/status/... vẫn hợp lệ nhưng
  // handle="i" trỏ cùng bài; giữ nguyên id là đủ để so khớp — chuẩn hoá về i/status khi handle
  // là 'i' hoặc 'web' hiếm gặp, vẫn giữ handle gốc cho đường dẫn hiển thị).
  return `https://x.com/${handle}/status/${id}`
}

// So sánh 2 URL tweet có CÙNG bài không (theo dạng chuẩn hoá). Sai định dạng -> false.
export function sameTweet(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalizeTweetUrl(a)
  const cb = canonicalizeTweetUrl(b)
  return !!ca && !!cb && ca === cb
}

// Trích tweet id từ 1 URL (dùng khi cần khớp theo id, bỏ qua handle). null nếu không hợp lệ.
export function tweetIdOf(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  const m = String(rawUrl).trim().match(/\/status\/(\d+)/)
  return m ? m[1] : null
}
