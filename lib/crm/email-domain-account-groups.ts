/**
 * Conservative email-domain grouping for CRM companies.
 *
 * Person-named accounts that share one corporate mailbox domain can be folded
 * into a single company. Consumer domains (gmail, outlook, …) are ignored, and
 * mixed corporate domains are left alone.
 */

const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.it",
  "hotmail.de",
  "hotmail.es",
  "live.com",
  "live.co.uk",
  "live.fr",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.es",
  "yahoo.it",
  "yahoo.com.au",
  "yahoo.ca",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "aol.co.uk",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "gmx.com",
  "gmx.co.uk",
  "gmx.de",
  "mail.com",
  "email.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "mail.ru",
  "qq.com",
  "163.com",
  "126.com",
  "sina.com",
  "btinternet.com",
  "btopenworld.com",
  "sky.com",
  "virginmedia.com",
  "ntlworld.com",
  "talktalk.net",
  "blueyonder.co.uk",
  "tiscali.co.uk",
  "plus.com",
  "plus.net",
  "comcast.net",
  "sbcglobal.net",
  "att.net",
  "verizon.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  "optonline.net",
  "rogers.com",
  "shaw.ca",
  "telus.net",
  "sympatico.ca",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "laposte.net",
  "web.de",
  "t-online.de",
  "libero.it",
  "virgilio.it",
  "tin.it",
  "alice.it",
  "naver.com",
  "hanmail.net",
  "daum.net",
  "rediffmail.com",
  "inbox.com",
  "fastmail.com",
  "fastmail.fm",
  "hushmail.com",
  "tutanota.com",
  "tutamail.com",
  "gmx.net",
  "mailinator.com",
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  // Platforms / marketplaces — many unrelated contacts share these domains.
  "salesforce.com",
  "force.com",
  "booking.com",
  "airbnb.com",
  "expedia.com",
  "hotels.com",
  "wix.com",
  "wixsite.com",
  "squarespace.com",
  "shopify.com",
  "zendesk.com",
  "hubspot.com",
  "mailchimp.com",
  "mailchimpapp.com",
  "campaign-archive.com",
  "sendgrid.net",
  "amazonses.com",
  "linkedin.com",
  "facebook.com",
  "facebookmail.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "googlegroups.com",
  "slack.com",
  "zoom.us",
  "calendly.com",
  "intercom.io",
  "crisp.chat",
  "constantcontact.com",
])

const MULTI_PART_TLDS = new Set([
  "co.uk",
  "uk.com",
  "us.com",
  "eu.com",
  "gb.com",
  "gb.net",
  "de.com",
  "br.com",
  "cn.com",
  "ru.com",
  "sa.com",
  "za.com",
  "jpn.com",
  "ae.org",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "net.uk",
  "me.uk",
  "ltd.uk",
  "plc.uk",
  "sch.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "asn.au",
  "id.au",
  "co.nz",
  "net.nz",
  "org.nz",
  "govt.nz",
  "ac.nz",
  "co.za",
  "org.za",
  "web.za",
  "gov.za",
  "ac.za",
  "com.br",
  "com.mx",
  "com.ar",
  "co.jp",
  "ne.jp",
  "or.jp",
  "ac.jp",
  "com.sg",
  "com.hk",
  "com.tr",
  "co.in",
  "firm.in",
  "gen.in",
  "ind.in",
  "net.in",
  "org.in",
  "co.ke",
  "co.il",
  "org.il",
  "com.cn",
  "com.tw",
  "co.id",
  "com.my",
  "com.ph",
  "com.vn",
  "co.th",
  "com.pk",
  "com.sa",
  "com.eg",
  "com.ng",
  "co.tz",
  "co.ug",
  "co.zw",
  "com.pt",
  "com.es",
  "com.pl",
  "com.ua",
  "com.ro",
  "com.gr",
  "co.at",
  "or.at",
  "ac.at",
  "co.kr",
  "or.kr",
  "ac.kr",
  "com.be",
  "co.ee",
])

const MAILBOX_ACCOUNT_NAMES = new Set([
  "accounts",
  "account",
  "admin",
  "info",
  "sales",
  "office",
  "enquiry",
  "enquiries",
  "inquiries",
  "contact",
  "hello",
  "bookings",
  "reservations",
  "support",
  "billing",
  "finance",
  "reception",
  "mail",
  "team",
  "marketing",
  "operations",
  "info desk",
  "purchasing",
  "invoices",
  "invoice",
  "payments",
  "orders",
  "procurement",
  "webmaster",
  "postmaster",
  "newsletter",
  "notifications",
  "press",
  "hospitality",
  "logistics",
])

