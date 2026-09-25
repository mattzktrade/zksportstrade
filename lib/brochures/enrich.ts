import { PACKAGE_TEMPLATES, type PackageTemplate } from "@/lib/catalog/package-templates"
import { brochurePrintText } from "@/lib/brochures/text"
import type { BrochureContent } from "@/lib/brochures/types"
import { MIN_BROCHURE_DESCRIPTION, MIN_BROCHURE_INCLUDES } from "@/lib/brochures/readiness"

const MAX_STORY_CHARS = 340

function templateById(id: string): PackageTemplate | undefined {
  return PACKAGE_TEMPLATES.find((item) => item.id === id)
}

function blob(content: BrochureContent): string {
  return `${content.productName} ${content.raceName} ${content.location ?? ""} ${content.country ?? ""}`
}

function accessDays(content: BrochureContent): number | null {
  const name = `${content.productName} ${content.durationLabel ?? ""}`
  if (/\b4\s*days?\b/i.test(name)) return 4
  if (/\b3\s*days?\b/i.test(name) || /\b3_day\b/i.test(content.durationLabel ?? "")) return 3
  if (/\b2\s*days?\b/i.test(name) || /\b2_day\b/i.test(content.durationLabel ?? "")) return 2
  if (/\b1\s*days?\b/i.test(name) || /\b1_day\b/i.test(content.durationLabel ?? "")) return 1
  return null
}

function withAccessDays(includes: string[], content: BrochureContent): string[] {
  const days = accessDays(content)
  return includes.map((item) => {
    if (!/paddock club/i.test(item) || !/\d-day/i.test(item)) return item
    if (!days) return item.replace(/\d-Day /i, "")
    return item.replace(/\d-Day /i, `${days}-Day `)
  })
}

/**
 * Official F1 Experiences programmes we already store as package templates.
 * House 44 copy is Mexico-specific and is only used when the event is Mexico.
 */
export function officialProgrammeTemplate(content: BrochureContent): PackageTemplate | null {
  const name = content.productName.toLowerCase()
  if (/house\s*44/.test(name)) {
    if (!/mexico/i.test(blob(content))) return null
    return templateById("3-day-house-44") ?? null
  }
  if (/champions\s*club/.test(name)) {
    return templateById("3-day-champions") ?? null
  }
  if (/paddock\s*club/.test(name) && !/team\s+paddock/.test(name) && !/house\s*44/.test(name)) {
    return templateById("3-day-paddock") ?? null
  }
  return null
}

export function punchyDescription(text: string, maxChars = MAX_STORY_CHARS): string {
  const safe = brochurePrintText(text)
  if (!safe) return ""
  const sentences = safe.split(/(?<=[.!?])\s+/).filter(Boolean)
  let out = ""
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence
    if (next.length > maxChars) {
      if (out) break
      const words = sentence.split(/\s+/)
      let clipped = ""
      for (const word of words) {
        const candidate = clipped ? `${clipped} ${word}` : word
        if (candidate.length > maxChars - 3) break
        clipped = candidate
      }
      return clipped ? `${clipped}...` : sentence.slice(0, maxChars)
    }
    out = next
    if (sentences.length > 1 && out.length >= 140 && out !== sentence) break
  }
  return out
}

export function enrichBrochureContent(content: BrochureContent): BrochureContent {
  const description = content.description?.trim() || ""
  const includes = content.includes.map((item) => item.trim()).filter(Boolean)
  const needsDescription = description.length < MIN_BROCHURE_DESCRIPTION
  const needsIncludes = includes.length < MIN_BROCHURE_INCLUDES
  if (!needsDescription && !needsIncludes) {
    return {
      ...content,
      description: description || null,
      includes,
    }
  }

  const programme = officialProgrammeTemplate(content)
  if (!programme) {
    return {
      ...content,
      description: description ? punchyDescription(description) || description : null,
      includes,
    }
  }

  const nextDescription = needsDescription ? programme.description : description || null
  const nextIncludes = needsIncludes ? withAccessDays(programme.includes, content) : includes
  return {
    ...content,
    description: nextDescription,
    includes: nextIncludes,
    copyEnriched: true,
  }
}
