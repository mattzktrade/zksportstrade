import type { SupabaseClient } from "@supabase/supabase-js"
import { chunkList, fetchAllRows } from "@/lib/supabase/fetch-all-rows"
import type { DealLedgerCandidate } from "@/lib/crm/imports/deal-ledger-match"

type DealRow = {
  id: string
  reference: string
  account_id: string | null
  primary_contact_id: string | null
  stage: string
  total_amount: number | string | null
  expected_close_date: string | null
  created_at: string | null
  ledger_invoice_number?: string | null
}

type LineRow = {
  deal_id: string
  package_id: string
  quantity: number | string | null
  unit_sale_price: number | string | null
  supplier_id: string | null
}

type PackageRow = {
  id: string
  name: string | null
  race_id: string | null
}

type RaceRow = {
  id: string
  name: string
  short_name: string | null
  location: string | null
  country: string | null
  country_code: string | null
  season: number | null
  event_date: string | null
}

function num(value: number | string | null | undefined): number {
  return Number(value ?? 0)
}

export async function loadDealLedgerCatalog(
  supabase: SupabaseClient,
): Promise<DealLedgerCandidate[]> {
  const selectWithLedger =
    "id, reference, account_id, primary_contact_id, stage, total_amount, expected_close_date, created_at, ledger_invoice_number"
  const selectBase =
    "id, reference, account_id, primary_contact_id, stage, total_amount, expected_close_date, created_at"

  let dealsRes = await fetchAllRows<DealRow>((from, to) =>
    supabase.from("deals").select(selectWithLedger).order("id").range(from, to),
  )
  if (dealsRes.error && /ledger_invoice_number|schema cache/i.test(dealsRes.error.message)) {
    dealsRes = await fetchAllRows<DealRow>((from, to) =>
      supabase.from("deals").select(selectBase).order("id").range(from, to),
    )
  }
  if (dealsRes.error) throw new Error(dealsRes.error.message)
  const deals = dealsRes.data
  if (deals.length === 0) return []

  const accountIds = [...new Set(deals.map((deal) => deal.account_id).filter(Boolean))] as string[]
  const dealIds = deals.map((deal) => deal.id)

  const accounts: Array<{ id: string; name: string }> = []
  const contacts: Array<{ account_id: string; full_name: string | null }> = []
  for (const ids of chunkList(accountIds, 100)) {
    const [accountsRes, contactsRes] = await Promise.all([
      supabase.from("crm_accounts").select("id, name").in("id", ids),
      supabase.from("crm_contacts").select("account_id, full_name").in("account_id", ids),
    ])
    if (accountsRes.error) throw new Error(accountsRes.error.message)
    if (contactsRes.error) throw new Error(contactsRes.error.message)
    accounts.push(...((accountsRes.data ?? []) as Array<{ id: string; name: string }>))
    contacts.push(
      ...((contactsRes.data ?? []) as Array<{ account_id: string; full_name: string | null }>),
    )
  }

  const [packagesRes, racesRes, suppliersRes] = await Promise.all([
    fetchAllRows<PackageRow>((from, to) =>
      supabase.from("packages").select("id, name, race_id").order("id").range(from, to),
    ),
    fetchAllRows<RaceRow>((from, to) =>
      supabase
        .from("races")
        .select("id, name, short_name, location, country, country_code, season, event_date")
        .order("id")
        .range(from, to),
    ),
    fetchAllRows<{ id: string; name: string }>((from, to) =>
      supabase.from("suppliers").select("id, name").order("id").range(from, to),
    ),
  ])
  if (packagesRes.error) throw new Error(packagesRes.error.message)
  if (racesRes.error) throw new Error(racesRes.error.message)
  if (suppliersRes.error) throw new Error(suppliersRes.error.message)

  const lines: LineRow[] = []
  for (const chunk of chunkList(dealIds, 200)) {
    const { data, error } = await fetchAllRows<LineRow>((from, to) =>
      supabase
        .from("deal_line_items")
        .select("deal_id, package_id, quantity, unit_sale_price, supplier_id")
        .in("deal_id", chunk)
        .order("id")
        .range(from, to),
    )
    if (error) throw new Error(error.message)
    lines.push(...data)
  }

  const accountNames = new Map(accounts.map((row) => [row.id, row.name]))
  const contactNames = new Map<string, string>()
  for (const contact of contacts) {
    if (!contactNames.has(contact.account_id) && contact.full_name) {
      contactNames.set(contact.account_id, contact.full_name)
    }
  }
  const packages = new Map((packagesRes.data ?? []).map((row) => [row.id, row]))
  const races = new Map((racesRes.data ?? []).map((row) => [row.id, row]))
  const suppliers = new Map((suppliersRes.data ?? []).map((row) => [row.id, row.name]))
  const linesByDeal = new Map<string, DealLedgerCandidate["lines"]>()

  for (const line of lines) {
    const pkg = packages.get(line.package_id)
    const race = pkg?.race_id ? races.get(pkg.race_id) : null
    const bucket = linesByDeal.get(line.deal_id) ?? []
    bucket.push({
      packageId: line.package_id,
      packageName: pkg?.name ?? "",
      raceId: pkg?.race_id ?? null,
      raceName: race?.name ?? "",
      raceShortName: race?.short_name ?? "",
      location: race?.location ?? "",
      country: race?.country ?? "",
      countryCode: race?.country_code ?? "",
      season: race?.season ?? null,
      eventDate: race?.event_date ?? null,
      quantity: num(line.quantity),
      unitSalePrice: num(line.unit_sale_price),
      supplierName: line.supplier_id ? suppliers.get(line.supplier_id) ?? null : null,
    })
    linesByDeal.set(line.deal_id, bucket)
  }

  return deals.map((deal) => ({
    id: deal.id,
    reference: deal.reference,
    accountName: deal.account_id ? accountNames.get(deal.account_id) ?? null : null,
    contactName: deal.account_id ? contactNames.get(deal.account_id) ?? null : null,
    stage: deal.stage,
    totalAmount: num(deal.total_amount),
    expectedCloseDate: deal.expected_close_date,
    createdAt: deal.created_at,
    ledgerInvoiceNumber: deal.ledger_invoice_number ?? null,
    lines: linesByDeal.get(deal.id) ?? [],
  }))
}
