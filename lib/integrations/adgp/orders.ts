import { enqueuePackageInventoryChannelSyncServer } from "@/lib/integrations/enqueue-server"
import { sendWebsiteCustomerEmail, sendWebsiteOrderEmail } from "@/lib/email/send-website-order"
import { getAdgpConfig } from "@/lib/integrations/adgp/config"
import { stopOutreachForWebsiteBuyer } from "@/lib/integrations/marketing-leads/outreach-purchase"
import type { AdgpAddress, AdgpBuyer, AdgpOrderResult } from "@/lib/integrations/adgp/types"
import { createAdminClient } from "@/lib/supabase/admin"

type OrderRpc = {
  order_id?: string
  order_reference?: string
  deal_id?: string
  deal_reference?: string
  package_name?: string
  circuit?: string
  total_amount?: number
  currency?: string
  guests?: number
  duplicate?: boolean
}

export async function resolveAdgpOwnerProfileId(email: string): Promise<string | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from("profiles")
    .select("id, role")
    .ilike("email", email.trim())
    .limit(1)
    .maybeSingle()
  const role = typeof data?.role === "string" ? data.role : ""
  if (!data?.id || !["admin", "finance", "sales"].includes(role)) return null
  return String(data.id)
}

export async function resolveAdgpAgentProfileId(): Promise<string | null> {
  const config = getAdgpConfig()
  const admin = createAdminClient()
  if (!admin) return null
  if (config?.agentProfileId) {
    const { data } = await admin
      .from("profiles")
      .select("id, approval_status")
      .eq("id", config.agentProfileId)
      .maybeSingle()
    if (data?.id && data.approval_status === "approved") return String(data.id)
  }
  const ownerId = await resolveAdgpOwnerProfileId(config?.ownerEmail ?? "matt@zk-sports.com")
  if (!ownerId) return null
  const { data } = await admin
    .from("profiles")
    .select("id, approval_status")
    .eq("id", ownerId)
    .maybeSingle()
  return data?.approval_status === "approved" ? ownerId : null
}

