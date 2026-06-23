/** Variants for matching SF ProductCode (e.g. PR-000020 vs PR - 000020). */
export function productCodeLookupVariants(code: string): string[] {
  const c = code.trim()
  if (!c) return []
  const variants = new Set<string>([c])
  const compact = c.replace(/\s+/g, "")
  if (compact !== c) variants.add(compact)

  const m = compact.match(/^PR-?(\d+)$/i)
  if (m) {
    const digits = m[1]
    variants.add(`PR - ${digits}`)
    if (digits.length < 6) {
      variants.add(`PR - ${digits.padStart(6, "0")}`)
    }
  }

  return [...variants]
}
