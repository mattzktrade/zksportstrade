export type BrochureContent = {
  packageId: string
  productName: string
  raceName: string
  circuit: string | null
  location: string | null
  country: string | null
  dateRange: string | null
  durationLabel: string | null
  description: string | null
  includes: string[]
  productCode: string | null
  heroUrl: string | null
  galleryUrls: string[]
  trackMapUrl: string | null
  eventFamily: string
  placeHeadline: string
  dateHeadline: string | null
  /** True when missing copy was filled from an official programme template. */
  copyEnriched?: boolean
}

export type BrochureCreateErrorCode =
  | "exists"
  | "forbidden"
  | "missing"
  | "insufficient_images"
  | "insufficient_content"

export type BrochureCreateResult =
  | { ok: true; brochureUrl: string; filename: string; replaced: boolean }
  | { ok: false; message: string; code?: BrochureCreateErrorCode; brochureUrl?: string }

export class BrochureInsufficientImagesError extends Error {
  readonly code = "insufficient_images" as const

  constructor(
    public loaded: number,
    public required: number,
  ) {
    super(
      loaded === 0
        ? `Add at least ${required} unique photos (primary image plus gallery) before creating a brochure. The layout is photography-led and will not invent images.`
        : `We could only load ${loaded} usable photo${loaded === 1 ? "" : "s"} and need ${required}. Use JPEG or PNG, and add more unique photos on the product if the gallery repeats the primary image.`,
    )
    this.name = "BrochureInsufficientImagesError"
  }
}
