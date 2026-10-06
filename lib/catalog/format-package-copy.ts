/** Turn pasted supplier copy into a portal description and one inclusion per line. */

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "your",
  "you",
  "are",
  "was",
  "all",
  "its",
  "it's",
  "into",
  "over",
  "than",
  "then",
  "also",
  "have",
  "has",
  "will",
  "our",
  "their",
])

const SENTENCE_LEAD =
  /^(this|that|it|it's|its|you|you'll|your|we|we're|our|if|when|as|located|enjoy|experience|watch|get|go|stroll|indulge|take|step|from|with|the|a|an)\b/i

const SALES_PITCH =
  /^(if you are looking|look no further|we are your official|this is your chance|this is it\b|this is the most exclusive|this is the best place to watch)\b/i

export type FormattedPackageCopy = {
  description: string
  includes: string[]
}

export function formatPackageCopy(raw: string): FormattedPackageCopy {
  const cleaned = cleanRaw(raw)
  if (!cleaned) return { description: "", includes: [] }

  const explicit = splitExplicitBullets(cleaned)
  const prose = explicit ? explicit.prose : cleaned
  const paragraphs = prose
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)

  const kept = dropSalesParagraphs(dropTeaserParagraphs(paragraphs))
  const source = kept.length > 0 ? kept : paragraphs
  const description = source.filter((paragraph) => !isSectionHeading(paragraph)).join("\n\n")
  const includes = dedupeIncludes([
    ...(explicit?.bullets ?? []),
    ...extractIncludes(source),
  ])

  return { description: description || source.join("\n\n"), includes }
}

function cleanRaw(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function splitExplicitBullets(text: string): { prose: string; bullets: string[] } | null {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean)
  const bulletLines = lines.filter((line) => /^([-*•]|\d+[.)])\s+\S/.test(line))
  if (bulletLines.length < 3 || bulletLines.length < lines.length / 2) return null
  const bullets = bulletLines.map((line) => tidyBullet(line.replace(/^([-*•]|\d+[.)])\s+/, "")))
  const leftover = lines
    .filter((line) => !/^([-*•]|\d+[.)])\s+\S/.test(line))
    .join("\n\n")
  return { prose: leftover, bullets: bullets.filter(Boolean) }
}

function dropTeaserParagraphs(paragraphs: string[]): string[] {
  return paragraphs.filter((paragraph, index) => {
    const later = paragraphs.slice(index + 1).join(" ")
    if (!later) return true
    return !isCoveredByLaterCopy(paragraph, later)
  })
}

function dropSalesParagraphs(paragraphs: string[]): string[] {
  return paragraphs.filter((paragraph) => {
    const sentences = splitSentences(paragraph)
    if (sentences.length === 0) return true
    return sentences.some((sentence) => !isSalesPitch(sentence))
  })
}

function isCoveredByLaterCopy(paragraph: string, later: string): boolean {
  const current = contentTokens(paragraph)
  const rest = contentTokens(later)
  if (current.size < 5) return false
  let hits = 0
  for (const token of current) {
    if (rest.has(token)) hits += 1
  }
  return hits / current.size >= 0.7 && later.length > paragraph.length
}

