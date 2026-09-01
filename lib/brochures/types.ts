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
  eventFamily: string
  placeHeadline: string
  dateHeadline: string | null
}

export type BrochureCreateResult =
  | { ok: true; brochureUrl: string; filename: string; replaced: boolean }
  | { ok: false; message: string; code?: "exists" | "forbidden" | "missing"; brochureUrl?: string }
