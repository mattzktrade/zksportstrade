import type { PDFFont } from "pdf-lib"

/** Keep brochure copy in a glyph set both custom fonts and WinAnsi can draw. */
export function brochureSafeText(value: string): string {
  return value
    .replaceAll("\u00a0", " ")
    .replaceAll("\u202f", " ")
    .replaceAll("\u200b", "")
    .replaceAll("\u2018", "'")
    .replaceAll("\u2019", "'")
    .replaceAll("\u201c", '"')
    .replaceAll("\u201d", '"')
    .replaceAll("\u2013", "-")
    .replaceAll("\u2014", "-")
    .replaceAll("\u2026", "...")
    .replaceAll("\u00ae", "(R)")
    .replaceAll("\u2122", "(TM)")
    .replace(/[^\n\r\t\u0020-\u007e\u00a1-\u00ff]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
}

/** Visible print copy: drop legal marks that render as ugly (R)/(TM) in the PDF. */
export function brochurePrintText(value: string): string {
  return brochureSafeText(value)
    .replace(/\(TM\)/gi, "")
    .replace(/\(R\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?:;])/g, "$1")
    .trim()
}

/** Body and list copy: readable sentence case instead of shouting all-caps. */
export function brochureReadable(value: string): string {
  const text = brochurePrintText(value)
  if (!text) return text
  if (text === text.toUpperCase() && /[A-Z]/.test(text) && text.length > 3) {
    const lower = text.toLowerCase()
    return lower.charAt(0).toUpperCase() + lower.slice(1)
  }
  return text
}

export function splitLongToken(token: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const parts: string[] = []
  let current = ""
  for (const char of token) {
    if (current && font.widthOfTextAtSize(current + char, size) > maxWidth) {
      parts.push(current)
      current = char
    } else {
      current += char
    }
  }
  if (current) parts.push(current)
  return parts
}

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const output: string[] = []
  for (const paragraph of brochureSafeText(text).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      output.push("")
      continue
    }
    let line = ""
    for (const rawWord of words) {
      const wordParts =
        font.widthOfTextAtSize(rawWord, size) > maxWidth
          ? splitLongToken(rawWord, font, size, maxWidth)
          : [rawWord]
      for (const word of wordParts) {
        const candidate = line ? `${line} ${word}` : word
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          output.push(line)
          line = word
        } else {
          line = candidate
        }
      }
    }
    if (line) output.push(line)
  }
  return output.length ? output : [""]
}

export function truncateLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  const last = kept[kept.length - 1] ?? ""
  kept[kept.length - 1] = last.replace(/[.,;:\s]+$/, "") + "..."
  return kept
}

export function fitTitle(
  text: string,
  font: PDFFont,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  maxLines: number,
): { size: number; lines: string[] } {
  const safe = brochureSafeText(text)
  for (let size = maxSize; size >= minSize; size -= 1) {
    const lines = wrapText(safe, font, size, maxWidth)
    if (lines.length <= maxLines) return { size, lines }
  }
  return {
    size: minSize,
    lines: truncateLines(wrapText(safe, font, minSize, maxWidth), maxLines),
  }
}

export function brochureNameSlug(value: string): string {
  return brochurePrintText(value)
    .toLowerCase()
    .replace(/\bformula\s*1\b/g, " ")
    .replace(/\bf1\b/g, " ")
    .replace(/\bgrand prix\b/g, "gp")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function brochureFilename(productName: string, raceName?: string | null): string {
  const event = brochureNameSlug(raceName ?? "").slice(0, 40)
  const product = brochureNameSlug(productName).slice(0, 48)
  const slug = [event, product].filter(Boolean).join("-").replace(/-{2,}/g, "-").slice(0, 90)
  return `${slug || "package"}-brochure.pdf`
}

export function uniqueImageUrls(heroUrl: string | null, galleryUrls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [heroUrl, ...galleryUrls]) {
    const url = raw?.trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}
