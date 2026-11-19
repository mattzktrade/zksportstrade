export type CountryOption = {
  name: string
  code: string
}

/** Country names with ISO 3166-1 alpha-2 codes for enquiry/event create. */
export const COUNTRY_OPTIONS: CountryOption[] = [
  { name: "United Arab Emirates", code: "AE" },
  { name: "United Kingdom", code: "GB" },
  { name: "United States", code: "US" },
  { name: "Australia", code: "AU" },
  { name: "Austria", code: "AT" },
  { name: "Bahrain", code: "BH" },
  { name: "Belgium", code: "BE" },
  { name: "Brazil", code: "BR" },
  { name: "Canada", code: "CA" },
  { name: "China", code: "CN" },
  { name: "France", code: "FR" },
  { name: "Germany", code: "DE" },
  { name: "Hungary", code: "HU" },
  { name: "India", code: "IN" },
  { name: "Italy", code: "IT" },
  { name: "Japan", code: "JP" },
  { name: "Mexico", code: "MX" },
  { name: "Monaco", code: "MC" },
  { name: "Netherlands", code: "NL" },
  { name: "Qatar", code: "QA" },
  { name: "Saudi Arabia", code: "SA" },
  { name: "Singapore", code: "SG" },
  { name: "Spain", code: "ES" },
  { name: "Switzerland", code: "CH" },
  { name: "Azerbaijan", code: "AZ" },
  { name: "Portugal", code: "PT" },
  { name: "South Africa", code: "ZA" },
  { name: "Ireland", code: "IE" },
  { name: "Sweden", code: "SE" },
  { name: "Norway", code: "NO" },
  { name: "Denmark", code: "DK" },
  { name: "Finland", code: "FI" },
  { name: "Poland", code: "PL" },
  { name: "Czech Republic", code: "CZ" },
  { name: "Greece", code: "GR" },
  { name: "Turkey", code: "TR" },
  { name: "Egypt", code: "EG" },
  { name: "Morocco", code: "MA" },
  { name: "Kuwait", code: "KW" },
  { name: "Oman", code: "OM" },
  { name: "Jordan", code: "JO" },
  { name: "Lebanon", code: "LB" },
  { name: "Hong Kong", code: "HK" },
  { name: "South Korea", code: "KR" },
  { name: "Thailand", code: "TH" },
  { name: "Malaysia", code: "MY" },
  { name: "Indonesia", code: "ID" },
  { name: "New Zealand", code: "NZ" },
  { name: "Argentina", code: "AR" },
  { name: "Chile", code: "CL" },
  { name: "Colombia", code: "CO" },
  { name: "Croatia", code: "HR" },
  { name: "Serbia", code: "RS" },
  { name: "Ukraine", code: "UA" },
  { name: "Russia", code: "RU" },
  { name: "Israel", code: "IL" },
]

const BY_CODE = new Map(COUNTRY_OPTIONS.map((country) => [country.code, country]))
const BY_NAME = new Map(COUNTRY_OPTIONS.map((country) => [country.name.toLowerCase(), country]))

export function countryOptionFromCode(code: string): CountryOption | null {
  return BY_CODE.get(code.trim().toUpperCase()) ?? null
}

export function countryOptionFromName(name: string): CountryOption | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  return BY_NAME.get(trimmed.toLowerCase()) ?? null
}

export function resolveCountryInput(name: string, code?: string): { name: string; code: string } | null {
  const fromCode = code ? countryOptionFromCode(code) : null
  if (fromCode) return { name: fromCode.name, code: fromCode.code }
  const fromName = countryOptionFromName(name)
  if (fromName) return { name: fromName.name, code: fromName.code }
  const trimmedName = name.trim()
  const trimmedCode = (code ?? "").trim().toUpperCase().slice(0, 8)
  if (trimmedName && trimmedCode) return { name: trimmedName, code: trimmedCode }
  return null
}
