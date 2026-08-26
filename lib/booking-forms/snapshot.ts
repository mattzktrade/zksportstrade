import { createHash, randomBytes } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { BookingFormSnapshot } from "@/lib/booking-forms/types"
import {
  BOOKING_ACKNOWLEDGEMENT,
  BOOKING_BANK_DETAILS,
  BOOKING_LEGAL_CONTENT_VERSION,
  BOOKING_SELLER,
  BOOKING_TEMPLATE_KEY,
  BOOKING_TEMPLATE_VERSION,
  BOOKING_TERMS,
} from "@/lib/booking-forms/template"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import { bookingLineTax } from "@/lib/booking-forms/line-tax"

export { bookingLineTax }

type DealRow = {
  id: string
  reference: string
  account_id: string | null
  primary_contact_id: string | null
  race_id: string | null
  currency: string
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }
  return value
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

export function generateSigningToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url")
  return { token, tokenHash: sha256(token) }
}

export function generateDocumentRef(now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "")
  return `ZK-${date}-${randomBytes(4).toString("hex").toUpperCase()}`
}

export async function buildBookingFormSnapshot(
  supabase: SupabaseClient,
  dealId: string,
  documentRef: string,
  createdAt = new Date(),
): Promise<{ snapshot: BookingFormSnapshot; snapshotHash: string }> {
  const { data: dealData, error: dealError } = await supabase
    .from("deals")
    .select("id, reference, account_id, primary_contact_id, race_id, currency")
    .eq("id", dealId)
    .maybeSingle()
  if (dealError) throw new Error(dealError.message)
  if (!dealData) throw new Error("Deal not found.")
  const deal = dealData as DealRow
  if (!deal.account_id || !deal.primary_contact_id) {
    throw new Error("The deal needs an account and primary contact before creating a booking form.")
  }

  const [{ data: account, error: accountError }, { data: contact, error: contactError }, linesResult] =
    await Promise.all([
      supabase
        .from("crm_accounts")
        .select(
          "id, name, billing_address_line1, billing_address_line2, billing_city, billing_postcode, billing_country",
        )
        .eq("id", deal.account_id)
        .maybeSingle(),
      supabase
        .from("crm_contacts")
        .select("id, account_id, full_name, email")
        .eq("id", deal.primary_contact_id)
        .maybeSingle(),
      supabase
        .from("deal_line_items")
        .select("id, package_id, quantity, unit_sale_price, currency, sort_order")
        .eq("deal_id", deal.id)
        .order("sort_order"),
    ])
  if (accountError) throw new Error(accountError.message)
  if (contactError) throw new Error(contactError.message)
  if (linesResult.error) throw new Error(linesResult.error.message)
  if (!account || !contact) throw new Error("The deal account or contact no longer exists.")
  if (contact.account_id !== account.id) throw new Error("The primary contact is not linked to the deal account.")
  if (!contact.email?.trim()) throw new Error("The primary contact needs an email address.")
  if (!linesResult.data?.length) throw new Error("Add at least one product before creating a booking form.")

  const packageIds = [...new Set(linesResult.data.map((line) => String(line.package_id)))]
  const { data: packages, error: packageError } = await supabase
    .from("packages")
    .select("id, name, race_id")
    .in("id", packageIds)
  if (packageError) throw new Error(packageError.message)
  const packageMap = new Map((packages ?? []).map((pkg) => [String(pkg.id), pkg]))
  if (packageMap.size !== packageIds.length) throw new Error("One or more deal products no longer exist.")

  const raceIds = [
    ...new Set(
      [deal.race_id, ...(packages ?? []).map((pkg) => pkg.race_id)]
        .filter(Boolean)
        .map(String),
    ),
  ]
  const { data: races, error: raceError } = raceIds.length
    ? await supabase.from("races").select("id, name, season").in("id", raceIds)
    : { data: [], error: null }
  if (raceError) throw new Error(raceError.message)
  const raceMap = new Map(
    (races ?? []).map((race) => [
      String(race.id),
      eventSeasonLabel(String(race.name), Number(race.season)),
    ]),
  )

  const currencies = new Set(linesResult.data.map((line) => String(line.currency || deal.currency || "USD")))
  if (currencies.size !== 1) throw new Error("All booking-form products must use the same currency.")
  const currency = [...currencies][0]
  if (currency.toUpperCase() !== "USD") {
    throw new Error("ZK booking forms must be issued in USD.")
  }
  const lines = linesResult.data.map((line) => {
    const pkg = packageMap.get(String(line.package_id))!
    const eventName = raceMap.get(String(pkg.race_id)) ?? "Event"
    const quantity = Number(line.quantity)
    const unitPrice = Number(line.unit_sale_price)
    const lineTotal = quantity * unitPrice
    const { taxRate, taxAmountIncluded } = bookingLineTax(eventName, lineTotal)
    return {
      dealLineItemId: String(line.id),
      packageId: String(line.package_id),
      eventName,
      packageName: String(pkg.name),
      description: `${eventName} — ${String(pkg.name)}`,
      quantity,
      unitPrice,
      lineTotal,
      currency,
      taxRate,
      taxAmountIncluded,
    }
  })
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0)
  const taxedLines = lines.filter((line) => line.taxRate > 0)
  const taxRate = taxedLines.length === lines.length ? 0.05 : 0
  const taxAmountIncluded = taxedLines.reduce(
    (sum, line) => sum + line.taxAmountIncluded,
    0,
  )
  const eventNames = [...new Set(lines.map((line) => line.eventName))]

  const addressLines = [
    account.billing_address_line1,
    account.billing_address_line2,
    [account.billing_city, account.billing_postcode]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(", "),
    account.billing_country,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)

  const snapshot: BookingFormSnapshot = {
    schemaVersion: 1,
    template: {
      key: BOOKING_TEMPLATE_KEY,
      version: BOOKING_TEMPLATE_VERSION,
      legalContentVersion: BOOKING_LEGAL_CONTENT_VERSION,
    },
    documentRef,
    createdAt: createdAt.toISOString(),
    deal: {
      id: deal.id,
      title: eventNames.length > 0 ? eventNames.join(", ") : deal.reference,
    },
    seller: BOOKING_SELLER,
    billTo: {
      accountId: String(account.id),
      accountName: String(account.name),
      contactId: String(contact.id),
      contactName: String(contact.full_name),
      contactEmail: String(contact.email).trim().toLowerCase(),
      addressLines,
    },
    lines,
    currency,
    subtotal,
    taxRate,
    taxAmountIncluded,
    taxDescription:
      taxedLines.length === 0
        ? undefined
        : taxedLines.length === lines.length
          ? "VAT included (5%)"
          : "VAT included (5% on Abu Dhabi products only)",
    total: subtotal,
    paymentTerms: `${currency} ${subtotal.toFixed(2)} (100.00%) due upon signing, all tax included.`,
    paymentMethod: "Wire Transfer",
    bankDetails: BOOKING_BANK_DETAILS,
    acknowledgement: BOOKING_ACKNOWLEDGEMENT,
    terms: BOOKING_TERMS,
  }

  return { snapshot, snapshotHash: sha256(stableJson(snapshot)) }
}

