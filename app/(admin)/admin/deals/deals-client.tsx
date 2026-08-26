"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarCheck,
  ChartNoAxesCombined,
  Clock3,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  Trophy,
  Trash2,
  UnlockKeyhole,
  UsersRound,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { createCrmAccount, upsertCrmContact } from "@/app/(admin)/admin/clients/profile-actions"
import {
  createNativeDeal,
  releaseNativeDealStock,
  reserveNativeDealStock,
  setNativeDealHoldPolicy,
  updateNativeDealWorkflow,
} from "@/app/(admin)/actions"
import { AccountKindPills } from "@/components/admin/account-kind-pills"
import { ActionCombobox } from "@/components/admin/action-combobox"
import { SearchableSelect } from "@/components/admin/searchable-select"
import { EventFilter, uniqueEventFilterOptions } from "@/components/admin/event-filter"
import { AdminPageHeader, AdminPanel, AdminStatCard, AdminStats, AdminDesktopTable, AdminMobileList, StatusPill } from "@/components/admin/admin-page-kit"
import {
  DealLineBasket,
  isPricedDealBasketLine,
  numericDealField,
  type DealBasketLine,
  type DealBasketSupplier,
} from "@/components/admin/deal-line-basket"
import {
  DEAL_NEXT_ACTION_OPTIONS,
  DEAL_SOURCE_LABELS,
  DEAL_SOURCES,
  DEAL_STAGES,
  DEAL_STAGE_LABELS,
  dealConfirmedOffPlatform,
  dealSourceLabel,
  friendlyDealActivitySummary,
  type CrmAccountOption,
  type DealListRow,
  type DealPackageOption,
  type DealStage,
} from "@/lib/crm/deal-types"
import { type AccountKind } from "@/lib/crm/account-kinds"
import type { StaffOption } from "@/lib/crm/lead-types"
import type { BookingFormAdminRow, BookingFormEventRow } from "@/lib/booking-forms/types"
import { cn } from "@/lib/utils"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"
import { adminDealPath } from "@/lib/admin/deal-link"
import { adminAccountPath, adminContactPath } from "@/lib/crm/profile-links"
import Link from "next/link"
import { BookingFormPanel } from "./booking-form-panel"
import { DealFinancePanel } from "./deal-finance-panel"
import { updateDealCommercials, deleteDeal } from "./deal-edit-actions"

type PipelineView = "all" | "mine" | "team"
type PipelineStageId =
  | "new_enquiry"
  | "price_sent"
  | "booking_form"
  | "awaiting_payment"
  | "won"
  | "lost"

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

