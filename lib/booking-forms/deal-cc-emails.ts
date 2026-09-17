import type { SupabaseClient } from "@supabase/supabase-js"
import {
  EMAIL_RE,
  type BookingFormAccountEmailOption,
  snapshotClientCcEmails,
} from "@/lib/booking-forms/cc-emails"

type BookingFormDb = Pick<SupabaseClient, "from">

export async function loadAccountEmailOptions(
  supabase: BookingFormDb,
  accountId: string | null | undefined,
): Promise<BookingFormAccountEmailOption[]> {
  const id = accountId?.trim()
  if (!id) return []

  const [{ data: contacts, error: contactError }, { data: account, error: accountError }] =
    await Promise.all([
      supabase
        .from("crm_contacts")
        .select("full_name, email")
        .eq("account_id", id)
        .order("full_name"),
      supabase.from("crm_accounts").select("name, email").eq("id", id).maybeSingle(),
    ])
  if (contactError) {
    console.warn("[booking-forms] could not load account contacts for CC:", contactError.message)
  }
  if (accountError) {
    console.warn("[booking-forms] could not load account email for CC:", accountError.message)
  }

  const seen = new Set<string>()
  const options: BookingFormAccountEmailOption[] = []
  const add = (email: string | null | undefined, label: string) => {
    const normalized = String(email ?? "").trim().toLowerCase()
    if (!EMAIL_RE.test(normalized) || seen.has(normalized)) return
    seen.add(normalized)
    options.push({ email: normalized, label: label.trim() || normalized })
  }
  for (const contact of contacts ?? []) {
    add(contact.email, String(contact.full_name ?? "").trim() || String(contact.email ?? ""))
  }
  add(account?.email, `${String(account?.name ?? "Account").trim()} (account email)`)
  return options
}

export async function loadDealClientCcEmails(
  supabase: BookingFormDb,
  dealId: string | null | undefined,
): Promise<string[]> {
  const id = dealId?.trim()
  if (!id) return []

  const { data: completed, error: completedError } = await supabase
    .from("booking_forms")
    .select("snapshot_data")
    .eq("deal_id", id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (completedError) {
    console.warn("[booking-forms] could not load completed form CC emails:", completedError.message)
  }
  if (completed) return snapshotClientCcEmails(completed.snapshot_data)

  const { data: latest, error: latestError } = await supabase
    .from("booking_forms")
    .select("snapshot_data")
    .eq("deal_id", id)
    .in("status", ["draft", "sent", "viewed", "awaiting_zk_signature", "zk_signed", "completed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestError) {
    console.warn("[booking-forms] could not load booking form CC emails:", latestError.message)
    return []
  }
  return snapshotClientCcEmails(latest?.snapshot_data)
}
