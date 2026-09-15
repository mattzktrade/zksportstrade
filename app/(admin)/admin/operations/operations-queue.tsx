"use client"

import Link from "next/link"
import { Search } from "lucide-react"
import {
  AdminDesktopTable,
  AdminMobileList,
  AdminPanel,
  StatusPill,
} from "@/components/admin/admin-page-kit"
import { AccountNameLink } from "@/components/admin/profile-name-link"
import type { OperationsBookingRow } from "@/lib/admin/operations-bookings"
import {
  eventFilterKey,
  eventTime,
  formatEventDate,
  startOfToday,
  uniqueEventOptions,
} from "@/lib/admin/workflow-event-filter"
import type { OperationsSupportingData } from "@/lib/admin/workflow-views"
import { pageSearchProps } from "@/lib/browser/laptop-qol"
import { bookingStepInput } from "@/lib/operations/booking-view"
import {
  isOperationsPaid,
  operationsNextStepLabel,
  operationsQueueBucket,
  operationsQueueBucketLabel,
  operationsQueueSortKey,
  operationsSortDeadline,
  unpaidCloseToEvent,
  utcTodayIso,
  type OperationsQueueBucket,
} from "@/lib/operations/fulfilment"

const BUCKETS: Array<OperationsQueueBucket | "all"> = [
  "all",
  "needs_guests",
  "waiting_supplier",
  "ready_to_fulfil",
  "awaiting_event",
  "after_event",
]

function bucketLabel(value: OperationsQueueBucket | "all"): string {
  return value === "all" ? "All bookings" : operationsQueueBucketLabel(value)
}

function toneForBucket(bucket: OperationsQueueBucket): "green" | "amber" | "red" | "blue" | "gray" {
  if (bucket === "needs_guests" || bucket === "waiting_supplier") return "amber"
  if (bucket === "ready_to_fulfil" || bucket === "after_event") return "blue"
  if (bucket === "done") return "green"
  return "gray"
}

function paymentTone(paid: boolean): "green" | "amber" {
  return paid ? "green" : "amber"
}

function deadlineLabel(iso: string | null): string {
  if (!iso) return "—"
  return formatEventDate(iso)
}

