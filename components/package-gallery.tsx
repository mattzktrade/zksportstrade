"use client"

import { useEffect } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { CatalogImage } from "@/components/catalog-image"
import { prefetchCatalogImages } from "@/lib/images/prefetch-catalog-image"
import { cn } from "@/lib/utils"

export function PackageGallery({
  images,
  alt,
  selectedIndex,
  onSelectIndex,
  warmCache = false,
  className,
}: {
  images: string[]
  alt: string
  selectedIndex: number
  onSelectIndex: (index: number) => void
  /** When true, prefetch optimized variants (e.g. on expand or row hover). */
  warmCache?: boolean
  className?: string
}) {
  const count = images.length

  useEffect(() => {
    if (!warmCache || count === 0) return
    prefetchCatalogImages(images, "card")
  }, [warmCache, images, count])

  if (count === 0) {
    return (
      <div className={cn("relative rounded-xl overflow-hidden bg-muted", className ?? "aspect-[16/10]")}>
        <CatalogImage src={null} alt={alt} variant="card" fill className="object-cover" />
      </div>
    )
  }

  return (
    <div className={cn("relative rounded-xl overflow-hidden group", className ?? "aspect-[16/10]")}>
      {images.map((src, i) => (
        <CatalogImage
          key={`${i}-${src}`}
          src={src}
          alt={i === selectedIndex ? alt : ""}
          variant="card"
          fill
          priority={i === 0}
          loading={i <= 2 ? "eager" : "lazy"}
          className={cn(
            "object-cover transition-opacity duration-150",
            i === selectedIndex ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none",
          )}
          aria-hidden={i !== selectedIndex}
        />
      ))}

      {count > 1 ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSelectIndex(selectedIndex === 0 ? count - 1 : selectedIndex - 1)
            }}
            className="absolute left-2 top-1/2 z-20 -translate-y-1/2 p-1.5 sm:p-2 bg-zk-black/50 hover:bg-zk-black/70 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Previous image"
          >
            <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSelectIndex(selectedIndex === count - 1 ? 0 : selectedIndex + 1)
            }}
            className="absolute right-2 top-1/2 z-20 -translate-y-1/2 p-1.5 sm:p-2 bg-zk-black/50 hover:bg-zk-black/70 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Next image"
          >
            <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
          </button>
          <div className="absolute bottom-2 right-2 z-20 px-2 py-1 bg-zk-black/50 rounded text-[10px] sm:text-xs text-white">
            {selectedIndex + 1} / {count}
          </div>
        </>
      ) : null}
    </div>
  )
}
