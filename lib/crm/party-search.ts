import { rankBySearchScore, searchMatchScore } from "@/lib/admin/ranked-search"
import type { CrmAccountOption, CrmContactOption } from "@/lib/crm/deal-types"

export const CRM_PARTY_RESULT_LIMIT = 50

export type CrmPartySearchHit = {
  key: string
  kind: "account" | "contact"
  account: CrmAccountOption
  contactId?: string
  label: string
  hint: string
}

function contactHint(accountName: string, contact: CrmContactOption): string {
  const bits = [accountName, contact.email, contact.phone].filter(Boolean)
  return bits.join(" · ")
}

export function mergeCrmAccountOptions(accounts: CrmAccountOption[]): CrmAccountOption[] {
  const byId = new Map<string, CrmAccountOption>()
  for (const account of accounts) {
    const existing = byId.get(account.id)
    if (!existing) {
      byId.set(account.id, {
        id: account.id,
        name: account.name,
        contacts: [...account.contacts],
      })
      continue
    }
    const seen = new Set(existing.contacts.map((contact) => contact.id))
    byId.set(account.id, {
      ...existing,
      name: existing.name || account.name,
      contacts: [
        ...existing.contacts,
        ...account.contacts.filter((contact) => !seen.has(contact.id)),
      ],
    })
  }
  return [...byId.values()]
}

export function searchCrmPartiesLocal(
  accounts: CrmAccountOption[],
  query: string,
  limit = CRM_PARTY_RESULT_LIMIT,
): CrmPartySearchHit[] {
  const q = query.trim()
  if (!q) return []

  const hits: Array<CrmPartySearchHit & { score: number }> = []
  for (const account of accounts) {
    const accountScore = searchMatchScore(account.name, q)
    if (accountScore > 0) {
      hits.push({
        key: `account:${account.id}`,
        kind: "account",
        account,
        label: account.name,
        hint:
          account.contacts.length === 1
            ? "Account · 1 contact"
            : `Account · ${account.contacts.length} contacts`,
        score: accountScore + 40,
      })
    }
    for (const contact of account.contacts) {
      const contactScore = Math.max(
        searchMatchScore(contact.full_name, q),
        searchMatchScore(contact.email ?? "", q),
        searchMatchScore(contact.phone ?? "", q),
      )
      if (contactScore <= 0) continue
      hits.push({
        key: `contact:${contact.id}`,
        kind: "contact",
        account,
        contactId: contact.id,
        label: contact.full_name,
        hint: contactHint(account.name, contact),
        score: contactScore,
      })
    }
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.kind === "contact") - Number(b.kind === "contact") ||
      a.label.localeCompare(b.label),
  )

  const seen = new Set<string>()
  const unique: CrmPartySearchHit[] = []
  for (const hit of hits) {
    if (seen.has(hit.key)) continue
    seen.add(hit.key)
    unique.push(hit)
    if (unique.length >= limit) break
  }
  return unique
}

export function mergeCrmPartyHits(
  local: CrmPartySearchHit[],
  remote: CrmPartySearchHit[],
  query: string,
  limit = CRM_PARTY_RESULT_LIMIT,
): CrmPartySearchHit[] {
  const accounts = mergeCrmAccountOptions([
    ...local.map((hit) => hit.account),
    ...remote.map((hit) => hit.account),
  ])
  const byId = new Map(accounts.map((account) => [account.id, account]))
  const rebuilt = [...local, ...remote].map((hit) => ({
    ...hit,
    account: byId.get(hit.account.id) ?? hit.account,
  }))
  return rankBySearchScore(
    rebuilt.filter((hit, index, rows) => rows.findIndex((row) => row.key === hit.key) === index),
    query,
    (hit) => `${hit.label} ${hit.hint}`,
  ).slice(0, limit)
}
