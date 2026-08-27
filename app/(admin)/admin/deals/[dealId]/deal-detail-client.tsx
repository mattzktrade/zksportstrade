"use client"

import { useMemo, useState, useTransition, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Mail, Pencil, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { updateNativeDealWorkflow } from "@/app/(admin)/actions"
import { ActionCombobox } from "@/components/admin/action-combobox"
import { CrmPartySelect } from "@/components/admin/crm-party-select"
import { SearchableSelect } from "@/components/admin/searchable-select"
import { AdminPageHeader, AdminPanel, AdminDesktopTable, AdminMobileList, StatusPill } from "@/components/admin/admin-page-kit"
import { AdminModalScrim } from "@/components/admin/admin-list-preview"
import type { DealBasketSupplier } from "@/components/admin/deal-line-basket"
import { DEAL_NEXT_ACTION_OPTIONS, DEAL_SOURCE_LABELS, DEAL_SOURCES, DEAL_STAGES, DEAL_STAGE_LABELS, canonicalDealStage, dealConfirmedOffPlatform, dealSourceLabel, friendlyDealActivitySummary, type CrmAccountOption, type DealPackageOption, type DealStage } from "@/lib/crm/deal-types"
import type { DealAddressDraft, DealDetailPageData, DealFulfilmentClient } from "@/lib/crm/deal-detail"
import type { StaffOption } from "@/lib/crm/lead-types"
import { formatMoney } from "@/lib/format/money"
import { adminPackagePath } from "@/lib/admin/package-link"
import { adminAccountPath, adminContactPath, adminSupplierPath } from "@/lib/crm/profile-links"
import { mergeCrmAccountOptions } from "@/lib/crm/party-search"
import { deleteOrderGuest, saveOrderGuests } from "@/app/(admin)/admin/operations/actions"
import { OperationsGuestEditor, type GuestDraft } from "@/app/(admin)/admin/operations/guest-editor"
import { updateDealClientDetails, updateDealCommercials, updateDealLineSupplier, addDealNote, deleteDeal } from "../deal-edit-actions"
import { BookingFormPanel } from "../booking-form-panel"
import { DealFinancePanel } from "../deal-finance-panel"
import { OperationsEmailComposer } from "@/app/(admin)/admin/operations/operations-email-composer"
import {
  operationsEmailKindLabel,
  type OperationsEmailKind,
} from "@/lib/operations/emails"

type EditLineState = {
  id?: string
  packageId: string
  quantity: string
  unitPrice: string
  expectedUnitCost: string
  sourcingMode: "owned" | "brokered"
  supplierId: string
  supplierQuoteAt: string
}

type ClientDraft = {
  accountName: string
  accountType: string
  accountEmail: string
  accountPhone: string
  accountBilling: DealAddressDraft
  contactName: string
  contactEmail: string
  contactPhone: string
  contactJobTitle: string
  clientName: string
  clientEmail: string
  clientPhone: string
  nationality: string
  dietaryRequirements: string
  specialRequests: string
  shipping: DealAddressDraft
  orderBilling: DealAddressDraft
}

function money(value: number, currency: string): string {
  return formatMoney(currency, value)
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDay(iso: string | null): string {
  if (!iso) return "—"
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function stageTone(stage: DealStage): "green" | "amber" | "red" | "blue" | "gray" {
  if (["paid_confirmed", "in_fulfilment", "fulfilled"].includes(stage)) return "green"
  if (["closed_lost", "cancelled"].includes(stage)) return "red"
  if (["awaiting_payment", "awaiting_client_signature", "awaiting_zk_signature"].includes(stage)) {
    return "amber"
  }
  if (["booking_form_sent", "signed", "awaiting_invoice"].includes(stage)) return "blue"
  return "gray"
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function localDateTimeInput(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

function emptyLine(): EditLineState {
  return {
    packageId: "",
    quantity: "1",
    unitPrice: "",
    expectedUnitCost: "",
    sourcingMode: "owned",
    supplierId: "",
    supplierQuoteAt: "",
  }
}

function clientDraftFrom(client: DealFulfilmentClient): ClientDraft {
  return {
    accountName: client.accountName ?? "",
    accountType: client.accountType ?? "agent_company",
    accountEmail: client.accountEmail ?? "",
    accountPhone: client.accountPhone ?? "",
    accountBilling: { ...client.accountBilling },
    contactName: client.contactName ?? "",
    contactEmail: client.contactEmail ?? "",
    contactPhone: client.contactPhone ?? "",
    contactJobTitle: client.contactJobTitle ?? "",
    clientName: client.orderClientName ?? "",
    clientEmail: client.orderClientEmail ?? "",
    clientPhone: client.orderClientPhone ?? "",
    nationality: client.orderClientNationality ?? "",
    dietaryRequirements: client.dietaryRequirements ?? "",
    specialRequests: client.specialRequests ?? "",
    shipping: { ...client.shipping },
    orderBilling: { ...client.orderBilling },
  }
}

function Field({ label: title, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[8px] uppercase tracking-wide text-slate-400">{title}</dt>
      <dd className="mt-1 text-[11px] text-[#25272b]">{value || "—"}</dd>
    </div>
  )
}

function TextInput({
  title,
  value,
  onChange,
  type = "text",
  className = "",
}: {
  title: string
  value: string
  onChange: (value: string) => void
  type?: string
  className?: string
}) {
  return (
    <label className={className}>
      <span className="mb-1 block text-[8px] uppercase tracking-wide text-slate-400">{title}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border px-3 text-[11px]"
      />
    </label>
  )
}

function AddressInputs({
  title,
  value,
  onChange,
}: {
  title: string
  value: DealAddressDraft
  onChange: (value: DealAddressDraft) => void
}) {
  function set(key: keyof DealAddressDraft, next: string) {
    onChange({ ...value, [key]: next })
  }
  return (
    <div className="col-span-2 space-y-2">
      <p className="text-[8px] uppercase tracking-wide text-slate-400">{title}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={value.line1}
          onChange={(event) => set("line1", event.target.value)}
          placeholder="Address line 1"
          className="h-9 rounded-md border px-3 text-[11px] sm:col-span-2"
        />
        <input
          value={value.line2}
          onChange={(event) => set("line2", event.target.value)}
          placeholder="Address line 2"
          className="h-9 rounded-md border px-3 text-[11px] sm:col-span-2"
        />
        <input
          value={value.city}
          onChange={(event) => set("city", event.target.value)}
          placeholder="City"
          className="h-9 rounded-md border px-3 text-[11px]"
        />
        <input
          value={value.postcode}
          onChange={(event) => set("postcode", event.target.value)}
          placeholder="Postcode (optional)"
          className="h-9 rounded-md border px-3 text-[11px]"
        />
        <input
          value={value.country}
          onChange={(event) => set("country", event.target.value)}
          placeholder="Country"
          className="h-9 rounded-md border px-3 text-[11px] sm:col-span-2"
        />
      </div>
    </div>
  )
}

export function DealDetailClient({
  data,
  accountOptions,
  packageOptions,
  staffOptions,
  supplierOptions,
  currentIsAdmin,
  currentProfileName,
  currentCanManageFinance,
  canManageOperations,
  canManageDeals,
}: {
  data: DealDetailPageData
  accountOptions: CrmAccountOption[]
  packageOptions: DealPackageOption[]
  staffOptions: StaffOption[]
  supplierOptions: DealBasketSupplier[]
  currentIsAdmin: boolean
  currentProfileName: string
  currentCanManageFinance: boolean
  canManageOperations: boolean
  canManageDeals: boolean
}) {
  const router = useRouter()
  const { deal, client, guests, lines, notes, bookingForm, bookingEvents, operationsEmails } = data
  const [pending, startTransition] = useTransition()
  const [noteDraft, setNoteDraft] = useState("")
  const [guestManagerOpen, setGuestManagerOpen] = useState(false)
  const [emailComposer, setEmailComposer] = useState<OperationsEmailKind | null>(null)
  const [editingClient, setEditingClient] = useState(false)
  const [clientForm, setClientForm] = useState<ClientDraft>(() => clientDraftFrom(client))
  const [editingWorkflow, setEditingWorkflow] = useState(false)
  const [workflowStage, setWorkflowStage] = useState<DealStage>(canonicalDealStage(deal.stage))
  const [workflowOwner, setWorkflowOwner] = useState(deal.owner_profile_id ?? "")
  const [workflowAction, setWorkflowAction] = useState(deal.next_action ?? "")
  const [workflowDueAt, setWorkflowDueAt] = useState(localDateTimeInput(deal.next_action_due_at))
  const [workflowCloseDate, setWorkflowCloseDate] = useState(deal.expected_close_date ?? "")
  const [workflowLossReason, setWorkflowLossReason] = useState(deal.loss_reason ?? "")
  const [showCommercial, setShowCommercial] = useState(false)
  const [editAccountId, setEditAccountId] = useState(deal.account_id ?? "")
  const [editContactId, setEditContactId] = useState(deal.primary_contact_id ?? "")
  const [knownAccounts, setKnownAccounts] = useState<CrmAccountOption[]>([])
  const clientAccounts = useMemo(
    () => mergeCrmAccountOptions([...accountOptions, ...knownAccounts]),
    [accountOptions, knownAccounts],
  )
  const editAccount = clientAccounts.find((account) => account.id === editAccountId) ?? null
  const [editSource, setEditSource] = useState(deal.source)
  const [editNotes, setEditNotes] = useState(deal.notes ?? "")
  const [editLines, setEditLines] = useState<EditLineState[]>([])

  const commercialEditLocked =
    Boolean(deal.order_id) ||
    Boolean(
      bookingForm &&
        ["sent", "viewed", "awaiting_zk_signature", "zk_signed", "completed"].includes(bookingForm.status),
    )
  const confirmedOffPlatform = dealConfirmedOffPlatform(deal)
  const guestQty = deal.lines.reduce((sum, line) => sum + line.quantity, 0)

  function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    onOk?: () => void,
  ) {
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(result.message || "That change could not be saved.")
        return
      }
      toast.success(result.message || "Saved.")
      onOk?.()
      router.refresh()
    })
  }

  function saveGuests(drafts: GuestDraft[]) {
    startTransition(async () => {
      const result = await saveOrderGuests({
        orderId: deal.order_id,
        dealId: deal.id,
        guests: drafts.map((draft, index) => ({
          guestId: draft.id,
          fullName: draft.fullName,
          email: draft.email,
          phone: draft.phone,
          nationality: draft.nationality,
          dateOfBirth: draft.dateOfBirth,
          dietaryRequirements: draft.dietaryRequirements,
          specialRequests: draft.specialRequests,
          isLeadGuest: draft.isLeadGuest,
          detailsComplete: true,
          sortOrder: index,
        })),
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      setGuestManagerOpen(false)
      router.refresh()
    })
  }

  function openClientEditor() {
    setClientForm(clientDraftFrom(client))
    setEditingClient(true)
  }

  function openWorkflowEditor() {
    setWorkflowStage(canonicalDealStage(deal.stage))
    setWorkflowOwner(deal.owner_profile_id ?? "")
    setWorkflowAction(deal.next_action ?? "")
    setWorkflowDueAt(localDateTimeInput(deal.next_action_due_at))
    setWorkflowCloseDate(deal.expected_close_date ?? "")
    setWorkflowLossReason(deal.loss_reason ?? "")
    setEditingWorkflow(true)
  }

  function openCommercialEditor() {
    setEditAccountId(deal.account_id ?? "")
    setEditContactId(deal.primary_contact_id ?? "")
    setEditSource(deal.source)
    setEditNotes(deal.notes ?? "")
    setEditLines(
      deal.lines.length
        ? deal.lines.map((line) => ({
            id: line.id,
            packageId: line.package_id,
            quantity: String(line.quantity),
            unitPrice: String(line.unit_sale_price),
            expectedUnitCost: line.expected_unit_cost == null ? "" : String(line.expected_unit_cost),
            sourcingMode: line.sourcing_mode,
            supplierId: line.supplier_id ?? "",
            supplierQuoteAt: localDateTimeInput(line.supplier_quote_at),
          }))
        : [emptyLine()],
    )
    setShowCommercial(true)
  }

  function saveClient() {
    run(
      () =>
        updateDealClientDetails({
          dealId: deal.id,
          ...clientForm,
        }),
      () => setEditingClient(false),
    )
  }

  function saveWorkflow() {
    run(
      () =>
        updateNativeDealWorkflow({
          dealId: deal.id,
          stage: workflowStage,
          ownerProfileId: workflowOwner || null,
          nextAction: workflowAction,
          nextActionDueAt: workflowDueAt || null,
          expectedCloseDate: workflowCloseDate || null,
          lossReason: workflowLossReason,
        }),
      () => setEditingWorkflow(false),
    )
  }

  function saveCommercial() {
    if (!editAccountId || editLines.some((line) => !line.packageId)) {
      toast.error("Select an account and product for every line.")
      return
    }
    run(
      () =>
        updateDealCommercials({
          dealId: deal.id,
          accountId: editAccountId,
          contactId: editContactId || undefined,
          source: editSource,
          notes: editNotes,
          lines: editLines.map((line) => ({
            id: line.id,
            packageId: line.packageId,
            quantity: Math.floor(Number(line.quantity)),
            unitPrice: Number(line.unitPrice),
            expectedUnitCost: line.expectedUnitCost.trim() === "" ? null : Number(line.expectedUnitCost),
            sourcingMode: line.sourcingMode,
            supplierId: line.supplierId || null,
            supplierQuoteAt: line.supplierQuoteAt || null,
          })),
        }),
      () => setShowCommercial(false),
    )
  }

  function saveNote() {
    const note = noteDraft.trim()
    if (!note) {
      toast.error("Write a note before saving.")
      return
    }
    run(() => addDealNote({ dealId: deal.id, note }), () => setNoteDraft(""))
  }

  function confirmDeleteDeal() {
    if (
      !window.confirm(
        `Delete ${deal.reference}? This cannot be undone. Deals with a portal order or active booking form cannot be deleted.`,
      )
    ) {
      return
    }
    run(() => deleteDeal({ dealId: deal.id }), () => router.push("/admin/deals"))
  }

  return (
    <div className="mx-auto max-w-[1540px] space-y-3 p-3 sm:p-5 lg:p-7">
      <div>
        <Link href="/admin/deals" className="text-[11px] font-medium text-primary hover:underline">
          ← Deals
        </Link>
        <AdminPageHeader
          title={`${deal.reference} — ${deal.account_name || "Deal"}`}
          description={`${deal.race_name || "No event"} · ${deal.line_summary || "No products"}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {canManageDeals ? (
                <button
                  type="button"
                  onClick={openCommercialEditor}
                  disabled={commercialEditLocked}
                  title={
                    commercialEditLocked
                      ? "Void the active form first, or edit products before an order exists."
                      : "Edit account, products, source and notes"
                  }
                  className="flex h-8 items-center gap-1.5 rounded-md border bg-white px-3 text-[9px] font-semibold disabled:opacity-40"
                >
                  <Pencil className="h-3 w-3" /> Edit deal
                </button>
              ) : null}
              {canManageDeals ? (
                <button
                  type="button"
                  onClick={confirmDeleteDeal}
                  disabled={pending || Boolean(deal.order_id)}
                  title={
                    deal.order_id
                      ? "This deal has a portal order, so it cannot be deleted."
                      : "Delete this deal"
                  }
                  className="flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 text-[9px] font-semibold text-red-600 disabled:opacity-40"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              ) : null}
              <StatusPill tone={stageTone(deal.stage)}>{DEAL_STAGE_LABELS[deal.stage]}</StatusPill>
            </div>
          }
        />
      </div>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="space-y-3">
          <AdminPanel>
            <div className="flex items-start justify-between gap-3 border-b border-[#eceef1] px-4 py-3">
              <div>
                <h2 className="text-[11px] font-semibold text-[#25272b]">Client &amp; fulfilment details</h2>
                <p className="mt-0.5 text-[9px] text-slate-400">
                  Contact, billing, and guest information needed to fulfil this booking.
                </p>
              </div>
              {canManageDeals ? (
                editingClient ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingClient(false)}
                      className="text-[9px] font-semibold text-slate-500 hover:underline"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={saveClient}
                      className="h-7 rounded-md bg-primary px-3 text-[9px] font-semibold text-white disabled:opacity-50"
                    >
                      Save details
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openClientEditor}
                    className="flex h-7 items-center gap-1.5 rounded-md border px-2 text-[9px] font-semibold"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                )
              ) : null}
            </div>
            {editingClient ? (
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                {!deal.account_id ? (
                  <p className="col-span-2 text-[10px] text-amber-700">
                    Assign an account with Edit deal before changing company details.
                  </p>
                ) : (
                  <>
                    <TextInput
                      title="Company / account"
                      value={clientForm.accountName}
                      onChange={(value) => setClientForm((current) => ({ ...current, accountName: value }))}
                    />
                    <label>
                      <span className="mb-1 block text-[8px] uppercase tracking-wide text-slate-400">
                        Account type
                      </span>
                      <select
                        value={clientForm.accountType}
                        onChange={(event) =>
                          setClientForm((current) => ({ ...current, accountType: event.target.value }))
                        }
                        className="h-9 w-full rounded-md border bg-white px-3 text-[11px]"
                      >
                        <option value="agent_company">Agent company</option>
                        <option value="direct_client">Direct client</option>
                        <option value="supplier_related">Supplier related</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <TextInput
                      title="Account email"
                      type="email"
                      value={clientForm.accountEmail}
                      onChange={(value) => setClientForm((current) => ({ ...current, accountEmail: value }))}
                    />
                    <TextInput
                      title="Account phone"
                      value={clientForm.accountPhone}
                      onChange={(value) => setClientForm((current) => ({ ...current, accountPhone: value }))}
                    />
                    <AddressInputs
                      title="Account billing address"
                      value={clientForm.accountBilling}
                      onChange={(value) => setClientForm((current) => ({ ...current, accountBilling: value }))}
                    />
                  </>
                )}
                {!deal.primary_contact_id ? (
                  <p className="col-span-2 text-[10px] text-amber-700">
                    Assign a primary contact with Edit deal before changing contact details.
                  </p>
                ) : (
                  <>
                    <TextInput
                      title="Primary contact"
                      value={clientForm.contactName}
                      onChange={(value) => setClientForm((current) => ({ ...current, contactName: value }))}
                    />
                    <TextInput
                      title="Job title"
                      value={clientForm.contactJobTitle}
                      onChange={(value) => setClientForm((current) => ({ ...current, contactJobTitle: value }))}
                    />
                    <TextInput
                      title="Contact email"
                      type="email"
                      value={clientForm.contactEmail}
                      onChange={(value) => setClientForm((current) => ({ ...current, contactEmail: value }))}
                    />
                    <TextInput
                      title="Contact phone"
                      value={clientForm.contactPhone}
                      onChange={(value) => setClientForm((current) => ({ ...current, contactPhone: value }))}
                    />
                  </>
                )}
                <p className="col-span-2 text-[9px] text-slate-400">
                  {deal.order_id
                    ? "End-client fields update the order."
                    : "End-client fields are stored on this deal until an order is created."}
                </p>
                <TextInput
                  title="End-client name"
                  value={clientForm.clientName}
                  onChange={(value) => setClientForm((current) => ({ ...current, clientName: value }))}
                />
                <TextInput
                  title="End-client email"
                  type="email"
                  value={clientForm.clientEmail}
                  onChange={(value) => setClientForm((current) => ({ ...current, clientEmail: value }))}
                />
                <TextInput
                  title="End-client phone"
                  value={clientForm.clientPhone}
                  onChange={(value) => setClientForm((current) => ({ ...current, clientPhone: value }))}
                />
                <TextInput
                  title="Nationality"
                  value={clientForm.nationality}
                  onChange={(value) => setClientForm((current) => ({ ...current, nationality: value }))}
                />
                <label className="col-span-2">
                  <span className="mb-1 block text-[8px] uppercase tracking-wide text-slate-400">
                    Dietary requirements
                  </span>
                  <textarea
                    value={clientForm.dietaryRequirements}
                    onChange={(event) =>
                      setClientForm((current) => ({ ...current, dietaryRequirements: event.target.value }))
                    }
                    className="min-h-16 w-full rounded-md border p-3 text-[11px]"
                  />
                </label>
                <label className="col-span-2">
                  <span className="mb-1 block text-[8px] uppercase tracking-wide text-slate-400">
                    Special requests
                  </span>
                  <textarea
                    value={clientForm.specialRequests}
                    onChange={(event) =>
                      setClientForm((current) => ({ ...current, specialRequests: event.target.value }))
                    }
                    className="min-h-16 w-full rounded-md border p-3 text-[11px]"
                  />
                </label>
                <AddressInputs
                  title="Shipping address"
                  value={clientForm.shipping}
                  onChange={(value) => setClientForm((current) => ({ ...current, shipping: value }))}
                />
                <AddressInputs
                  title="Order billing address"
                  value={clientForm.orderBilling}
                  onChange={(value) => setClientForm((current) => ({ ...current, orderBilling: value }))}
                />
              </div>
            ) : (
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <Field
                  label="Company / account"
                  value={
                    deal.account_id && client.accountName ? (
                      <Link href={adminAccountPath(deal.account_id)} className="text-primary hover:underline">
                        {client.accountName}
                      </Link>
                    ) : client.accountName
                  }
                />
                <Field label="Account type" value={client.accountType ? label(client.accountType) : null} />
                <Field label="Account email" value={client.accountEmail} />
                <Field label="Account phone" value={client.accountPhone} />
                <Field
                  label="Primary contact"
                  value={
                    deal.account_id && deal.primary_contact_id && client.contactName ? (
                      <Link
                        href={adminContactPath(deal.account_id, deal.primary_contact_id)}
                        className="text-primary hover:underline"
                      >
                        {client.contactName}
                      </Link>
                    ) : client.contactName
                  }
                />
                <Field label="Job title" value={client.contactJobTitle} />
                <Field
                  label="Contact email"
                  value={
                    client.contactEmail ? (
                      <a href={`mailto:${client.contactEmail}`} className="text-primary hover:underline">
                        {client.contactEmail}
                      </a>
                    ) : null
                  }
                />
                <Field
                  label="Contact phone"
                  value={
                    client.contactPhone ? (
                      <a href={`tel:${client.contactPhone}`} className="text-primary hover:underline">
                        {client.contactPhone}
                      </a>
                    ) : null
                  }
                />
                <Field label="Account billing address" value={client.billingAddress} />
                <Field label="End-client name" value={client.orderClientName} />
                <Field label="End-client email" value={client.orderClientEmail} />
                <Field label="End-client phone" value={client.orderClientPhone} />
                <Field label="Nationality" value={client.orderClientNationality} />
                <Field label="Dietary requirements" value={client.dietaryRequirements} />
                <Field label="Special requests" value={client.specialRequests} />
                <Field label="Shipping address" value={client.shippingAddress} />
                <Field label="Order billing address" value={client.orderBillingAddress} />
              </div>
            )}
          </AdminPanel>

          <AdminPanel>
            <div className="flex items-center justify-between gap-2 border-b border-[#eceef1] px-4 py-3">
              <h2 className="text-[11px] font-semibold text-[#25272b]">
                Guest details ({guests.length}/{guestQty || "—"})
              </h2>
              <div className="flex items-center gap-2">
                {canManageOperations ? (
                  <button
                    type="button"
                    onClick={() => setEmailComposer("operations_intro")}
                    className="text-[9px] font-semibold text-primary hover:underline"
                  >
                    Intro email
                  </button>
                ) : null}
                {canManageOperations ? (
                  <button
                    type="button"
                    onClick={() => setEmailComposer("guest_details")}
                    className="text-[9px] font-semibold text-primary hover:underline"
                  >
                    Request guests
                  </button>
                ) : null}
                {canManageOperations ? (
                  <button
                    type="button"
                    onClick={() => setGuestManagerOpen(true)}
                    className="text-[9px] font-semibold text-primary hover:underline"
                  >
                    Manage guests
                  </button>
                ) : null}
              </div>
            </div>
            <div className="divide-y divide-[#f0f1f3]">
                {guests.map((guest) => (
                  <button
                    key={guest.id}
                    type="button"
                    onClick={() => (canManageOperations ? setGuestManagerOpen(true) : undefined)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        guest.detailsComplete ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium">
                        {guest.fullName || "Unnamed guest"}
                        {guest.isLeadGuest ? (
                          <span className="ml-2 text-[8px] font-semibold uppercase text-slate-400">
                            Lead
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-[9px] text-slate-500">
                        {[guest.email, guest.phone, guest.nationality].filter(Boolean).join(" · ") ||
                          "Details pending"}
                      </p>
                      {guest.dietaryRequirements || guest.specialRequests ? (
                        <p className="mt-1 text-[9px] text-slate-500">
                          {[guest.dietaryRequirements, guest.specialRequests].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <span className="text-[8px] text-slate-400">
                      {guest.dateOfBirth ? formatDay(guest.dateOfBirth) : ""}
                    </span>
                  </button>
                ))}
                {guests.length === 0 ? (
                  <p className="px-4 py-6 text-[10px] text-slate-400">
                    No guest names have been added yet. Add each attendee here, mark a lead guest,
                    then set the guests status to Complete when you have what you need.
                  </p>
                ) : null}
              </div>
          </AdminPanel>

          <AdminPanel>
            <div className="flex items-center justify-between border-b border-[#eceef1] px-4 py-3">
              <h2 className="text-[11px] font-semibold text-[#25272b]">Products</h2>
              {canManageDeals ? (
                <button
                  type="button"
                  onClick={openCommercialEditor}
                  disabled={commercialEditLocked}
                  title={
                    commercialEditLocked
                      ? "Products cannot be changed after a booking form or portal order exists."
                      : "Edit products and pricing"
                  }
                  className="flex h-7 items-center gap-1.5 rounded-md border px-2 text-[9px] font-semibold disabled:opacity-40"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              ) : null}
            </div>
            <AdminDesktopTable>
              <table className="w-full text-left text-[10px]">
                <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Package</th>
                    <th className="px-4 py-2 font-medium text-right">Qty</th>
                    <th className="px-4 py-2 font-medium text-right">Sale</th>
                    <th className="px-4 py-2 font-medium text-right">Buy</th>
                    <th className="px-4 py-2 font-medium">Supplier (from stock)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f1f3]">
                  {lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-4 py-2.5">
                        <Link
                          href={adminPackagePath(line.package_id, "orders")}
                          className="font-medium text-primary hover:underline"
                        >
                          {line.packageName || line.package_id}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{line.quantity}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {money(line.unit_sale_price, deal.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                        {line.expected_unit_cost == null
                          ? "—"
                          : money(line.expected_unit_cost, deal.currency)}
                      </td>
                      <td className="px-4 py-2.5">
                        {canManageDeals ? (
                          <select
                            value={line.supplierKey}
                            disabled={pending}
                            onChange={(event) => {
                              const option = line.supplierOptions.find((item) => item.key === event.target.value)
                              run(() =>
                                updateDealLineSupplier({
                                  dealId: deal.id,
                                  lineId: line.id,
                                  supplierKey: event.target.value,
                                  costLayerId: option?.costLayerId ?? null,
                                  supplierId: option?.supplierId ?? null,
                                }),
                              )
                            }}
                            className="h-8 max-w-[260px] rounded-md border bg-white px-2 text-[10px]"
                          >
                            <option value="">Choose supplier…</option>
                            {line.supplierOptions.map((option) => (
                              <option key={option.key} value={option.key}>
                                {option.supplierName} · {option.remaining} left
                              </option>
                            ))}
                          </select>
                        ) : (
                          line.supplier_id && line.supplierName ? (
                            <Link href={adminSupplierPath(line.supplier_id)} className="text-primary hover:underline">
                              {line.supplierName}
                            </Link>
                          ) : line.supplierName || "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminDesktopTable>
            <AdminMobileList>
              {lines.map((line) => (
                <div key={line.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={adminPackagePath(line.package_id, "orders")} className="min-w-0 font-medium text-primary">
                      {line.packageName || line.package_id}
                    </Link>
                    <p className="shrink-0 font-semibold">{money(line.unit_sale_price, deal.currency)}</p>
                  </div>
                  <p className="text-[8px] text-slate-400">{line.quantity} units</p>
                  {canManageDeals ? (
                    <select
                      value={line.supplierKey}
                      disabled={pending}
                      onChange={(event) => {
                        const option = line.supplierOptions.find((item) => item.key === event.target.value)
                        run(() =>
                          updateDealLineSupplier({
                            dealId: deal.id,
                            lineId: line.id,
                            supplierKey: event.target.value,
                            costLayerId: option?.costLayerId ?? null,
                            supplierId: option?.supplierId ?? null,
                          }),
                        )
                      }}
                      className="h-9 w-full rounded-md border bg-white px-2 text-[10px]"
                    >
                      <option value="">Choose supplier…</option>
                      {line.supplierOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.supplierName} · {option.remaining} left
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-[10px] text-slate-600">{line.supplierName || "No supplier"}</p>
                  )}
                </div>
              ))}
            </AdminMobileList>
          </AdminPanel>

          <AdminPanel>
            <div className="border-b border-[#eceef1] px-4 py-3">
              <h2 className="text-[11px] font-semibold text-[#25272b]">Notes</h2>
              <p className="mt-0.5 text-[9px] text-slate-400">Internal comments on this deal. They stay on the record after it is won or cancelled.</p>
            </div>
            <div className="space-y-3 p-4">
              {deal.notes ? (
                <div className="rounded-md bg-[#fafbfc] p-3">
                  <p className="text-[8px] uppercase tracking-wide text-slate-400">Internal notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-[10px] text-slate-600">{deal.notes}</p>
                </div>
              ) : null}
              {notes.length > 0 ? (
                <div className="space-y-2">
                  {notes.map((note) => (
                    <div key={note.id} className="rounded-md border border-[#eceef1] bg-[#fafbfc] px-3 py-2">
                      <p className="text-[8px] text-slate-400">
                        {note.actorName || "Someone"} · {formatWhen(note.createdAt)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-[10px] text-slate-600">{note.body}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {notes.length === 0 && !deal.notes ? (
                <p className="text-[10px] text-slate-400">No notes yet.</p>
              ) : null}
              {canManageDeals ? (
                <div className="space-y-2">
                  <textarea
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    placeholder="Add a note…"
                    className="min-h-20 w-full rounded-md border px-3 py-2 text-[10px] outline-none focus:border-primary/40"
                  />
                  <button
                    type="button"
                    disabled={pending || !noteDraft.trim()}
                    onClick={saveNote}
                    className="h-8 rounded-md bg-slate-900 px-3 text-[9px] font-semibold text-white disabled:opacity-50"
                  >
                    Add note
                  </button>
                </div>
              ) : null}
            </div>
          </AdminPanel>

        </div>

        <div className="space-y-3">
          <AdminPanel>
            <div className="flex items-center justify-between border-b border-[#eceef1] px-4 py-3">
              <h2 className="text-[11px] font-semibold text-[#25272b]">Deal summary</h2>
              {canManageDeals ? (
                editingWorkflow ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingWorkflow(false)}
                      className="text-[9px] font-semibold text-slate-500 hover:underline"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={saveWorkflow}
                      className="h-7 rounded-md bg-slate-900 px-3 text-[9px] font-semibold text-white disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openWorkflowEditor}
                    className="flex h-7 items-center gap-1.5 rounded-md border px-2 text-[9px] font-semibold"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                )
              ) : null}
            </div>
            {editingWorkflow ? (
              <div className="grid gap-3 p-4">
                <label className="text-[8px] font-medium text-slate-500">
                  Stage
                  <select
                    value={workflowStage}
                    onChange={(event) => setWorkflowStage(event.target.value as DealStage)}
                    className="mt-1 h-9 w-full rounded-md border bg-white px-2 text-[10px]"
                  >
                    {DEAL_STAGES.map((stage) => (
                      <option key={stage} value={stage}>
                        {DEAL_STAGE_LABELS[stage]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[8px] font-medium text-slate-500">
                  Owner
                  <select
                    value={workflowOwner}
                    onChange={(event) => setWorkflowOwner(event.target.value)}
                    className="mt-1 h-9 w-full rounded-md border bg-white px-2 text-[10px]"
                  >
                    <option value="">Unassigned</option>
                    {staffOptions.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[8px] font-medium text-slate-500">
                  Next action
                  <ActionCombobox
                    value={workflowAction}
                    onChange={setWorkflowAction}
                    options={DEAL_NEXT_ACTION_OPTIONS}
                    inputClassName="mt-1 h-9 w-full rounded-md border px-2 text-[10px]"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[8px] font-medium text-slate-500">
                    Action due
                    <input
                      type="datetime-local"
                      value={workflowDueAt}
                      onChange={(event) => setWorkflowDueAt(event.target.value)}
                      className="mt-1 h-9 w-full rounded-md border px-2 text-[10px]"
                    />
                  </label>
                  <label className="text-[8px] font-medium text-slate-500">
                    Expected close
                    <input
                      type="date"
                      value={workflowCloseDate}
                      onChange={(event) => setWorkflowCloseDate(event.target.value)}
                      className="mt-1 h-9 w-full rounded-md border px-2 text-[10px]"
                    />
                  </label>
                </div>
                {workflowStage === "closed_lost" ? (
                  <label className="text-[8px] font-medium text-slate-500">
                    Loss reason
                    <input
                      value={workflowLossReason}
                      onChange={(event) => setWorkflowLossReason(event.target.value)}
                      className="mt-1 h-9 w-full rounded-md border px-2 text-[10px]"
                    />
                  </label>
                ) : null}
              </div>
            ) : (
              <dl className="grid grid-cols-[120px_1fr] gap-y-2.5 p-4 text-[10px]">
                <dt className="text-slate-400">Deal ID</dt>
                <dd className="font-semibold">{deal.reference}</dd>
                <dt className="text-slate-400">Source</dt>
                <dd>
                  <StatusPill tone="blue">{dealSourceLabel(deal.source)}</StatusPill>
                </dd>
                <dt className="text-slate-400">Owner</dt>
                <dd>{deal.owner_name || "—"}</dd>
                <dt className="text-slate-400">Event</dt>
                <dd>{deal.race_name || "—"}</dd>
                <dt className="text-slate-400">Value</dt>
                <dd className="font-semibold">{money(deal.total_amount, deal.currency)}</dd>
                <dt className="text-slate-400">Gross profit</dt>
                <dd>
                  {deal.gross_profit == null
                    ? "Not costed"
                    : `${money(deal.gross_profit, deal.currency)}${
                        deal.margin == null ? "" : ` (${(deal.margin * 100).toFixed(1)}%)`
                      }`}
                </dd>
                <dt className="text-slate-400">Expected close</dt>
                <dd>{formatDay(deal.expected_close_date)}</dd>
                <dt className="text-slate-400">Next action</dt>
                <dd>{deal.next_action || "—"}</dd>
                <dt className="text-slate-400">Stock hold</dt>
                <dd>
                  {deal.reserved_qty > 0
                    ? `${deal.reserved_qty} ticket${deal.reserved_qty === 1 ? "" : "s"} held${
                        deal.do_not_expire
                          ? " (does not expire)"
                          : deal.hold_expires_at
                            ? ` until ${formatDay(deal.hold_expires_at.slice(0, 10))}`
                            : ""
                      }`
                    : "None"}
                  <p className="mt-0.5 text-[8px] leading-4 text-slate-400">
                    {deal.reserved_qty > 0
                      ? "These tickets are reserved so they cannot be sold to someone else."
                      : confirmedOffPlatform
                        ? "Stock for this sale was handled on the previous platform. No portal booking form is needed."
                        : "No inventory is held yet. Sending a booking form reserves stock for seven days."}
                  </p>
                </dd>
                <dt className="text-slate-400">Confirmed order</dt>
                <dd>
                  {deal.order_reference
                    ? deal.order_reference
                    : confirmedOffPlatform
                      ? "Confirmed off-platform"
                      : "Not created yet"}
                  <p className="mt-0.5 text-[8px] leading-4 text-slate-400">
                    {deal.order_id
                      ? deal.source === "portal"
                        ? "Created at portal checkout. Invoice follows the booking confirmation email."
                        : "Created after both booking-form signatures. Guests, invoices and supplier tickets attach here."
                      : confirmedOffPlatform
                        ? "This sale was booked before this portal. Setting the stage to Fulfilled is enough — no booking form or portal order is required."
                        : "This is still a pipeline deal. A confirmed order is created after both booking-form signatures, or immediately when the agent books on the portal."}
                  </p>
                </dd>
                <dt className="text-slate-400">Created</dt>
                <dd>
                  {formatWhen(deal.created_at)}
                  {deal.created_by_name ? ` · ${deal.created_by_name}` : ""}
                </dd>
                <dt className="text-slate-400">Updated</dt>
                <dd>
                  {deal.recent_activities[0] ? (
                    <>
                      {formatWhen(deal.recent_activities[0].created_at)}
                      {deal.recent_activities[0].actor_name
                        ? ` · ${deal.recent_activities[0].actor_name}`
                        : ""}
                      <p className="mt-0.5 text-[8px] leading-4 text-slate-400">
                        {friendlyDealActivitySummary(deal.recent_activities[0].summary)}
                      </p>
                    </>
                  ) : (
                    formatWhen(deal.updated_at)
                  )}
                </dd>
              </dl>
            )}
          </AdminPanel>

          <AdminPanel>
            <div className="flex items-center justify-between border-b border-[#eceef1] px-4 py-3">
              <h2 className="text-[11px] font-semibold text-[#25272b]">Operations emails</h2>
              {canManageOperations ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEmailComposer("operations_intro")}
                    className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[9px] font-semibold"
                  >
                    <Mail className="h-3 w-3" />
                    Intro email
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmailComposer("guest_details")}
                    className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[9px] font-semibold"
                  >
                    <Mail className="h-3 w-3" />
                    Request guests
                  </button>
                </div>
              ) : null}
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] leading-5 text-slate-500">
                Preview and edit before sending, the same way as a booking form. Guest requests and
                operations introductions are stored on this deal.
              </p>
              {(operationsEmails ?? []).length ? (
                <ul className="mt-3 space-y-2">
                  {(operationsEmails ?? []).map((row) => (
                    <li key={row.id} className="rounded-md border border-[#eceef1] px-3 py-2">
                      <p className="text-[11px] font-medium">
                        {operationsEmailKindLabel(row.kind)}
                      </p>
                      <p className="mt-0.5 text-[9px] text-slate-500">
                        {formatWhen(row.sentAt)}
                        {row.sentByName ? ` · ${row.sentByName}` : ""}
                        {" · "}
                        {row.toEmail}
                      </p>
                      <p className="mt-0.5 text-[9px] text-slate-400">{row.subject}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[10px] text-slate-400">
                  No guest-details or operations introduction emails have been sent yet.
                </p>
              )}
            </div>
          </AdminPanel>

          <BookingFormPanel
            dealId={deal.id}
            dealClosed={["closed_lost", "cancelled", "fulfilled"].includes(deal.stage)}
            orderAlreadyConfirmed={Boolean(deal.order_id) || confirmedOffPlatform}
            confirmedOffPlatform={confirmedOffPlatform}
            form={bookingForm}
            events={bookingEvents}
            currentIsAdmin={currentIsAdmin}
            currentProfileName={currentProfileName}
          />
          <DealFinancePanel deal={deal} canManageFinance={currentCanManageFinance} />
        </div>
      </section>

      {showCommercial ? (
        <AdminModalScrim onClose={() => setShowCommercial(false)} panelClassName="overflow-y-auto p-4 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Edit {deal.reference}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Correct the client, products, quantities, prices and expected costs.
                </p>
              </div>
              <button type="button" onClick={() => setShowCommercial(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            {deal.reserved_qty > 0 ? (
              <div className="mt-4 rounded-md bg-amber-50 p-3 text-[10px] text-amber-800">
                Release the active stock reservation before changing products or quantities.
              </div>
            ) : null}
            {["paid_confirmed", "in_fulfilment", "fulfilled"].includes(deal.stage) ? (
              <div className="mt-4 rounded-md bg-blue-50 p-3 text-[10px] text-blue-800">
                Editing an imported won deal returns its stock reconciliation to Pending so the corrected
                products can be reviewed again. It does not change stock.
              </div>
            ) : null}
            <div className="mt-5 grid gap-4 rounded-lg border p-4 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Account / company</span>
                <CrmPartySelect
                  accountId={editAccountId}
                  localAccounts={clientAccounts}
                  onSelect={(account, nextContactId) => {
                    if (!account.id) {
                      setEditAccountId("")
                      setEditContactId("")
                      return
                    }
                    setKnownAccounts((current) => mergeCrmAccountOptions([...current, account]))
                    setEditAccountId(account.id)
                    setEditContactId(nextContactId ?? "")
                  }}
                  placeholder="Search accounts and contacts…"
                  emptyLabel="No accounts or contacts match"
                  className="h-11 w-full rounded-md border bg-white px-3 text-sm outline-none focus:border-primary/50"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Primary contact</span>
                <select
                  value={editContactId}
                  onChange={(event) => setEditContactId(event.target.value)}
                  disabled={!editAccount}
                  className="h-11 w-full rounded-md border bg-white px-3 disabled:bg-slate-100"
                >
                  <option value="">No primary contact</option>
                  {editAccount?.contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.full_name}
                      {contact.email ? ` · ${contact.email}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Source</span>
                <select
                  value={editSource}
                  onChange={(event) => setEditSource(event.target.value)}
                  className="h-11 w-full rounded-md border bg-white px-3"
                >
                  {DEAL_SOURCES.map((source) => (
                    <option key={source} value={source}>{DEAL_SOURCE_LABELS[source]}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Notes</span>
                <input
                  value={editNotes}
                  onChange={(event) => setEditNotes(event.target.value)}
                  className="h-11 w-full rounded-md border px-3"
                />
              </label>
            </div>

            <div className="mt-4 rounded-lg border">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold">Products and pricing</h3>
                  <p className="text-[9px] text-slate-500">
                    Create missing events/products in Manage Inventory first, then return here.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditLines((current) => [...current, emptyLine()])}
                  className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-[9px] font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" /> Add product
                </button>
              </div>
              <div className="divide-y">
                {editLines.map((line, index) => {
                  const product = packageOptions.find((option) => option.id === line.packageId)
                  return (
                    <div
                      key={line.id ?? `new-${index}`}
                      className="grid gap-3 p-4 md:grid-cols-[minmax(240px,1fr)_90px_120px_120px_130px_40px]"
                    >
                      <label className="text-[9px] font-medium text-slate-500">
                        Product
                        <SearchableSelect
                          value={line.packageId}
                          onChange={(packageId) => {
                            const nextProduct = packageOptions.find((option) => option.id === packageId)
                            setEditLines((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      packageId,
                                      unitPrice:
                                        item.unitPrice ||
                                        (nextProduct?.price == null ? "" : String(nextProduct.price)),
                                    }
                                  : item,
                              ),
                            )
                          }}
                          options={packageOptions.map((option) => ({ value: option.id, label: option.label }))}
                          placeholder="Search product…"
                          className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-[10px]"
                        />
                        {product ? (
                          <span className="mt-1 block text-[8px] text-slate-400">
                            {product.stockLeft} currently available
                          </span>
                        ) : null}
                      </label>
                      <label className="text-[9px] font-medium text-slate-500">
                        Quantity
                        <input
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(event) =>
                            setEditLines((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, quantity: event.target.value } : item,
                              ),
                            )
                          }
                          className="mt-1 h-10 w-full rounded-md border px-2 text-[10px]"
                        />
                      </label>
                      <label className="text-[9px] font-medium text-slate-500">
                        Sale price
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(event) =>
                            setEditLines((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, unitPrice: event.target.value } : item,
                              ),
                            )
                          }
                          className="mt-1 h-10 w-full rounded-md border px-2 text-[10px]"
                        />
                      </label>
                      <label className="text-[9px] font-medium text-slate-500">
                        Expected cost
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.expectedUnitCost}
                          onChange={(event) =>
                            setEditLines((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, expectedUnitCost: event.target.value } : item,
                              ),
                            )
                          }
                          className="mt-1 h-10 w-full rounded-md border px-2 text-[10px]"
                        />
                      </label>
                      <label className="text-[9px] font-medium text-slate-500">
                        Stock source
                        <select
                          value={line.sourcingMode}
                          onChange={(event) =>
                            setEditLines((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, sourcingMode: event.target.value as "owned" | "brokered" }
                                  : item,
                              ),
                            )
                          }
                          className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-[10px]"
                        >
                          <option value="owned">Our stock</option>
                          <option value="brokered">Brokered</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={editLines.length === 1}
                        onClick={() =>
                          setEditLines((current) => current.filter((_, itemIndex) => itemIndex !== index))
                        }
                        className="mt-5 flex h-10 items-center justify-center rounded-md border text-red-600 disabled:opacity-30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      {line.sourcingMode === "brokered" ? (
                        <div className="grid gap-3 rounded-md bg-amber-50 p-3 md:col-span-6 md:grid-cols-2">
                          <label className="text-[9px] font-medium text-amber-800">
                            Supplier
                            <select
                              value={line.supplierId}
                              onChange={(event) =>
                                setEditLines((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, supplierId: event.target.value } : item,
                                  ),
                                )
                              }
                              className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-[10px]"
                            >
                              <option value="">Select supplier…</option>
                              {supplierOptions.map((supplier) => (
                                <option key={supplier.id} value={supplier.id}>
                                  {supplier.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-[9px] font-medium text-amber-800">
                            Quote received
                            <input
                              type="datetime-local"
                              value={line.supplierQuoteAt}
                              onChange={(event) =>
                                setEditLines((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, supplierQuoteAt: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                              className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-[10px]"
                            />
                          </label>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCommercial(false)}
                className="h-10 rounded-md border px-4 text-[10px] font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || deal.reserved_qty > 0}
                onClick={saveCommercial}
                className="h-10 rounded-md bg-primary px-5 text-[10px] font-semibold text-white disabled:opacity-50"
              >
                Save deal
              </button>
            </div>
        </AdminModalScrim>
      ) : null}

      {guestManagerOpen ? (
        <OperationsGuestEditor
          key={deal.id}
          title="Manage guests"
          subtitle={`${deal.reference} · ${client.accountName || client.contactName || "Client"}`}
          expectedCount={guestQty || guests.length || 1}
          existing={guests}
          pending={pending}
          onClose={() => setGuestManagerOpen(false)}
          onSave={saveGuests}
          onDelete={(guestId) => {
            run(() =>
              deleteOrderGuest({
                orderId: deal.order_id,
                dealId: deal.id,
                guestId,
              }),
            )
          }}
        />
      ) : null}

      {emailComposer ? (
        <OperationsEmailComposer
          dealId={deal.id}
          kind={emailComposer}
          onClose={() => setEmailComposer(null)}
          onSent={() => {
            setEmailComposer(null)
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}
