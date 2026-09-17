import Image, { type ImageProps } from "next/image"
import {
  toDisplayImageUrl,
  type CatalogImageVariant,
} from "@/lib/images/display-image-url"
import { canOptimizeCatalogImage } from "@/lib/images/next-image-host"
import { cn } from "@/lib/utils"

type CatalogImageProps = Omit<ImageProps, "src"> & {
  src: string | null | undefined
  /** Controls CDN max width (thumb / card / hero). */
  variant?: CatalogImageVariant
}

/**
 * Cover-style catalog image: CDN-sized sources + Next.js responsive WebP/AVIF.
 * Unlisted remote hosts render as a native img so unknown gallery URLs never crash.
 */
export function CatalogImage({
  src,
  variant = "card",
  className,
  sizes,
  alt,
  fill,
  quality = 75,
  ...rest
}: CatalogImageProps) {
  const displaySrc = toDisplayImageUrl(src, { variant })
  const resolvedSizes =
    sizes ??
    (fill
      ? variant === "thumb"
        ? "64px"
        : variant === "hero"
          ? "100vw"
          : "(max-width: 1024px) 100vw, (max-width: 1280px) 50vw, 33vw"
      : undefined)

  if (!canOptimizeCatalogImage(displaySrc)) {
    const { width, height, style, loading } = rest
    return (
      <img
        src={displaySrc}
        alt={alt ?? ""}
        width={fill ? undefined : width}
        height={fill ? undefined : height}
        loading={loading}
        decoding="async"
        className={cn(fill && "absolute inset-0 h-full w-full", className)}
        style={style}
      />
    )
  }

  return (
    <Image
      src={displaySrc}
      alt={alt ?? ""}
      fill={fill}
      sizes={resolvedSizes}
      quality={quality}
      className={cn(className)}
      {...rest}
    />
  )
}
