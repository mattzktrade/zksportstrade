import { sendXeroInvoiceEmail } from "@/lib/email/send-xero-invoice"
import { enqueueOpportunityOutcomeServer } from "@/lib/integrations/enqueue-server"
import { attachInvoicePdfToOpportunity } from "@/lib/integrations/salesforce/invoice-file"
import { xeroFetchInvoicePdf, xeroRequest } from "@/lib/integrations/xero/client"
import {
  getXeroInvoiceLineDefaults,
  resolveXeroInvoiceCurrency,
} from "@/lib/integrations/xero/invoice-line-defaults"
import { createAdminClient } from "@/lib/supabase/admin"

type XeroContact = { ContactID?: string; Name?: string; EmailAddress?: string }
type XeroInvoice = {
  InvoiceID?: string
  InvoiceNumber?: string
  Status?: string
}
type XeroItem = { Code?: string; Name?: string; IsSold?: boolean }
type XeroBillingAddress = {
  line1?: string | null
  line2?: string | null
  city?: string | null
  postcode?: string | null
  country?: string | null
}

let cachedInvoiceItemCode: string | null | undefined

/** Default on; set env to `false` to create DRAFT invoices or skip email. */
function xeroInvoiceAutoAuthorise(): boolean {
  return process.env.XERO_INVOICE_AUTO_AUTHORISE !== "false"
}

