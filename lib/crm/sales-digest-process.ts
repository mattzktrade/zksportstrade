import { createAdminClient } from "@/lib/supabase/admin"
import { loadFollowUpSummary } from "@/lib/admin/follow-up-summary"
import { listCallAttemptsForDeals } from "@/lib/crm/call-attempts-store"
import { ENQUIRY_PIPELINE_STAGES } from "@/lib/crm/deal-pipeline"
import {
  buildSalesDigest,
  digestDateKey,
  digestIsEmpty,
  salesDigestDue,
  type DigestDeal,
} from "@/lib/crm/sales-digest"
import { MARKETING_LEAD_NOTIFY_EMAILS } from "@/lib/integrations/marketing-leads/notify"
import { sendSalesDigest } from "@/lib/email/send-sales-digest"

export type SalesDigestResult = { sent: number; skipped: number; failed: number }

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>
type Person = { full_name: string | null; phone: string | null }

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function postgresUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === "23505" || /duplicate key/i.test(error.message ?? "")
}

/** Inserts the key; false when it already exists, so each key is claimed once. */
async function claim(admin: AdminClient, key: string, now: Date): Promise<boolean> {
  const { error } = await admin.from("integration_settings").insert({ key, value: now.toISOString() })
  if (!error) return true
  if (!postgresUniqueViolation(error)) console.error("[sales-digest] claim", error.message)
  return false
}

async function release(admin: AdminClient, key: string): Promise<void> {
  await admin.from("integration_settings").delete().eq("key", key)
}

async function loadDigestDeals(admin: AdminClient): Promise<DigestDeal[]> {
  const { data, error } = await admin
    .from("deals")
    .select(
      "id, reference, stage, enquiry_stage, source, created_at, next_action, next_action_due_at, owner_profile_id, crm_contacts!primary_contact_id ( full_name, phone ), races ( name )",
    )
    .eq("source", "marketing")
    .in("enquiry_stage", ["new", "contacted", "follow_up"])
    .in("stage", [...ENQUIRY_PIPELINE_STAGES])
    .limit(1000)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => {
    const contact = one(row.crm_contacts as Person | Person[] | null)
    const race = one(row.races as { name: string | null } | Array<{ name: string | null }> | null)
    return {
      id: String(row.id),
      reference: String(row.reference ?? ""),
      stage: String(row.stage),
      enquiry_stage: (row.enquiry_stage as string | null) ?? null,
      source: String(row.source),
      created_at: String(row.created_at),
      next_action: (row.next_action as string | null) ?? null,
      next_action_due_at: (row.next_action_due_at as string | null) ?? null,
      owner_profile_id: (row.owner_profile_id as string | null) ?? null,
      name: contact?.full_name?.trim() || "Lead",
      phone: contact?.phone?.trim() || null,
      interest: race?.name?.trim() || "",
    }
  })
}

/**
 * Once a day from 9:00 Dubai: Samantha and Oliver get unclaimed leads plus their
 * own list; anyone else who owns a marketing lead with something due gets theirs.
 */
export async function processSalesDigest(now = new Date()): Promise<SalesDigestResult> {
  const result: SalesDigestResult = { sent: 0, skipped: 0, failed: 0 }
  if (!salesDigestDue(now)) return result
  const admin = createAdminClient()
  if (!admin) return result
  const dateKey = digestDateKey(now)
  const dayKey = `sales_digest:${dateKey}`
  if (!(await claim(admin, dayKey, now))) return result

  try {
    const deals = await loadDigestDeals(admin)
    const calls = await listCallAttemptsForDeals(deals.map((deal) => deal.id))
    const ownerIds = [...new Set(deals.map((deal) => deal.owner_profile_id).filter(Boolean))] as string[]
    const { data: owners } = ownerIds.length
      ? await admin.from("profiles").select("id, email, full_name").in("id", ownerIds)
      : { data: [] }
    const { data: notifyProfiles } = await admin
      .from("profiles")
      .select("id, email, full_name")
      .or(MARKETING_LEAD_NOTIFY_EMAILS.map((email) => `email.ilike.${email}`).join(","))

    type Recipient = { email: string; profileId: string | null; firstName: string; includeUnclaimed: boolean }
    const recipients = new Map<string, Recipient>()
    for (const email of MARKETING_LEAD_NOTIFY_EMAILS) {
      const profile = (notifyProfiles ?? []).find((row) => String(row.email ?? "").toLowerCase() === email)
      recipients.set(email, {
        email,
        profileId: profile ? String(profile.id) : null,
        firstName: String(profile?.full_name ?? "").trim().split(/\s+/)[0] ?? "",
        includeUnclaimed: true,
      })
    }
    for (const owner of owners ?? []) {
      const email = String(owner.email ?? "").trim().toLowerCase()
      if (!email || recipients.has(email)) continue
      recipients.set(email, {
        email,
        profileId: String(owner.id),
        firstName: String(owner.full_name ?? "").trim().split(/\s+/)[0] ?? "",
        includeUnclaimed: false,
      })
    }

    const { inboxNeedsReply } = await loadFollowUpSummary({ now })
    for (const recipient of recipients.values()) {
      const digest = buildSalesDigest({
        deals,
        calls,
        ownerProfileId: recipient.profileId,
        includeUnclaimed: recipient.includeUnclaimed,
        now,
      })
      const inbox = recipient.includeUnclaimed ? inboxNeedsReply : 0
      if (digestIsEmpty(digest) && inbox === 0) {
        result.skipped += 1
        continue
      }
      const personKey = `${dayKey}:${recipient.email}`
      if (!(await claim(admin, personKey, now))) {
        result.skipped += 1
        continue
      }
      const sent = await sendSalesDigest({
        to: recipient.email,
        firstName: recipient.firstName,
        digest,
        inboxNeedsReply: inbox,
        now,
      })
      if (sent.ok) {
        result.sent += 1
      } else {
        result.failed += 1
        console.error("[sales-digest] send failed", recipient.email, sent.error)
        await release(admin, personKey)
      }
    }
  } catch (error) {
    result.failed += 1
    console.error("[sales-digest]", error instanceof Error ? error.message : "Digest failed.")
  }
  if (result.failed > 0) await release(admin, dayKey)
  return result
}
