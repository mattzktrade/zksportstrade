export type CheckoutAddressFields = {
  shippingAddressLine1: string
  shippingAddressLine2: string
  shippingCity: string
  shippingPostcode: string
  shippingCountry: string
  billingAddressLine1: string
  billingAddressLine2: string
  billingCity: string
  billingPostcode: string
  billingCountry: string
}

export function emptyCheckoutAddressFields(): CheckoutAddressFields {
  return {
    shippingAddressLine1: "",
    shippingAddressLine2: "",
    shippingCity: "",
    shippingPostcode: "",
    shippingCountry: "",
    billingAddressLine1: "",
    billingAddressLine2: "",
    billingCity: "",
    billingPostcode: "",
    billingCountry: "",
  }
}

export function checkoutDefaultsFromProfile(profile: {
  shipping_address_line1?: string | null
  shipping_address_line2?: string | null
  shipping_city?: string | null
  shipping_postcode?: string | null
  shipping_country?: string | null
  billing_address_line1?: string | null
  billing_address_line2?: string | null
  billing_city?: string | null
  billing_postcode?: string | null
  billing_country?: string | null
}): CheckoutAddressFields {
  return {
    shippingAddressLine1: profile.shipping_address_line1 ?? "",
    shippingAddressLine2: profile.shipping_address_line2 ?? "",
    shippingCity: profile.shipping_city ?? "",
    shippingPostcode: profile.shipping_postcode ?? "",
    shippingCountry: profile.shipping_country ?? "",
    billingAddressLine1: profile.billing_address_line1 ?? "",
    billingAddressLine2: profile.billing_address_line2 ?? "",
    billingCity: profile.billing_city ?? "",
    billingPostcode: profile.billing_postcode ?? "",
    billingCountry: profile.billing_country ?? "",
  }
}