function xeroInvoiceEmailOnCreate(): boolean {
  return process.env.XERO_INVOICE_EMAIL_ON_CREATE !== "false"
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatXeroRaceLabel(input: {
  raceName?: string | null
  circuit?: string | null
  eventDate?: string | null
}): string | null {
  const rawName = input.raceName?.trim() || input.circuit?.trim()
  if (!rawName) return null

  const eventName = rawName.replace(/\s+Grand Prix$/i, " F1 GP")
  const year = input.eventDate?.trim().slice(0, 4)
  if (year && /^\d{4}$/.test(year) && !eventName.includes(year)) {
    return `${year} ${eventName}`
  }
  return eventName
}

function isAbuDhabiEvent(input: {
  raceId?: string | null
  raceName?: string | null
  circuit?: string | null
  country?: string | null
  countryCode?: string | null
}): boolean {
  return [input.raceId, input.raceName, input.circuit, input.country, input.countryCode]
    .some((value) => {
      const normalized = value?.trim().toLowerCase()
      return normalized === "uae" || normalized?.includes("abu dhabi") || normalized?.includes("abudhabi")
    })
}

function buildXeroAddresses(address?: XeroBillingAddress): Array<Record<string, string>> | undefined {
  const line1 = address?.line1?.trim()
  const line2 = address?.line2?.trim()
  const city = address?.city?.trim()
  const postcode = address?.postcode?.trim()
  const country = address?.country?.trim()
  if (!line1 && !line2 && !city && !postcode && !country) return undefined

  return [
    {
      AddressType: "POBOX",
      ...(line1 ? { AddressLine1: line1 } : {}),
      ...(line2 ? { AddressLine2: line2 } : {}),
      ...(city ? { City: city } : {}),
      ...(postcode ? { PostalCode: postcode } : {}),
      ...(country ? { Country: country } : {}),
    },
  ]
}

async function findOrCreateXeroContact(input: {
  name: string
  email: string
  phone?: string
  billingAddress?: XeroBillingAddress
}): Promise<string> {
  const email = input.email.trim().toLowerCase()
  const addresses = buildXeroAddresses(input.billingAddress)
  const where = encodeURIComponent(`EmailAddress=="${email}"`)
  const found = await xeroRequest<{ Contacts?: XeroContact[] }>(
    "GET",
    `/api.xro/2.0/Contacts?where=${where}`,
  )
  const existingId = found.Contacts?.[0]?.ContactID
  if (existingId) {
    if (addresses) {
      await xeroRequest("POST", "/api.xro/2.0/Contacts", {
        body: {
          Contacts: [
            {
              ContactID: existingId,
              Addresses: addresses,
            },
          ],
        },
      })
    }
    return existingId
  }

  const created = await xeroRequest<{ Contacts?: XeroContact[] }>("POST", "/api.xro/2.0/Contacts", {
    body: {
      Contacts: [
        {
          Name: input.name.trim() || email,
          EmailAddress: email,
          Phones: input.phone?.trim()
            ? [{ PhoneType: "DEFAULT", PhoneNumber: input.phone.trim() }]
            : undefined,
          Addresses: addresses,
        },
      ],
    },
  })
  const id = created.Contacts?.[0]?.ContactID
  if (!id) throw new Error("Xero did not return a ContactID.")
  return id
}

async function resolveXeroInvoiceItemCode(): Promise<string | undefined> {
  if (cachedInvoiceItemCode !== undefined) return cachedInvoiceItemCode ?? undefined

  const preferred = process.env.XERO_INVOICE_ITEM_CODE?.trim() || "1001"
  try {
    const res = await xeroRequest<{ Items?: XeroItem[] }>("GET", "/api.xro/2.0/Items")
    const items = res.Items ?? []
    const match =
      items.find((item) => item.Code?.trim().toLowerCase() === preferred.toLowerCase() && item.IsSold !== false) ??
      items.find((item) => item.Name?.trim().toLowerCase() === "tickets" && item.IsSold !== false)
    cachedInvoiceItemCode = match?.Code?.trim() || null
  } catch (e) {
    cachedInvoiceItemCode = null
    console.warn("[xero] Invoice item lookup skipped:", e instanceof Error ? e.message : e)
  }

  return cachedInvoiceItemCode ?? undefined
}

/** Best-effort: attach Xero invoice PDF to the linked Salesforce Opportunity. */
async function syncInvoicePdfToSalesforce(orderId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return

  const { data: order } = await admin
    .from("orders")
    .select("reference, salesforce_opportunity_id")
    .eq("id", orderId)
    .maybeSingle()
  const opportunityId = order?.salesforce_opportunity_id?.trim()
  if (!order || !opportunityId) return

  const { data: inv } = await admin
    .from("invoices")
    .select("xero_invoice_id, xero_invoice_number")
    .eq("order_id", orderId)
    .maybeSingle()
  if (!inv?.xero_invoice_id) return

  try {
    const pdf = await xeroFetchInvoicePdf(inv.xero_invoice_id)
    await attachInvoicePdfToOpportunity({
      opportunityId,
      orderReference: order.reference,
      xeroInvoiceNumber: inv.xero_invoice_number ?? null,
      pdf,
    })
  } catch (e) {
    console.warn(
      "[salesforce] Invoice PDF attach skipped:",
      e instanceof Error ? e.message : e,
    )
  }
}

/**
 * Creates an ACCREC invoice in Xero for a portal order and marks portal invoice awaiting_payment.
 */
export async function createXeroInvoiceForOrder(orderId: string): Promise<{
  xeroInvoiceId: string
  xeroInvoiceNumber: string | null
}> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")

  const { data: order, error: orderErr } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle()
  if (orderErr) throw new Error(orderErr.message)
  if (!order) throw new Error(`Order ${orderId} not found.`)

  if (order.channel === "wix") {
    throw new Error("Wix orders are prepaid at checkout — Xero invoice creation is skipped.")
  }

  const { data: inv, error: invErr } = await admin
    .from("invoices")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle()
  if (invErr) throw new Error(invErr.message)
  if (!inv) throw new Error("Invoice row not found for order.")

  if (inv.xero_invoice_id) {
    await syncInvoicePdfToSalesforce(orderId)
    return { xeroInvoiceId: inv.xero_invoice_id, xeroInvoiceNumber: inv.xero_invoice_number ?? null }
  }

  const { data: agent } = await admin
    .from("profiles")
    .select("company_name, full_name, email")
    .eq("id", order.agent_profile_id)
    .maybeSingle()

  const { data: pkg } = await admin
    .from("packages")
    .select("name, circuit, race_id, event_date, country, country_code")
    .eq("id", order.package_id)
    .maybeSingle()

  const { data: race } = pkg?.race_id
    ? await admin.from("races").select("name, event_date, country, country_code").eq("id", pkg.race_id).maybeSingle()
    : { data: null }

  const billToName = (agent?.company_name || agent?.full_name || agent?.email || "Trade partner").trim()
  const contactId = await findOrCreateXeroContact({
    name: billToName,
    email: agent?.email ?? order.client_email,
    phone: order.client_phone,
    billingAddress: {
      line1: order.billing_address_line1,
      line2: order.billing_address_line2,
      city: order.billing_city,
      postcode: order.billing_postcode,
      country: order.billing_country,
    },
  })

  const today = new Date().toISOString().slice(0, 10)
  const dueDays = Number(process.env.XERO_INVOICE_DUE_DAYS ?? "7")
  const dueDate = addDays(today, Number.isFinite(dueDays) ? dueDays : 7)

  const packageName = pkg?.name ?? "Package"
  const raceLabel = formatXeroRaceLabel({
    raceName: race?.name,
    circuit: pkg?.circuit,
    eventDate: race?.event_date ?? pkg?.event_date,
  })
  const description = `${packageName}${raceLabel ? ` (${raceLabel})` : ""}`
  const { accountCode, taxType } = await getXeroInvoiceLineDefaults()
  const currencyCode = await resolveXeroInvoiceCurrency(String(order.currency ?? "USD"))
  const itemCode = await resolveXeroInvoiceItemCode()
  const autoAuthorise = xeroInvoiceAutoAuthorise()
  const includesAbuDhabiTax = isAbuDhabiEvent({
    raceId: pkg?.race_id,
    raceName: race?.name,
    circuit: pkg?.circuit,
    country: race?.country ?? pkg?.country,
    countryCode: race?.country_code ?? pkg?.country_code,
  })
  const lineAmountTypes = includesAbuDhabiTax ? "Inclusive" : "Exclusive"
  const lineTaxType = includesAbuDhabiTax
    ? process.env.XERO_ABU_DHABI_TAX_TYPE?.trim() || "TAX001"
    : taxType

  const result = await xeroRequest<{ Invoices?: XeroInvoice[] }>("POST", "/api.xro/2.0/Invoices", {
    body: {
      Invoices: [
        {
          Type: "ACCREC",
          Contact: { ContactID: contactId },
          Date: today,
          DueDate: dueDate,
          Reference: order.reference,
          ...(currencyCode ? { CurrencyCode: currencyCode } : {}),
          LineAmountTypes: lineAmountTypes,
          Status: autoAuthorise ? "AUTHORISED" : "DRAFT",
          ...(autoAuthorise ? { SentToContact: true } : {}),
          LineItems: [
            {
              ...(itemCode ? { ItemCode: itemCode } : {}),
              Description: description,
              Quantity: Number(order.guests),
              UnitAmount: Number(order.unit_price),
              AccountCode: accountCode,
              TaxType: lineTaxType,
            },
          ],
        },
      ],
    },
  })

  const xeroInv = result.Invoices?.[0]
  if (!xeroInv?.InvoiceID) throw new Error("Xero did not return InvoiceID.")

  if (xeroInvoiceEmailOnCreate() && xeroInv.Status === "AUTHORISED") {
    const emailResult = await sendXeroInvoiceEmail({
      agentEmail: agent?.email ?? order.client_email,
      agentName: billToName,
      orderReference: order.reference,
      xeroInvoiceId: xeroInv.InvoiceID,
      xeroInvoiceNumber: xeroInv.InvoiceNumber ?? null,
      packageName,
      clientName: order.client_name,
      guests: Number(order.guests),
      totalAmount: Number(order.total_amount),
      currency: order.currency,
      dueDate,
    })
    if (!emailResult.ok) {
      console.warn(
        "[xero] Invoice email via Resend failed:",
        emailResult.error ?? emailResult.skipped ?? "unknown",
      )
      try {
        await xeroRequest("POST", `/api.xro/2.0/Invoices/${xeroInv.InvoiceID}/Email`, { body: {} })
        console.warn("[xero] Fell back to Xero email API (no CC support).")
      } catch (e) {
        console.warn("[xero] Invoice email send skipped:", e instanceof Error ? e.message : e)
      }
    }
  }

  const issuedAt = new Date().toISOString()
  const { error: upErr } = await admin
    .from("invoices")
    .update({
      xero_invoice_id: xeroInv.InvoiceID,
      xero_invoice_number: xeroInv.InvoiceNumber ?? null,
      xero_sync_status: "synced",
      xero_synced_at: issuedAt,
      xero_sync_error: null,
      status: "awaiting_payment",
      issued_at: issuedAt,
    })
    .eq("id", inv.id)

  if (upErr) throw new Error(upErr.message)

  await syncInvoicePdfToSalesforce(orderId)

  return {
    xeroInvoiceId: xeroInv.InvoiceID,
    xeroInvoiceNumber: xeroInv.InvoiceNumber ?? null,
  }
}

/** Mark portal invoice paid when Xero shows invoice PAID. */
export async function markPortalInvoicePaidFromXero(xeroInvoiceId: string): Promise<void> {
  const remote = await xeroRequest<{ Invoices?: XeroInvoice[] }>(
    "GET",
    `/api.xro/2.0/Invoices/${encodeURIComponent(xeroInvoiceId)}`,
  )
  const status = (remote.Invoices?.[0]?.Status ?? "").toUpperCase()
  if (status !== "PAID") return

  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")

  const { data: inv, error } = await admin
    .from("invoices")
    .select("id, status, order_id")
    .eq("xero_invoice_id", xeroInvoiceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!inv) return

  if (inv.status === "paid") return

  const { error: upErr } = await admin
    .from("invoices")
    .update({ status: "paid" })
    .eq("id", inv.id)
  if (upErr) throw new Error(upErr.message)

  if (inv.order_id) {
    const enq = await enqueueOpportunityOutcomeServer(String(inv.order_id), "won")
    if (!enq.ok) console.warn("[xero webhook] Salesforce Closed Won not queued:", enq.message)
  }
}
