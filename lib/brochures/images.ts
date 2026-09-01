import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { PDFDocument, PDFImage, PDFPage } from "pdf-lib"
import {
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
} from "pdf-lib"
import { toDisplayImageUrl } from "@/lib/images/display-image-url"

const WIX_MEDIA_BASE =
  /^https:\/\/static\.wixstatic\.com\/media\/([^/]+~mv2\.\w+)(?:\/v1\/[^?#]*)?(?:\?.*)?$/i

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const FETCH_TIMEOUT_MS = 12_000

export function brochureImageFetchUrl(url: string, width: number): string {
  const trimmed = url.trim()
  if (trimmed.startsWith("/")) return trimmed
  const match = trimmed.match(WIX_MEDIA_BASE)
  if (match) {
    const file = match[1]
    const height = Math.max(1, Math.round(width * 0.66))
    return `https://static.wixstatic.com/media/${file}/v1/fill/w_${width},h_${height},al_c,q_82,usm_0.66_1.00_0.01,enc_jpg/${file}`
  }
  return toDisplayImageUrl(trimmed, { variant: width >= 1600 ? "hero" : "card" })
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  )
}

async function readLocalPublicFile(url: string): Promise<Uint8Array | null> {
  if (!url.startsWith("/") || url.startsWith("//")) return null
  const normalized = decodeURIComponent(url)
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
  if (normalized.some((part) => part === ".." || part === "." || part.includes("\\"))) return null
  try {
    return await readFile(join(process.cwd(), "public", ...normalized))
  } catch {
    return null
  }
}

async function fetchRemoteImage(url: string): Promise<Uint8Array | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:") return null
  if (isPrivateHostname(parsed.hostname)) return null

  try {
    const response = await fetch(parsed.toString(), {
      headers: {
        Accept: "image/jpeg,image/png,image/*;q=0.8",
        "User-Agent": "ZKSportsBrochure/1.0",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    })
    if (!response.ok) return null
    const length = Number(response.headers.get("content-length") || "0")
    if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null
    return bytes
  } catch {
    return null
  }
}

export async function loadImageBytes(url: string, width: number): Promise<Uint8Array | null> {
  const fetchUrl = brochureImageFetchUrl(url, width)
  if (fetchUrl.startsWith("/")) return readLocalPublicFile(fetchUrl)
  return fetchRemoteImage(fetchUrl)
}

export async function embedRasterImage(pdf: PDFDocument, bytes: Uint8Array): Promise<PDFImage | null> {
  try {
    if (isJpeg(bytes)) return await pdf.embedJpg(bytes)
    if (isPng(bytes)) return await pdf.embedPng(bytes)
  } catch {
    return null
  }
  return null
}

export async function embedLogo(
  pdf: PDFDocument,
  filename: string,
): Promise<PDFImage | null> {
  try {
    const bytes = await readFile(join(process.cwd(), "public", "images", filename))
    return await pdf.embedPng(bytes)
  } catch {
    return null
  }
}

export function drawImageCover(
  page: PDFPage,
  image: PDFImage,
  box: { x: number; y: number; width: number; height: number },
) {
  clipRect(page, box)
  drawImageCoverUnclipped(page, image, box)
  endClip(page)
}

export function drawImageCoverUnclipped(
  page: PDFPage,
  image: PDFImage,
  box: { x: number; y: number; width: number; height: number },
) {
  const scale = Math.max(box.width / image.width, box.height / image.height)
  const width = image.width * scale
  const height = image.height * scale
  const x = box.x + (box.width - width) / 2
  const y = box.y + (box.height - height) / 2
  page.drawImage(image, { x, y, width, height })
}

export function clipRect(
  page: PDFPage,
  box: { x: number; y: number; width: number; height: number },
) {
  page.pushOperators(
    pushGraphicsState(),
    rectangle(box.x, box.y, box.width, box.height),
    clip(),
    endPath(),
  )
}

export function clipPolygon(page: PDFPage, points: Array<{ x: number; y: number }>) {
  if (points.length < 3) return
  const [first, ...rest] = points
  page.pushOperators(
    pushGraphicsState(),
    moveTo(first.x, first.y),
    ...rest.map((point) => lineTo(point.x, point.y)),
    closePath(),
    clip(),
    endPath(),
  )
}

export function endClip(page: PDFPage) {
  page.pushOperators(popGraphicsState())
}

export function polygonPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ""
  const [first, ...rest] = points
  return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(" ")} Z`
}
