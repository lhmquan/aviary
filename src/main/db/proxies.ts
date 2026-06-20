import { randomUUID } from 'crypto'
import { getDb } from './index'
import { parseProxy } from '../browser/BrowserManager'

// 1 dòng proxy trong kho proxy chung. proxy_string dạng user:pass@host:port hoặc host:port
// (có thể kèm scheme http:// | socks5://...). kind là nhãn người dùng tự ghi (VD "VN", "US").
export interface Proxy {
  id: string
  label: string
  proxyString: string
  kind: string | null
  note: string | null
  createdAt: number
  updatedAt: number
}

export interface ProxyInput {
  label: string
  proxyString: string
  kind?: string | null
  note?: string | null
}

interface ProxyRow {
  id: string
  label: string
  proxy_string: string
  kind: string | null
  note: string | null
  created_at: number
  updated_at: number
}

function toProxy(r: ProxyRow): Proxy {
  return {
    id: r.id,
    label: r.label,
    proxyString: r.proxy_string,
    kind: r.kind,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listProxies(): Proxy[] {
  const rows = getDb()
    .prepare('SELECT * FROM proxies ORDER BY created_at ASC')
    .all() as ProxyRow[]
  return rows.map(toProxy)
}

export function getProxy(id: string): Proxy | null {
  const row = getDb().prepare('SELECT * FROM proxies WHERE id = ?').get(id) as
    | ProxyRow
    | undefined
  return row ? toProxy(row) : null
}

export function createProxy(input: ProxyInput): Proxy {
  const id = randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO proxies (id, label, proxy_string, kind, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.label.trim(), input.proxyString.trim(), input.kind ?? null, input.note ?? null, now, now)
  return getProxy(id)!
}

// Thêm nhiều proxy cùng lúc (paste danh sách). Mỗi dòng = 1 proxy. Tự sinh nhãn dạng
// "<prefix> <số thứ tự>" nếu user không kèm nhãn (định dạng "label|proxyString"). Dòng
// trống / trùng proxyString đã có trong kho -> bỏ qua (không insert, không lỗi). Trả về
// số lượng đã thêm + danh sách bị bỏ (để hiển thị cho user). Toàn bộ trong 1 transaction.
export function bulkCreateProxies(
  lines: string[],
  opts: { labelPrefix?: string; kind?: string | null }
): { added: number; skipped: string[] } {
  const now = Date.now()
  const prefix = (opts.labelPrefix ?? 'Proxy').trim() || 'Proxy'
  const kind = opts.kind?.trim() || null

  // Parse từng dòng: "label|proxyString" hoặc chỉ "proxyString".
  const parsed: { label: string; proxyString: string }[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    let label: string
    let proxyString: string
    const pipe = line.indexOf('|')
    if (pipe !== -1) {
      label = line.slice(0, pipe).trim()
      proxyString = line.slice(pipe + 1).trim()
    } else {
      label = ''
      proxyString = line
    }
    if (!proxyString) continue
    parsed.push({ label: label || proxyString, proxyString })
  }

  if (parsed.length === 0) return { added: 0, skipped: [] }

  const db = getDb()
  const insert = db.prepare(
    `INSERT INTO proxies (id, label, proxy_string, kind, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`
  )

  // Lấy set proxyString đã có để dedup (tránh trùng lặp khi paste 2 lần).
  const existing = new Set(
    (db.prepare('SELECT proxy_string FROM proxies').all() as { proxy_string: string }[]).map(
      (r) => r.proxy_string
    )
  )

  let added = 0
  let seq = 1
  const skipped: string[] = []
  const tx = db.transaction((items: { label: string; proxyString: string }[]) => {
    for (const it of items) {
      if (existing.has(it.proxyString)) {
        skipped.push(it.proxyString)
        continue
      }
      // Sinh nhãn tự động "<prefix> <seq>" nếu user paste dạng thuần proxyString, hoặc dùng
      // nhãn họ kèm theo "|". Ưu tiên: nếu nhãn = proxyString (không kèm |) thì tự sinh.
      const autoLabel = it.label === it.proxyString ? `${prefix} ${seq}` : it.label
      insert.run(randomUUID(), autoLabel, it.proxyString, kind, now, now)
      existing.add(it.proxyString)
      added++
      seq++
    }
  })
  tx(parsed)
  return { added, skipped }
}

export function updateProxy(id: string, input: Partial<ProxyInput>): Proxy {
  const existing = getProxy(id)
  if (!existing) throw new Error(`Proxy không tồn tại: ${id}`)
  const next = {
    label: input.label ?? existing.label,
    proxyString: input.proxyString ?? existing.proxyString,
    kind: input.kind !== undefined ? input.kind : existing.kind,
    note: input.note !== undefined ? input.note : existing.note
  }
  getDb()
    .prepare(
      'UPDATE proxies SET label = ?, proxy_string = ?, kind = ?, note = ?, updated_at = ? WHERE id = ?'
    )
    .run(next.label.trim(), next.proxyString.trim(), next.kind, next.note, Date.now(), id)
  return getProxy(id)!
}

export function deleteProxy(id: string): void {
  getDb().prepare('DELETE FROM proxies WHERE id = ?').run(id)
}

// Giá trị đặc biệt cho account.proxyId:
//  - null/undefined/'__local' -> không proxy (dùng IP máy).
//  - '__random' -> mỗi lần chạy pick random 1 proxy trong kho.
//  - id proxy cụ thể -> dùng proxy đó.
export const PROXY_LOCAL = '__local'
export const PROXY_RANDOM = '__random'

// Từ account.proxyId + kho proxy -> ra raw proxy string dùng cho lần chạy NÀY.
// Với __random, trả về chuỗi random (không lưu lại vào account — mỗi lần chạy khác nhau).
// Trả về null nghĩa là không dùng proxy (local). Trả về Error nếu proxyId chỉ định 1 proxy
// cụ thể nhưng đã bị xoá khỏi kho.
export function resolveProxyString(accountProxyId: string | null): string | null {
  const pid = accountProxyId?.trim() || PROXY_LOCAL
  if (pid === PROXY_LOCAL || pid === '') return null
  if (pid === PROXY_RANDOM) {
    const all = listProxies()
    if (all.length === 0) return null // không có proxy nào trong kho -> dùng local
    return all[Math.floor(Math.random() * all.length)].proxyString
  }
  const p = getProxy(pid)
  return p ? p.proxyString : null
}

// Validate 1 chuỗi proxy có parse được không (dùng ở form proxy để báo lỗi sớm).
export function isValidProxyString(raw: string): boolean {
  if (!raw.trim()) return false
  return parseProxy(raw) !== undefined
}