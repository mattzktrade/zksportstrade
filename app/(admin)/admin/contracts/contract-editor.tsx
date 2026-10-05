"use client"

import { useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  Download,
  Plus,
  Send,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { CrmPartySelect } from "@/components/admin/crm-party-select"
import { createCrmAccount } from "@/app/(admin)/admin/clients/profile-actions"
import type { CrmAccountOption } from "@/lib/crm/deal-types"
import { mergeCrmAccountOptions } from "@/lib/crm/party-search"
import {
  contractIsEditable,
  contractLinkExpired,
  contractStatusLabel,
  type ContractContent,
  type ContractDraft,
  type ContractSection,
  type ContractStatus,
} from "@/lib/contracts/content"
import {
  downloadInclusionContractPdf,
  duplicateInclusionContract,
  previewInclusionContractPdf,
  saveInclusionContract,
  sendInclusionContract,
  voidInclusionContract,
} from "./actions"

export type ContractEditorInitial = {
  id: string | null
  documentRef: string | null
  title: string
  companyName: string
  clientName: string
  clientEmail: string
  dealId: string | null
  dealReference: string | null
  accountId: string | null
  contactId: string | null
  content: ContractContent
  status: ContractStatus
  expiresAt: string | null
  signedAt: string | null
  signerName: string | null
  signerPosition: string | null
  lastError: string | null
  signingUrl: string | null
  templateNote: string | null
  events: Array<{ id: string; eventType: string; actorEmail: string | null; createdAt: string }>
}

const fieldClass =
  "mt-1.5 h-10 w-full rounded-md border border-[#e5e7eb] bg-white px-3 text-sm outline-none focus:border-[#F90202]/40"
const textAreaClass =
  "mt-1.5 w-full rounded-md border border-[#e5e7eb] bg-white px-3 py-2 text-sm outline-none focus:border-[#F90202]/40"

const EVENT_LABELS: Record<string, string> = {
  created: "Created",
  saved: "Saved",
  sent: "Sent for signature",
  resent: "Resent",
  viewed: "Opened by the client",
  signed: "Signed",
  voided: "Voided",
}

function when(value: string | null): string {
  if (!value) return ""
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function ContractEditor({
  initial,
  canManage,
}: {
  initial: ContractEditorInitial
  canManage: boolean
}) {
  const router = useRouter()
  const inFlight = useRef(false)
  const [title, setTitle] = useState(initial.title)
  const [companyName, setCompanyName] = useState(initial.companyName)
  const [clientName, setClientName] = useState(initial.clientName)
  const [clientEmail, setClientEmail] = useState(initial.clientEmail)
  const [dealId, setDealId] = useState(initial.dealId)
  const [dealReference, setDealReference] = useState(initial.dealReference)
  const [accountId, setAccountId] = useState(initial.accountId)
  const [contactId, setContactId] = useState(initial.contactId)
  const [accounts, setAccounts] = useState<CrmAccountOption[]>(() => {
    if (!initial.accountId) return []
    return [{
      id: initial.accountId,
      name: initial.companyName,
      contacts: initial.contactId
        ? [{ id: initial.contactId, full_name: initial.clientName, email: initial.clientEmail, phone: null }]
        : [],
    }]
  })
  const [content, setContent] = useState<ContractContent>(initial.content)
  const [signingUrl, setSigningUrl] = useState(initial.signingUrl)
  const [pending, setPending] = useState<"save" | "send" | "void" | "preview" | "duplicate" | null>(null)
  const [confirmVoid, setConfirmVoid] = useState(false)

  const locked = !canManage || !contractIsEditable(initial.status)
  const expired = contractLinkExpired(initial.status, initial.expiresAt)
  const statusLabel = contractStatusLabel(initial.status, initial.expiresAt)

  const draft = useMemo<ContractDraft>(
    () => ({ title, companyName, clientName, clientEmail, content }),
    [title, companyName, clientName, clientEmail, content],
  )
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null

  function rememberAccount(account: CrmAccountOption) {
    setAccounts((current) => mergeCrmAccountOptions([...current, account]))
  }

  function applyParty(account: CrmAccountOption, nextContactId?: string) {
    if (!account.id) {
      setAccountId(null)
      setContactId(null)
      return
    }
    rememberAccount(account)
    setAccountId(account.id)
    setCompanyName(account.name)
    const contact = nextContactId
      ? account.contacts.find((row) => row.id === nextContactId)
      : account.contacts.find((row) => row.email) ?? account.contacts[0]
    if (contact) {
      setContactId(contact.id)
      setClientName(contact.full_name)
      setClientEmail(contact.email ?? "")
    } else {
      setContactId(null)
    }
  }

  function patchSection(id: string, patch: Partial<ContractSection>) {
    setContent((current) => ({
      ...current,
      sections: current.sections.map((section) => (section.id === id ? { ...section, ...patch } : section)),
    }))
  }

  function moveSection(index: number, direction: -1 | 1) {
    setContent((current) => {
      const next = [...current.sections]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      const [row] = next.splice(index, 1)
      next.splice(target, 0, row)
      return { ...current, sections: next }
    })
  }

  async function run(kind: "save" | "send" | "void" | "preview" | "duplicate", action: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setPending(kind)
    try {
      await action()
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  function goTo(id: string | undefined) {
    if (id && id !== initial.id) router.replace(`/admin/contracts/${id}`)
    else router.refresh()
  }

  const links = {
    id: initial.id,
    draft,
    dealId,
    accountId,
    contactId,
  }

  return (
    <div className="mx-auto max-w-[1540px] p-3 sm:p-5 lg:p-7">
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/contracts" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#5f636b] hover:text-[#18191c]">
          <ArrowLeft className="h-4 w-4" />
          All contracts
        </Link>
        <span className="rounded-full bg-[#f4f5f7] px-3 py-1 text-xs font-semibold text-[#25272b]">{statusLabel}</span>
      </div>

      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#18191c]">
          {initial.id ? initial.documentRef : "New contract"}
        </h1>
      </div>

      {initial.templateNote ? (
        <div className="rounded-lg border border-[#eceef1] bg-white px-4 py-3 text-sm text-[#25272b]">
          {initial.templateNote}
        </div>
      ) : null}
      {initial.lastError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {initial.lastError}
        </div>
      ) : null}
      {initial.status === "signed" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          Signed{initial.signedAt ? ` ${when(initial.signedAt)}` : ""}
          {initial.signerName ? ` by ${initial.signerName}` : ""}
          {initial.signerPosition ? `, ${initial.signerPosition}` : ""}. This copy is locked. Duplicate it if something needs to change.
        </div>
      ) : null}
      {expired ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          The signing link has expired. Send a new link when the inclusions are ready.
        </div>
      ) : null}
      {!locked && initial.status !== "draft" ? (
        <div className="rounded-lg border border-[#eceef1] bg-white px-4 py-3 text-sm text-[#25272b]">
          Saving updates the copy the client sees on their link. Resending emails a fresh 30-day link.
        </div>
      ) : null}

      <section className="space-y-4 rounded-lg border border-[#eceef1] bg-white p-4">
        <div>
          <h2 className="text-sm font-semibold">Who is signing</h2>
          <p className="mt-1 text-xs text-[#80848d]">
            Search an account or contact to fill the details. If they are not in the system yet, type them in and we will create the account.
          </p>
        </div>
        {dealId ? (
          <div className="flex items-center justify-between gap-3 rounded-md bg-[#f7f8fa] px-3 py-2 text-sm">
            <span>
              Linked to deal <span className="font-semibold">{dealReference || "selected deal"}</span>. For your records only.
            </span>
            {!locked ? (
              <button
                type="button"
                className="text-xs font-semibold text-[#5f636b]"
                onClick={() => {
                  setDealId(null)
                  setDealReference(null)
                }}
              >
                Remove
              </button>
            ) : (
              <Link href={`/admin/deals/${dealId}`} className="text-xs font-semibold text-[#F90202]">
                Open deal
              </Link>
            )}
          </div>
        ) : null}
        <label className="block text-sm font-medium">
          Contract title
          <input value={title} disabled={locked} onChange={(event) => setTitle(event.target.value)} className={fieldClass} />
        </label>
        <label className="block text-sm font-medium">
          Company
          {locked ? (
            <input value={companyName} disabled className={fieldClass} />
          ) : (
            <CrmPartySelect
              accountId={accountId ?? ""}
              localAccounts={accounts}
              placeholder="Search accounts and contacts…"
              emptyLabel="No accounts or contacts match"
              createLabel={(query) => `Create “${query}” as a new account`}
              className={fieldClass}
              onQueryChange={(query) => {
                setCompanyName(query)
                if (accountId && query.trim() !== (selectedAccount?.name ?? "")) {
                  setAccountId(null)
                  setContactId(null)
                }
              }}
              onSelect={applyParty}
              onCreate={(query) => {
                void (async () => {
                  const created = await createCrmAccount({
                    name: query,
                    accountTypes: ["direct_client"],
                    source: "manual",
                  })
                  if (!created.ok || !created.accountId) {
                    toast.error(created.ok ? "Could not create that account." : created.message)
                    setCompanyName(query)
                    return
                  }
                  const account = { id: created.accountId, name: query, contacts: [] }
                  rememberAccount(account)
                  setAccountId(created.accountId)
                  setCompanyName(query)
                  setContactId(null)
                  toast.success("Account created. Add the recipient name and email.")
                })()
              }}
            />
          )}
        </label>
        {selectedAccount && selectedAccount.contacts.length > 0 && !locked ? (
          <label className="block text-sm font-medium">
            Saved contacts
            <select
              value={contactId ?? ""}
              onChange={(event) => {
                const nextId = event.target.value
                if (!nextId) {
                  setContactId(null)
                  return
                }
                const contact = selectedAccount.contacts.find((row) => row.id === nextId)
                if (!contact) return
                setContactId(contact.id)
                setClientName(contact.full_name)
                setClientEmail(contact.email ?? "")
              }}
              className={fieldClass}
            >
              <option value="">Type a new recipient</option>
              {selectedAccount.contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.full_name}
                  {contact.email ? ` · ${contact.email}` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Recipient name
            <input
              value={clientName}
              disabled={locked}
              onChange={(event) => {
                const value = event.target.value
                setClientName(value)
                const selected = selectedAccount?.contacts.find((row) => row.id === contactId)
                if (selected && selected.full_name !== value) setContactId(null)
              }}
              className={fieldClass}
            />
          </label>
          <label className="block text-sm font-medium">
            Recipient email
            <input
              type="email"
              value={clientEmail}
              disabled={locked}
              onChange={(event) => {
                const value = event.target.value
                setClientEmail(value)
                const selected = selectedAccount?.contacts.find((row) => row.id === contactId)
                if (selected && (selected.email ?? "") !== value) setContactId(null)
              }}
              className={fieldClass}
            />
          </label>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-[#eceef1] bg-white p-4">
        <h2 className="text-sm font-semibold">Event details</h2>
        <label className="block text-sm font-medium">
          Event
          <input
            value={content.event}
            disabled={locked}
            onChange={(event) => setContent({ ...content, event: event.target.value })}
            className={fieldClass}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Dates
            <input
              value={content.dates}
              disabled={locked}
              onChange={(event) => setContent({ ...content, dates: event.target.value })}
              className={fieldClass}
            />
          </label>
          <label className="block text-sm font-medium">
            Operating hours
            <input
              value={content.operatingHours}
              disabled={locked}
              onChange={(event) => setContent({ ...content, operatingHours: event.target.value })}
              className={fieldClass}
            />
          </label>
        </div>
        <label className="block text-sm font-medium">
          Guest allocation
          <input
            value={content.guestAllocation}
            disabled={locked}
            onChange={(event) => setContent({ ...content, guestAllocation: event.target.value })}
            className={fieldClass}
          />
        </label>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Inclusions</h2>
          {!locked ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm font-semibold text-[#F90202]"
              onClick={() =>
                setContent({
                  ...content,
                  sections: [
                    ...content.sections,
                    { id: crypto.randomUUID(), heading: "", bullets: [""] },
                  ],
                })
              }
            >
              <Plus className="h-4 w-4" />
              Add section
            </button>
          ) : null}
        </div>
        {content.sections.map((section, index) => (
          <article key={section.id} className="space-y-3 rounded-lg border border-[#eceef1] bg-white p-4">
            <div className="flex items-start gap-2">
              <span className="mt-2 w-6 text-sm font-semibold text-[#80848d]">{index + 1}.</span>
              <input
                value={section.heading}
                disabled={locked}
                placeholder="Section heading"
                onChange={(event) => patchSection(section.id, { heading: event.target.value })}
                className="h-10 min-w-0 flex-1 rounded-md border border-[#e5e7eb] px-3 text-sm font-medium outline-none focus:border-[#F90202]/40"
              />
              {!locked ? (
                <div className="flex shrink-0 gap-1">
                  <IconButton label="Move section up" disabled={index === 0} onClick={() => moveSection(index, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label="Move section down"
                    disabled={index === content.sections.length - 1}
                    onClick={() => moveSection(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label="Remove section"
                    onClick={() =>
                      setContent({
                        ...content,
                        sections: content.sections.filter((row) => row.id !== section.id),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              ) : null}
            </div>
            <ul className="space-y-2 pl-8">
              {section.bullets.map((bullet, bulletIndex) => (
                <li key={`${section.id}-${bulletIndex}`} className="flex gap-2">
                  <input
                    value={bullet}
                    disabled={locked}
                    placeholder="Inclusion"
                    onChange={(event) => {
                      const bullets = [...section.bullets]
                      bullets[bulletIndex] = event.target.value
                      patchSection(section.id, { bullets })
                    }}
                    className="h-10 min-w-0 flex-1 rounded-md border border-[#e5e7eb] px-3 text-sm outline-none focus:border-[#F90202]/40"
                  />
                  {!locked ? (
                    <IconButton
                      label="Remove point"
                      onClick={() =>
                        patchSection(section.id, {
                          bullets: section.bullets.filter((_, item) => item !== bulletIndex),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
            {!locked ? (
              <button
                type="button"
                className="ml-8 text-sm font-medium text-[#5f636b]"
                onClick={() => patchSection(section.id, { bullets: [...section.bullets, ""] })}
              >
                Add point
              </button>
            ) : null}
          </article>
        ))}
        {content.sections.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#e5e7eb] bg-white px-4 py-6 text-center text-sm text-[#80848d]">
            No sections yet.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-[#eceef1] bg-white p-4">
        <label className="block text-sm font-medium">
          Sentence above the signature
          <textarea
            value={content.confirmationIntro}
            disabled={locked}
            rows={3}
            onChange={(event) => setContent({ ...content, confirmationIntro: event.target.value })}
            className={textAreaClass}
          />
        </label>
        <p className="mt-2 text-xs text-[#80848d]">
          The client adds their name, position, signature, and the date on the signing page.
        </p>
      </section>

      {initial.events.length > 0 ? (
        <section className="rounded-lg border border-[#eceef1] bg-white p-4">
          <h2 className="text-sm font-semibold">Activity</h2>
          <ul className="mt-3 space-y-2">
            {initial.events.map((event) => (
              <li key={event.id} className="flex flex-wrap justify-between gap-2 text-sm">
                <span>{EVENT_LABELS[event.eventType] ?? event.eventType}</span>
                <span className="text-[#80848d]">
                  {when(event.createdAt)}
                  {event.actorEmail ? ` · ${event.actorEmail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#eceef1] bg-white p-3 shadow-sm">
        {!locked ? (
          <>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() =>
                void run("save", async () => {
                  const result = await saveInclusionContract(links)
                  if (!result.ok) {
                    toast.error(result.message)
                    if (result.id) goTo(result.id)
                    return
                  }
                  toast.success(result.message)
                  goTo(result.id)
                })
              }
              className="h-10 rounded-md border border-[#e5e7eb] px-4 text-sm font-semibold disabled:opacity-50"
            >
              {pending === "save" ? "Saving…" : initial.status === "draft" ? "Save draft" : "Save changes"}
            </button>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() =>
                void run("send", async () => {
                  const result = await sendInclusionContract(links)
                  if (!result.ok) {
                    toast.error(result.message)
                    if (result.id) goTo(result.id)
                    return
                  }
                  if (result.signingUrl) setSigningUrl(result.signingUrl)
                  toast.success(result.message)
                  goTo(result.id)
                })
              }
              className="inline-flex h-10 items-center gap-2 rounded-md bg-[#F90202] px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {pending === "send" ? "Sending…" : initial.status === "draft" ? "Send for signature" : "Resend link"}
            </button>
          </>
        ) : null}
        <button
          type="button"
          disabled={pending !== null}
          onClick={() =>
            void run("preview", async () => {
              if (initial.id && initial.status === "signed") {
                const result = await downloadInclusionContractPdf(initial.id)
                if (!result.ok) toast.error(result.message)
                else window.open(result.url, "_blank", "noopener,noreferrer")
                return
              }
              const result = await previewInclusionContractPdf(draft)
              if (!result.ok) {
                toast.error(result.message)
                return
              }
              const binary = atob(result.pdfBase64)
              const bytes = new Uint8Array(binary.length)
              for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
              const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
              window.open(url, "_blank", "noopener,noreferrer")
            })
          }
          className="inline-flex h-10 items-center gap-2 rounded-md border border-[#e5e7eb] px-4 text-sm font-semibold disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {initial.status === "signed" ? "Download signed PDF" : "Preview PDF"}
        </button>
        {signingUrl && !expired && initial.status !== "voided" && initial.status !== "declined" ? (
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[#e5e7eb] px-4 text-sm font-semibold"
            onClick={() => {
              void navigator.clipboard.writeText(signingUrl).then(
                () => toast.success("Signing link copied."),
                () => toast.error("Could not copy the link."),
              )
            }}
          >
            <Copy className="h-4 w-4" />
            Copy link
          </button>
        ) : null}
        {canManage && initial.id ? (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() =>
              void run("duplicate", async () => {
                const result = await duplicateInclusionContract(initial.id!)
                if (!result.ok || !result.id) {
                  toast.error(result.ok ? "Could not duplicate." : result.message)
                  return
                }
                toast.success(result.message)
                router.push(`/admin/contracts/${result.id}`)
              })
            }
            className="h-10 rounded-md px-3 text-sm font-semibold text-[#5f636b] disabled:opacity-50"
          >
            Duplicate
          </button>
        ) : null}
        {canManage && initial.id && contractIsEditable(initial.status) ? (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => {
              if (!confirmVoid) {
                setConfirmVoid(true)
                return
              }
              void run("void", async () => {
                const result = await voidInclusionContract(initial.id!)
                setConfirmVoid(false)
                if (!result.ok) {
                  toast.error(result.message)
                  return
                }
                toast.success(result.message)
                router.refresh()
              })
            }}
            className="ml-auto h-10 rounded-md px-3 text-sm font-semibold text-[#F90202] disabled:opacity-50"
          >
            {confirmVoid ? "Confirm void" : "Void"}
          </button>
        ) : null}
      </div>
    </div>
    </div>
  )
}

function IconButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: ReactNode
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-md border border-[#e5e7eb] text-[#5f636b] disabled:opacity-30"
    >
      {children}
    </button>
  )
}
