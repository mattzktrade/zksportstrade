import { timingSafeEqual } from "crypto"

/** Compare two strings in constant time when they are the same length. */
export function safeEqualStrings(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
