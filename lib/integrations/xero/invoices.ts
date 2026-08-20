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
  Reference?: string
  AmountDue?: number
  AmountPaid?: number
  Total?: number
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
 * Pass replaceKey after voiding the previous Xero invoice so Xero does not replay the original create.
 */
export async function createXeroInvoiceForOrder(
  orderId: string,
  options?: { replaceKey?: string },
): Promise<{
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

  if (options?.replaceKey && inv.xero_invoice_id) {
    if (inv.status === "paid" || inv.status === "delivered") {
      throw new Error("Mark the invoice unpaid before replacing it.")
    }
    await voidXeroInvoiceForOrder(orderId)
    const { error: clearErr } = await admin
      .from("invoices")
      .update({
        xero_invoice_id: null,
        xero_invoice_number: null,
        xero_sync_status: "pending",
        xero_sync_error: null,
      })
      .eq("id", inv.id)
    if (clearErr) throw new Error(clearErr.message)
    inv.xero_invoice_id = null
    inv.xero_invoice_number = null
  } else if (inv.xero_invoice_id) {
    if (order.deal_id) {
      await admin
        .from("deals")
        .update({
          stage:
            inv.status === "paid"
              ? "paid_confirmed"
              : inv.status === "awaiting_invoice"
                ? "awaiting_invoice"
                : "awaiting_payment",
          next_action:
            inv.status === "paid"
              ? "Hand over to fulfilment"
              : inv.status === "awaiting_invoice"
                ? "Authorise draft invoice in Xero"
                : "Await Xero payment",
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.deal_id)
    }
    await syncInvoicePdfToSalesforce(orderId)
    return { xeroInvoiceId: inv.xero_invoice_id, xeroInvoiceNumber: inv.xero_invoice_number ?? null }
  }

  const [
    { data: agent },
    { data: crmAccount },
    { data: crmContact },
    { data: nativeOrderLines, error: nativeLinesError },
  ] = await Promise.all([
    order.agent_profile_id
      ? admin
          .from("profiles")
          .select("company_name, full_name, email")
          .eq("id", order.agent_profile_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    order.crm_account_id
      ? admin
          .from("crm_accounts")
          .select(
            "name, email, phone, billing_address_line1, billing_address_line2, billing_city, billing_postcode, billing_country",
          )
          .eq("id", order.crm_account_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    order.crm_contact_id
      ? admin
          .from("crm_contacts")
          .select("full_name, email, phone")
          .eq("id", order.crm_contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("order_line_items")
      .select("package_id, description, quantity, unit_price, line_total, currency, sort_order")
      .eq("order_id", orderId)
      .order("sort_order"),
  ])
  if (nativeLinesError) throw new Error(nativeLinesError.message)

  const packageIds = [
    ...new Set(
      (nativeOrderLines?.length
        ? nativeOrderLines.map((line) => String(line.package_id))
        : [String(order.package_id)]
      ).filter(Boolean),
    ),
  ]
  const { data: packageRows, error: packagesError } = await admin
    .from("packages")
    .select("id, name, circuit, race_id, event_date, country, country_code")
    .in("id", packageIds)
  if (packagesError) throw new Error(packagesError.message)
  const packageMap = new Map((packageRows ?? []).map((pkg) => [String(pkg.id), pkg]))
  const raceIds = [
    ...new Set((packageRows ?? []).map((pkg) => pkg.race_id).filter(Boolean).map(String)),
  ]
  const { data: raceRows, error: racesError } = raceIds.length
    ? await admin
        .from("races")
        .select("id, name, event_date, country, country_code")
        .in("id", raceIds)
    : { data: [], error: null }
  if (racesError) throw new Error(racesError.message)
  const raceMap = new Map((raceRows ?? []).map((race) => [String(race.id), race]))

  const billingEmail = (
    crmContact?.email ||
    crmAccount?.email ||
    agent?.email ||
    order.client_email ||
    ""
  ).trim().toLowerCase()
  if (!billingEmail) throw new Error("The billing account needs an email address before invoicing.")
  const billToName = (
    crmAccount?.name ||
    agent?.company_name ||
    agent?.full_name ||
    order.client_name ||
    billingEmail
  ).trim()
  const contactId = await findOrCreateXeroContact({
    name: billToName,
    email: billingEmail,
    phone: crmAccount?.phone || crmContact?.phone || order.client_phone,
    billingAddress: {
      line1: crmAccount?.billing_address_line1 || order.billing_address_line1,
      line2: crmAccount?.billing_address_line2 || order.billing_address_line2,
      city: crmAccount?.billing_city || order.billing_city,
      postcode: crmAccount?.billing_postcode || order.billing_postcode,
      country: crmAccount?.billing_country || order.billing_country,
    },
  })

  const today = new Date().toISOString().slice(0, 10)
  const dueDays = Number(process.env.XERO_INVOICE_DUE_DAYS ?? "7")
  const dueDate = addDays(today, Number.isFinite(dueDays) ? dueDays : 7)

  const { accountCode, taxType } = await getXeroInvoiceLineDefaults()
  const currencyCode = await resolveXeroInvoiceCurrency(String(order.currency ?? "USD"))
  const itemCode = await resolveXeroInvoiceItemCode()
  const autoAuthorise = xeroInvoiceAutoAuthorise()
  const sourceLines = nativeOrderLines?.length
    ? nativeOrderLines
    : [
        {
          package_id: order.package_id,
          description: "",
          quantity: order.guests,
          unit_price: order.unit_price,
          line_total: order.total_amount,
          currency: order.currency,
          sort_order: 0,
        },
      ]
  const invoiceLines = sourceLines.map((line) => {
    const pkg = packageMap.get(String(line.package_id))
    const race = pkg?.race_id ? raceMap.get(String(pkg.race_id)) : null
    const raceLabel = formatXeroRaceLabel({
      raceName: race?.name,
      circuit: pkg?.circuit,
      eventDate: race?.event_date ?? pkg?.event_date,
    })
    const packageName = pkg?.name ?? String(line.description || "Package")
    const description =
      String(line.description || "").trim() ||
      `${packageName}${raceLabel ? ` (${raceLabel})` : ""}`
    const abuDhabi = isAbuDhabiEvent({
      raceId: pkg?.race_id,
      raceName: race?.name,
      circuit: pkg?.circuit,
      country: race?.country ?? pkg?.country,
      countryCode: race?.country_code ?? pkg?.country_code,
    })
    return {
      description,
      packageName,
      quantity: Number(line.quantity),
      unitAmount: Number(line.unit_price),
      abuDhabi,
    }
  })
  const includesAbuDhabiTax = invoiceLines.some((line) => line.abuDhabi)
  const lineAmountTypes = includesAbuDhabiTax ? "Inclusive" : "Exclusive"
  const where = encodeURIComponent(`Reference=="${String(order.reference).replaceAll('"', '\\"')}"`)
  const existing = await xeroRequest<{ Invoices?: XeroInvoice[] }>(
    "GET",
    `/api.xro/2.0/Invoices?where=${where}`,
  )
  let xeroInv = existing.Invoices?.find(
    (candidate) => candidate.InvoiceID && !["DELETED", "VOIDED"].includes((candidate.Status ?? "").toUpperCase()),
  )
  if (!xeroInv) {
    const result = await xeroRequest<{ Invoices?: XeroInvoice[] }>(
      "POST",
      "/api.xro/2.0/Invoices",
      {
        idempotencyKey: options?.replaceKey
          ? `zk-invoice-${orderId}-r${options.replaceKey}`
          : `zk-invoice-${orderId}`,
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
              LineItems: invoiceLines.map((line) => ({
                ...(itemCode ? { ItemCode: itemCode } : {}),
                Description: line.description,
                Quantity: line.quantity,
                UnitAmount: line.unitAmount,
                AccountCode: accountCode,
                TaxType: line.abuDhabi
                  ? process.env.XERO_ABU_DHABI_TAX_TYPE?.trim() || "TAX001"
                  : taxType,
              })),
            },
          ],
        },
      },
    )
    xeroInv = result.Invoices?.[0]
  }
  if (!xeroInv?.InvoiceID) throw new Error("Xero did not return InvoiceID.")

  const issuedAt = new Date().toISOString()
  const xeroStatus = (xeroInv.Status ?? "").toUpperCase()
  const awaitingPayment = xeroStatus !== "DRAFT"
  const { error: upErr } = await admin
    .from("invoices")
    .update({
      xero_invoice_id: xeroInv.InvoiceID,
      xero_invoice_number: xeroInv.InvoiceNumber ?? null,
      xero_sync_status: "synced",
      xero_synced_at: issuedAt,
      xero_sync_error: null,
      status: awaitingPayment ? "awaiting_payment" : "awaiting_invoice",
      issued_at: issuedAt,
      due_date: dueDate,
      cancellation_eligible_at: addDays(dueDate, 28),
      xero_amount_due: xeroInv.AmountDue ?? Number(order.total_amount),
      xero_amount_paid: xeroInv.AmountPaid ?? 0,
      xero_total: xeroInv.Total ?? Number(order.total_amount),
    })
    .eq("id", inv.id)
  if (upErr) throw new Error(upErr.message)

  if (order.deal_id) {
    await admin
      .from("deals")
      .update({
        stage: awaitingPayment ? "awaiting_payment" : "awaiting_invoice",
        next_action: awaitingPayment ? "Await Xero payment" : "Authorise draft invoice in Xero",
        next_action_due_at: `${dueDate}T00:00:00.000Z`,
        updated_at: issuedAt,
      })
      .eq("id", order.deal_id)
  }

  if (xeroInvoiceEmailOnCreate() && xeroInv.Status === "AUTHORISED" && !inv.invoice_emailed_at) {
    const packageName = invoiceLines.map((line) => line.packageName).join(", ")
    const emailResult = await sendXeroInvoiceEmail({
      agentEmail: billingEmail,
      agentName: billToName,
      orderReference: order.reference,
      xeroInvoiceId: xeroInv.InvoiceID,
      xeroInvoiceNumber: xeroInv.InvoiceNumber ?? null,
      packageName,
      clientName: order.client_name,
      guests: invoiceLines.reduce((sum, line) => sum + line.quantity, 0),
      totalAmount: Number(order.total_amount),
      currency: order.currency,
      dueDate,
    })
    if (!emailResult.ok) {
      console.warn(
        "[xero] Invoice email via Resend failed:",
        emailResult.error ?? emailResult.skipped ?? "unknown",
      )
      let fallbackSent = false
      try {
        await xeroRequest("POST", `/api.xro/2.0/Invoices/${xeroInv.InvoiceID}/Email`, { body: {} })
        fallbackSent = true
        console.warn("[xero] Fell back to Xero email API (no CC support).")
      } catch (e) {
        console.warn("[xero] Invoice email send skipped:", e instanceof Error ? e.message : e)
      }
      await admin
        .from("invoices")
        .update({
          invoice_emailed_at: fallbackSent ? issuedAt : null,
          invoice_email_error: fallbackSent
            ? null
            : emailResult.error ?? emailResult.skipped ?? "Invoice email failed.",
        })
        .eq("id", inv.id)
    } else {
      await admin
        .from("invoices")
        .update({ invoice_emailed_at: issuedAt, invoice_email_error: null })
        .eq("id", inv.id)
    }
  }

  await syncInvoicePdfToSalesforce(orderId)

  return {
    xeroInvoiceId: xeroInv.InvoiceID,
    xeroInvoiceNumber: xeroInv.InvoiceNumber ?? null,
  }
}

export async function resendXeroInvoiceForOrder(orderId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const [{ data: order, error: orderError }, { data: invoice, error: invoiceError }] =
    await Promise.all([
      admin.from("orders").select("*").eq("id", orderId).maybeSingle(),
      admin.from("invoices").select("*").eq("order_id", orderId).maybeSingle(),
    ])
  if (orderError || !order) throw new Error(orderError?.message ?? "Order not found.")
  if (invoiceError || !invoice) throw new Error(invoiceError?.message ?? "Invoice not found.")
  if (!invoice.xero_invoice_id) throw new Error("The Xero invoice has not been created yet.")
  if (invoice.status === "cancelled") throw new Error("A cancelled invoice cannot be resent.")

  const [{ data: account }, { data: contact }, { data: agent }, { data: lines }] =
    await Promise.all([
      order.crm_account_id
        ? admin.from("crm_accounts").select("name, email").eq("id", order.crm_account_id).maybeSingle()
        : Promise.resolve({ data: null }),
      order.crm_contact_id
        ? admin.from("crm_contacts").select("full_name, email").eq("id", order.crm_contact_id).maybeSingle()
        : Promise.resolve({ data: null }),
      order.agent_profile_id
        ? admin.from("profiles").select("company_name, full_name, email").eq("id", order.agent_profile_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin
        .from("order_line_items")
        .select("description, quantity")
        .eq("order_id", orderId)
        .order("sort_order"),
    ])
  const recipientEmail = contact?.email || account?.email || agent?.email || order.client_email
  if (!recipientEmail) throw new Error("The billing contact has no email address.")
  const recipientName =
    account?.name || agent?.company_name || agent?.full_name || contact?.full_name || order.client_name
  const packageName =
    lines?.map((line) => String(line.description)).filter(Boolean).join(", ") || "Package"
  const guests =
    lines?.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0) || Number(order.guests)
  const result = await sendXeroInvoiceEmail({
    agentEmail: recipientEmail,
    agentName: recipientName,
    orderReference: order.reference,
    xeroInvoiceId: invoice.xero_invoice_id,
    xeroInvoiceNumber: invoice.xero_invoice_number ?? null,
    packageName,
    clientName: order.client_name,
    guests,
    totalAmount: Number(order.total_amount),
    currency: order.currency,
    dueDate: invoice.due_date ?? new Date().toISOString().slice(0, 10),
  })
  if (!result.ok) throw new Error(result.error ?? result.skipped ?? "Invoice email failed.")
  await admin
    .from("invoices")
    .update({
      invoice_emailed_at: new Date().toISOString(),
      invoice_email_error: null,
    })
    .eq("id", invoice.id)
}

export async function reconcileXeroInvoiceForOrder(
  orderId: string,
  actorProfileId?: string | null,
): Promise<string> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const { data: invoice, error } = await admin
    .from("invoices")
    .select("id, xero_invoice_id")
    .eq("order_id", orderId)
    .maybeSingle()
  if (error || !invoice) throw new Error(error?.message ?? "Invoice not found.")
  if (!invoice.xero_invoice_id) throw new Error("The Xero invoice has not been created yet.")
  const remote = await xeroRequest<{ Invoices?: XeroInvoice[] }>(
    "GET",
    `/api.xro/2.0/Invoices/${encodeURIComponent(invoice.xero_invoice_id)}`,
  )
  const status = (remote.Invoices?.[0]?.Status ?? "").toUpperCase()
  if (status === "PAID") {
    await markPortalInvoicePaidFromXero(invoice.xero_invoice_id)
    if (actorProfileId) {
      await admin
        .from("invoices")
        .update({ reconciled_by: actorProfileId })
        .eq("id", invoice.id)
    }
  } else {
    const remoteInvoice = remote.Invoices?.[0]
    await admin
      .from("invoices")
      .update({
        ...(status === "AUTHORISED" ? { status: "awaiting_payment" } : {}),
        reconciled_at: new Date().toISOString(),
        reconciled_by: actorProfileId ?? null,
        xero_amount_due: remoteInvoice?.AmountDue ?? null,
        xero_amount_paid: remoteInvoice?.AmountPaid ?? null,
        xero_total: remoteInvoice?.Total ?? null,
        reconciliation_note: `${actorProfileId ? "Manual" : "Automated"} Xero reconciliation: ${status || "unknown"}`,
      })
      .eq("id", invoice.id)
    if (status === "AUTHORISED") {
      const { data: order } = await admin
        .from("orders")
        .select("deal_id")
        .eq("id", orderId)
        .maybeSingle()
      if (order?.deal_id) {
        await admin
          .from("deals")
          .update({
            stage: "awaiting_payment",
            next_action: "Await Xero payment",
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.deal_id)
        if (actorProfileId) {
          await admin.from("deal_activities").insert({
            deal_id: order.deal_id,
            actor_profile_id: actorProfileId,
            action: "invoice_reconciled",
            summary: `Reconciled Xero invoice status: ${status || "unknown"}`,
            metadata: { order_id: orderId, xero_invoice_id: invoice.xero_invoice_id },
          })
        }
      }
    }
  }
  return status || "UNKNOWN"
}

/** Void the current Xero invoice (if any) and clear local Xero IDs so a replacement can be created. */
export async function prepareXeroInvoiceReplacement(orderId: string): Promise<string> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const { data: invoice, error } = await admin
    .from("invoices")
    .select("id, status, xero_invoice_id")
    .eq("order_id", orderId)
    .maybeSingle()
  if (error || !invoice) throw new Error(error?.message ?? "Invoice not found.")
  if (invoice.status === "paid" || invoice.status === "delivered") {
    throw new Error("Mark the invoice unpaid before replacing it.")
  }
  if (invoice.status === "cancelled") {
    throw new Error("A cancelled invoice cannot be replaced.")
  }
  await voidXeroInvoiceForOrder(orderId)
  const { error: clearErr } = await admin
    .from("invoices")
    .update({
      xero_invoice_id: null,
      xero_invoice_number: null,
      xero_sync_status: "pending",
      xero_sync_error: null,
      status: "awaiting_invoice",
    })
    .eq("id", invoice.id)
  if (clearErr) throw new Error(clearErr.message)
  return `${Date.now()}`
}

