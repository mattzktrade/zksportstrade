"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { X } from "lucide-react"
import { toast } from "sonner"
import { createCrmAccount, upsertCrmContact } from "@/app/(admin)/admin/clients/profile-actions"
import { createNativeDeal } from "@/app/(admin)/actions"
import { AccountKindPills } from "@/components/admin/account-kind-pills"
import { AdminModalScrim } from "@/components/admin/admin-list-preview"
import { CrmPartySelect } from "@/components/admin/crm-party-select"
import {
  DealLineBasket,
  isPricedDealBasketLine,
  numericDealField,
  type DealBasketLine,
  type DealBasketProduct,
  type DealBasketSupplier,
} from "@/components/admin/deal-line-basket"
import { type AccountKind } from "@/lib/crm/account-kinds"
import { DEAL_SOURCE_LABELS, DEAL_SOURCES, type CrmAccountOption } from "@/lib/crm/deal-types"
import { inboundEnquirySource, type EnquiryTemperature } from "@/lib/crm/deal-pipeline"
import { formatMoneyCompact } from "@/lib/format/money"
import { cn } from "@/lib/utils"

export function DealCreateModal({
  accountOptions,
  products,
  suppliers,
  title = "Create new deal",
  description = "Choose the client and product, then confirm pricing and stock.",
  submitLabel = "Create deal",
  onCreated,
  onClose,
}: {
  accountOptions: CrmAccountOption[]
  products: DealBasketProduct[]
  suppliers: DealBasketSupplier[]
  title?: string
  description?: string
  submitLabel?: string
  onCreated?: (dealId?: string) => void
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [accountId, setAccountId] = useState("")
  const [contactId, setContactId] = useState("")
  const [newAccountMode, setNewAccountMode] = useState(false)
  const [newContactMode, setNewContactMode] = useState(false)
  const [newAccountName, setNewAccountName] = useState("")
  const [newAccountTypes, setNewAccountTypes] = useState<AccountKind[]>([])
  const [newContactName, setNewContactName] = useState("")
  const [newContactEmail, setNewContactEmail] = useState("")
  const [newContactPhone, setNewContactPhone] = useState("")
  const [newBillingLine1, setNewBillingLine1] = useState("")
  const [newBillingLine2, setNewBillingLine2] = useState("")
  const [newBillingCity, setNewBillingCity] = useState("")
  const [newBillingPostcode, setNewBillingPostcode] = useState("")
  const [newBillingCountry, setNewBillingCountry] = useState("")
  const [createdAccounts, setCreatedAccounts] = useState<CrmAccountOption[]>([])
  const [createLines, setCreateLines] = useState<DealBasketLine[]>([])
  const [notes, setNotes] = useState("")
  const [createSource, setCreateSource] = useState("offline")
  const [enquiryTemperature, setEnquiryTemperature] = useState<EnquiryTemperature>("warm")
  const [reserve, setReserve] = useState(false)

  const clientAccounts = useMemo(() => {
    const byId = new Map(accountOptions.map((account) => [account.id, account]))
    for (const account of createdAccounts) {
      const existing = byId.get(account.id)
      if (!existing) {
        byId.set(account.id, account)
        continue
      }
      const seen = new Set(existing.contacts.map((contact) => contact.id))
      byId.set(account.id, {
        ...existing,
        contacts: [...existing.contacts, ...account.contacts.filter((contact) => !seen.has(contact.id))],
      })
    }
    return [...byId.values()]
  }, [accountOptions, createdAccounts])

  const selectedAccount = clientAccounts.find((account) => account.id === accountId) ?? null
  const addingNewContact =
    newAccountMode || newContactMode || Boolean(selectedAccount && selectedAccount.contacts.length === 0)
  const hasNewContactDetails = Boolean(newContactName.trim() && newContactEmail.trim())
  const hasNewAccountAddress = Boolean(
    newBillingLine1.trim() && newBillingCity.trim() && newBillingCountry.trim(),
  )
  const canSubmitDeal =
    createLines.length > 0 &&
    (newAccountMode
      ? Boolean(newAccountName.trim() && hasNewContactDetails && hasNewAccountAddress)
      : Boolean(accountId && (addingNewContact ? hasNewContactDetails : contactId)))

  function rememberCreatedClient(account: CrmAccountOption) {
    setCreatedAccounts((current) => {
      const existing = current.find((item) => item.id === account.id)
      if (!existing) return [...current, account]
      const seen = new Set(existing.contacts.map((contact) => contact.id))
      return current.map((item) =>
        item.id === account.id
          ? {
              ...item,
              name: account.name || item.name,
              contacts: [...item.contacts, ...account.contacts.filter((contact) => !seen.has(contact.id))],
            }
          : item,
      )
    })
  }

  function submit() {
    if (newAccountMode) {
      if (!newAccountName.trim()) {
        toast.error(newAccountTypes.includes("direct_client") ? "Enter the client's name." : "Enter the account / company name.")
        return
      }
      if (!newContactName.trim()) {
        toast.error("Add a contact name so we know who to speak to.")
        return
      }
      if (!newContactEmail.trim()) {
        toast.error("Add the contact email — it is used on the booking form and invoice.")
        return
      }
      if (!newBillingLine1.trim() || !newBillingCity.trim() || !newBillingCountry.trim()) {
        toast.error("Add the billing address — it is used on the booking form and invoice. Postcode can be left blank.")
        return
      }
    } else {
      if (!accountId) {
        toast.error("Select an account / company.")
        return
      }
      if (addingNewContact) {
        if (!newContactName.trim()) {
          toast.error("Add a contact name so we know who to speak to.")
          return
        }
        if (!newContactEmail.trim()) {
          toast.error("Add the contact email — it is used on the booking form and invoice.")
          return
        }
      } else if (!contactId) {
        toast.error("Select a contact for this account.")
        return
      }
    }
    if (createLines.length === 0) {
      toast.error("Add at least one product.")
      return
    }
    if (createLines.some((line) => !isPricedDealBasketLine(line))) {
      toast.error("Check the quantity and sale price for every product.")
      return
    }
    startTransition(async () => {
      let resolvedAccountId = accountId
      let resolvedContactId = contactId

      if (newAccountMode) {
        const created = await createCrmAccount({
          name: newAccountName.trim(),
          accountTypes: newAccountTypes,
          source: "manual",
          email: newContactEmail.trim(),
          phone: newContactPhone.trim() || null,
          billing: {
            line1: newBillingLine1.trim(),
            line2: newBillingLine2.trim() || null,
            city: newBillingCity.trim(),
            postcode: newBillingPostcode.trim() || null,
            country: newBillingCountry.trim(),
          },
          contacts: [{
            fullName: newContactName.trim(),
            email: newContactEmail.trim(),
            phone: newContactPhone.trim() || null,
          }],
        })
        if (!created.ok || !created.accountId) {
          toast.error(created.ok ? "Account was created but its id was not returned." : created.message)
          return
        }
        if (!created.contactId) {
          rememberCreatedClient({ id: created.accountId, name: newAccountName.trim(), contacts: [] })
          setAccountId(created.accountId)
          setNewAccountMode(false)
          setNewContactMode(true)
          toast.error("Account created, but the contact could not be saved. Add the contact and try again.")
          return
        }
        resolvedAccountId = created.accountId
        resolvedContactId = created.contactId
        rememberCreatedClient({
          id: created.accountId,
          name: newAccountName.trim(),
          contacts: [{
            id: created.contactId,
            full_name: newContactName.trim(),
            email: newContactEmail.trim(),
            phone: newContactPhone.trim() || null,
          }],
        })
      } else if (addingNewContact) {
        const created = await upsertCrmContact({
          accountId: resolvedAccountId,
          fullName: newContactName.trim(),
          email: newContactEmail.trim(),
          phone: newContactPhone.trim() || null,
          isPrimary: !selectedAccount?.contacts.length,
        })
        if (!created.ok || !created.contactId) {
          toast.error(created.ok ? "Contact was saved but its id was not returned." : created.message)
          return
        }
        resolvedContactId = created.contactId
        rememberCreatedClient({
          id: resolvedAccountId,
          name: selectedAccount?.name ?? "",
          contacts: [{
            id: created.contactId,
            full_name: newContactName.trim(),
            email: newContactEmail.trim(),
            phone: newContactPhone.trim() || null,
          }],
        })
      }

      const result = await createNativeDeal({
        accountId: resolvedAccountId,
        contactId: resolvedContactId,
        lines: createLines.map((line) => ({
          packageId: line.packageId,
          quantity: numericDealField(line.quantity),
          unitPrice: numericDealField(line.unitPrice),
          sourcingMode: line.sourcingMode,
          supplierId: line.supplierId || null,
          expectedUnitCost: line.expectedUnitCost,
          supplierQuoteAt: line.supplierQuoteAt || null,
        })),
        notes,
        reserve,
        source: createSource,
        enquiryTemperature: inboundEnquirySource(createSource) ? "warm" : enquiryTemperature,
      })
      if (!result.ok) {
        toast.error(result.message)
        setAccountId(resolvedAccountId)
        setContactId(resolvedContactId)
        setNewAccountMode(false)
        setNewContactMode(false)
        return
      }
      toast.success(result.message)
      onClose()
      onCreated?.(result.dealId)
      router.refresh()
    })
  }

  return (
    <AdminModalScrim onClose={onClose} zClassName="z-[80]" panelClassName="max-w-4xl overflow-hidden">
      <div className="flex shrink-0 items-start justify-between px-4 pt-4 sm:px-6 sm:pt-6">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        <button type="button" onClick={onClose}><X className="h-5 w-5" /></button>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">1. Client</h3>
            <div className="flex rounded-md border border-slate-200 bg-white p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => {
                  setNewAccountMode(false)
                  setNewContactMode(false)
                }}
                className={cn(
                  "rounded px-3 py-1.5",
                  !newAccountMode ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-50",
                )}
              >
                Existing account
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewAccountMode(true)
                  setAccountId("")
                  setContactId("")
                  setNewContactMode(true)
                }}
                className={cn(
                  "rounded px-3 py-1.5",
                  newAccountMode ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-50",
                )}
              >
                New account
              </button>
            </div>
          </div>

          {newAccountMode ? (
            <div className="mt-4 space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">
                  {newAccountTypes.includes("direct_client") ? "Name" : "Account / company"}
                </span>
                <input
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder={newAccountTypes.includes("direct_client") ? "e.g. Jane Smith" : "e.g. Apex Travel"}
                  className="h-11 w-full rounded-md border bg-white px-3"
                />
                <span className="mt-1.5 block text-xs text-slate-500">
                  If this is a direct client / end user, put their name here instead of a company.
                </span>
              </label>
              <div>
                <p className="mb-1 text-sm font-medium">Type</p>
                <p className="mb-2 text-xs text-slate-500">Select all that apply.</p>
                <AccountKindPills compact value={newAccountTypes} onChange={setNewAccountTypes} />
              </div>
              <div>
                <p className="text-sm font-medium">Billing address</p>
                <p className="mt-0.5 text-xs text-slate-500">Used on the booking form and invoice.</p>
                <div className="mt-3 grid gap-2">
                  <input
                    value={newBillingLine1}
                    onChange={(e) => setNewBillingLine1(e.target.value)}
                    placeholder="Address line 1"
                    className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                  />
                  <input
                    value={newBillingLine2}
                    onChange={(e) => setNewBillingLine2(e.target.value)}
                    placeholder="Address line 2 (optional)"
                    className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                  />
                  <div className="grid gap-2 md:grid-cols-3">
                    <input
                      value={newBillingCity}
                      onChange={(e) => setNewBillingCity(e.target.value)}
                      placeholder="City"
                      className="h-10 rounded-md border bg-white px-3 text-sm"
                    />
                    <input
                      value={newBillingPostcode}
                      onChange={(e) => setNewBillingPostcode(e.target.value)}
                      placeholder="Postcode (optional)"
                      className="h-10 rounded-md border bg-white px-3 text-sm"
                    />
                    <input
                      value={newBillingCountry}
                      onChange={(e) => setNewBillingCountry(e.target.value)}
                      placeholder="Country"
                      className="h-10 rounded-md border bg-white px-3 text-sm"
                    />
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-white bg-white p-3">
                <p className="text-sm font-medium">Primary contact</p>
                <p className="mt-0.5 text-xs text-slate-500">Name and email are required for the booking form and invoice.</p>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <input
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    placeholder="Full name"
                    className="h-10 rounded-md border px-3 text-sm"
                  />
                  <input
                    type="email"
                    value={newContactEmail}
                    onChange={(e) => setNewContactEmail(e.target.value)}
                    placeholder="Email"
                    className="h-10 rounded-md border px-3 text-sm"
                  />
                  <input
                    value={newContactPhone}
                    onChange={(e) => setNewContactPhone(e.target.value)}
                    placeholder="Phone (optional)"
                    className="h-10 rounded-md border px-3 text-sm"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Account / company</span>
                <CrmPartySelect
                  accountId={accountId}
                  localAccounts={clientAccounts}
                  onSelect={(account, nextContactId) => {
                    if (!account.id) {
                      setAccountId("")
                      setContactId("")
                      return
                    }
                    rememberCreatedClient(account)
                    setAccountId(account.id)
                    setContactId(nextContactId ?? "")
                    setNewContactMode(false)
                    setNewContactName("")
                    setNewContactEmail("")
                    setNewContactPhone("")
                  }}
                  placeholder="Search accounts and contacts…"
                  emptyLabel="No accounts or contacts match"
                  className="h-11 w-full rounded-md border bg-white px-3 text-sm outline-none focus:border-primary/50"
                />
              </label>

              {!selectedAccount ? (
                <p className="text-xs text-slate-500">Pick an account, or switch to New account if they are not in the list yet.</p>
              ) : addingNewContact ? (
                <div className="rounded-lg border border-white bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {selectedAccount.contacts.length === 0 ? "Add a contact" : "New contact"}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {selectedAccount.contacts.length === 0
                          ? `${selectedAccount.name} has no contacts yet.`
                          : `Adding someone new at ${selectedAccount.name}.`}
                      </p>
                    </div>
                    {selectedAccount.contacts.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setNewContactMode(false)
                          setNewContactName("")
                          setNewContactEmail("")
                          setNewContactPhone("")
                        }}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Use existing contact
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <input
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                      placeholder="Full name"
                      className="h-10 rounded-md border px-3 text-sm"
                    />
                    <input
                      type="email"
                      value={newContactEmail}
                      onChange={(e) => setNewContactEmail(e.target.value)}
                      placeholder="Email"
                      className="h-10 rounded-md border px-3 text-sm"
                    />
                    <input
                      value={newContactPhone}
                      onChange={(e) => setNewContactPhone(e.target.value)}
                      placeholder="Phone (optional)"
                      className="h-10 rounded-md border px-3 text-sm"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">Contact</span>
                    <button
                      type="button"
                      onClick={() => {
                        setNewContactMode(true)
                        setContactId("")
                      }}
                      className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      + New contact
                    </button>
                  </div>
                  <select
                    value={contactId}
                    onChange={(e) => setContactId(e.target.value)}
                    className="h-11 w-full rounded-md border bg-white px-3 text-sm"
                  >
                    <option value="">Select a contact…</option>
                    {selectedAccount.contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.full_name}{contact.email ? ` · ${contact.email}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 p-4">
          <div>
            <h3 className="text-sm font-semibold">2. Products, events and pricing</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Add products from any event. Each line can use your stock or a fresh broker quote, and its sale price can be changed.
            </p>
          </div>
          <div className="mt-3">
            <DealLineBasket
              products={products}
              suppliers={suppliers}
              lines={createLines}
              onChange={setCreateLines}
            />
          </div>
          <div className="mt-4 flex items-center justify-between border-t pt-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={reserve} onChange={(event) => setReserve(event.target.checked)} />
              Place a seven-day hold now
            </label>
            <div className="text-right">
              <p className="text-[10px] uppercase text-slate-400">Total</p>
              <p className="text-lg font-semibold">
                {formatMoneyCompact(
                  "USD",
                  createLines.reduce((sum, line) => sum + numericDealField(line.quantity) * numericDealField(line.unitPrice), 0),
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Source</span>
            <select
              value={createSource}
              onChange={(e) => {
                const next = e.target.value
                setCreateSource(next)
                if (inboundEnquirySource(next)) setEnquiryTemperature("warm")
              }}
              className="h-11 w-full rounded-md border bg-white px-3"
            >
              {DEAL_SOURCES.map((source) => (
                <option key={source} value={source}>{DEAL_SOURCE_LABELS[source]}</option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <p className="mb-1 font-medium">Warm / Cold</p>
            <div className="flex h-11 rounded-md border border-slate-200 bg-white p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setEnquiryTemperature("warm")}
                className={cn(
                  "flex-1 rounded px-3",
                  (inboundEnquirySource(createSource) || enquiryTemperature === "warm")
                    ? "bg-primary text-white"
                    : "text-slate-600 hover:bg-slate-50",
                )}
              >
                Warm
              </button>
              <button
                type="button"
                disabled={inboundEnquirySource(createSource)}
                onClick={() => setEnquiryTemperature("cold")}
                className={cn(
                  "flex-1 rounded px-3 disabled:cursor-not-allowed disabled:opacity-40",
                  !inboundEnquirySource(createSource) && enquiryTemperature === "cold"
                    ? "bg-primary text-white"
                    : "text-slate-600 hover:bg-slate-50",
                )}
              >
                Cold
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {inboundEnquirySource(createSource)
                ? "Website, portal and referral enquiries are Warm — they came to us."
                : "Warm if they contacted us. Cold if we reached out first, until they reply."}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Notes</span>
            <span className="mb-2 block text-xs text-slate-500">
              Other options, dates, or anything they were not sure about. You still need at least one product on the enquiry.
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Also asked about Paddock Club, or Sunday only if the three-day is gone."
              className="min-h-20 w-full rounded-md border p-3"
            />
          </label>
        </div>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-6 py-4">
        <button type="button" onClick={onClose} className="h-10 rounded-md border px-4 text-sm">Cancel</button>
        <button
          type="button"
          disabled={pending || !canSubmitDeal}
          onClick={submit}
          className="h-10 rounded-md bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Creating…" : submitLabel}
        </button>
      </div>
    </AdminModalScrim>
  )
}