function contentTokens(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .replace(/[®™'’]/g, "")
    .split(/[^a-z0-9]+/)
    .map((token) => token.replace(/(ing|ed|s)$/i, ""))
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
  return new Set(tokens)
}

function extractIncludes(paragraphs: string[]): string[] {
  const bullets: string[] = []
  let heading: string | null = null

  const push = (item: string) => {
    const bullet = tidyBullet(item)
    if (!bullet) return
    if (heading) {
      bullets.push(withHeading(heading, bullet))
      heading = null
      return
    }
    bullets.push(bullet)
  }

  for (const paragraph of paragraphs) {
    if (isSectionHeading(paragraph)) {
      heading = tidyBullet(paragraph)
      continue
    }
    for (const sentence of splitSentences(paragraph)) {
      if (isSectionHeading(sentence)) {
        heading = tidyBullet(sentence)
        continue
      }
      if (isSalesPitch(sentence)) continue
      for (const part of sentenceToBullets(sentence)) push(part)
    }
  }

  return stitchIncludeFragments(bullets)
}

function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function sentenceToBullets(sentence: string): string[] {
  if (/^(get ready for|welcome to|experience the)\b/i.test(sentence) && !/,\s+(and|or)\s+/i.test(sentence)) {
    return []
  }
  const withoutLead = stripLeadIn(sentence)
  const parts = splitList(withoutLead)
  const bullets = (parts.length > 1 ? parts : [withoutLead]).map(tidyBullet).filter(Boolean)
  return bullets.length > 0 ? bullets : [tidyBullet(sentence)].filter(Boolean)
}

function stripLeadIn(sentence: string): string {
  return sentence
    .replace(/^(get ready for|experience|enjoy|indulge in|this ticket includes|all this,?\s+paired with|watch)\s+/i, "")
    .replace(/^(a|an|the)\s+/i, (match) => match)
}

const LIST_CONTINUATION =
  /^(from|including|include|with|featuring|fitted|such|where|which|who|between|offering|through|to|led|located|positioned|based)\b/i

const BENEFIT_WORD =
  /\b(access|tour|walk|dining|bar|view|views|terrace|suite|photo|trophy|concerts?|simulators?|host|hosts)\b/i

function splitList(sentence: string): string[] {
  if (/\bincluding\b/i.test(sentence)) return [sentence]
  const marked = sentence
    .replace(/(?<!\d),\s+and\s+(?!\d{1,2}\b)/gi, "||")
    .replace(/(?<!\d),\s+or\s+(?!\d{1,2}\b)/gi, "||")
    .replace(/;\s+/g, "||")
    .replace(/,\s+(?=general admission\b|access to\b|entry to\b)/gi, "||")
  if (!marked.includes("||")) return [sentence]
  const parts = marked
    .split("||")
    .map((part) => part.trim())
    .filter((part) => part.length >= 8 && !LIST_CONTINUATION.test(part))
  if (parts.length < 2) return [sentence]
  if (parts.some((part) => isShortListTail(part))) return [sentence]
  return parts
}

function isShortListTail(part: string): boolean {
  const words = part.split(/\s+/).filter(Boolean)
  if (words.length > 4) return false
  return !BENEFIT_WORD.test(part)
}

function isSectionHeading(text: string): boolean {
  const value = text.replace(/[.!?]+$/g, "").trim()
  if (!value || /[.!?]/.test(value) || SENTENCE_LEAD.test(value)) return false
  const words = value.split(/\s+/).filter(Boolean)
  if (words.length < 2 || words.length > 8 || value.length > 60) return false
  const hasColon = /:\s+\S/.test(value)
  const hasAmp = /(?:\s|^)&(?:\s|$)/.test(value) || / & /.test(value)
  const contentWords = words.filter((word) => !/^(and|or|the|a|an|of|to|for|in|on|&)$/i.test(word))
  const capped = contentWords.filter((word) => /^[A-Z]/.test(word)).length
  const titleCase = contentWords.length > 0 && capped >= Math.ceil(contentWords.length * 0.7)
  if (hasColon || hasAmp) return true
  return titleCase && words.length >= 4
}

function isSalesPitch(sentence: string): boolean {
  return (
    SALES_PITCH.test(sentence) ||
    /\b(official source for|look no further for|tickets over the track|more than just a race)\b/i.test(sentence)
  )
}

function withHeading(heading: string, bullet: string): string {
  const title = heading.replace(/[.]+$/g, "").trim()
  if (!title) return bullet
  if (normalizeKey(bullet).includes(normalizeKey(title))) return bullet
  if (title.includes(":")) return `${title} - ${bullet}`
  return `${title}: ${bullet}`
}

function looksLikeNumberListTail(text: string): boolean {
  const trimmed = text.replace(/[.,;:\s]+$/g, "").trim()
  return /(?:\bturns?\s+)?(?:\d{1,2}\s*,\s*)+\d{1,2}$/i.test(trimmed) || /\bturns?\s+\d{1,2}$/i.test(trimmed)
}

function stitchIncludeFragments(items: string[]): string[] {
  const out: string[] = []
  for (const raw of items) {
    const item = raw.replace(/\s+/g, " ").trim()
    if (!item) continue
    const previous = out[out.length - 1]
    if (
      previous &&
      looksLikeNumberListTail(previous) &&
      /^\d{1,2}\b/.test(item)
    ) {
      out[out.length - 1] = `${previous.replace(/[.,;:\s]+$/g, "")} and ${item}`
      continue
    }
    out.push(item)
  }
  return out
}

function tidyBullet(value: string): string {
  let bullet = value.replace(/\s+/g, " ").trim()
  bullet = bullet.replace(/^(and|or|maybe even)\s+/i, "")
  bullet = bullet.replace(/[.!]+$/g, "").trim()
  if (!bullet) return ""
  return bullet.charAt(0).toUpperCase() + bullet.slice(1)
}

function dedupeIncludes(bullets: string[]): string[] {
  const kept: string[] = []
  for (const bullet of bullets) {
    const key = normalizeKey(bullet)
    if (!key) continue
    const existingIndex = kept.findIndex((item) => {
      const existing = normalizeKey(item)
      return existing === key || existing.includes(key) || key.includes(existing)
    })
    if (existingIndex === -1) {
      kept.push(bullet)
      continue
    }
    if (bullet.length > kept[existingIndex].length) kept[existingIndex] = bullet
  }
  return kept
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[®™'’.,!]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}
