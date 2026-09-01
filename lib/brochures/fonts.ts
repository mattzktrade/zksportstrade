import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PDFDocument, PDFFont, StandardFonts } from "pdf-lib"

const FONT_FILES = {
  sans: "outfit-400.ttf",
  sansMedium: "outfit-600.ttf",
  condensed: "oswald-700.ttf",
  condensedMedium: "oswald-500.ttf",
} as const

const FONT_URLS: Record<keyof typeof FONT_FILES, string> = {
  sans: "https://cdn.jsdelivr.net/fontsource/fonts/outfit@5.2.5/latin-400-normal.ttf",
  sansMedium: "https://cdn.jsdelivr.net/fontsource/fonts/outfit@5.2.5/latin-600-normal.ttf",
  condensed: "https://cdn.jsdelivr.net/fontsource/fonts/oswald@5.2.5/latin-700-normal.ttf",
  condensedMedium: "https://cdn.jsdelivr.net/fontsource/fonts/oswald@5.2.5/latin-500-normal.ttf",
}

export type BrochureFonts = {
  sans: PDFFont
  sansMedium: PDFFont
  condensed: PDFFont
  condensedMedium: PDFFont
}

function fontSearchDirs(): string[] {
  return [join(process.cwd(), "lib", "brochures", "fonts"), join(tmpdir(), "zk-brochure-fonts")]
}

async function loadFontBytes(key: keyof typeof FONT_FILES): Promise<Uint8Array | null> {
  const filename = FONT_FILES[key]
  for (const dir of fontSearchDirs()) {
    try {
      const bytes = await readFile(join(dir, filename))
      if (bytes.length > 1000) return bytes
    } catch {
      /* try next */
    }
  }

  try {
    const response = await fetch(FONT_URLS[key], {
      headers: { Accept: "font/ttf,application/octet-stream,*/*" },
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length < 1000) return null
    const cacheDir = join(tmpdir(), "zk-brochure-fonts")
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, filename), bytes)
    return bytes
  } catch {
    return null
  }
}

export async function embedBrochureFonts(pdf: PDFDocument): Promise<BrochureFonts> {
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const [sansBytes, mediumBytes, condensedBytes, condensedMediumBytes] = await Promise.all([
    loadFontBytes("sans"),
    loadFontBytes("sansMedium"),
    loadFontBytes("condensed"),
    loadFontBytes("condensedMedium"),
  ])

  const embed = async (bytes: Uint8Array | null, fallback: PDFFont) => {
    if (!bytes) return fallback
    try {
      return await pdf.embedFont(bytes, { subset: true })
    } catch {
      return fallback
    }
  }

  return {
    sans: await embed(sansBytes, helvetica),
    sansMedium: await embed(mediumBytes, helveticaBold),
    condensed: await embed(condensedBytes, helveticaBold),
    condensedMedium: await embed(condensedMediumBytes, helveticaBold),
  }
}