function localDateTimeInput(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

function shortDate(value: string | null): string {
  if (!value) return "—"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function formatCreatedDate(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function dealReferenceNumber(reference: string): number {
  const match = /^DL(\d+)$/i.exec(reference.trim())
  return match ? Number(match[1]) : Number.NaN
}

type DealSortKey = "reference" | "created"

function DealSortTh({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string
  column: DealSortKey
  sortKey: DealSortKey
  sortDir: "asc" | "desc"
  onSort: (key: DealSortKey) => void
}) {
  const active = sortKey === column
  return (
    <th className="whitespace-nowrap px-3 py-2 font-medium">
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-700"
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" aria-hidden />
        )}
      </button>
    </th>
  )
}

function stageTone(stage: DealStage): "green" | "amber" | "red" | "blue" | "purple" | "gray" {
  switch (pipelineStageFor(stage).id) {
    case "new_enquiry":
      return "purple"
    case "price_sent":
      return "blue"
    case "booking_form":
      return "amber"
    case "awaiting_payment":
      return "red"
    case "won":
      return "green"
    case "lost":
      return "gray"
  }
}

function approvalLabel(stage: DealStage): { label: string; tone: "green" | "amber" | "gray" } {
  if (["signed", "awaiting_invoice", "awaiting_payment", "paid_confirmed", "in_fulfilment", "fulfilled"].includes(stage)) {
    return { label: "Approved", tone: "green" }
  }
  if (stage === "awaiting_zk_signature") return { label: "Pending", tone: "amber" }
  return { label: "—", tone: "gray" }
}

const PIPELINE_COLUMNS: Array<{
  id: PipelineStageId
  label: string
  stages: DealStage[]
  colour: string
}> = [
  {
    id: "new_enquiry",
    label: "Enquiry",
    stages: ["draft", "sourcing"],
    colour: "border-violet-500",
  },
  { id: "price_sent", label: "Price sent", stages: ["proposal"], colour: "border-blue-500" },
  {
    id: "booking_form",
    label: "Booking form",
    stages: ["booking_form_sent", "awaiting_client_signature", "awaiting_zk_signature"],
    colour: "border-amber-500",
  },
  {
    id: "awaiting_payment",
    label: "Awaiting payment",
    stages: ["signed", "awaiting_invoice", "awaiting_payment"],
    colour: "border-red-500",
  },
  {
    id: "won",
    label: "Won",
    stages: ["paid_confirmed", "in_fulfilment", "fulfilled"],
    colour: "border-emerald-500",
  },
  { id: "lost", label: "Lost", stages: ["closed_lost", "cancelled"], colour: "border-slate-400" },
]

function pipelineStageFor(stage: DealStage) {
  return PIPELINE_COLUMNS.find((column) => column.stages.includes(stage)) ?? PIPELINE_COLUMNS[0]
}

function actionRequired(deal: DealListRow): string {
  if (deal.next_action?.trim()) return deal.next_action
  switch (deal.stage) {
    case "draft":
      return "Review enquiry and send price"
    case "sourcing":
      return "Confirm sourcing and price"
    case "proposal":
      return "Follow up price"
    case "booking_form_sent":
    case "awaiting_client_signature":
      return "Chase client signature"
    case "awaiting_zk_signature":
      return "ZK admin to approve and sign"
    case "signed":
    case "awaiting_invoice":
      return "Create and send invoice"
    case "awaiting_payment":
      return "Follow up payment"
    case "paid_confirmed":
      return "Hand over to fulfilment"
    case "in_fulfilment":
      return "Complete fulfilment"
    case "fulfilled":
      return "Complete"
    case "closed_lost":
    case "cancelled":
      return "No action — closed"
  }
}

export function DealsClient({
  deals,
  packageOptions,
  createPackageOptions,
  accountOptions,
  staffOptions,
  currentProfileId,
  currentProfileName,
  currentIsAdmin,
  currentCanManageFinance,
  bookingForms,
  bookingFormEvents,
  supplierOptions,
  initialSelectedId = null,
}: {
  deals: DealListRow[]
  packageOptions: DealPackageOption[]
  createPackageOptions: DealPackageOption[]
  accountOptions: CrmAccountOption[]
  staffOptions: StaffOption[]
  currentProfileId: string
  currentProfileName: string
  currentIsAdmin: boolean
  currentCanManageFinance: boolean
  bookingForms: BookingFormAdminRow[]
  bookingFormEvents: BookingFormEventRow[]
  supplierOptions: DealBasketSupplier[]
  initialSelectedId?: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [listState, setListState] = usePersistedAdminFilters("zk-admin-deals-filters-v1", {
    view: "all" as PipelineView,
    query: "",
    pipelineFilter: "" as PipelineStageId | "",
    sourceFilter: "",
    eventFilter: [] as string[],
    sortKey: "reference" as DealSortKey,
    sortDir: "desc" as "asc" | "desc",
  })
  const { view, query, pipelineFilter, sourceFilter, eventFilter, sortKey, sortDir } = listState
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId && deals.some((deal) => deal.id === initialSelectedId)
      ? initialSelectedId
      : initialSelectedId
        ? initialSelectedId
        : (deals[0]?.id ?? null),
  )
  const previewRef = useRef<HTMLElement>(null)
  const [showCreate, setShowCreate] = useState(false)
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
  const [reserve, setReserve] = useState(false)
  const [workflowStage, setWorkflowStage] = useState<DealStage>("draft")
  const [workflowOwner, setWorkflowOwner] = useState("")
  const [workflowAction, setWorkflowAction] = useState("")
  const [workflowDueAt, setWorkflowDueAt] = useState("")
  const [workflowCloseDate, setWorkflowCloseDate] = useState("")
  const [workflowLossReason, setWorkflowLossReason] = useState("")
  const [holdDays, setHoldDays] = useState("7")
  const [holdUntil, setHoldUntil] = useState("")
  const [doNotExpire, setDoNotExpire] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editAccountId, setEditAccountId] = useState("")
  const [editContactId, setEditContactId] = useState("")
  const [editSource, setEditSource] = useState("other")
  const [editNotes, setEditNotes] = useState("")
  const [editLines, setEditLines] = useState<EditLineState[]>([])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return deals.filter((deal) => {
      if (view === "mine" && deal.owner_profile_id !== currentProfileId) return false
      if (
        view === "team" &&
        (!deal.owner_profile_id || ["cancelled", "closed_lost", "fulfilled"].includes(deal.stage))
      ) {
        return false
      }
      if (pipelineFilter && pipelineStageFor(deal.stage).id !== pipelineFilter) return false
      if (sourceFilter && deal.source !== sourceFilter) return false
      if (eventFilter.length > 0) {
        const selected = new Set(eventFilter)
        if (!(deal.events ?? []).some((event) => selected.has(event.id))) return false
      }
      if (!q) return true
      return [
        deal.reference,
        deal.account_name,
        deal.contact_name,
        deal.race_name,
        deal.line_summary,
        deal.owner_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    })
  }, [currentProfileId, deals, eventFilter, pipelineFilter, query, sourceFilter, view])

  const sorted = useMemo(() => {
    const rows = [...filtered]
    const direction = sortDir === "asc" ? 1 : -1
    rows.sort((a, b) => {
      if (sortKey === "created") {
        return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * direction
      }
      const aNumber = dealReferenceNumber(a.reference)
      const bNumber = dealReferenceNumber(b.reference)
      if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
        return (aNumber - bNumber) * direction
      }
      return a.reference.localeCompare(b.reference) * direction
    })
    return rows
  }, [filtered, sortDir, sortKey])

  function toggleSort(column: DealSortKey) {
    setListState((current) => {
      if (current.sortKey === column) {
        return { ...current, sortDir: current.sortDir === "desc" ? "asc" : "desc" }
      }
      return { ...current, sortKey: column, sortDir: "desc" }
    })
  }

  const selected = selectedId ? deals.find((deal) => deal.id === selectedId) ?? null : null

  useEffect(() => {
    if (!initialSelectedId) return
    if (deals.some((deal) => deal.id === initialSelectedId)) {
      setSelectedId(initialSelectedId)
    }
  }, [deals, initialSelectedId])

  useEffect(() => {
    if (!initialSelectedId) return
    const el = document.getElementById(`deal-${initialSelectedId}`)
    el?.scrollIntoView({ block: "center" })
  }, [initialSelectedId, selected?.id])

  useEffect(() => {
    previewRef.current?.scrollTo({ top: 0 })
  }, [selectedId])
  const latestBookingByDeal = useMemo(() => {
    const map = new Map<string, BookingFormAdminRow>()
    for (const form of bookingForms) {
      const current = map.get(form.deal_id)
      if (!current || form.revision > current.revision) map.set(form.deal_id, form)
    }
    return map
  }, [bookingForms])
  const bookingEventsByForm = useMemo(() => {
    const map = new Map<string, BookingFormEventRow[]>()
    for (const event of bookingFormEvents) {
      const rows = map.get(event.booking_form_id) ?? []
      rows.push(event)
      map.set(event.booking_form_id, rows)
    }
    return map
  }, [bookingFormEvents])
  const selectedBookingForm = selected ? latestBookingByDeal.get(selected.id) ?? null : null
  const commercialEditLocked =
    Boolean(selected?.order_id) ||
    Boolean(
      selectedBookingForm &&
        ["sent", "viewed", "awaiting_zk_signature", "zk_signed", "completed"].includes(
          selectedBookingForm.status,
        ),
    )
  useEffect(() => {
    if (!selected) return
    setWorkflowStage(selected.stage)
    setWorkflowOwner(selected.owner_profile_id ?? "")
    setWorkflowAction(selected.next_action ?? "")
    setWorkflowDueAt(selected.next_action_due_at?.slice(0, 16) ?? "")
    setWorkflowCloseDate(selected.expected_close_date ?? "")
    setWorkflowLossReason(selected.loss_reason ?? "")
    setHoldUntil(selected.hold_expires_at?.slice(0, 16) ?? "")
    setDoNotExpire(selected.do_not_expire)
  }, [selected])
  const openDeals = deals.filter((deal) => !["cancelled", "closed_lost", "fulfilled"].includes(deal.stage))
  const pipelineValue = openDeals.reduce((sum, deal) => sum + deal.total_amount, 0)
  const awaitingApproval = deals.filter((deal) => deal.stage === "awaiting_zk_signature")
  const monthKey = new Date().toISOString().slice(0, 7)
  const closingThisMonth = deals.filter((deal) => deal.expected_close_date?.startsWith(monthKey))
  const wonThisMonth = deals.filter(
    (deal) =>
      ["paid_confirmed", "in_fulfilment", "fulfilled"].includes(deal.stage) &&
      deal.updated_at.startsWith(monthKey),
  )

  const eventOptions = useMemo(
    () =>
      uniqueEventFilterOptions(
        deals.flatMap((deal) =>
          (deal.events ?? []).map((event) => ({
            id: event.id,
            label: event.label,
            eventDate: event.eventDate,
          })),
        ),
      ),
    [deals],
  )
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
  const editAccount = accountOptions.find((account) => account.id === editAccountId) ?? null
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

  function resetCreateForm() {
    setShowCreate(false)
    setAccountId("")
    setContactId("")
    setNewAccountMode(false)
    setNewContactMode(false)
    setNewAccountName("")
    setNewAccountTypes([])
    setNewContactName("")
    setNewContactEmail("")
    setNewContactPhone("")
    setNewBillingLine1("")
    setNewBillingLine2("")
    setNewBillingCity("")
    setNewBillingPostcode("")
    setNewBillingCountry("")
    setCreateLines([])
    setNotes("")
    setCreateSource("offline")
    setReserve(false)
  }
  function openDealEditor() {
    if (!selected) return
    setEditAccountId(selected.account_id ?? "")
    setEditContactId(selected.primary_contact_id ?? "")
    setEditSource(selected.source)
    setEditNotes(selected.notes ?? "")
    setEditLines(
      selected.lines.length
        ? selected.lines.map((line) => ({
            id: line.id,
            packageId: line.package_id,
            quantity: String(line.quantity),
            unitPrice: String(line.unit_sale_price),
            expectedUnitCost:
              line.expected_unit_cost == null ? "" : String(line.expected_unit_cost),
            sourcingMode: line.sourcing_mode,
            supplierId: line.supplier_id ?? "",
            supplierQuoteAt: localDateTimeInput(line.supplier_quote_at),
          }))
        : [{
            packageId: "",
            quantity: "1",
            unitPrice: "",
            expectedUnitCost: "",
            sourcingMode: "owned",
            supplierId: "",
            supplierQuoteAt: "",
          }],
    )
    setShowEdit(true)
  }

  function saveDealEditor() {
    if (!selected || !editAccountId || editLines.some((line) => !line.packageId)) {
      toast.error("Select an account and product for every line.")
      return
    }
    const lines = editLines.map((line) => ({
      id: line.id,
      packageId: line.packageId,
      quantity: Math.floor(Number(line.quantity)),
      unitPrice: Number(line.unitPrice),
      expectedUnitCost:
        line.expectedUnitCost.trim() === "" ? null : Number(line.expectedUnitCost),
      sourcingMode: line.sourcingMode,
      supplierId: line.supplierId || null,
      supplierQuoteAt: line.supplierQuoteAt || null,
    }))
    startTransition(async () => {
      const result = await updateDealCommercials({
        dealId: selected.id,
        accountId: editAccountId,
        contactId: editContactId || undefined,
        source: editSource,
        notes: editNotes,
        lines,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      setShowEdit(false)
      router.refresh()
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
      resetCreateForm()
      router.refresh()
    })
  }

  function saveWorkflow() {
    if (!selected) return
    startTransition(async () => {
      const result = await updateNativeDealWorkflow({
        dealId: selected.id,
        stage: workflowStage,
        ownerProfileId: workflowOwner || null,
        nextAction: workflowAction,
        nextActionDueAt: workflowDueAt || null,
        expectedCloseDate: workflowCloseDate || null,
        lossReason: workflowLossReason,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function reserveSelectedDeal() {
    if (!selected) return
    startTransition(async () => {
      const result = await reserveNativeDealStock(selected.id, Number(holdDays))
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function releaseSelectedDeal() {
    if (!selected) return
    startTransition(async () => {
      const result = await releaseNativeDealStock(selected.id)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function saveHoldPolicy() {
    if (!selected) return
    startTransition(async () => {
      const result = await setNativeDealHoldPolicy({
        dealId: selected.id,
        doNotExpire,
        holdUntil: doNotExpire ? null : holdUntil || null,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function confirmDeleteSelectedDeal() {
    if (!selected) return
    if (
      !window.confirm(
        `Delete ${selected.reference}? This cannot be undone. Deals with a portal order or active booking form cannot be deleted.`,
      )
    ) {
      return
    }
    startTransition(async () => {
      const result = await deleteDeal({ dealId: selected.id })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      setSelectedId(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <AdminPageHeader
        title="Deals / Pipeline"
        description="View all deals, track status, and manage your personal pipeline."
      />

      <AdminStats className="sm:grid-cols-2 xl:grid-cols-5">
        <AdminStatCard icon={UsersRound} value={openDeals.length} label="Open deals" tone="purple" />
        <AdminStatCard icon={ChartNoAxesCombined} value={money(pipelineValue)} label="Pipeline value" tone="blue" />
        <AdminStatCard icon={Clock3} value={awaitingApproval.length} label="Awaiting ZK approval" tone="amber" />
        <AdminStatCard icon={CalendarCheck} value={closingThisMonth.length} label="Closing this month" tone="green" />
        <AdminStatCard
          icon={Trophy}
          value={money(wonThisMonth.reduce((sum, deal) => sum + deal.total_amount, 0))}
          label="Won this month"
          tone="amber"
        />
      </AdminStats>

      <AdminPanel className="overflow-visible">
        <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] px-4 pt-3">
          {([
            ["all", "All deals"],
            ["mine", "My pipeline"],
            ["team", "Team pipeline"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setListState((current) => ({ ...current, view: id }))}
              className={cn(
                "border-b-2 px-3 pb-3 text-[10px] font-semibold",
                view === id ? "border-primary text-primary" : "border-transparent text-slate-500",
              )}
            >
              {label}
            </button>
          ))}
          <button type="button" className="mb-3 hidden h-9 rounded-md border px-3 text-[9px] font-medium sm:inline-flex sm:ml-auto">
            Save view
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="mb-3 ml-auto flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-[9px] font-semibold text-white sm:ml-0 sm:w-auto"
          >
            <Plus className="h-3.5 w-3.5" /> New deal
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-[#eceef1] p-3">
          <select
            value={pipelineFilter}
            onChange={(e) =>
              setListState((current) => ({ ...current, pipelineFilter: e.target.value as PipelineStageId | "" }))
            }
            className="h-9 rounded-md border bg-white px-3 text-[9px]"
          >
            <option value="">All stages</option>
            {PIPELINE_COLUMNS.map((column) => (
              <option key={column.id} value={column.id}>{column.label}</option>
            ))}
          </select>
          <select value={sourceFilter} onChange={(e) => setListState((current) => ({ ...current, sourceFilter: e.target.value }))} className="h-9 rounded-md border bg-white px-3 text-[9px]">
            <option value="">All sources</option>
            {DEAL_SOURCES.map((source) => (
              <option key={source} value={source}>{DEAL_SOURCE_LABELS[source]}</option>
            ))}
          </select>
          <EventFilter options={eventOptions} selectedIds={eventFilter} onChange={(eventFilter) => setListState((current) => ({ ...current, eventFilter }))} />
          <div className="relative w-full min-w-0 sm:ml-auto sm:min-w-[260px] sm:w-auto sm:flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setListState((current) => ({ ...current, query: e.target.value }))}
              placeholder="Search deals, clients, events..."
              className="h-9 w-full rounded-md border pl-9 pr-3 text-[9px] outline-none focus:border-primary/50"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-[#eceef1] p-3 md:grid-cols-3 xl:grid-cols-6">
          {PIPELINE_COLUMNS.map((column) => {
            const columnDeals = filtered.filter((deal) => column.stages.includes(deal.stage))
            const value = columnDeals.reduce((sum, deal) => sum + deal.total_amount, 0)
            return (
              <button
                key={column.label}
                type="button"
                onClick={() =>
                  setListState((current) => ({
                    ...current,
                    pipelineFilter: current.pipelineFilter === column.id ? "" : column.id,
                  }))
                }
                className={cn(
                  "rounded-md border border-t-2 bg-white p-3 text-left transition-shadow",
                  column.colour,
                  pipelineFilter === column.id && "ring-2 ring-primary/20",
                )}
              >
                <p className="text-[8px] font-medium text-slate-500">{column.label}</p>
                <p className="mt-1 text-[12px] font-semibold">{columnDeals.length}</p>
                <p className="mt-0.5 text-[8px] text-slate-500">{money(value)}</p>
              </button>
            )
          })}
        </div>

        <div className={cn(
          "grid min-h-[540px] items-start",
          selected && "xl:grid-cols-[minmax(0,1fr)_340px]",
        )}>
          <div className={cn("hidden min-w-0 overflow-x-auto no-scrollbar md:block", selected && "border-r border-[#eceef1]")}>
            <div className="px-4 py-2.5 text-[8px] text-slate-500">
              Showing {filtered.length} of {deals.length} deals
            </div>
            <table className="w-full min-w-[720px] text-left">
              <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-[#92969e]">
                <tr>
                  <DealSortTh label="Deal ID" column="reference" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <DealSortTh label="Created" column="created" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="px-3 py-2 font-medium">Client / Company</th>
                  <th className="px-3 py-2 font-medium">Event / Package</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Source</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Deal owner</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Stage</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Next action</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Deal value</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Approval</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f1f3] text-[9px]">
                {sorted.map((deal) => {
                  const approval = approvalLabel(deal.stage)
                  const pipelineStage = pipelineStageFor(deal.stage)
                  return (
                    <tr
                      id={`deal-${deal.id}`}
                      key={deal.id}
                      onClick={() => setSelectedId(deal.id)}
                      className={cn(
                        "cursor-pointer hover:bg-slate-50",
                        selected?.id === deal.id && "bg-red-50/60 outline outline-1 outline-primary/30",
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-3 font-semibold">
                        <Link
                          href={adminDealPath(deal.id)}
                          onClick={(event) => event.stopPropagation()}
                          className="text-primary hover:underline"
                        >
                          {deal.reference}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600">{formatCreatedDate(deal.created_at)}</td>
                      <td className="px-3 py-3">
                        {deal.account_id && deal.account_name ? (
                          <Link
                            href={adminAccountPath(deal.account_id)}
                            onClick={(event) => event.stopPropagation()}
                            className="font-medium hover:text-primary hover:underline"
                          >
                            {deal.account_name}
                          </Link>
                        ) : <p className="font-medium">—</p>}
                        {deal.account_id && deal.primary_contact_id && deal.contact_name ? (
                          <Link
                            href={adminContactPath(deal.account_id, deal.primary_contact_id)}
                            onClick={(event) => event.stopPropagation()}
                            className="mt-0.5 block text-[8px] text-slate-400 hover:text-primary hover:underline"
                          >
                            {deal.contact_name}
                          </Link>
                        ) : <p className="text-[8px] text-slate-400">—</p>}
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium">{deal.race_name || "—"}</p>
                        <p className="mt-0.5 text-[8px] text-slate-400">{deal.line_summary || "—"}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3"><StatusPill tone="blue">{dealSourceLabel(deal.source)}</StatusPill></td>
                      <td className="whitespace-nowrap px-3 py-3">{deal.owner_name || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <StatusPill tone={stageTone(deal.stage)}>{pipelineStage.label}</StatusPill>
                      </td>
                      <td className="max-w-[120px] px-3 py-3 font-medium text-slate-700">
                        <p className="truncate" title={actionRequired(deal)}>{actionRequired(deal)}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-semibold">{money(deal.total_amount, deal.currency)}</td>
                      <td className="whitespace-nowrap px-3 py-3"><StatusPill tone={approval.tone}>{approval.label}</StatusPill></td>
                    </tr>
                  )
                })}
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-14 text-center text-[10px] text-slate-400">No deals match this view.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <AdminMobileList>
            {sorted.map((deal) => {
              const pipelineStage = pipelineStageFor(deal.stage)
              return (
                <button
                  type="button"
                  key={deal.id}
                  onClick={() => setSelectedId(deal.id)}
                  className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-primary">{deal.reference}</p>
                    <p className="mt-0.5 font-medium text-slate-700">{deal.account_name || "—"}</p>
                    <p className="mt-1 text-[10px] leading-snug text-slate-600">{deal.race_name || deal.line_summary || "—"}</p>
                    <p className="mt-0.5 text-[8px] text-slate-400">{shortDate(deal.created_at)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold">{money(deal.total_amount, deal.currency)}</p>
                    <div className="mt-1"><StatusPill tone={stageTone(deal.stage)}>{pipelineStage.label}</StatusPill></div>
                  </div>
                </button>
              )
            })}
            {filtered.length === 0 ? (
              <p className="px-4 py-14 text-center text-[10px] text-slate-400">No deals match this view.</p>
            ) : null}
          </AdminMobileList>

          {selected ? (
            <aside
              ref={previewRef}
              className="min-w-0 overflow-x-hidden bg-white max-xl:fixed max-xl:inset-x-0 max-xl:bottom-0 max-xl:top-14 max-xl:z-40 max-xl:overflow-y-auto xl:sticky xl:top-16 xl:z-20 xl:max-h-[calc(100vh-4rem)] xl:overflow-y-auto"
            >
              <div className="space-y-4 p-5">
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h2
                        className="truncate text-[12px] font-semibold"
                        title={`${selected.reference} — ${selected.account_name || "Deal"}`}
                      >
                        <Link href={adminDealPath(selected.id)} className="text-primary hover:underline">
                          {selected.reference}
                        </Link>
                        {" — "}
                        {selected.account_name || "Deal"}
                      </h2>
                      <p className="mt-1 truncate text-[8px] text-slate-400">
                        {selected.recent_activities[0]
                          ? `Last update by ${selected.recent_activities[0].actor_name || "someone"} · ${new Date(selected.recent_activities[0].created_at).toLocaleString("en-GB")}`
                          : `Updated ${new Date(selected.updated_at).toLocaleString("en-GB")}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="shrink-0 p-0.5 text-slate-400 hover:text-slate-700"
                      aria-label="Close deal preview"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={adminDealPath(selected.id)}
                      className="flex h-8 shrink-0 items-center rounded-md border px-2 text-[8px] font-semibold"
                    >
                      Open page
                    </Link>
                    <button
                      type="button"
                      onClick={openDealEditor}
                      disabled={commercialEditLocked}
                      title={commercialEditLocked ? "Void the active form first, or edit before an order exists." : "Edit deal"}
                      className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[8px] font-semibold disabled:opacity-40"
                    >
                      <Pencil className="h-3 w-3" /> Edit deal
                    </button>
                    <button
                      type="button"
                      onClick={confirmDeleteSelectedDeal}
                      disabled={pending || Boolean(selected.order_id)}
                      title={
                        selected.order_id
                          ? "This deal has a portal order, so it cannot be deleted."
                          : "Delete this deal"
                      }
                      className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-red-200 px-2 text-[8px] font-semibold text-red-600 disabled:opacity-40"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </div>
                <dl className="grid grid-cols-[125px_1fr] gap-y-2.5 border-y py-4 text-[9px]">
                  <dt className="text-slate-400">Client / Company</dt><dd className="font-medium">{selected.account_id && selected.account_name ? <Link href={adminAccountPath(selected.account_id)} className="text-primary hover:underline">{selected.account_name}</Link> : "—"}</dd>
                  <dt className="text-slate-400">Contact</dt><dd>{selected.account_id && selected.primary_contact_id && selected.contact_name ? <Link href={adminContactPath(selected.account_id, selected.primary_contact_id)} className="text-primary hover:underline">{selected.contact_name}</Link> : "—"}</dd>
                  <dt className="text-slate-400">Event / Package</dt><dd>{selected.race_name || "—"}<br /><span className="text-slate-500">{selected.line_summary || "—"}</span></dd>
                  <dt className="text-slate-400">Source</dt><dd><StatusPill tone="blue">{dealSourceLabel(selected.source)}</StatusPill></dd>
                  <dt className="text-slate-400">Deal owner</dt><dd>{selected.owner_name || "—"}</dd>
                  <dt className="text-slate-400">Sales stage</dt>
                  <dd><StatusPill tone={stageTone(selected.stage)}>{pipelineStageFor(selected.stage).label}</StatusPill></dd>
                  <dt className="text-slate-400">Workflow status</dt><dd>{DEAL_STAGE_LABELS[selected.stage]}</dd>
                  <dt className="text-slate-400">Action required</dt><dd className="font-semibold text-primary">{actionRequired(selected)}</dd>
                  <dt className="text-slate-400">Deal value</dt><dd className="font-semibold">{money(selected.total_amount, selected.currency)}</dd>
                  <dt className="text-slate-400">Gross profit / Margin</dt>
                  <dd>{selected.gross_profit == null ? "Not costed" : `${money(selected.gross_profit, selected.currency)} (${((selected.margin ?? 0) * 100).toFixed(1)}%)`}</dd>
                  <dt className="text-slate-400">Expected close date</dt><dd>{shortDate(selected.expected_close_date)}</dd>
                  <dt className="text-slate-400">Stock reservation</dt>
                  <dd>
                    {selected.reserved_qty > 0
                      ? `${selected.reserved_qty} unit${selected.reserved_qty === 1 ? "" : "s"} reserved${selected.hold_expires_at ? ` until ${shortDate(selected.hold_expires_at.slice(0, 10))}` : ""}`
                      : "No active reservation"}
                  </dd>
                </dl>
                <div className="rounded-lg border border-slate-200 p-3">
                  <h3 className="text-[9px] font-semibold">Workflow</h3>
                  <div className="mt-3 grid gap-2">
                    <label className="text-[8px] font-medium text-slate-500">
                      Stage
                      <select
                        value={workflowStage}
                        onChange={(event) => setWorkflowStage(event.target.value as DealStage)}
                        className="mt-1 h-9 w-full rounded-md border bg-white px-2 text-[9px] text-slate-800"
                      >
                        {DEAL_STAGES.map((stage) => (
                          <option key={stage} value={stage}>{DEAL_STAGE_LABELS[stage]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[8px] font-medium text-slate-500">
                      Owner
                      <select
                        value={workflowOwner}
                        onChange={(event) => setWorkflowOwner(event.target.value)}
                        className="mt-1 h-9 w-full rounded-md border bg-white px-2 text-[9px] text-slate-800"
                      >
                        <option value="">Unassigned</option>
                        {staffOptions.map((owner) => (
                          <option key={owner.id} value={owner.id}>{owner.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[8px] font-medium text-slate-500">
                      Next action
                      <ActionCombobox
                        value={workflowAction}
                        onChange={setWorkflowAction}
                        options={DEAL_NEXT_ACTION_OPTIONS}
                        inputClassName="mt-1 h-9 w-full rounded-md border px-2 text-[9px] text-slate-800"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[8px] font-medium text-slate-500">
                        Action due
                        <input
                          type="datetime-local"
                          value={workflowDueAt}
                          onChange={(event) => setWorkflowDueAt(event.target.value)}
                          className="mt-1 h-9 w-full rounded-md border px-2 text-[9px] text-slate-800"
                        />
                      </label>
                      <label className="text-[8px] font-medium text-slate-500">
                        Expected close
                        <input
                          type="date"
                          value={workflowCloseDate}
                          onChange={(event) => setWorkflowCloseDate(event.target.value)}
                          className="mt-1 h-9 w-full rounded-md border px-2 text-[9px] text-slate-800"
                        />
                      </label>
                    </div>
                    {workflowStage === "closed_lost" ? (
                      <label className="text-[8px] font-medium text-slate-500">
                        Loss reason
                        <input
                          value={workflowLossReason}
                          onChange={(event) => setWorkflowLossReason(event.target.value)}
                          className="mt-1 h-9 w-full rounded-md border px-2 text-[9px] text-slate-800"
                        />
                      </label>
                    ) : null}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={saveWorkflow}
                      className="h-9 rounded-md bg-slate-900 text-[9px] font-semibold text-white disabled:opacity-50"
                    >
                      Save workflow
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    {selected.reserved_qty > 0 ? <LockKeyhole className="h-3.5 w-3.5 text-amber-600" /> : <UnlockKeyhole className="h-3.5 w-3.5 text-slate-400" />}
                    <h3 className="text-[9px] font-semibold">Stock hold</h3>
                  </div>
                  {selected.reserved_qty > 0 ? (
                    <div className="mt-3 space-y-2">
                      <label className="flex items-center gap-2 text-[9px] font-medium">
                        <input
                          type="checkbox"
                          checked={doNotExpire}
                          onChange={(event) => setDoNotExpire(event.target.checked)}
                        />
                        Do not expire this hold
                      </label>
                      {!doNotExpire ? (
                        <label className="block text-[8px] font-medium text-slate-500">
                          Hold until
                          <input
                            type="datetime-local"
                            value={holdUntil}
                            onChange={(event) => setHoldUntil(event.target.value)}
                            className="mt-1 h-9 w-full rounded-md border px-2 text-[9px]"
                          />
                        </label>
                      ) : null}
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" disabled={pending} onClick={saveHoldPolicy} className="h-9 rounded-md border text-[9px] font-semibold disabled:opacity-50">
                          Update hold
                        </button>
                        <button type="button" disabled={pending} onClick={releaseSelectedDeal} className="h-9 rounded-md border border-red-200 text-[9px] font-semibold text-red-600 disabled:opacity-50">
                          Release stock
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <p className="text-[8px] text-slate-500">Reserve every available deal line atomically.</p>
                      <div className="mt-2 flex gap-2">
                        <label className="flex-1 text-[8px] font-medium text-slate-500">
                          Days
                          <input type="number" min={1} max={90} value={holdDays} onChange={(event) => setHoldDays(event.target.value)} className="mt-1 h-9 w-full rounded-md border px-2 text-[9px]" />
                        </label>
                        <button
                          type="button"
                          disabled={pending || ["closed_lost", "cancelled", "fulfilled"].includes(selected.stage)}
                          onClick={reserveSelectedDeal}
                          className="mt-4 h-9 flex-[2] rounded-md bg-primary text-[9px] font-semibold text-white disabled:opacity-50"
                        >
                          Reserve stock
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-[9px] font-semibold">Latest activity</h3>
                  <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 text-[8px] text-slate-600">
                    {selected.recent_activities.length > 0 ? (
                      selected.recent_activities.map((activity) => (
                        <p key={activity.id}>
                          <span className="font-semibold text-slate-800">
                            {activity.actor_name || "Someone"}
                          </span>
                          {" — "}
                          {friendlyDealActivitySummary(activity.summary)}
                          <span className="mt-0.5 block text-slate-400">
                            {new Date(activity.created_at).toLocaleString("en-GB")}
                          </span>
                        </p>
                      ))
                    ) : (
                      <p>Deal last updated — {new Date(selected.updated_at).toLocaleString("en-GB")}</p>
                    )}
                    <p>
                      Deal created
                      {selected.created_by_name ? ` by ${selected.created_by_name}` : ""}
                      {" — "}
                      {new Date(selected.created_at).toLocaleString("en-GB")}
                    </p>
                  </div>
                </div>
                <div>
                  <h3 className="text-[9px] font-semibold">Notes / Interests</h3>
                  <p className="mt-2 min-h-16 rounded-lg border p-3 text-[8px] text-slate-600">{selected.notes || "No notes recorded."}</p>
                </div>
                <BookingFormPanel
                  dealId={selected.id}
                  dealClosed={["closed_lost", "cancelled", "fulfilled"].includes(selected.stage)}
                  orderAlreadyConfirmed={Boolean(selected.order_id) || dealConfirmedOffPlatform(selected)}
                  confirmedOffPlatform={dealConfirmedOffPlatform(selected)}
                  form={latestBookingByDeal.get(selected.id) ?? null}
                  events={
                    latestBookingByDeal.get(selected.id)
                      ? bookingEventsByForm.get(latestBookingByDeal.get(selected.id)!.id) ?? []
                      : []
                  }
                  currentIsAdmin={currentIsAdmin}
                  currentProfileName={currentProfileName}
                />
                <DealFinancePanel
                  deal={selected}
                  canManageFinance={currentCanManageFinance}
                />
              </div>
            </aside>
          ) : null}
        </div>
      </AdminPanel>

      {showEdit && selected ? (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowEdit(false)}>
          <div className="max-h-[92dvh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-4 sm:p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Edit {selected.reference}</h2>
                <p className="mt-1 text-sm text-slate-500">Correct the client, products, quantities, prices and expected costs.</p>
              </div>
              <button type="button" onClick={() => setShowEdit(false)}><X className="h-5 w-5" /></button>
            </div>
            {selected.reserved_qty > 0 ? (
              <div className="mt-4 rounded-md bg-amber-50 p-3 text-[10px] text-amber-800">
                Release the active stock reservation before changing products or quantities.
              </div>
            ) : null}
            {["paid_confirmed", "in_fulfilment", "fulfilled"].includes(selected.stage) ? (
              <div className="mt-4 rounded-md bg-blue-50 p-3 text-[10px] text-blue-800">
                Editing an imported won deal returns its stock reconciliation to Pending so the corrected products can be reviewed again. It does not change stock.
              </div>
            ) : null}
            <div className="mt-5 grid gap-4 rounded-lg border p-4 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Account / company</span>
                <SearchableSelect
                  value={editAccountId}
                  onChange={(next) => {
                    setEditAccountId(next)
                    setEditContactId("")
                  }}
                  options={accountOptions.map((account) => ({ value: account.id, label: account.name }))}
                  placeholder="Search account…"
                  emptyLabel="No accounts match"
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
                    <option key={contact.id} value={contact.id}>{contact.full_name}{contact.email ? ` · ${contact.email}` : ""}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Source</span>
                <select value={editSource} onChange={(event) => setEditSource(event.target.value)} className="h-11 w-full rounded-md border bg-white px-3">
                  {DEAL_SOURCES.map((source) => (
                    <option key={source} value={source}>{DEAL_SOURCE_LABELS[source]}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Notes</span>
                <input value={editNotes} onChange={(event) => setEditNotes(event.target.value)} className="h-11 w-full rounded-md border px-3" />
              </label>
            </div>

            <div className="mt-4 rounded-lg border">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold">Products and pricing</h3>
                  <p className="text-[9px] text-slate-500">Create missing events/products in Manage Inventory first, then return here.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditLines((lines) => [...lines, {
                    packageId: "",
                    quantity: "1",
                    unitPrice: "",
                    expectedUnitCost: "",
                    sourcingMode: "owned",
                    supplierId: "",
                    supplierQuoteAt: "",
                  }])}
                  className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-[9px] font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" /> Add product
                </button>
              </div>
              <div className="divide-y">
                {editLines.map((line, index) => {
                  const product = packageOptions.find((option) => option.id === line.packageId)
                  return (
                    <div key={line.id ?? `new-${index}`} className="grid gap-3 p-4 md:grid-cols-[minmax(240px,1fr)_90px_120px_120px_130px_40px]">
                      <label className="text-[9px] font-medium text-slate-500">
                        Product
                        <SearchableSelect
                          value={line.packageId}
                          onChange={(packageId) => {
                            const nextProduct = packageOptions.find((option) => option.id === packageId)
                            setEditLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? {
                              ...item,
                              packageId,
                              unitPrice: item.unitPrice || (nextProduct?.price == null ? "" : String(nextProduct.price)),
                            } : item))
                          }}
                          options={packageOptions.map((option) => ({ value: option.id, label: option.label }))}
                          placeholder="Search product…"
                          className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-[10px]"
                        />
                        {product ? <span className="mt-1 block text-[8px] text-slate-400">{product.stockLeft} currently available</span> : null}
                      </label>
                      <label className="text-[9px] font-medium text-slate-500">Quantity<input type="number" min={1} value={line.quantity} onChange={(event) => setEditLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} className="mt-1 h-10 w-full rounded-md border px-2 text-[10px]" /></label>
                      <label className="text-[9px] font-medium text-slate-500">Sale price<input type="number" min={0} step="0.01" value={line.unitPrice} onChange={(event) => setEditLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, unitPrice: event.target.value } : item))} className="mt-1 h-10 w-full rounded-md border px-2 text-[10px]" /></label>
                      <label className="text-[9px] font-medium text-slate-500">Expected cost<input type="number" min={0} step="0.01" value={line.expectedUnitCost} onChange={(event) => setEditLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, expectedUnitCost: event.target.value } : item))} className="mt-1 h-10 w-full rounded-md border px-2 text-[10px]" /></label>
                      <label className="text-[9px] font-medium text-slate-500">
                        Stock source
                        <select value={line.sourcingMode} onChange={(event) => setEditLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, sourcingMode: event.target.value as "owned" | "brokered" } : item))} className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-[10px]">
                          <option value="owned">Our stock</option>
                          <option value="brokered">Brokered</option>
                        </select>
                      </label>
                      <button type="button" disabled={editLines.length === 1} onClick={() => setEditLines((lines) => lines.filter((_, itemIndex) => itemIndex !== index))} className="mt-5 flex h-10 items-center justify-center rounded-md border text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                      {line.sourcingMode === "brokered" ? (
                        <div className="grid gap-3 rounded-md bg-amber-50 p-3 md:col-span-6 md:grid-cols-2">
                          <label className="text-[9px] font-medium text-amber-800">
                            Supplier
                            <select value={line.supplierId} onChange={(event) => setEditLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, supplierId: event.target.value } : item))} className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-[10px]">
                              <option value="">Select supplier…</option>
                              {supplierOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                            </select>
                          </label>
                          <label className="text-[9px] font-medium text-amber-800">
                            Quote received
                            <input type="datetime-local" value={line.supplierQuoteAt} onChange={(event) => setEditLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, supplierQuoteAt: event.target.value } : item))} className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-[10px]" />
                          </label>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowEdit(false)} className="h-10 rounded-md border px-4 text-[10px] font-semibold">Cancel</button>
              <button type="button" disabled={pending || selected.reserved_qty > 0} onClick={saveDealEditor} className="h-10 rounded-md bg-primary px-5 text-[10px] font-semibold text-white disabled:opacity-50">Save deal</button>
            </div>
          </div>
        </div>
      ) : null}

      {showCreate ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={resetCreateForm}>
          <div
            className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between px-4 pt-4 sm:px-6 sm:pt-6">
              <div>
                <h2 className="text-lg font-semibold">Create new deal</h2>
                <p className="text-sm text-slate-500">Choose the client and product, then confirm pricing and stock.</p>
              </div>
              <button type="button" onClick={resetCreateForm}><X className="h-5 w-5" /></button>
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
                      <SearchableSelect
                        value={accountId}
                        onChange={(next) => {
                          setAccountId(next)
                          setContactId("")
                          setNewContactMode(false)
                          setNewContactName("")
                          setNewContactEmail("")
                          setNewContactPhone("")
                        }}
                        options={clientAccounts.map((account) => ({ value: account.id, label: account.name }))}
                        placeholder="Search account…"
                        emptyLabel="No accounts match"
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
                            <Plus className="h-3.5 w-3.5" /> New contact
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
                    products={createPackageOptions}
                    suppliers={supplierOptions}
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
                    <p className="text-[10px] uppercase text-slate-400">Deal total</p>
                    <p className="text-lg font-semibold">
                      {money(createLines.reduce((sum, line) => sum + numericDealField(line.quantity) * numericDealField(line.unitPrice), 0), "USD")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Source</span>
                  <select
                    value={createSource}
                    onChange={(e) => setCreateSource(e.target.value)}
                    className="h-11 w-full rounded-md border bg-white px-3"
                  >
                    {DEAL_SOURCES.map((source) => (
                      <option key={source} value={source}>{DEAL_SOURCE_LABELS[source]}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4">
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Notes / interests</span>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-20 w-full rounded-md border p-3" />
                </label>
              </div>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={resetCreateForm} className="h-10 rounded-md border px-4 text-sm">Cancel</button>
              <button
                type="button"
                disabled={pending || !canSubmitDeal}
                onClick={submit}
                className="h-10 rounded-md bg-primary px-5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending ? "Creating…" : "Create deal"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
