import { isSalesforceDuplicateError, extractDuplicateRecordId } from "@/lib/integrations/salesforce/duplicate"
import { salesforceQuery, salesforceRequest } from "@/lib/integrations/salesforce/client"

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

const PLACEHOLDER_CLIENT_EMAILS = new Set([
  "tbc",
  "tba",
  "n/a",
  "na",
  "none",
  "pending",
  "unknown",
  "-",
  "—",
])

/** Returns a normalised email for SF, or null when missing / placeholder / invalid format. */
export function clientEmailForSalesforce(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim().toLowerCase()
  if (!trimmed) return null
  if (PLACEHOLDER_CLIENT_EMAILS.has(trimmed)) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
  return trimmed
}

function splitName(full: string): { firstName: string; lastName: string } {
  const t = full.trim()
  if (!t) return { firstName: "Guest", lastName: "Client" }
  const i = t.indexOf(" ")
  if (i <= 0) return { firstName: t.slice(0, 40), lastName: "—" }
  return { firstName: t.slice(0, i).slice(0, 40), lastName: t.slice(i + 1).trim().slice(0, 80) || "—" }
}

export type AgentContactInput = {
  accountId: string
  fullName: string
  email: string
  phone?: string | null
}

export type ResolvedAgentSalesforce = {
  accountId: string
  contactId: string
}

export type ResolveAgentInput = {
  companyOrAccountName: string
  fullName: string
  email: string
  phone?: string | null
}

async function findContactByEmailGlobal(email: string): Promise<{ Id: string; AccountId: string } | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null
  const rows = await salesforceQuery<{ Id: string; AccountId: string }>(
    `SELECT Id, AccountId FROM Contact WHERE Email = '${escapeSoqlString(normalized)}' ORDER BY LastModifiedDate DESC LIMIT 1`,
  )
  return rows[0]?.Id && rows[0]?.AccountId ? rows[0] : null
}

async function findOrCreateAgentAccount(accountName: string): Promise<string> {
  const name = accountName.trim().slice(0, 255) || "Trade Portal Agent"
  const rows = await salesforceQuery<{ Id: string }>(
    `SELECT Id FROM Account WHERE Name = '${escapeSoqlString(name)}' LIMIT 1`,
  )
  if (rows[0]?.Id) return rows[0].Id

  try {
    const created = await salesforceRequest<{ id: string }>("POST", "/sobjects/Account", {
      body: {
        Name: name,
        Type: "Partner",
      },
    })
    return created.id
  } catch (e) {
    if (isSalesforceDuplicateError(e)) {
      const dupId = extractDuplicateRecordId(e, "Account")
      if (dupId) return dupId
      const retry = await salesforceQuery<{ Id: string }>(
        `SELECT Id FROM Account WHERE Name = '${escapeSoqlString(name)}' LIMIT 1`,
      )
      if (retry[0]?.Id) return retry[0].Id
    }
    throw e
  }
}

/**
 * Resolve the trade agent Account + Contact for an Opportunity.
 * Reuses an existing Contact when the agent email already exists in Salesforce
 * (common for new portal signups that share an email with an existing SF contact).
 */
export async function resolveAgentForSalesforce(input: ResolveAgentInput): Promise<ResolvedAgentSalesforce> {
  const email = input.email.trim().toLowerCase()

  if (email) {
    const existing = await findContactByEmailGlobal(email)
    if (existing) {
      return { accountId: existing.AccountId, contactId: existing.Id }
    }
  }

  const accountId = await findOrCreateAgentAccount(input.companyOrAccountName || input.fullName || input.email)
  const contactId = await findOrCreateAgentContact({
    accountId,
    fullName: input.fullName || input.companyOrAccountName || input.email,
    email: input.email,
    phone: input.phone,
  })

  return { accountId, contactId }
}

/**
 * Resolve the trade agent's Contact on their Salesforce Account (the person you deal with —
 * e.g. "Admin" on the ZK Sports account). End-client / guest details belong on the
 * Opportunity description only, not as the primary Contact Role.
 */