export async function voidXeroInvoiceForOrder(orderId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) throw new Error("Supabase service role is not configured.")
  const { data: invoice, error } = await admin
    .from("invoices")
    .select("xero_invoice_id, status")
    .eq("order_id", orderId)
    .maybeSingle()
  if (error || !invoice) throw new Error(error?.message ?? "Invoice not found.")
  if (invoice.status === "paid" || invoice.status === "delivered") {
    throw new Error("A paid or delivered invoice cannot be voided.")
  }
  if (!invoice.xero_invoice_id) return
  const remote = await xeroRequest<{ Invoices?: XeroInvoice[] }>(
    "GET",
    `/api.xro/2.0/Invoices/${encodeURIComponent(invoice.xero_invoice_id)}`,
  )
  const status = (remote.Invoices?.[0]?.Status ?? "").toUpperCase()
  if (status === "PAID") throw new Error("Xero reports this invoice as paid; it cannot be cancelled.")
  if (status !== "VOIDED" && status !== "DELETED") {
    await xeroRequest(
      "POST",
      `/api.xro/2.0/Invoices/${encodeURIComponent(invoice.xero_invoice_id)}`,
      {
        idempotencyKey: `zk-void-${orderId}-${invoice.xero_invoice_id}`,
        body: {
          Invoices: [{ InvoiceID: invoice.xero_invoice_id, Status: "VOIDED" }],
        },
      },
    )
  }
  const { error: confirmationError } = await admin
    .from("xero_void_confirmations")
    .upsert(
      {
        order_id: orderId,
        xero_invoice_id: invoice.xero_invoice_id,
        confirmed_at: new Date().toISOString(),
      },
      { onConflict: "order_id" },
    )
  if (confirmationError) {
    throw new Error(`Xero was voided, but local confirmation failed: ${confirmationError.message}`)
  }
}

