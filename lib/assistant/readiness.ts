import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows"
import { eventSeasonLabel } from "@/lib/catalog/event-label"
import {
  catalogReadinessIssues,
  contactMissingPhone,
  summarizeReadiness,
  type CatalogReadinessIssue,
  type ContactReadinessRow,
} from "@/lib/assistant/completeness"
import { DEFAULT_SALES_POLICY_SLUG } from "@/lib/assistant/knowledge"

export type AssistantReadinessView = {
  summary: ReturnType<typeof summarizeReadiness>
  catalogIssues: CatalogReadinessIssue[]
  contactsMissingPhone: ContactReadinessRow[]
  catalogChecked: number
  contactsChecked: number
}

export async function loadAssistantReadiness(): Promise<AssistantReadinessView> {
  noStore()
  const supabase = await createClient()
  const today = new Date().toISOString().slice(0, 10)
  const [packages, contacts, policy] = await Promise.all([
    fetchAllRows<{
      id: string
      name: string
      race_id: string | null
      description: string | null
      includes: unknown
      faqs: unknown
      image: string | null
      gallery_images: unknown
      brochure_url: string | null
      is_hidden: boolean | null
      shell_parent_package_id: string | null
      races: { name?: string; event_date?: string; season?: number } | { name?: string; event_date?: string; season?: number }[] | null
    }>((from, to) =>
      supabase
        .from("packages")
        .select(
          "id, name, race_id, description, includes, faqs, image, gallery_images, brochure_url, is_hidden, shell_parent_package_id, races(name, event_date, season)",
        )
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<{
      id: string
      account_id: string
      full_name: string
      email: string | null
      phone: string | null
      crm_accounts: { name?: string } | { name?: string }[] | null
    }>((from, to) =>
      supabase
        .from("crm_contacts")
        .select("id, account_id, full_name, email, phone, crm_accounts(name)")
        .eq("active", true)
        .order("id")
        .range(from, to),
    ),
    supabase.from("knowledge_articles").select("id").eq("slug", DEFAULT_SALES_POLICY_SLUG).eq("active", true).maybeSingle(),
  ])

  const upcoming = (packages.data ?? []).filter((row) => {
    const race = Array.isArray(row.races) ? row.races[0] : row.races
    const eventDate = race?.event_date ? String(race.event_date).slice(0, 10) : ""
    return !eventDate || eventDate >= today
  })
  const catalogIssues = catalogReadinessIssues(
    upcoming.map((row) => {
      const race = Array.isArray(row.races) ? row.races[0] : row.races
      return {
        id: row.id,
        name: row.name,
        raceName: eventSeasonLabel(String(race?.name ?? ""), race?.season ?? null),
        description: row.description,
        includes: row.includes,
        faqs: row.faqs,
        image: row.image,
        galleryImages: row.gallery_images,
        brochureUrl: row.brochure_url,
        hidden: Boolean(row.is_hidden),
        shell: Boolean(row.shell_parent_package_id),
      }
    }),
  )
  const missingPhones = (contacts.data ?? [])
    .map((row) => {
      const account = Array.isArray(row.crm_accounts) ? row.crm_accounts[0] : row.crm_accounts
      return contactMissingPhone({
        id: row.id,
        accountId: row.account_id,
        accountName: account?.name?.trim() || "Account",
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
      })
    })
    .filter((row): row is ContactReadinessRow => Boolean(row))

  return {
    summary: summarizeReadiness({
      catalogIssues,
      catalogChecked: upcoming.filter((row) => !row.is_hidden && !row.shell_parent_package_id).length,
      contactsMissingPhone: missingPhones.length,
      contactsChecked: (contacts.data ?? []).length,
      policyArticle: Boolean(policy.data?.id),
    }),
    catalogIssues,
    contactsMissingPhone: missingPhones.slice(0, 80),
    catalogChecked: upcoming.filter((row) => !row.is_hidden && !row.shell_parent_package_id).length,
    contactsChecked: (contacts.data ?? []).length,
  }
}