const COMPANY_NAME_MARKERS = [
  "ltd",
  "limited",
  "inc",
  "llc",
  "gmbh",
  "plc",
  "pty",
  "sa",
  "nv",
  "bv",
  "ag",
  "llp",
  "lp",
  "corp",
  "corporation",
  "company",
  "group",
  "holdings",
  "holding",
  "agency",
  "agencies",
  "travel",
  "tours",
  "tourism",
  "hospitality",
  "tickets",
  "ticket",
  "racing",
  "motorsport",
  "motorsports",
  "events",
  "event",
  "entertainment",
  "sports",
  "sport",
  "concierge",
  "logistics",
  "solutions",
  "services",
  "service",
  "international",
  "worldwide",
  "global",
  "partners",
  "partner",
  "consulting",
  "consultants",
  "management",
  "marketing",
  "media",
  "productions",
  "studio",
  "studios",
  "club",
  "hotels",
  "hotel",
  "resorts",
  "resort",
  "airlines",
  "airline",
  "aviation",
  "formula",
  "grand prix",
  "gp",
  "f1",
  "experiences",
  "experience",
  "vip",
  "premium",
  "associates",
  "association",
  "foundation",
  "institute",
  "university",
  "college",
  "school",
  "bank",
  "capital",
  "investments",
  "investment",
  "ventures",
  "venture",
  "trading",
  "trade",
  "imports",
  "export",
  "exports",
  "wholesale",
  "retail",
  "boutique",
  "gallery",
  "museum",
  "theatre",
  "theater",
  "opera",
  "orchestra",
  "festival",
  "promotions",
  "promotion",
  "communications",
  "network",
  "networks",
  "systems",
  "software",
  "digital",
  "tech",
  "technology",
  "technologies",
  "automotive",
  "motor",
  "motors",
  "cars",
  "auto",
  "supplier",
  "suppliers",
  "distribution",
  "distributors",
  "distributor",
]

const PERSON_STOPWORDS = new Set(["de", "da", "di", "del", "van", "von", "la", "le", "du", "st", "san"])

export type DomainGroupAccount = {
  id: string
  name: string
  email: string | null
  accountTypes: string[]
  contactNames: string[]
  contactEmails: string[]
  dealCount: number
  orderCount: number
  supplierNames: string[]
  createdAt: string
}

export type DomainMergePlan = {
  domain: string
  confidence: "high" | "skip"
  reason: string
  target: DomainGroupAccount | null
  sources: DomainGroupAccount[]
  skippedAccounts: Array<{ account: DomainGroupAccount; reason: string }>
}

export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.trim().toLowerCase().lastIndexOf("@")
  if (at <= 0 || at === email.trim().length - 1) return null
  const host = email
    .trim()
    .toLowerCase()
    .slice(at + 1)
    .replace(/\.+$/, "")
  if (!host || host.includes(" ") || !host.includes(".")) return null
  const parts = host.split(".").filter(Boolean)
  if (parts.length < 2) return null
  const last2 = parts.slice(-2).join(".")
  if (parts.length >= 3 && MULTI_PART_TLDS.has(last2)) {
    return parts.slice(-3).join(".")
  }
  return last2
}

export function isConsumerEmailDomain(domain: string | null | undefined): boolean {
  if (!domain) return true
  return CONSUMER_DOMAINS.has(domain.toLowerCase())
}

export function corporateEmailDomain(email: string | null | undefined): string | null {
  const domain = emailDomain(email)
  if (!domain || isConsumerEmailDomain(domain)) return null
  return domain
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
}

function compact(value: string): string {
  return fold(value).toLowerCase().replace(/[^a-z0-9]/g, "")
}

