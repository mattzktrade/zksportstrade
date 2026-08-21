"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CircleDollarSign,
  ClipboardCheck,
  PackageCheck,
  Search,
  Truck,
  UserRoundCheck,
} from "lucide-react"
import { toast } from "sonner"
import { isCancelledWorkflowRow, operationsTicketStatus } from "@/lib/admin/workflow-status"
import type {
  OperationsGuest,
  OperationsSupportingData,
  WorkflowOrderRow,
} from "@/lib/admin/workflow-views"
import {
  eventFilterKey,
  eventTime,
  formatEventDate,
  startOfToday,
  uniqueEventOptions,
} from "@/lib/admin/workflow-event-filter"
import {
  AdminPageHeader,
  AdminPanel,
  AdminStatCard,
  AdminStats,
  AdminDesktopTable,
  AdminMobileList,
  StatusPill,
} from "@/components/admin/admin-page-kit"
import { dealSourceLabel } from "@/lib/crm/deal-types"
import { AccountNameLink, ContactNameLink } from "@/components/admin/profile-name-link"
import { OperationsEmailComposer } from "@/app/(admin)/admin/operations/operations-email-composer"
import { OperationsGuestEditor, type GuestDraft } from "@/app/(admin)/admin/operations/guest-editor"
import { OperationsSupplierEditor } from "@/app/(admin)/admin/operations/supplier-editor"
import type { OperationsEmailKind } from "@/lib/operations/emails"
import { orderStockSummaries } from "@/lib/operations/stock"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"
import {
  deleteOrderGuest,
  reassignDealPackageStock,
  reassignOrderPackageStock,
  saveOrderGuests,
  updateDealOperations,
  updateOrderOperations,
} from "./actions"

const SELECTS = {
  guestDetailsStatus: ["not_requested", "requested", "partial", "complete", "not_required"],
  deliveryStatus: ["not_ready", "ready", "delivered"],
} as const

type SortKey = "eventDate" | "reference" | "client" | "event"

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function tone(value: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (["confirmed", "complete", "ready", "delivered", "tickets_received", "sent", "paid"].includes(value)) return "green"
  if (["issue", "cancelled"].includes(value)) return "red"
  if (["pending", "partial", "requested", "awaiting_payment"].includes(value)) return "amber"
  if (value === "in_progress") return "blue"
  return "gray"
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value)
}

const ACTION_LINK =
  "mt-1 block text-[8px] font-semibold text-primary hover:underline underline-offset-2"

