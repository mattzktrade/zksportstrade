export type AdgpCatalogItem = {
  slug: string
  day: string
  packageId: string
  name: string
  currency: string
  unitPrice: number
  sellable: number
  buyable: boolean
  reason: string | null
}

export type AdgpHoldResult = {
  holdId: string
  expiresAt: string
  packageId: string
  packageName: string
  slug: string
  day: string
  guests: number
  unitPrice: number
  currency: string
  total: number
}

export type AdgpOrderResult =
  | {
      ok: true
      orderId: string
      orderReference: string
      dealId: string
      dealReference: string
      packageName: string
      guests: number
      totalAmount: number
      currency: string
      duplicate: boolean
    }
  | { ok: false; message: string; code?: string }

export type AdgpBuyer = {
  name: string
  email: string
  phone?: string | null
  nationality?: string | null
}

export type AdgpAddress = {
  line1?: string | null
  line2?: string | null
  city?: string | null
  postcode?: string | null
  country?: string | null
}
