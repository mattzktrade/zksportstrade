import { getImageProps } from "next/image"
import {
  toDisplayImageUrl,
  type CatalogImageVariant,
} from "@/lib/images/display-image-url"
import { canOptimizeCatalogImage } from "@/lib/images/next-image-host"

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

function warmBrowserCache(src: string, srcSet?: string) {
  const img = new window.Image()
  if (srcSet) img.srcset = srcSet
  img.src = src
}

/** Warm the browser + Next image optimizer cache for a catalog URL. */
export function prefetchCatalogImage(
  src: string | null | undefined,
  variant: CatalogImageVariant = "card",
): void {
  if (typeof window === "undefined") return

  const displaySrc = toDisplayImageUrl(src, { variant })
  if (displaySrc === "/placeholder.svg" || prefetched.has(displaySrc)) return
  prefetched.add(displaySrc)

  if (!canOptimizeCatalogImage(displaySrc)) {
    warmBrowserCache(displaySrc)
    return
  }

  const layout = VARIANT_LAYOUT[variant]
  try {
    const { props } = getImageProps({
      src: displaySrc,
      alt: "",
      width: layout.width,
      height: layout.height,
      sizes: layout.sizes,
      quality: 75,
    })
    warmBrowserCache(typeof props.src === "string" ? props.src : displaySrc, props.srcSet)
  } catch {
    warmBrowserCache(displaySrc)
  }
}

export function prefetchCatalogImages(
  sources: string[],
  variant: CatalogImageVariant = "card",
): void {
  for (const src of sources) prefetchCatalogImage(src, variant)
}
