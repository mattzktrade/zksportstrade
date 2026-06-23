import Image, { type ImageProps } from "next/image"
import {
  toDisplayImageUrl,
  type CatalogImageVariant,
} from "@/lib/images/display-image-url"
import { cn } from "@/lib/utils"

type CatalogImageProps = Omit<ImageProps, "src"> & {
  src: string | null | undefined
  /** Controls CDN max width (thumb / card / hero). */
  variant?: CatalogImageVariant
}

/**
 * Cover-style catalog image: CDN-sized sources + Next.js responsive WebP/AVIF.
 */
export function CatalogImage({
  src,
  variant = "card",
  className,
  sizes,
  alt,
  fill,
  quality = 82,
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
