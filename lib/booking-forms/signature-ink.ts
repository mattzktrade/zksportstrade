export type InkBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const MIN_INK_PIXELS = 16

function isInkPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 24) return false
  return r < 232 || g < 232 || b < 232
}

export function signatureInkBounds(
  data: ArrayLike<number>,
  width: number,
  height: number,
): InkBounds | null {
  if (width < 1 || height < 1 || data.length < width * height * 4) return null
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let pixels = 0
  const count = width * height
  for (let i = 0; i < count; i++) {
    const offset = i * 4
    if (!isInkPixel(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])) {
      continue
    }
    pixels += 1
    const x = i % width
    const y = (i / width) | 0
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (pixels < MIN_INK_PIXELS || maxX < 0) return null
  return { minX, minY, maxX, maxY }
}

export function paddedInkRect(
  bounds: InkBounds,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const pad = Math.max(
    4,
    Math.round(Math.max(bounds.maxX - bounds.minX + 1, bounds.maxY - bounds.minY + 1) * 0.08),
  )
  const x = Math.max(0, bounds.minX - pad)
  const y = Math.max(0, bounds.minY - pad)
  const right = Math.min(width, bounds.maxX + pad + 1)
  const bottom = Math.min(height, bounds.maxY + pad + 1)
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}