export async function findOrCreateAgentContact(input: AgentContactInput): Promise<string> {
  const accountId = input.accountId.trim()
  const email = input.email.trim().toLowerCase()
  const { firstName, lastName } = splitName(input.fullName)

  if (email) {
    const global = await findContactByEmailGlobal(email)
    if (global) return global.Id

    const byEmail = await salesforceQuery<{ Id: string }>(
      `SELECT Id FROM Contact WHERE AccountId = '${escapeSoqlString(accountId)}' AND Email = '${escapeSoqlString(email)}' ORDER BY LastModifiedDate DESC LIMIT 1`,
    )
    if (byEmail[0]?.Id) return byEmail[0].Id
  }

  const byName = await salesforceQuery<{ Id: string }>(
    `SELECT Id FROM Contact WHERE AccountId = '${escapeSoqlString(accountId)}' AND FirstName = '${escapeSoqlString(firstName)}' AND LastName = '${escapeSoqlString(lastName)}' ORDER BY LastModifiedDate DESC LIMIT 1`,
  )
  if (byName[0]?.Id) return byName[0].Id

  // Account already has a single contact (common for agent accounts) — use that person.
  const onAccount = await salesforceQuery<{ Id: string }>(
    `SELECT Id FROM Contact WHERE AccountId = '${escapeSoqlString(accountId)}' ORDER BY CreatedDate ASC LIMIT 2`,
  )
  if (onAccount.length === 1) return onAccount[0].Id

  const body: Record<string, unknown> = {
    AccountId: accountId,
    FirstName: firstName,
    LastName: lastName,
    Phone: input.phone?.trim() || null,
  }
  if (email) body.Email = email

  try {
    const created = await salesforceRequest<{ id: string }>("POST", "/sobjects/Contact", { body })
    return created.id
  } catch (e) {
    if (!isSalesforceDuplicateError(e)) throw e

    const dupContactId = extractDuplicateRecordId(e, "Contact")
    if (dupContactId) return dupContactId

    if (email) {
      const retryGlobal = await findContactByEmailGlobal(email)
      if (retryGlobal) return retryGlobal.Id

      const retryEmail = await salesforceQuery<{ Id: string }>(
        `SELECT Id FROM Contact WHERE AccountId = '${escapeSoqlString(accountId)}' AND Email = '${escapeSoqlString(email)}' ORDER BY LastModifiedDate DESC LIMIT 1`,
      )
      if (retryEmail[0]?.Id) return retryEmail[0].Id
    }
    const retryName = await salesforceQuery<{ Id: string }>(
      `SELECT Id FROM Contact WHERE AccountId = '${escapeSoqlString(accountId)}' AND FirstName = '${escapeSoqlString(firstName)}' AND LastName = '${escapeSoqlString(lastName)}' ORDER BY LastModifiedDate DESC LIMIT 1`,
    )
    if (retryName[0]?.Id) return retryName[0].Id
    throw e
  }
}

/** Link the trade agent as the sole primary Contact on the Opportunity. */
export async function linkPrimaryContactToOpportunity(
  opportunityId: string,
  contactId: string,
): Promise<void> {
  const roles = await salesforceQuery<{ Id: string; ContactId: string; IsPrimary: boolean }>(
    `SELECT Id, ContactId, IsPrimary FROM OpportunityContactRole WHERE OpportunityId = '${escapeSoqlString(opportunityId)}'`,
  )

  // Demote any existing primary (e.g. a previously synced end-client contact).
  for (const role of roles) {
    if (role.IsPrimary && role.ContactId !== contactId) {
      await salesforceRequest("PATCH", `/sobjects/OpportunityContactRole/${role.Id}`, {
        body: { IsPrimary: false },
      })
    }
  }

  const agentRole = roles.find((r) => r.ContactId === contactId)
  if (!agentRole) {
    await salesforceRequest("POST", "/sobjects/OpportunityContactRole", {
      body: {
        OpportunityId: opportunityId,
        ContactId: contactId,
        IsPrimary: true,
      },
    })
  } else if (!agentRole.IsPrimary) {
    await salesforceRequest("PATCH", `/sobjects/OpportunityContactRole/${agentRole.Id}`, {
      body: { IsPrimary: true },
    })
  }
}