/** Mark a portal or native-deal invoice paid when Xero shows PAID. */
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
    .select("id, status, order_id, orders(deal_id)")
    .eq("xero_invoice_id", xeroInvoiceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!inv) return

  if (inv.status === "paid" || inv.status === "delivered") return

  const { error: upErr } = await admin
    .from("invoices")
    .update({
      status: "paid",
      xero_amount_due: remote.Invoices?.[0]?.AmountDue ?? 0,
      xero_amount_paid: remote.Invoices?.[0]?.AmountPaid ?? remote.Invoices?.[0]?.Total ?? null,
      xero_total: remote.Invoices?.[0]?.Total ?? null,
      paid_at: new Date().toISOString(),
      reconciled_at: new Date().toISOString(),
      payment_reminder_error: null,
    })
    .eq("id", inv.id)
  if (upErr) throw new Error(upErr.message)

  if (inv.order_id) {
    await admin.from("orders").update({ status: "confirmed" }).eq("id", inv.order_id)
    const orderRelation = inv.orders as { deal_id?: string | null } | { deal_id?: string | null }[] | null
    const dealId = Array.isArray(orderRelation)
      ? orderRelation[0]?.deal_id
      : orderRelation?.deal_id
    if (dealId) {
      const paidAt = new Date().toISOString()
      await admin
        .from("deals")
        .update({
          stage: "paid_confirmed",
          next_action: "Hand over to fulfilment",
          next_action_due_at: paidAt,
          updated_at: paidAt,
        })
        .eq("id", dealId)
      await admin.from("deal_activities").insert({
        deal_id: dealId,
        action: "payment_confirmed",
        summary: "Xero confirmed the invoice as paid",
        metadata: { order_id: inv.order_id, xero_invoice_id: xeroInvoiceId },
      })
    }
    const enq = await enqueueOpportunityOutcomeServer(String(inv.order_id), "won")
    if (!enq.ok) console.warn("[xero webhook] Salesforce Closed Won not queued:", enq.message)
  }
}