function eventPackageLines(value: string): string[] {
  return value
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function SupplierColumn({
  orderId,
  fallback,
  supporting,
}: {
  orderId: string
  fallback: string
  supporting: OperationsSupportingData
}) {
  const parts = orderStockSummaries(
    supporting.lines,
    supporting.stockLayers,
    supporting.allocations,
    orderId,
  )
  if (parts.length === 0) {
    return <p className="max-w-[240px] whitespace-normal break-words leading-snug text-slate-500">{fallback}</p>
  }
  if (parts.length === 1) {
    const assignment = parts[0]?.assignment === "Unassigned" ? fallback : parts[0]?.assignment
    return (
      <p className="max-w-[240px] whitespace-normal break-words leading-snug text-slate-500">{assignment}</p>
    )
  }
  return (
    <div className="max-w-[240px] space-y-1.5 text-slate-500">
      {parts.map((part) => (
        <div key={part.packageId} className="leading-snug">
          <p className="font-medium text-slate-600">{part.description}</p>
          <p>{part.assignment}</p>
        </div>
      ))}
    </div>
  )
}

function rowHasOrder(row: WorkflowOrderRow): boolean {
  return !row.id.startsWith("deal:")
}

function guestsForRow(guests: OperationsGuest[], row: WorkflowOrderRow): OperationsGuest[] {
  if (rowHasOrder(row)) return guests.filter((guest) => guest.orderId === row.id)
  return guests.filter((guest) => guest.dealId === row.dealId)
}

function canEditStatuses(row: WorkflowOrderRow, canManage: boolean): boolean {
  return canManage && (rowHasOrder(row) || Boolean(row.dealId))
}

function deliveryPatch(row: WorkflowOrderRow, delivery: "not_ready" | "ready" | "delivered") {
  return {
    fulfilmentStatus:
      delivery === "delivered"
        ? "delivered"
        : delivery === "ready"
          ? "ready"
          : row.fulfilmentStatus === "delivered"
            ? "confirmed"
            : row.fulfilmentStatus,
    guestDetailsStatus: row.guestDetailsStatus,
    communicationStatus: row.communicationStatus,
    supplierStatus:
      delivery === "not_ready"
        ? row.supplierStatus === "tickets_received"
          ? "pending"
          : row.supplierStatus
        : row.supplierStatus === "unassigned"
          ? "pending"
          : "tickets_received",
    deliveryStatus: delivery,
  }
}

function SortTh({
  label: heading,
  column,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string
  column: SortKey
  sortKey: SortKey
  sortDir: "asc" | "desc"
  onSort: (key: SortKey) => void
}) {
  const active = sortKey === column
  return (
    <th className="px-4 py-2.5 font-medium">
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-600"
      >
        {heading}
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

function lastEmail(
  emails: OperationsSupportingData["emails"],
  dealId: string | null,
  kind: OperationsEmailKind,
) {
  if (!dealId) return null
  return emails.find((row) => row.dealId === dealId && row.kind === kind) ?? null
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export function OperationsClient({
  initialRows,
  supporting,
  canManage,
}: {
  initialRows: WorkflowOrderRow[]
  supporting: OperationsSupportingData
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [listState, setListState] = usePersistedAdminFilters("zk-admin-operations-filters-v1", {
    search: "",
    filter: "all",
    eventScope: "future" as "future" | "all",
    eventKey: "all",
    sortKey: "eventDate" as SortKey,
    sortDir: "asc" as "asc" | "desc",
  })
  const { search, filter, eventScope, eventKey, sortKey, sortDir } = listState
  const [managingId, setManagingId] = useState<string | null>(null)
  const [guestsOpen, setGuestsOpen] = useState(false)
  const [supplierOpen, setSupplierOpen] = useState(false)
  const [emailComposer, setEmailComposer] = useState<{ dealId: string; kind: OperationsEmailKind } | null>(null)

  const managing = initialRows.find((row) => row.id === managingId) ?? null
  const guests = managing ? guestsForRow(supporting.guests, managing) : []
  const lines = supporting.lines.filter((line) => line.orderId === managing?.id)

  const liveRows = useMemo(
    () => initialRows.filter((row) => !isCancelledWorkflowRow(row)),
    [initialRows],
  )
  const eventOptions = useMemo(
    () => uniqueEventOptions(liveRows, eventScope),
    [liveRows, eventScope],
  )
  const activeEventKey = eventOptions.some((option) => option.key === eventKey) ? eventKey : "all"

  const scopedRows = useMemo(() => {
    const today = startOfToday()
    const q = search.trim().toLowerCase()
    return liveRows.filter((row) => {
      const ticket = operationsTicketStatus(row)
      if (filter === "guest") {
        if (ticket === "delivered") return false
        if (!["not_requested", "requested", "partial"].includes(row.guestDetailsStatus)) return false
      }
      if (filter === "supplier" && ticket !== "not_ready") return false
      if (filter === "delivery" && ticket !== "ready") return false
      if (filter === "delivered" && ticket !== "delivered") return false
      if (activeEventKey !== "all") {
        if (eventFilterKey(row) !== activeEventKey) return false
      } else if (eventScope === "future") {
        const time = eventTime(row)
        if (time != null && time < today) return false
      }
      if (!q) return true
      return [row.reference, row.dealReference, row.accountName, row.contactName, row.eventPackage, row.ownerName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    })
  }, [liveRows, search, filter, eventScope, activeEventKey])

  const rows = useMemo(() => {
    const today = startOfToday()
    const sorted = [...scopedRows]
    sorted.sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1
      if (sortKey === "reference") {
        return direction * (a.dealReference || a.reference).localeCompare(b.dealReference || b.reference)
      }
      if (sortKey === "client") {
        return direction * a.accountName.localeCompare(b.accountName)
      }
      if (sortKey === "event") {
        return direction * a.eventPackage.localeCompare(b.eventPackage)
      }
      const aTime = eventTime(a)
      const bTime = eventTime(b)
      if (aTime == null && bTime == null) {
        return (a.dealReference || a.reference).localeCompare(b.dealReference || b.reference)
      }
      if (aTime == null) return 1
      if (bTime == null) return -1
      const aPast = aTime < today
      const bPast = bTime < today
      if (aPast !== bPast) return aPast ? 1 : -1
      if (!aPast && !bPast) return direction * (aTime - bTime)
      return direction * (bTime - aTime)
    })
    return sorted
  }, [scopedRows, sortDir, sortKey])

  function toggleSort(column: SortKey) {
    setListState((current) => {
      if (current.sortKey === column) {
        return { ...current, sortDir: current.sortDir === "asc" ? "desc" : "asc" }
      }
      return { ...current, sortKey: column, sortDir: "asc" }
    })
  }

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function patchGuestStatus(row: WorkflowOrderRow, value: string) {
    saveOperations(row, {
      fulfilmentStatus: row.fulfilmentStatus,
      guestDetailsStatus: value,
      communicationStatus: row.communicationStatus,
      supplierStatus: row.supplierStatus,
      deliveryStatus: row.deliveryStatus,
    })
  }

  function patchDeliveryStatus(row: WorkflowOrderRow, value: "not_ready" | "ready" | "delivered") {
    saveOperations(row, deliveryPatch(row, value))
  }

  function saveOperations(
    row: WorkflowOrderRow,
    patch: {
      fulfilmentStatus: string
      guestDetailsStatus: string
      communicationStatus: string
      supplierStatus: string
      deliveryStatus: string
    },
  ) {
    if (rowHasOrder(row)) {
      run(() =>
        updateOrderOperations({
          orderId: row.id,
          ...patch,
          ownerProfileId: row.operationsOwnerId ?? undefined,
          internalNotes: row.internalNotes ?? "",
        }),
      )
      return
    }
    if (!row.dealId) return
    run(() => updateDealOperations({ dealId: row.dealId!, ...patch }))
  }

  function patchStatus(row: WorkflowOrderRow, field: keyof typeof SELECTS, value: string) {
    if (field === "guestDetailsStatus") patchGuestStatus(row, value)
    if (field === "deliveryStatus") patchDeliveryStatus(row, value as "not_ready" | "ready" | "delivered")
  }

  function openGuests(row: WorkflowOrderRow) {
    setManagingId(row.id)
    setSupplierOpen(false)
    setGuestsOpen(true)
  }

  function saveGuests(drafts: GuestDraft[]) {
    if (!managing) return
    startTransition(async () => {
      const result = await saveOrderGuests({
        orderId: rowHasOrder(managing) ? managing.id : undefined,
        dealId: managing.dealId,
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
      setGuestsOpen(false)
      router.refresh()
    })
  }

  const scopedForTabs = useMemo(() => {
    const today = startOfToday()
    return liveRows.filter((row) => {
      if (activeEventKey !== "all") return eventFilterKey(row) === activeEventKey
      if (eventScope === "future") {
        const time = eventTime(row)
        if (time != null && time < today) return false
      }
      return true
    })
  }, [liveRows, activeEventKey, eventScope])
  const awaitingGuests = scopedForTabs.filter(
    (row) =>
      operationsTicketStatus(row) !== "delivered" &&
      ["not_requested", "requested", "partial"].includes(row.guestDetailsStatus),
  )
  const supplierAction = scopedForTabs.filter((row) => operationsTicketStatus(row) === "not_ready")
  const readyToDeliver = scopedForTabs.filter((row) => operationsTicketStatus(row) === "ready")
  const delivered = scopedForTabs.filter((row) => operationsTicketStatus(row) === "delivered")

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="Operations"
        description="Confirmed deals by event date. Collect guest details, wait for tickets, then mark them ready and delivered."
      />
      <AdminStats className="sm:grid-cols-2 xl:grid-cols-5">
        <AdminStatCard icon={ClipboardCheck} value={scopedForTabs.length} label="Confirmed deals" tone="blue" />
        <AdminStatCard icon={UserRoundCheck} value={awaitingGuests.length} label="Awaiting guests" tone="amber" />
        <AdminStatCard icon={Truck} value={supplierAction.length} label="Supplier action" tone="amber" />
        <AdminStatCard icon={PackageCheck} value={readyToDeliver.length} label="Ready to deliver" tone="green" />
        <AdminStatCard icon={CircleDollarSign} value={delivered.length} label="Delivered" tone="green" />
      </AdminStats>

      <AdminPanel>
        <div className="no-scrollbar flex overflow-x-auto border-b px-3">
          {[
            ["all", "All confirmed deals", scopedForTabs.length],
            ["guest", "Awaiting guests", awaitingGuests.length],
            ["supplier", "Supplier action", supplierAction.length],
            ["delivery", "Ready to deliver", readyToDeliver.length],
            ["delivered", "Delivered", delivered.length],
          ].map(([value, text, count]) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => setListState((current) => ({ ...current, filter: String(value) }))}
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-[10px] font-semibold ${
                filter === value ? "border-primary text-primary" : "border-transparent text-slate-500"
              }`}
            >
              {text} · {count}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <label className="relative min-w-0 w-full flex-1 sm:min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setListState((current) => ({ ...current, search: event.target.value }))}
              placeholder="Search deals, clients or events..."
              className="h-9 w-full rounded-md border pl-9 pr-3 text-[10px] outline-none focus:border-primary"
            />
          </label>
          <select
            value={eventScope}
            onChange={(event) =>
              setListState((current) => ({ ...current, eventScope: event.target.value as "future" | "all" }))
            }
            className="h-9 w-full rounded-md border bg-white px-3 text-[10px] sm:w-auto"
          >
            <option value="future">Future events</option>
            <option value="all">All dates</option>
          </select>
          <select
            value={activeEventKey}
            onChange={(event) => setListState((current) => ({ ...current, eventKey: event.target.value }))}
            className="h-9 w-full rounded-md border bg-white px-3 text-[10px] sm:w-auto sm:max-w-[280px]"
          >
            <option value="all">Any event</option>
            {eventOptions.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
        </div>
        <AdminDesktopTable>
          <table className="w-full text-left">
            <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-slate-400">
              <tr>
                <SortTh label="Deal" column="reference" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Client" column="client" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Event" column="event" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Event date" column="eventDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <th className="px-4 py-2.5 font-medium">Payment</th>
                <th className="px-4 py-2.5 font-medium">Guests</th>
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="px-4 py-2.5 font-medium">Delivery</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y text-[10px]">
              {rows.map((row) => {
                const hasOrder = rowHasOrder(row)
                const editable = canEditStatuses(row, canManage)
                const ticket = operationsTicketStatus(row)
                return (
                  <tr key={row.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3">
                      {row.dealId ? (
                        <a href={`/admin/deals/${row.dealId}`} className="font-semibold text-primary hover:underline">
                          {row.dealReference || row.reference}
                        </a>
                      ) : (
                        <p className="font-semibold">{row.dealReference || row.reference}</p>
                      )}
                      {row.dealReference && row.reference !== row.dealReference ? (
                        <p className="mt-0.5 text-[8px] text-slate-400">{row.reference}</p>
                      ) : null}
                      <p className="mt-0.5 text-[8px] text-slate-400">
                        {dealSourceLabel(row.dealSource || row.channel)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <AccountNameLink accountId={row.accountId} name={row.accountName} className="font-medium" />
                      <ContactNameLink
                        accountId={row.accountId}
                        contactId={row.contactId}
                        name={row.contactName}
                        className="mt-0.5 block text-[8px] text-slate-400"
                      />
                    </td>
                    <td className="min-w-[240px] max-w-[420px] px-4 py-3">
                      <div className="space-y-1">
                        {eventPackageLines(row.eventPackage).map((product, index) => (
                          <p
                            key={`${row.id}:${index}:${product}`}
                            className="whitespace-normal break-words font-medium leading-snug"
                          >
                            {product}
                          </p>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">{formatEventDate(row.eventDate)}</td>
                    <td className="px-4 py-3">
                      <StatusPill tone={tone(row.invoiceStatus || "pending")}>{label(row.invoiceStatus || "pending")}</StatusPill>
                      <p className="mt-1 text-[8px] text-slate-400">{money(row.amountDue, row.currency)} due</p>
                      <p className="text-[8px] font-semibold text-slate-600">{money(row.total, row.currency)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p>{row.completeGuestCount}/{row.quantity} complete</p>
                      {editable ? (
                        <>
                          <select
                            disabled={pending}
                            value={row.guestDetailsStatus}
                            onChange={(event) => patchStatus(row, "guestDetailsStatus", event.target.value)}
                            className="mt-1 h-7 max-w-[130px] rounded border bg-white px-1 text-[9px]"
                          >
                            {SELECTS.guestDetailsStatus.map((value) => (
                              <option key={value} value={value}>{label(value)}</option>
                            ))}
                          </select>
                          {canManage ? (
                            <button
                              type="button"
                              onClick={() => openGuests(row)}
                              className={ACTION_LINK}
                            >
                              Manage guests
                            </button>
                          ) : null}
                          {canManage && row.dealId ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setEmailComposer({ dealId: row.dealId!, kind: "operations_intro" })}
                                className={ACTION_LINK}
                              >
                                Intro email
                              </button>
                              <button
                                type="button"
                                onClick={() => setEmailComposer({ dealId: row.dealId!, kind: "guest_details" })}
                                className={ACTION_LINK}
                              >
                                Request guests
                              </button>
                              {lastEmail(supporting.emails, row.dealId, "operations_intro") ? (
                                <p className="mt-1 text-[8px] text-slate-400">
                                  Intro {formatWhen(lastEmail(supporting.emails, row.dealId, "operations_intro")!.sentAt)}
                                </p>
                              ) : null}
                              {lastEmail(supporting.emails, row.dealId, "guest_details") ? (
                                <p className="text-[8px] text-slate-400">
                                  Asked {formatWhen(lastEmail(supporting.emails, row.dealId, "guest_details")!.sentAt)}
                                </p>
                              ) : null}
                            </>
                          ) : null}
                        </>
                      ) : (
                        <div className="mt-1">
                          <StatusPill tone={tone(row.guestDetailsStatus)}>{label(row.guestDetailsStatus)}</StatusPill>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[8px]">
                        <SupplierColumn
                          orderId={row.id}
                          fallback={row.supplierSummary}
                          supporting={supporting}
                        />
                      </div>
                      {canManage && (hasOrder || Boolean(row.dealId)) ? (
                        <button
                          type="button"
                          onClick={() => { setManagingId(row.id); setGuestsOpen(false); setSupplierOpen(true) }}
                          className={ACTION_LINK}
                        >
                          Manage supplier
                        </button>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {editable ? (
                        <select
                          disabled={pending}
                          value={ticket}
                          onChange={(event) => patchStatus(row, "deliveryStatus", event.target.value)}
                          className="h-7 max-w-[120px] rounded border bg-white px-1 text-[9px]"
                        >
                          {SELECTS.deliveryStatus.map((value) => (
                            <option key={value} value={value}>{label(value)}</option>
                          ))}
                        </select>
                      ) : (
                        <StatusPill tone={tone(ticket)}>{label(ticket)}</StatusPill>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p>{row.operationsOwnerName || row.ownerName || "Unassigned"}</p>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-slate-400">
                    No matching deals{eventScope === "future" ? " for future events" : ""}.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </AdminDesktopTable>
        <AdminMobileList>
          {rows.map((row) => {
            const ticket = operationsTicketStatus(row)
            const editable = canEditStatuses(row, canManage)
            return (
              <article key={row.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {row.dealId ? (
                      <a href={`/admin/deals/${row.dealId}`} className="font-semibold text-primary">
                        {row.dealReference || row.reference}
                      </a>
                    ) : (
                      <p className="font-semibold">{row.dealReference || row.reference}</p>
                    )}
                    <AccountNameLink accountId={row.accountId} name={row.accountName} className="mt-0.5 block font-medium" />
                    <p className="mt-1 text-[10px] leading-snug text-slate-600">
                      {eventPackageLines(row.eventPackage).join(" · ")}
                    </p>
                    <p className="mt-0.5 text-[8px] text-slate-400">{formatEventDate(row.eventDate)}</p>
                  </div>
                  <StatusPill tone={tone(ticket)}>{label(ticket)}</StatusPill>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone={tone(row.invoiceStatus || "pending")}>{label(row.invoiceStatus || "pending")}</StatusPill>
                  <span className="text-[8px] text-slate-500">
                    {row.completeGuestCount}/{row.quantity} guests
                  </span>
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-3 text-[8px] font-semibold text-primary">
                    <button type="button" onClick={() => openGuests(row)}>Manage guests</button>
                    {rowHasOrder(row) || row.dealId ? (
                      <button
                        type="button"
                        onClick={() => {
                          setManagingId(row.id)
                          setGuestsOpen(false)
                          setSupplierOpen(true)
                        }}
                      >
                        Manage supplier
                      </button>
                    ) : null}
                    {editable ? (
                      <select
                        disabled={pending}
                        value={ticket}
                        onChange={(event) => patchStatus(row, "deliveryStatus", event.target.value)}
                        className="h-8 rounded border bg-white px-2 text-[9px] font-medium text-slate-700"
                      >
                        {SELECTS.deliveryStatus.map((value) => (
                          <option key={value} value={value}>{label(value)}</option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-[10px] text-slate-400">
              No matching deals{eventScope === "future" ? " for future events" : ""}.
            </p>
          ) : null}
        </AdminMobileList>
      </AdminPanel>

      {guestsOpen && managing ? (
        <OperationsGuestEditor
          key={managing.id}
          title="Manage guests"
          subtitle={`${managing.dealReference || managing.reference} · ${managing.accountName}`}
          expectedCount={managing.quantity}
          existing={guests}
          pending={pending}
          onClose={() => setGuestsOpen(false)}
          onSave={saveGuests}
          onDelete={(guestId) => {
            run(() =>
              deleteOrderGuest({
                orderId: rowHasOrder(managing) ? managing.id : undefined,
                dealId: managing.dealId,
                guestId,
              }),
            )
          }}
        />
      ) : null}

      {supplierOpen && managing ? (
        <OperationsSupplierEditor
          title="Manage supplier"
          subtitle={`${managing.dealReference || managing.reference} · ${managing.accountName}`}
          orderId={managing.id}
          lines={lines}
          layers={supporting.stockLayers}
          allocations={supporting.allocations}
          pending={pending}
          onClose={() => setSupplierOpen(false)}
          onSave={(packageId, takes) => {
            run(() =>
              rowHasOrder(managing)
                ? reassignOrderPackageStock({
                    orderId: managing.id,
                    packageId,
                    allocations: takes,
                  })
                : reassignDealPackageStock({
                    dealId: managing.dealId || managing.id.replace(/^deal:/, ""),
                    packageId,
                    allocations: takes,
                  }),
            )
          }}
        />
      ) : null}

      {emailComposer ? (
        <OperationsEmailComposer
          dealId={emailComposer.dealId}
          kind={emailComposer.kind}
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
