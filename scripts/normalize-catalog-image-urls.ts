/**
 * One-off: upgrade stored package image / gallery URLs (e.g. Wix w_284 thumbnails).
 * Run: npx tsx scripts/normalize-catalog-image-urls.ts
 */
import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"
import {
  normalizeCatalogImageUrl,
  normalizeCatalogImageUrlList,
  toDisplayImageUrl,
} from "../lib/images/display-image-url"

dotenv.config({ path: ".env.local" })

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: rows, error } = await sb.from("packages").select("id, name, image, gallery_images")
  if (error) throw error

  let updated = 0
  for (const row of rows ?? []) {
    const image =
      typeof row.image === "string" ? normalizeCatalogImageUrl(row.image) : null
    const gallery = Array.isArray(row.gallery_images)
      ? normalizeCatalogImageUrlList(row.gallery_images as string[])
      : []

    const imageChanged =
      typeof row.image === "string" &&
      row.image.trim() &&
      image !== row.image.trim()
    const galleryChanged =
      Array.isArray(row.gallery_images) &&
      JSON.stringify(gallery) !== JSON.stringify(row.gallery_images)

    if (!imageChanged && !galleryChanged) continue

    const { error: upErr } = await sb
      .from("packages")
      .update({ image, gallery_images: gallery })
      .eq("id", row.id)
    if (upErr) {
      console.error(row.name, upErr.message)
      continue
    }
    updated++
    if (imageChanged && row.image) {
      console.log(row.name)
      console.log("  was:", row.image.slice(0, 100))
      console.log("  now:", toDisplayImageUrl(row.image).slice(0, 100))
    }
  }

  console.log(`Updated ${updated} package(s).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
