import { getImageProps } from "next/image"
import {
  toDisplayImageUrl,
  type CatalogImageVariant,
} from "@/lib/images/display-image-url"

const VARIANT_LAYOUT: Record<
  CatalogImageVariant,
  { width: number; height: number; sizes: string }
> = {
  thumb: { width: 640, height: 422, sizes: "64px" },
  card: {
    width: 1280,
    height: 845,
    sizes: "(max-width: 1024px) 100vw, (max-width: 1280px) 50vw, 33vw",
  },
  hero: { width: 1920, height: 1267, sizes: "100vw" },
}

const prefetched = new Set<string>()

/** Warm the browser + Next image optimizer cache for a catalog URL. */
export function prefetchCatalogImage(
  src: string | null | undefined,
  variant: CatalogImageVariant = "card",
): void {
  if (typeof window === "undefined") return

  const displaySrc = toDisplayImageUrl(src, { variant })
  if (displaySrc === "/placeholder.svg" || prefetched.has(displaySrc)) return
  prefetched.add(displaySrc)

  const layout = VARIANT_LAYOUT[variant]
  const { props } = getImageProps({
    src: displaySrc,
    alt: "",
    width: layout.width,
    height: layout.height,
    sizes: layout.sizes,
    quality: 82,
  })

  const img = new window.Image()
  if (props.srcSet) img.srcset = props.srcSet
  if (typeof props.src === "string") img.src = props.src
}

export function prefetchCatalogImages(
  sources: string[],
  variant: CatalogImageVariant = "card",
): void {
  for (const src of sources) prefetchCatalogImage(src, variant)
}
