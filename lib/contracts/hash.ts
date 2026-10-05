import { createHash, randomBytes } from "crypto"
import { normalizeContractDraft, type ContractDraft } from "@/lib/contracts/content"

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }
  return value
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

export function contractContentHash(draft: ContractDraft): string {
  const normalized = normalizeContractDraft(draft)
  return sha256(
    stableJson({
      title: normalized.title,
      companyName: normalized.companyName,
      clientName: normalized.clientName,
      clientEmail: normalized.clientEmail,
      content: normalized.content,
    }),
  )
}

export function generateInclusionDocumentRef(now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "")
  return `INC-${date}-${randomBytes(4).toString("hex").toUpperCase()}`
}

export function generateContractSigningToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url")
  return { token, tokenHash: sha256(token) }
}
