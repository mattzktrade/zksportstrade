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

const TRAILING_FUNCTION =
  /^(and|or|but|nor|the|a|an|of|to|with|from|for|in|on|at|by|as|into|onto|upon|over|about|across|after|before|between|through|during|without|within|via|per|&|plus|including|includes|your|our|their|its|it's|this|that|these|those|is|are|was|were|be|been|being|will|would|can|could|should|may|might|have|has|had|do|does|did|not|also|both|either|neither|than|then|such)$/i

const TRAILING_ADJECTIVE =
  /^(unique|exclusive|premium|stunning|panoramic|comprehensive|dedicated|unmatched|breathtaking|expansive|gourmet|complimentary|spectacular|incredible|culinary|trackside|indoor|outdoor|elevated|private|official|professional|complete|full|live|special|new|own|wide|prime|open|vip)$/i

const TRAILING_VERB =
  /^(provide|provides|include|includes|offer|offers|feature|features|deliver|delivers|enjoy|enjoys|take|takes|watch|watches|give|gives|ensure|ensures|create|creates|make|makes|get|gets|bring|brings|unlock|unlocks|extend|extends)$/i

const TRAILING_PARTICIPLE =
  /^(overlooking|featuring|including|offering|located|positioned|providing|giving|taking|watching|using|hosting|enjoying|facing|beside|towards|toward)$/i

const FINISHED_IDIOM = /(?:\band more|\bmeet and greet|\bopen bar)$/i

function lastBrochureWord(text: string): string {
  const cleaned = text.replace(/[.,;:!?()"“”]+$/g, "").trim()
  const words = cleaned.split(/\s+/).filter(Boolean)
  return (words[words.length - 1] ?? "").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9']+$/g, "")
}

/** True when a bullet can stand on its own, instead of ending mid-thought. */
export function isFinishedBrochurePhrase(text: string): boolean {
  const cleaned = text.replace(/[.,;:!?()\s-]+$/g, "").replace(/\s+/g, " ").trim()
  if (!cleaned) return false
  if (FINISHED_IDIOM.test(cleaned)) return true
  const last = lastBrochureWord(cleaned)
  if (!last) return false
  if (TRAILING_FUNCTION.test(last) || TRAILING_ADJECTIVE.test(last) || TRAILING_VERB.test(last)) return false
  if (TRAILING_PARTICIPLE.test(last)) return false
  if (/ly$/i.test(last) && last.length > 4) return false
  return true
}

function omittedBrochureWords(budget: string, source: string): string {
  const full = source.replace(/\s+/g, " ").trim()
  const prefix = budget.replace(/\s+/g, " ").trim()
  if (!prefix || !full.startsWith(prefix)) return ""
  return full.slice(prefix.length).trim()
}

function isUnstableBrochureCut(budget: string, source: string): boolean {
  const next = lastBrochureWord(omittedBrochureWords(budget, source).split(/\s+/)[0] ?? "")
  if (!next) return false
  const last = lastBrochureWord(budget)
  if (!last) return false
  if (/^\d{1,2}$/.test(last) && /^\d{1,2}$/.test(next)) return true
  return /^[A-Z][A-Za-z]*$/.test(last) && /^[A-Z][A-Za-z]*$/.test(next)
}

function looksLikeNumberListTail(text: string): boolean {
  const trimmed = text.replace(/[.,;:\s]+$/g, "").trim()
  return /(?:\bturns?\s+)?(?:\d{1,2}\s*,\s*)+\d{1,2}$/i.test(trimmed) || /\bturns?\s+\d{1,2}$/i.test(trimmed)
}

function looksLikeNumberListHead(text: string): boolean {
  return /^\d{1,2}\b/.test(text.trim())
}

function joinBrochureFragments(previous: string, next: string): string {
  const left = previous.replace(/[.,;:\s]+$/g, "").trim()
  const right = next.replace(/^[.,;:\s]+/, "").trim()
  if (looksLikeNumberListTail(left) && looksLikeNumberListHead(right)) return `${left} and ${right}`
  if (/^(and|or)\b/i.test(right)) return `${left} ${right}`
  return `${left} ${right}`
}

/** Rejoin list fragments that were split across two inclusion lines. */
export function stitchBrochureIncludes(items: string[]): string[] {
  const out: string[] = []
  for (const raw of items) {
    const item = raw.replace(/\s+/g, " ").trim()
    if (!item) continue
    const previous = out[out.length - 1]
    if (!previous) {
      out.push(item)
      continue
    }
    const numberList = looksLikeNumberListTail(previous) && looksLikeNumberListHead(item)
    const danglingPrev = !isFinishedBrochurePhrase(previous) && /^(and|or|from|of|to|with)\b/i.test(item)
    if (numberList || danglingPrev) {
      out[out.length - 1] = joinBrochureFragments(previous, item)
    } else {
      out.push(item)
    }
  }
  return out
}

function trimFinishedBrochurePhrase(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean)
  while (words.length > 1 && !isFinishedBrochurePhrase(words.join(" "))) words.pop()
  return words.join(" ").replace(/[.,;:\s-]+$/g, "").trim()
}

/** Wrap a bullet to a line budget, keeping only a finished phrase. Never uses an ellipsis. */
export function wrapFinishedLines(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const source = brochureReadable(text)
  if (!source) return [""]
  const wrapped = wrapText(source, font, size, maxWidth)
  if (wrapped.length <= maxLines && isFinishedBrochurePhrase(source)) return wrapped

  const budget = wrapped.length <= maxLines ? source : wrapped.slice(0, maxLines).join(" ")
  const words = budget.split(/\s+/).filter(Boolean)
  while (words.length > 0) {
    const candidate = trimFinishedBrochurePhrase(words.join(" "))
    if (candidate) {
      const lines = wrapText(candidate, font, size, maxWidth)
      if (
        lines.length <= maxLines &&
        isFinishedBrochurePhrase(candidate) &&
        !isUnstableBrochureCut(candidate, source)
      ) {
        return lines
      }
    }
    words.pop()
  }
  const fallback = trimFinishedBrochurePhrase(source) || source
  return wrapText(fallback, font, size, maxWidth).slice(0, maxLines)
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

export function guestGuideFilename(productName: string, raceName?: string | null): string {
  return brochureFilename(productName, raceName).replace(/-brochure\.pdf$/i, "-guest-guide.pdf")
}

export function zkBrochureFilename(productName: string, raceName?: string | null): string {
  return brochureFilename(productName, raceName).replace(/-brochure\.pdf$/i, "-zk-brochure.pdf")
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