export function OperationsQueue({
  rows,
  supporting,
  filter,
  search,
  eventScope,
  eventKey,
  onFilter,
  onSearch,
  onEventScope,
  onEventKey,
  onOpen,
}: {
  rows: OperationsBookingRow[]
  supporting: OperationsSupportingData
  filter: OperationsQueueBucket | "all"
  search: string
  eventScope: "future" | "all"
  eventKey: string
  onFilter: (value: OperationsQueueBucket | "all") => void
  onSearch: (value: string) => void
  onEventScope: (value: "future" | "all") => void
  onEventKey: (value: string) => void
  onOpen: (row: OperationsBookingRow) => void
}) {
  const today = startOfToday()
  const eventOptions = uniqueEventOptions(rows, eventScope)
  const activeEventKey = eventOptions.some((option) => option.key === eventKey) ? eventKey : "all"
  const q = search.trim().toLowerCase()

  const scoped = rows.filter((row) => {
    if (activeEventKey !== "all") {
      if (eventFilterKey(row) !== activeEventKey) return false
    } else if (eventScope === "future") {
      const time = eventTime(row)
      if (time != null && time < today) return false
    }
    if (!q) return true
    return [row.reference, row.dealReference, row.accountName, row.contactName, row.eventPackage, row.operationsContactName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q)
  })

  const counts = Object.fromEntries(
    BUCKETS.map((bucket) => [
      bucket,
      bucket === "all"
        ? scoped.length
        : scoped.filter((row) => operationsQueueBucket(bookingStepInput(row, supporting.emails)) === bucket).length,
    ]),
  ) as Record<OperationsQueueBucket | "all", number>

  const visible = scoped
    .filter((row) => {
      if (filter === "all") return true
      return operationsQueueBucket(bookingStepInput(row, supporting.emails)) === filter
    })
    .sort((a, b) => {
      const aInput = bookingStepInput(a, supporting.emails)
      const bInput = bookingStepInput(b, supporting.emails)
      const byStep = operationsQueueSortKey(aInput).localeCompare(operationsQueueSortKey(bInput))
      if (byStep !== 0) return byStep
      return (a.dealReference || a.reference).localeCompare(b.dealReference || b.reference)
    })

  return (
    <AdminPanel>
      <div className="no-scrollbar flex overflow-x-auto border-b px-3">
        {BUCKETS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onFilter(value)}
            className={`whitespace-nowrap border-b-2 px-3 py-3 text-[10px] font-semibold ${
              filter === value ? "border-primary text-primary" : "border-transparent text-slate-500"
            }`}
          >
            {bucketLabel(value)} · {counts[value]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <label className="relative min-w-0 w-full flex-1 sm:min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            {...pageSearchProps}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search deals, clients or events..."
            className="h-9 w-full rounded-md border pl-9 pr-3 text-[10px] outline-none focus:border-primary"
          />
        </label>
        <select
          value={eventScope}
          onChange={(event) => onEventScope(event.target.value as "future" | "all")}
          className="h-9 w-full rounded-md border bg-white px-3 text-[10px] sm:w-auto"
        >
          <option value="future">Future events</option>
          <option value="all">All dates</option>
        </select>
        <select
          value={activeEventKey}
          onChange={(event) => onEventKey(event.target.value)}
          className="h-9 w-full rounded-md border bg-white px-3 text-[10px] sm:w-auto sm:max-w-[280px]"
        >
          <option value="all">Any event</option>
          {eventOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <AdminDesktopTable>
        <table className="w-full text-left">
          <thead className="bg-[#fafbfc] text-[8px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-2.5 font-medium">Deal</th>
              <th className="px-4 py-2.5 font-medium">Client</th>
              <th className="px-4 py-2.5 font-medium">Event</th>
              <th className="px-4 py-2.5 font-medium">Event date</th>
              <th className="px-4 py-2.5 font-medium">Payment</th>
              <th className="px-4 py-2.5 font-medium">Next step</th>
              <th className="px-4 py-2.5 font-medium">Deadline</th>
            </tr>
          </thead>
          <tbody className="divide-y text-[10px]">
            {visible.map((row) => {
              const input = bookingStepInput(row, supporting.emails)
              const bucket = operationsQueueBucket(input)
              const paid = isOperationsPaid(input)
              const warnUnpaid = unpaidCloseToEvent(input)
              const deadline = operationsSortDeadline(input)
              const overdue = Boolean(deadline && deadline < utcTodayIso())
              return (
                <tr key={row.id} className="cursor-pointer align-top hover:bg-slate-50" onClick={() => onOpen(row)}>
                  <td className="px-4 py-3">
                    {row.dealId ? (
                      <Link
                        href={`/admin/deals/${row.dealId}`}
                        onClick={(event) => event.stopPropagation()}
                        className="font-semibold text-primary hover:underline"
                      >
                        {row.dealReference || row.reference}
                      </Link>
                    ) : (
                      <p className="font-semibold">{row.dealReference || row.reference}</p>
                    )}
                    <p className="mt-0.5 text-[8px] text-slate-400">{row.operationsContactName || row.contactName}</p>
                  </td>
                  <td className="px-4 py-3">
                    <AccountNameLink accountId={row.accountId} name={row.accountName} className="font-medium" />
                  </td>
                  <td className="min-w-[200px] max-w-[380px] px-4 py-3">
                    <p className="whitespace-normal break-words font-medium leading-snug">{row.eventPackage}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{formatEventDate(row.eventDate)}</td>
                  <td className="px-4 py-3">
                    <StatusPill tone={paymentTone(paid)}>{paid ? "Paid" : "Unpaid"}</StatusPill>
                    {warnUnpaid ? <p className="mt-1 text-[8px] font-semibold text-red-600">Event soon</p> : null}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill tone={toneForBucket(bucket)}>{operationsNextStepLabel(bucket)}</StatusPill>
                    <p className="mt-1 text-[8px] text-slate-400">
                      {row.completeGuestCount}/{row.quantity} guests
                    </p>
                  </td>
                  <td className={`whitespace-nowrap px-4 py-3 ${overdue ? "font-semibold text-red-600" : ""}`}>
                    {deadlineLabel(deadline)}
                    {overdue ? <p className="mt-0.5 text-[8px] uppercase tracking-wide">Overdue</p> : null}
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-10 text-center text-slate-400">
                  No matching bookings{eventScope === "future" ? " for future events" : ""}.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </AdminDesktopTable>
      <AdminMobileList>
        {visible.map((row) => {
          const input = bookingStepInput(row, supporting.emails)
          const bucket = operationsQueueBucket(input)
          const paid = isOperationsPaid(input)
          return (
            <button key={row.id} type="button" onClick={() => onOpen(row)} className="w-full space-y-2 px-4 py-3 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-primary">{row.dealReference || row.reference}</p>
                  <p className="mt-0.5 font-medium">{row.accountName}</p>
                  <p className="mt-1 text-[10px] leading-snug text-slate-600">{row.eventPackage}</p>
                  <p className="mt-0.5 text-[8px] text-slate-400">{formatEventDate(row.eventDate)}</p>
                </div>
                <StatusPill tone={toneForBucket(bucket)}>{operationsNextStepLabel(bucket)}</StatusPill>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill tone={paymentTone(paid)}>{paid ? "Paid" : "Unpaid"}</StatusPill>
                <span className="text-[8px] text-slate-500">
                  {row.completeGuestCount}/{row.quantity} guests
                </span>
              </div>
            </button>
          )
        })}
        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-[10px] text-slate-400">
            No matching bookings{eventScope === "future" ? " for future events" : ""}.
          </p>
        ) : null}
      </AdminMobileList>
    </AdminPanel>
  )
}
