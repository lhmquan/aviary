const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  bull: '•',
  cent: '¢',
  copy: '©',
  divide: '÷',
  euro: '€',
  gt: '>',
  hellip: '…',
  laquo: '«',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  middot: '·',
  nbsp: ' ',
  ndash: '–',
  pound: '£',
  quot: '"',
  raquo: '»',
  rdquo: '”',
  reg: '®',
  rsquo: '’',
  times: '×',
  trade: '™',
  yen: '¥'
}

const CP1252_BYTES = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f]
])

function decodeEntity(entity: string): string | null {
  if (entity.startsWith('#')) {
    const hex = entity[1]?.toLowerCase() === 'x'
    const raw = entity.slice(hex ? 2 : 1)
    if (!raw || !/^[0-9a-f]+$/i.test(raw)) return null
    const codePoint = Number.parseInt(raw, hex ? 16 : 10)
    if (codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return null
    }
    return String.fromCodePoint(codePoint)
  }
  return NAMED_ENTITIES[entity.toLowerCase()] ?? null
}

function decodeHtmlEntities(text: string): string {
  let current = text
  // Một số nguồn escape nhiều lớp, ví dụ `&amp;amp;`.
  for (let pass = 0; pass < 3; pass++) {
    const decoded = current.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
      return decodeEntity(entity) ?? match
    })
    if (decoded === current) break
    current = decoded
  }
  return current
}

function cp1252Byte(codePoint: number): number | null {
  if (codePoint <= 0xff && !(codePoint >= 0x80 && codePoint <= 0x9f)) return codePoint
  return CP1252_BYTES.get(codePoint) ?? null
}

function mojibakeScore(text: string): number {
  return (text.match(/(?:Ã.|Â.|â.|ð.|ï.|�)/g) ?? []).length
}

function repairMojibake(text: string): string {
  let output = ''
  let run = ''

  const flush = (): void => {
    if (!run) return
    const bytes: number[] = []
    for (const char of run) {
      const byte = cp1252Byte(char.codePointAt(0)!)
      if (byte === null) {
        output += run
        run = ''
        return
      }
      bytes.push(byte)
    }
    const repaired = Buffer.from(bytes).toString('utf8')
    output += !repaired.includes('�') && mojibakeScore(repaired) < mojibakeScore(run) ? repaired : run
    run = ''
  }

  for (const char of text) {
    if (cp1252Byte(char.codePointAt(0)!) !== null) run += char
    else {
      flush()
      output += char
    }
  }
  flush()
  return output
}

/** Chuẩn hóa caption cuối cùng trước khi tính độ dài và nhập vào X. */
export function normalizePostCaption(raw: string): string {
  return repairMojibake(decodeHtmlEntities(raw))
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u200b\u2060\ufeff]/g, '')
    .replace(/\u00a0/g, ' ')
    .normalize('NFC')
    .trim()
}