export async function commitAdgpOrder(input: {
  holdId: string
  stripeSessionId: string
  packageId: string
  guests: number
  unitPrice: number
  currency: string
  buyer: AdgpBuyer
  billing?: AdgpAddress | null
}): Promise<AdgpOrderResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, message: "Service role is not configured." }

  const config = getAdgpConfig()
  const ownerId = await resolveAdgpOwnerProfileId(config?.ownerEmail ?? "matt@zk-sports.com")
  if (!ownerId) {
    return { ok: false, message: "owner_profile_required", code: "owner_profile_required" }
  }
  const agentId = await resolveAdgpAgentProfileId()
  if (!agentId) {
    return { ok: false, message: "agent_profile_id_required", code: "agent_profile_id_required" }
  }

  let { data: hold } = await admin
    .from("website_checkout_holds")
    .select("id, package_id, guests, unit_price, currency, status, day, inventory_hold_id")
    .eq("id", input.holdId)
    .maybeSingle()
  if (!hold && input.stripeSessionId.trim()) {
    const bySession = await admin
      .from("website_checkout_holds")
      .select("id, package_id, guests, unit_price, currency, status, day, inventory_hold_id")
      .eq("stripe_session_id", input.stripeSessionId.trim())
      .maybeSingle()
    hold = bySession.data
  }
  if (!hold) return { ok: false, message: "hold_not_found", code: "hold_not_found" }
  if (String(hold.package_id) !== input.packageId) {
    return { ok: false, message: "hold_package_mismatch", code: "hold_package_mismatch" }
  }
  if (Number(hold.guests) !== input.guests) {
    return { ok: false, message: "hold_guests_mismatch", code: "hold_guests_mismatch" }
  }
  if (Math.round(Number(hold.unit_price) * 100) !== Math.round(input.unitPrice * 100)) {
    return { ok: false, message: "hold_price_mismatch", code: "hold_price_mismatch" }
  }
  if ((hold.currency ?? "").trim() && input.currency.trim() && hold.currency !== input.currency) {
    return { ok: false, message: "hold_currency_mismatch", code: "hold_currency_mismatch" }
  }

  const holdId = String(hold.id)
  const holdDay = typeof hold.day === "string" ? hold.day : ""

  const { data, error } = await admin.rpc("place_website_order", {
    p_external_order_id: input.stripeSessionId.trim(),
    p_hold_id: holdId,
    p_package_id: input.packageId,
    p_guests: input.guests,
    p_client_name: input.buyer.name.trim(),
    p_client_email: input.buyer.email.trim(),
    p_client_phone: (input.buyer.phone ?? "").trim() || "—",
    p_agent_profile_id: agentId,
    p_owner_profile_id: ownerId,
    p_unit_price: input.unitPrice,
    p_currency: input.currency,
    p_client_nationality: (input.buyer.nationality ?? "").trim(),
    p_bill_line1: input.billing?.line1 ?? "",
    p_bill_line2: input.billing?.line2 ?? null,
    p_bill_city: input.billing?.city ?? "",
    p_bill_postcode: input.billing?.postcode ?? "",
    p_bill_country: input.billing?.country ?? "",
  })
  if (error && /lead_stage/i.test(error.message)) {
    const fallback = await placeWebsiteOrderInApp({
      admin,
      holdId,
      holdDay,
      holdInventoryHoldId: hold.inventory_hold_id ? String(hold.inventory_hold_id) : null,
      stripeSessionId: input.stripeSessionId.trim(),
      packageId: input.packageId,
      guests: input.guests,
      unitPrice: input.unitPrice,
      currency: input.currency,
      buyer: input.buyer,
      billing: input.billing ?? null,
      ownerId,
      agentId,
    })
    if (fallback.ok && !fallback.duplicate) {
      const sync = await enqueuePackageInventoryChannelSyncServer(input.packageId, {
        trigger: `website-order:${fallback.orderId}`,
      })
      if (!sync.ok) {
        console.warn("[adgp] inventory sync not queued:", sync.message)
      }
      const mailPayload = {
        orderReference: fallback.orderReference,
        dealReference: fallback.dealReference,
        packageName: fallback.packageName,
        day: holdDay,
        guests: fallback.guests,
        totalAmount: fallback.totalAmount,
        currency: fallback.currency,
        clientName: input.buyer.name,
        clientEmail: input.buyer.email,
        clientPhone: input.buyer.phone ?? "",
      }
      const mail = await sendWebsiteOrderEmail(mailPayload)
      if (!mail.ok && !mail.skipped) {
        console.error("[adgp] website order email failed:", mail.error)
      }
      const customerMail = await sendWebsiteCustomerEmail(mailPayload)
      if (!customerMail.ok && !customerMail.skipped) {
        console.error("[adgp] website customer email failed:", customerMail.error)
      }
      await stopOutreachForWebsiteBuyer(admin, {
        email: input.buyer.email,
        phone: input.buyer.phone,
        orderDealId: fallback.dealId,
        orderReference: fallback.orderReference,
      }).catch((error) => console.error("[adgp] stop marketing follow-up failed:", error))
    }
    return fallback
  }

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      const existing = await admin
        .from("orders")
        .select("id, reference, deal_id, guests, total_amount, currency, package_id")
        .eq("external_order_id", input.stripeSessionId.trim())
        .maybeSingle()
      if (existing.data?.id && existing.data.deal_id) {
        const { data: deal } = await admin
          .from("deals")
          .select("reference")
          .eq("id", existing.data.deal_id)
          .maybeSingle()
        const { data: pkg } = existing.data.package_id
          ? await admin.from("packages").select("name").eq("id", existing.data.package_id).maybeSingle()
          : { data: null }
        return {
          ok: true,
          orderId: String(existing.data.id),
          orderReference: String(existing.data.reference ?? ""),
          dealId: String(existing.data.deal_id),
          dealReference: String(deal?.reference ?? ""),
          packageName: String(pkg?.name ?? ""),
          guests: Number(existing.data.guests ?? input.guests),
          totalAmount: Number(existing.data.total_amount ?? input.unitPrice * input.guests),
          currency: String(existing.data.currency ?? input.currency),
          duplicate: true,
        }
      }
    }
    return { ok: false, message: error.message, code: error.message }
  }

  const row = data as OrderRpc
  const orderId = String(row.order_id ?? "")
  const dealId = String(row.deal_id ?? "")
  if (!orderId || !dealId) {
    return { ok: false, message: "place_website_order did not return order and deal ids." }
  }

  const result = {
    ok: true as const,
    orderId,
    orderReference: String(row.order_reference ?? ""),
    dealId,
    dealReference: String(row.deal_reference ?? ""),
    packageName: String(row.package_name ?? ""),
    guests: Number(row.guests ?? input.guests),
    totalAmount: Number(row.total_amount ?? input.unitPrice * input.guests),
    currency: String(row.currency ?? input.currency),
    duplicate: Boolean(row.duplicate),
  }

  if (!result.duplicate) {
    const sync = await enqueuePackageInventoryChannelSyncServer(input.packageId, {
      trigger: `website-order:${orderId}`,
    })
    if (!sync.ok) {
      console.warn("[adgp] inventory sync not queued:", sync.message)
    }
    const mailPayload = {
      orderReference: result.orderReference,
      dealReference: result.dealReference,
      packageName: result.packageName,
      day: holdDay,
      guests: result.guests,
      totalAmount: result.totalAmount,
      currency: result.currency,
      clientName: input.buyer.name,
      clientEmail: input.buyer.email,
      clientPhone: input.buyer.phone ?? "",
    }
    const mail = await sendWebsiteOrderEmail(mailPayload)
    if (!mail.ok && !mail.skipped) {
      console.error("[adgp] website order email failed:", mail.error)
    }
    const customerMail = await sendWebsiteCustomerEmail(mailPayload)
    if (!customerMail.ok && !customerMail.skipped) {
      console.error("[adgp] website customer email failed:", customerMail.error)
    }
    await stopOutreachForWebsiteBuyer(admin, {
      email: input.buyer.email,
      phone: input.buyer.phone,
      orderDealId: dealId,
      orderReference: result.orderReference,
    }).catch((error) => console.error("[adgp] stop marketing follow-up failed:", error))
  }

  return result
}

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>