function words(value: string): string[] {
  return fold(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

const GENERIC_DOMAIN_LABELS = new Set([
  "media",
  "info",
  "mail",
  "shop",
  "team",
  "club",
  "city",
  "bank",
  "news",
  "tech",
  "auto",
  "plus",
  "star",
  "gold",
  "best",
  "home",
  "live",
  "play",
  "park",
  "group",
  "event",
  "events",
  "sport",
  "sports",
  "world",
  "global",
  "online",
  "digital",
  "agency",
  "travel",
  "tours",
  "hotel",
  "hotels",
  "vip",
  "pro",
  "net",
  "web",
  "app",
  "apps",
  "lab",
  "labs",
  "hub",
  "express",
  "direct",
  "smart",
  "fast",
  "easy",
  "prime",
  "first",
  "one",
  "trip",
])

const DOMAIN_NOISE_PREFIXES = ["weare", "we-are", "the", "try", "get", "my", "join", "hello", "hey", "for", "go"] as const

const LEGAL_SUFFIXES = new Set([
  "limited",
  "ltd",
  "llc",
  "inc",
  "plc",
  "gmbh",
  "llp",
  "pty",
  "company",
  "corp",
  "corporation",
  "holdings",
  "holding",
  "group",
  "ag",
  "sa",
  "bv",
  "nv",
  "co",
  "uk",
  "us",
  "uae",
  "fz",
  "fzllc",
])

function secondLevelLabel(domain: string): string {
  const host = domain.toLowerCase()
  const last2 = host.split(".").slice(-2).join(".")
  if (MULTI_PART_TLDS.has(last2)) {
    return host.split(".").slice(-3)[0] ?? host
  }
  return host.split(".").slice(-2)[0] ?? host
}

function nameVariants(name: string): string[] {
  const parts = name
    .split(/\b(?:t\/a|t\/as|trading as|dba|d\/b\/a|aka)\b/i)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length ? parts : [name]
}

function significantTokens(name: string): string[] {
  return words(name).filter((word) => word.length >= 2 && !PERSON_STOPWORDS.has(word) && !LEGAL_SUFFIXES.has(word))
}

function labelsToMatch(domain: string): string[] {
  const raw = secondLevelLabel(domain).replace(/-/g, "")
  const labels = new Set<string>([raw])
  for (const prefix of DOMAIN_NOISE_PREFIXES) {
    const compactPrefix = prefix.replace(/-/g, "")
    if (raw.startsWith(compactPrefix) && raw.length - compactPrefix.length >= 4) {
      labels.add(raw.slice(compactPrefix.length))
    }
  }
  return [...labels]
}

function tokensCanFormLabel(tokens: string[], label: string): boolean {
  if (label.length < 6) return false
  const compactTokens = tokens.map((token) => token.replace(/-/g, ""))
  const n = compactTokens.length
  function search(index: number, built: string, used: number): boolean {
    if (built === label && used >= 1) return true
    if (index >= n || built.length >= label.length) return false
    if (search(index + 1, built, used)) return true
    return search(index + 1, built + compactTokens[index], used + 1)
  }
  return search(0, "", 0)
}

export function accountNameMatchesDomain(name: string, domain: string): boolean {
  const labels = labelsToMatch(domain)
  return nameVariants(name).some((variant) => variantIdentifiesLabel(variant, labels))
}

function variantIdentifiesLabel(name: string, labels: string[]): boolean {
  const squeezed = compact(name)
  if (!squeezed) return false
  const tokens = significantTokens(name)
  const joined = tokens.join("")
  for (const label of labels) {
    if (!label) continue
    if (squeezed === label || joined === label) return true
    if (label.length >= 5 && squeezed.length >= 4 && !GENERIC_DOMAIN_LABELS.has(label)) {
      if (label.startsWith(squeezed)) return true
      if (squeezed.startsWith(label)) {
        const rest = squeezed.slice(label.length)
        if (!rest || LEGAL_SUFFIXES.has(rest)) return true
      }
    }
    if (tokens.some((token) => token.replace(/-/g, "") === label)) {
      if (GENERIC_DOMAIN_LABELS.has(label)) {
        if (tokens[0]?.replace(/-/g, "") === label) return true
        continue
      }
      const rest = tokens.slice(1)
      const extraIsLegalOrMarker = rest.every(
        (token) => LEGAL_SUFFIXES.has(token) || COMPANY_NAME_MARKERS.includes(token),
      )
      if (tokens[0]?.replace(/-/g, "") === label && extraIsLegalOrMarker) return true
      if (tokens.length === 1) return true
      continue
    }
    if (tokensCanFormLabel(tokens, label)) return true
  }
  return false
}

function looksLikePersonWord(word: string): boolean {
  if (PERSON_STOPWORDS.has(word)) return true
  if (word.length < 2) return false
  if (/\d/.test(word)) return false
  return /^[a-z][a-z'-]*$/.test(word)
}

function hasCompanyMarker(name: string): boolean {
  const lowered = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `
  return COMPANY_NAME_MARKERS.some((marker) => lowered.includes(` ${marker} `))
}

function looksLikePersonName(name: string): boolean {
  const nameWords = words(name)
  if (nameWords.length >= 2 && nameWords.length <= 4 && nameWords.every(looksLikePersonWord)) return true
  return false
}

export function isPersonLikeAccountName(name: string, contactNames: string[]): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  if (trimmed.includes("@")) return true
  if (MAILBOX_ACCOUNT_NAMES.has(trimmed.toLowerCase())) return true
  if (hasCompanyMarker(trimmed)) return false
  if (looksLikePersonName(trimmed)) return true
  const squeezed = compact(trimmed)
  const matchingContact = contactNames.some((contact) => compact(contact) === squeezed)
  if (matchingContact && (looksLikePersonName(trimmed) || MAILBOX_ACCOUNT_NAMES.has(trimmed.toLowerCase()))) {
    return true
  }
  const nameWords = words(trimmed)
  if (nameWords.length === 1 && MAILBOX_ACCOUNT_NAMES.has(nameWords[0] ?? "")) return true
  return false
}

export function corporateDomainsForAccount(account: {
  email: string | null
  contactEmails: string[]
}): string[] {
  const found = new Set<string>()
  const domain = corporateEmailDomain(account.email)
  if (domain) found.add(domain)
  for (const email of account.contactEmails) {
    const contactDomain = corporateEmailDomain(email)
    if (contactDomain) found.add(contactDomain)
  }
  return [...found].sort()
}

function pickTarget(
  domain: string,
  companyLike: DomainGroupAccount[],
): { target: DomainGroupAccount; reason: string } | { skip: string } {
  const matching = companyLike.filter((account) => accountNameMatchesDomain(account.name, domain))
  if (matching.length === 0) {
    return { skip: "No company-named account whose name matches this domain." }
  }
  if (matching.length > 1) {
    return {
      skip: `Several company accounts match ${domain}: ${matching.map((account) => account.name).join(", ")}.`,
    }
  }
  return { target: matching[0]!, reason: `Company name matches ${domain}.` }
}

function attachNameMatchedCompanies(
  accounts: DomainGroupAccount[],
  byDomain: Map<string, DomainGroupAccount[]>,
) {
  const matches = new Map<string, string[]>()
  for (const domain of byDomain.keys()) {
    for (const account of accounts) {
      if (isPersonLikeAccountName(account.name, account.contactNames)) continue
      if (!accountNameMatchesDomain(account.name, domain)) continue
      if (corporateDomainsForAccount(account).some((other) => other !== domain)) continue
      const list = matches.get(account.id) ?? []
      list.push(domain)
      matches.set(account.id, list)
    }
  }

  for (const [accountId, domains] of matches) {
    if (domains.length !== 1) continue
    const domain = domains[0]!
    const members = byDomain.get(domain)
    if (!members) continue
    if (members.some((member) => member.id === accountId)) continue
    const account = accounts.find((row) => row.id === accountId)
    if (account) members.push(account)
  }
}

export function companyAccountForDomain(
  accounts: DomainGroupAccount[],
  domain: string,
): DomainGroupAccount | null {
  const companyLike = accounts.filter((account) => {
    if (isPersonLikeAccountName(account.name, account.contactNames)) return false
    if (corporateDomainsForAccount(account).some((other) => other !== domain)) return false
    return (
      corporateDomainsForAccount(account).includes(domain) || accountNameMatchesDomain(account.name, domain)
    )
  })
  const picked = pickTarget(domain, companyLike)
  if ("skip" in picked) return null
  return picked.target
}

export function planDomainAccountMerges(accounts: DomainGroupAccount[]): DomainMergePlan[] {
  const byDomain = new Map<string, DomainGroupAccount[]>()
  const mixed: DomainGroupAccount[] = []

  for (const account of accounts) {
    const domains = corporateDomainsForAccount(account)
    if (domains.length === 0) continue
    if (domains.length > 1) {
      mixed.push(account)
      continue
    }
    const domain = domains[0]!
    const list = byDomain.get(domain) ?? []
    list.push(account)
    byDomain.set(domain, list)
  }

  attachNameMatchedCompanies(accounts, byDomain)

  const plans: DomainMergePlan[] = []
  for (const [domain, members] of [...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const personLike: DomainGroupAccount[] = []
    const companyLike: DomainGroupAccount[] = []

    for (const account of members) {
      if (isPersonLikeAccountName(account.name, account.contactNames)) {
        personLike.push(account)
      } else {
        companyLike.push(account)
      }
    }

    if (personLike.length === 0) continue

    const picked = pickTarget(domain, companyLike)
    if ("skip" in picked) {
      const matchingCompanies = companyLike.filter((account) => accountNameMatchesDomain(account.name, domain))
      if (personLike.length < 2 && matchingCompanies.length <= 1) continue
      plans.push({
        domain,
        confidence: "skip",
        reason: picked.skip,
        target: null,
        sources: personLike,
        skippedAccounts: companyLike.map((account) => ({ account, reason: picked.skip })),
      })
      continue
    }

    const sources = personLike.filter((account) => account.id !== picked.target.id)
    if (sources.length === 0) continue

    plans.push({
      domain,
      confidence: "high",
      reason: picked.reason,
      target: picked.target,
      sources,
      skippedAccounts: companyLike
        .filter((account) => account.id !== picked.target.id)
        .map((account) => ({
          account,
          reason: "Left in place — extra company-named account on this domain.",
        })),
    })
  }

  if (mixed.length) {
    plans.push({
      domain: "(mixed corporate domains)",
      confidence: "skip",
      reason: "These accounts have contacts/emails at more than one company domain.",
      target: null,
      sources: [],
      skippedAccounts: mixed.map((account) => ({
        account,
        reason: corporateDomainsForAccount(account).join(", "),
      })),
    })
  }

  return plans
}
