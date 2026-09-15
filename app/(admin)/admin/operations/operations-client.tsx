"use client"

import { useMemo, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { CalendarDays, ClipboardList, Mail } from "lucide-react"
import {
  AdminPageHeader,
  AdminStatCard,
  AdminStats,
} from "@/components/admin/admin-page-kit"
import type { OperationsBookingRow } from "@/lib/admin/operations-bookings"
import type { OperationsSupportingData } from "@/lib/admin/workflow-views"
import { eventTime, startOfToday } from "@/lib/admin/workflow-event-filter"
import { usePersistedAdminFilters } from "@/lib/admin/use-persisted-admin-filters"
import { bookingStepInput } from "@/lib/operations/booking-view"
import { operationsQueueBucket, type OperationsQueueBucket } from "@/lib/operations/fulfilment"
import { OperationsBoard } from "./operations-board"
import { OperationsCalendar } from "./operations-calendar"
import { OperationsQueue } from "./operations-queue"
import { OperationsTemplates } from "./operations-templates"

type Tab = "queue" | "calendar" | "templates"

export function OperationsClient({
  initialRows,
  supporting,
  canManage,
  initialTab,
  initialBookingId,
  initialDealId,
}: {
  initialRows: OperationsBookingRow[]
  supporting: OperationsSupportingData
  canManage: boolean
  initialTab?: string | null
  initialBookingId?: string | null
  initialDealId?: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [listState, setListState] = usePersistedAdminFilters("zk-admin-operations-filters-v2", {
    search: "",
    filter: "all" as OperationsQueueBucket | "all",
    eventScope: "future" as "future" | "all",
    eventKey: "all",
  })
  const tab = (["queue", "calendar", "templates"].includes(initialTab ?? "") ? initialTab : "queue") as Tab
  const [bookingId, setBookingId] = useState<string | null>(initialBookingId ?? null)

  const selected = useMemo(() => {
    if (bookingId) return initialRows.find((row) => row.id === bookingId) ?? null
    if (initialDealId) {
      return (
        initialRows.find((row) => row.dealId === initialDealId) ??
        initialRows.find((row) => row.id === `deal:${initialDealId}`) ??
        null
      )
    }
    return null
  }, [bookingId, initialDealId, initialRows])

  const today = startOfToday()
  const futureRows = initialRows.filter((row) => {
    const time = eventTime(row)
    return time == null || time >= today
  })
  const counts = {
    needsGuests: futureRows.filter((row) => operationsQueueBucket(bookingStepInput(row, supporting.emails)) === "needs_guests").length,
    waitingSupplier: futureRows.filter((row) => operationsQueueBucket(bookingStepInput(row, supporting.emails)) === "waiting_supplier").length,
    ready: futureRows.filter((row) => operationsQueueBucket(bookingStepInput(row, supporting.emails)) === "ready_to_fulfil").length,
    afterEvent: initialRows.filter((row) => operationsQueueBucket(bookingStepInput(row, supporting.emails)) === "after_event").length,
  }

  function setTab(next: Tab) {
    setBookingId(null)
    const params = new URLSearchParams()
    if (next !== "queue") params.set("tab", next)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  function openRow(row: OperationsBookingRow) {
    setBookingId(row.id)
    const params = new URLSearchParams()
    if (tab === "calendar") params.set("tab", "calendar")
    params.set("booking", row.id)
    if (row.dealId) params.set("deal", row.dealId)
    router.replace(`${pathname}?${params.toString()}`)
  }

  function closeBoard() {
    setBookingId(null)
    router.replace(tab === "calendar" ? `${pathname}?tab=calendar` : pathname)
  }

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-5">
      <AdminPageHeader
        title="Operations"
        description="Work each signed booking in order: guests, supplier, fulfil, then thank-you for direct clients."
      />
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["queue", "Queue", ClipboardList],
            ["calendar", "Calendar", CalendarDays],
            ["templates", "Templates", Mail],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={String(value)}
            type="button"
            onClick={() => setTab(value as Tab)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[11px] font-semibold ${
              tab === value && !selected ? "border-primary text-primary" : "text-slate-600"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {selected ? (
        <OperationsBoard row={selected} supporting={supporting} canManage={canManage} onBack={closeBoard} />
      ) : tab === "calendar" ? (
        <OperationsCalendar rows={initialRows} supporting={supporting} canManage={canManage} onOpen={openRow} />
      ) : tab === "templates" ? (
        <OperationsTemplates templates={supporting.templates} canManage={canManage} />
      ) : (
        <>
          <AdminStats className="sm:grid-cols-2 xl:grid-cols-4">
            <AdminStatCard icon={ClipboardList} value={counts.needsGuests} label="Needs guests" tone="amber" />
            <AdminStatCard icon={ClipboardList} value={counts.waitingSupplier} label="Waiting on supplier" tone="amber" />
            <AdminStatCard icon={ClipboardList} value={counts.ready} label="Ready to fulfil" tone="green" />
            <AdminStatCard icon={Mail} value={counts.afterEvent} label="Thank-you due" tone="blue" />
          </AdminStats>
          <OperationsQueue
            rows={initialRows}
            supporting={supporting}
            filter={listState.filter}
            search={listState.search}
            eventScope={listState.eventScope}
            eventKey={listState.eventKey}
            onFilter={(filter) => setListState((current) => ({ ...current, filter }))}
            onSearch={(search) => setListState((current) => ({ ...current, search }))}
            onEventScope={(eventScope) => setListState((current) => ({ ...current, eventScope }))}
            onEventKey={(eventKey) => setListState((current) => ({ ...current, eventKey }))}
            onOpen={openRow}
          />
        </>
      )}
    </div>
  )
}
