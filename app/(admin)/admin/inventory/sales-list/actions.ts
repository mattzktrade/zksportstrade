"use server"

import { revalidatePath } from "next/cache"
import { requireCmsPermission } from "@/lib/admin/require-admin"
import { createClient } from "@/lib/supabase/server"

type SaveCrmPartyResult =
  | { ok: true; accountId: string; contactId: string | null }
  | { ok: false; message: string }

export async function saveSalesListCrmParty(input: {
  accountId?: string | null
  accountName: string
  contactId?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
}): Promise<SaveCrmPartyResult> {
  const profile = await requireCmsPermission("accounts.manage")
  const supabase = await createClient()
  const accountName = input.accountName.trim()
  const contactName = input.contactName?.trim() || ""
  const contactEmail = input.contactEmail?.trim().toLowerCase() || null
  const contactPhone = input.contactPhone?.trim() || null
  if (!accountName) return { ok: false, message: "Company name is required." }
  if ((contactEmail || contactPhone) && !contactName) {
    return { ok: false, message: "Enter the contact name before saving contact details." }
  }
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return { ok: false, message: "Enter a valid contact email." }
  }

  let accountId = input.accountId?.trim() || null
  if (accountId) {
    const { data: account, error: findError } = await supabase
      .from("crm_accounts")
      .select("id")
      .eq("id", accountId)
      .eq("active", true)
      .maybeSingle()
    if (findError) return { ok: false, message: findError.message }
    if (!account) return { ok: false, message: "The selected company is no longer available." }
    const { error } = await supabase
      .from("crm_accounts")
      .update({ name: accountName, updated_at: new Date().toISOString() })
      .eq("id", accountId)
    if (error) return { ok: false, message: error.message }
  } else {
    const { data, error } = await supabase.rpc("admin_ensure_crm_account", {
      p_name: accountName,
      p_account_type: "agent_company",
      p_email: null,
      p_phone: null,
      p_portal_profile_id: null,
    })
    if (error) return { ok: false, message: error.message }
    accountId = String(data)
  }

  let contactId = input.contactId?.trim() || null
  if (contactId) {
    const { data: contact, error: findError } = await supabase
      .from("crm_contacts")
      .select("id")
      .eq("id", contactId)
      .eq("account_id", accountId)
      .eq("active", true)
      .maybeSingle()
    if (findError) return { ok: false, message: findError.message }
    if (!contact) return { ok: false, message: "The selected contact does not belong to this company." }
    const { error } = await supabase
      .from("crm_contacts")
      .update({
        full_name: contactName,
        email: contactEmail,
        phone: contactPhone,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId)
    if (error) return { ok: false, message: error.message }
  } else if (contactName) {
    const { count } = await supabase
      .from("crm_contacts")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("active", true)
    const { data, error } = await supabase
      .from("crm_contacts")
      .insert({
        account_id: accountId,
        full_name: contactName,
        email: contactEmail,
        phone: contactPhone,
        is_primary: (count ?? 0) === 0,
        created_by: profile.id,
      })
      .select("id")
      .single()
    if (error) return { ok: false, message: error.message }
    contactId = String(data.id)
  }

  revalidatePath("/admin/inventory/sales-list")
  revalidatePath("/admin/deals")
  revalidatePath("/admin/enquiries")
  revalidatePath("/admin/leads")
  return { ok: true, accountId, contactId }
}

