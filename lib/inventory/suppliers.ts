import { unstable_noStore as noStore } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"

export type SupplierRow = {
  id: string
  name: string
  code: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
}

const SUPPLIER_COLUMNS =
  "id, name, code, contact_name, contact_email, contact_phone, notes, active, created_at, updated_at" as const

export async function getSuppliers(options?: {
  activeOnly?: boolean
}): Promise<SupplierRow[]> {
  noStore()
  const supabase = await createClient()
  let query = supabase.from("suppliers").select(SUPPLIER_COLUMNS).order("name", { ascending: true })
  if (options?.activeOnly !== false) {
    query = query.eq("active", true)
  }
  const { data, error } = await query
  if (error || !data) return []
  return data as SupplierRow[]
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function ensureSupplierByName(
  supabase: SupabaseClient,
  name: string,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, message: "Supplier is required." }

  const { data, error } = await supabase.rpc("admin_ensure_supplier", {
    p_name: trimmed,
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true, id: String(data) }
}

export async function ensureSupplierForAccount(
  supabase: SupabaseClient,
  accountId: string,
): Promise<{ ok: true; id: string; name: string } | { ok: false; message: string }> {
  const id = accountId.trim()
  if (!UUID_RE.test(id)) return { ok: false, message: "Select a company from the list." }

  const { data: account, error: accountErr } = await supabase
    .from("crm_accounts")
    .select("id, name")
    .eq("id", id)
    .maybeSingle()
  if (accountErr) return { ok: false, message: accountErr.message }
  if (!account?.id) return { ok: false, message: "Company not found." }

  const name = String(account.name ?? "").trim()
  if (!name) return { ok: false, message: "Company name is missing." }

  const { data, error } = await supabase.rpc("admin_ensure_supplier_for_account", {
    p_account_id: id,
  })
  if (error) {
    const message = error.message.toLowerCase()
    if (message.includes("account_not_found")) return { ok: false, message: "Company not found." }
    if (message.includes("supplier_name_linked_to_other_account")) {
      return {
        ok: false,
        message: `A supplier named "${name}" is already linked to a different company.`,
      }
    }
    return { ok: false, message: error.message }
  }
  return { ok: true, id: String(data), name }
}

export async function linkPurchaseOrderSupplier(
  supabase: SupabaseClient,
  purchaseOrderId: string,
  supplierName: string,
): Promise<{ ok: true; supplierId: string } | { ok: false; message: string }> {
  const ensured = await ensureSupplierByName(supabase, supplierName)
  if (!ensured.ok) return ensured

  const { error } = await supabase
    .from("purchase_orders")
    .update({ supplier_id: ensured.id, updated_at: new Date().toISOString() })
    .eq("id", purchaseOrderId)

  if (error) return { ok: false, message: error.message }
  return { ok: true, supplierId: ensured.id }
}

export async function linkPurchaseOrderToAccount(
  supabase: SupabaseClient,
  purchaseOrderId: string,
  accountId: string,
): Promise<{ ok: true; supplierId: string; name: string } | { ok: false; message: string }> {
  const ensured = await ensureSupplierForAccount(supabase, accountId)
  if (!ensured.ok) return ensured

  const { error } = await supabase
    .from("purchase_orders")
    .update({
      supplier: ensured.name,
      supplier_id: ensured.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", purchaseOrderId)

  if (error) return { ok: false, message: error.message }
  return { ok: true, supplierId: ensured.id, name: ensured.name }
}