async function uniqueAccountName(admin: AdminClient, name: string, email: string): Promise<string> {
  const base = name.trim() || email
  const { data } = await admin.from("crm_accounts").select("id").ilike("name", base).limit(1).maybeSingle()
  if (!data?.id) return base.slice(0, 180)
  return `${base} (${email})`.slice(0, 180)
}

async function placeWebsiteOrderInApp(input: {
  admin: AdminClient
  holdId: string
  holdDay: string
  holdInventoryHoldId: string | null
  stripeSessionId: string
  packageId: string
  guests: number
  unitPrice: number
  currency: string
  buyer: AdgpBuyer
  billing: AdgpAddress | null
  ownerId: string
  agentId: string
}): Promise<AdgpOrderResult> {
  const admin = input.admin
  const email = input.buyer.email.trim().toLowerCase()
  const name = input.buyer.name.trim()
  const phone = (input.buyer.phone ?? "").trim() || "—"
  if (!name) return { ok: false, message: "client_name_required", code: "client_name_required" }
  if (!email.includes("@")) return { ok: false, message: "client_email_required", code: "client_email_required" }

  const { data: existing } = await admin
    .from("orders")
    .select("id, reference, deal_id, guests, total_amount, currency, package_id")
    .eq("external_order_id", input.stripeSessionId)
    .maybeSingle()
  if (existing?.id && existing.deal_id) {
    const { data: deal } = await admin.from("deals").select("reference").eq("id", existing.deal_id).maybeSingle()
    const { data: pkg } = existing.package_id
      ? await admin.from("packages").select("name").eq("id", existing.package_id).maybeSingle()
      : { data: null }
    return {
      ok: true,
      orderId: String(existing.id),
      orderReference: String(existing.reference ?? ""),
      dealId: String(existing.deal_id),
      dealReference: String(deal?.reference ?? ""),
      packageName: String(pkg?.name ?? ""),
      guests: Number(existing.guests ?? input.guests),
      totalAmount: Number(existing.total_amount ?? input.unitPrice * input.guests),
      currency: String(existing.currency ?? input.currency),
      duplicate: true,
    }
  }

  const { data: pkg, error: pkgError } = await admin
    .from("packages")
    .select("id, name, circuit, currency, race_id, event_date, is_enquiry")
    .eq("id", input.packageId)
    .maybeSingle()
  if (pkgError || !pkg) return { ok: false, message: "package_not_found", code: "package_not_found" }
  if (pkg.is_enquiry) return { ok: false, message: "package_enquiry_only", code: "package_enquiry_only" }

  const lock = await admin.rpc("lock_package_inventory", { p_package_id: input.packageId })
  if (lock.error) return { ok: false, message: lock.error.message, code: lock.error.message }

  const sellable = await admin.rpc("linked_inventory_sellable", {
    p_package_id: input.packageId,
    p_agent_profile_id: input.agentId,
  })
  if (sellable.error) return { ok: false, message: sellable.error.message, code: sellable.error.message }
  const remaining = Number(sellable.data ?? 0)
  if (remaining < input.guests) return { ok: false, message: "insufficient_stock", code: "insufficient_stock" }
  if (remaining <= 5 && remaining - input.guests === 1) {
    return { ok: false, message: "leaves_one_remaining", code: "leaves_one_remaining" }
  }

  const unit = Math.round(input.unitPrice * 100) / 100
  const total = Math.round(unit * input.guests * 100) / 100
  const currency = input.currency.trim() || pkg.currency || "USD"
  const orderReference = `ZK-${new Date().getUTCFullYear()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`
  const paidAt = new Date().toISOString()
  const bill = input.billing ?? {}

  const { data: contactMatch } = await admin
    .from("crm_contacts")
    .select("id, account_id")
    .eq("active", true)
    .ilike("email", email)
    .order("created_at")
    .limit(1)
    .maybeSingle()
  let accountId = contactMatch?.account_id ? String(contactMatch.account_id) : null
  let contactId = contactMatch?.id ? String(contactMatch.id) : null
  if (!accountId) {
    const { data: accountMatch } = await admin
      .from("crm_accounts")
      .select("id")
      .eq("active", true)
      .ilike("email", email)
      .order("created_at")
      .limit(1)
      .maybeSingle()
    accountId = accountMatch?.id ? String(accountMatch.id) : null
  }
  if (!accountId) {
    const accountName = await uniqueAccountName(admin, name, email)
    const created = await admin
      .from("crm_accounts")
      .insert({
        name: accountName,
        account_type: "direct_client",
        account_types: ["direct_client"],
        email,
        phone,
        source: "website",
        lifecycle: "client",
        lead_stage: "talking",
        active: true,
      })
      .select("id")
      .single()
    if (created.error || !created.data) {
      return { ok: false, message: created.error?.message || "account_create_failed", code: "account_create_failed" }
    }
    accountId = String(created.data.id)
  } else {
    await admin
      .from("crm_accounts")
      .update({
        lifecycle: "client",
        email,
        phone,
        updated_at: paidAt,
      })
      .eq("id", accountId)
  }
  if (!contactId) {
    const { count } = await admin
      .from("crm_contacts")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("active", true)
      .eq("is_primary", true)
    const createdContact = await admin
      .from("crm_contacts")
      .insert({
        account_id: accountId,
        full_name: name,
        email,
        phone,
        is_primary: (count ?? 0) === 0,
        active: true,
      })
      .select("id")
      .single()
    if (createdContact.error || !createdContact.data) {
      return { ok: false, message: createdContact.error?.message || "contact_create_failed", code: "contact_create_failed" }
    }
    contactId = String(createdContact.data.id)
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      reference: orderReference,
      agent_profile_id: input.agentId,
      package_id: input.packageId,
      status: "confirmed",
      channel: "website",
      external_order_id: input.stripeSessionId,
      guests: input.guests,
      unit_price: unit,
      total_amount: total,
      currency,
      client_name: name,
      client_email: email,
      client_phone: phone,
      client_nationality: (input.buyer.nationality ?? "").trim(),
      shipping_address_line1: bill.line1 ?? "",
      shipping_address_line2: bill.line2 ?? "",
      shipping_city: bill.city ?? "",
      shipping_postcode: bill.postcode ?? "",
      shipping_country: bill.country ?? "",
      billing_address_line1: bill.line1 ?? "",
      billing_address_line2: bill.line2 ?? "",
      billing_city: bill.city ?? "",
      billing_postcode: bill.postcode ?? "",
      billing_country: bill.country ?? "",
      crm_account_id: accountId,
      crm_contact_id: contactId,
    })
    .select("id, reference")
    .single()
  if (orderError || !order) {
    return { ok: false, message: orderError?.message || "order_create_failed", code: "order_create_failed" }
  }

  const stock = await admin.rpc("adjust_linked_inventory_available", {
    p_package_id: input.packageId,
    p_delta: -input.guests,
  })
  if (stock.error) {
    await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id)
    return { ok: false, message: stock.error.message, code: stock.error.message }
  }
  const allocated = await admin.rpc("allocate_order_cost_layers", {
    p_order_id: order.id,
    p_order_package_id: input.packageId,
    p_guests: input.guests,
    p_currency: currency,
  })
  if (allocated.error) {
    console.warn("[adgp] cost layers not allocated:", allocated.error.message)
  }
  if (input.holdInventoryHoldId) {
    await admin
      .from("inventory_holds")
      .update({ released_at: paidAt })
      .eq("id", input.holdInventoryHoldId)
      .is("released_at", null)
    await admin.rpc("reconcile_holds_for_package", { p_package_id: input.packageId })
  }

  const invoice = await admin.from("invoices").insert({
    order_id: order.id,
    reference: orderReference,
    amount: total,
    currency,
    status: "paid",
    issued_at: paidAt,
    due_date: paidAt.slice(0, 10),
    paid_at: paidAt,
  })
  if (invoice.error) {
    console.warn("[adgp] invoice not created:", invoice.error.message)
  }

  const { data: deal, error: dealError } = await admin
    .from("deals")
    .insert({
      reference: "DL0000",
      account_id: accountId,
      primary_contact_id: contactId,
      owner_profile_id: input.ownerId,
      race_id: pkg.race_id,
      source: "website",
      stage: "paid_confirmed",
      currency,
      total_amount: total,
      notes: [
        "Paid website checkout from the Abu Dhabi GP site.",
        `Stripe session: ${input.stripeSessionId}`,
        `Package: ${pkg.name}`,
        input.holdDay ? `Days: ${input.holdDay}` : "",
        `Guests: ${input.guests}`,
      ]
        .filter(Boolean)
        .join("\n"),
      next_action: "Hand over to fulfilment",
      order_id: order.id,
      closed_at: paidAt,
      created_at: paidAt,
      updated_at: paidAt,
    })
    .select("id, reference")
    .single()
  if (dealError || !deal) {
    return { ok: false, message: dealError?.message || "deal_create_failed", code: "deal_create_failed" }
  }

  const line = await admin.from("deal_line_items").insert({
    deal_id: deal.id,
    package_id: input.packageId,
    quantity: input.guests,
    unit_sale_price: unit,
    currency,
    sourcing_mode: "owned",
    reservation_status: "none",
    sort_order: 0,
  })
  if (line.error) {
    console.warn("[adgp] deal line not created:", line.error.message)
  }

  await admin
    .from("orders")
    .update({ deal_id: deal.id, crm_account_id: accountId, crm_contact_id: contactId })
    .eq("id", order.id)

  await admin.from("deal_activities").insert({
    deal_id: deal.id,
    actor_profile_id: input.ownerId,
    action: "website_checkout_paid",
    summary: "Paid website checkout from the Abu Dhabi GP website.",
    metadata: {
      order_id: order.id,
      order_reference: order.reference,
      channel: "website",
      stripe_session_id: input.stripeSessionId,
    },
  })

  await admin
    .from("website_checkout_holds")
    .update({
      status: "converted",
      order_id: order.id,
      stripe_session_id: input.stripeSessionId,
      updated_at: paidAt,
    })
    .eq("id", input.holdId)

  return {
    ok: true,
    orderId: String(order.id),
    orderReference: String(order.reference),
    dealId: String(deal.id),
    dealReference: String(deal.reference),
    packageName: String(pkg.name ?? ""),
    guests: input.guests,
    totalAmount: total,
    currency,
    duplicate: false,
  }
}
