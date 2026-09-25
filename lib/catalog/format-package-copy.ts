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

  const kept = dropTeaserParagraphs(paragraphs)
  const description = kept.join("\n\n")
  const includes = dedupeIncludes([
    ...(explicit?.bullets ?? []),
    ...extractIncludes(kept.length > 0 ? kept : paragraphs),
  ])

  return { description, includes }
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
  const prose = lines
    .filter((line) => !/^([-*•]|\d+[.)])\s+\S/.test(line))
    .join("\n\n")
  return { prose, bullets: bullets.filter(Boolean) }
}

function dropTeaserParagraphs(paragraphs: string[]): string[] {
  return paragraphs.filter((paragraph, index) => {
    const later = paragraphs.slice(index + 1).join(" ")
    if (!later) return true
    return !isCoveredByLaterCopy(paragraph, later)
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
  for (const paragraph of paragraphs) {
    for (const sentence of splitSentences(paragraph)) {
      bullets.push(...sentenceToBullets(sentence))
    }
  }
  return bullets
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

function splitList(sentence: string): string[] {
  const marked = sentence
    .replace(/,\s+and\s+/gi, "||")
    .replace(/,\s+or\s+/gi, "||")
    .replace(/;\s+/g, "||")
    .replace(/,\s+(?=general admission\b|access to\b|entry to\b)/gi, "||")
  if (!marked.includes("||")) return [sentence]
  const parts = marked
    .split("||")
    .map((part) => part.trim())
    .filter((part) => part.length >= 8 && !LIST_CONTINUATION.test(part))
  return parts.length >= 2 ? parts : [sentence]
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
