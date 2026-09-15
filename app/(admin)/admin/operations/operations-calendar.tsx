"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Flag,
  MapPin,
  Pencil,
  Plus,
  CheckSquare,
  Truck,
  Users,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { AdminModalScrim } from "@/components/admin/admin-list-preview"
import type { OperationsBookingRow } from "@/lib/admin/operations-bookings"
import { uniqueEventOptions } from "@/lib/admin/workflow-event-filter"
import type { OperationsSupportingData } from "@/lib/admin/workflow-views"
import { bookingStepInput } from "@/lib/operations/booking-view"
import {
  addCalendarDays,
  buildOperationsCalendarFeed,
  filterOperationsCalendarFeed,
  formatCalendarDayHeading,
  formatCalendarShortDay,
  groupOperationsCalendarByDate,
  operationsCalendarFilterLabel,
  operationsCalendarIcs,
  operationsCalendarKindLabel,
  operationsCalendarUpcoming,
  type OperationsCalendarFeedItem,
  type OperationsCalendarFilter,
  type OperationsCalendarStaffEntry,
  type OperationsCalendarView,
  OPERATIONS_CALENDAR_FILTERS,
} from "@/lib/operations/calendar"
import {
  deleteOperationsCalendarEntry,
  saveOperationsCalendarBookingDate,
  saveOperationsCalendarEntry,
} from "@/app/(admin)/admin/operations/calendar-actions"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function localTodayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function startOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1))
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month + delta, 1))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() }
}

function isoFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function parseIso(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number)
  return { year, month: (month ?? 1) - 1, day: day ?? 1 }
}

function mondayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  const weekday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - weekday)
  return date.toISOString().slice(0, 10)
}

function kindChipClass(kind: OperationsCalendarFeedItem["kind"]): string {
  if (kind === "race") return "bg-red-50 text-primary"
  if (kind === "guest_deadline") return "bg-amber-50 text-amber-800"
  if (kind === "collection") return "bg-violet-50 text-violet-700"
  return "bg-emerald-50 text-emerald-700"
}

function filterDotClass(filter: OperationsCalendarFilter): string {
  if (filter === "guest_deadline") return "bg-amber-500"
  if (filter === "collection") return "bg-violet-500"
  if (filter === "task") return "bg-emerald-500"
  return "bg-primary"
}

function KindIcon({ kind, className }: { kind: OperationsCalendarFeedItem["kind"]; className?: string }) {
  const cls = className ?? "h-3.5 w-3.5"
  if (kind === "race") return <Flag className={cls} />
  if (kind === "guest_deadline") return <Users className={cls} />
  if (kind === "collection") return <Truck className={cls} />
  return <CheckSquare className={cls} />
}

type Draft = {
  id?: string
  title: string
  notes: string
  date: string
  startTime: string
  endTime: string
  dealId: string
  orderId: string
  kind?: "task" | "guest_deadline" | "collection"
  bookingId?: string
  purchaseOrderIds?: string[]
}

function emptyDraft(date: string): Draft {
  return { title: "", notes: "", date, startTime: "", endTime: "", dealId: "", orderId: "" }
}

export function OperationsCalendar({
  rows,
  supporting,
  canManage,
  onOpen,
}: {
  rows: OperationsBookingRow[]
  supporting: OperationsSupportingData
  canManage: boolean
  onOpen: (row: OperationsBookingRow) => void
}) {
  const router = useRouter()
  const todayIso = localTodayIso()
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [selected, setSelected] = useState(todayIso)
  const [filter, setFilter] = useState<OperationsCalendarFilter>("all")
  const [eventKey, setEventKey] = useState("all")
  const [view, setView] = useState<OperationsCalendarView>("month")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pending, start] = useTransition()

  const entries: OperationsCalendarStaffEntry[] = supporting.calendarEntries ?? []
  const feed = useMemo(
    () =>
      buildOperationsCalendarFeed(
        rows.map((row) => ({
          ...bookingStepInput(row, supporting.emails),
          id: row.id,
          accountName: row.accountName,
          eventPackage: row.eventPackage,
          dealId: row.dealId,
          collectionPoint: row.collectionPoint,
          collectionTime: row.collectionTime,
          purchaseOrderIds: row.purchaseOrders.map((po) => po.id),
        })),
        entries,
      ),
    [rows, supporting.emails, entries],
  )
  const visible = useMemo(() => filterOperationsCalendarFeed(feed, filter, eventKey), [feed, filter, eventKey])
  const byDate = useMemo(() => groupOperationsCalendarByDate(visible), [visible])
  const eventOptions = uniqueEventOptions(rows, "all")

  const first = startOfMonth(cursor.year, cursor.month)
  const monthLabel = first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
  const startWeekday = (first.getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate()
  const previous = addMonths(cursor.year, cursor.month, -1)
  const next = addMonths(cursor.year, cursor.month, 1)
  const daysInPrevious = new Date(Date.UTC(previous.year, previous.month + 1, 0)).getUTCDate()
  const monthCells: { date: string; inMonth: boolean; day: number }[] = []
  for (let offset = startWeekday; offset > 0; offset--) {
    const day = daysInPrevious - offset + 1
    monthCells.push({ date: isoFromParts(previous.year, previous.month, day), inMonth: false, day })
  }
  for (let day = 1; day <= daysInMonth; day++) {
    monthCells.push({ date: isoFromParts(cursor.year, cursor.month, day), inMonth: true, day })
  }
  let trailing = 1
  while (monthCells.length % 7 !== 0) {
    monthCells.push({ date: isoFromParts(next.year, next.month, trailing), inMonth: false, day: trailing })
    trailing += 1
  }

  const weekStart = mondayOf(selected)
  const weekDays = Array.from({ length: 7 }, (_, index) => addCalendarDays(weekStart, index))
  const selectedItems = byDate.get(selected) ?? []
  const upcoming = operationsCalendarUpcoming(visible, selected, 7)
  const monthListDates = [...byDate.keys()].filter((date) => date.startsWith(`${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`))

  function goToday() {
    const now = new Date()
    setCursor({ year: now.getFullYear(), month: now.getMonth() })
    setSelected(todayIso)
  }

  function selectDate(date: string) {
    setSelected(date)
    const parts = parseIso(date)
    setCursor({ year: parts.year, month: parts.month })
  }

  function run(action: () => Promise<{ ok: boolean; message: string }>, close = true) {
    start(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      if (close) setDraft(null)
      router.refresh()
    })
  }

  function openBooking(bookingId: string) {
    const row = rows.find((booking) => booking.id === bookingId)
    if (row) onOpen(row)
  }

  function startEdit(item: OperationsCalendarFeedItem) {
    if (item.kind === "task" && item.entryId) {
      const entry = entries.find((row) => row.id === item.entryId)
      setDraft({
        id: item.entryId,
        title: item.title,
        notes: entry?.notes ?? item.subtitle ?? "",
        date: item.date,
        startTime: entry?.startTime ?? "",
        endTime: entry?.endTime ?? "",
        dealId: item.dealId ?? "",
        orderId: entry?.orderId ?? "",
      })
      return
    }
    if ((item.kind === "guest_deadline" || item.kind === "collection") && item.bookingIds[0]) {
      const row = rows.find((booking) => booking.id === item.bookingIds[0])
      setDraft({
        title: item.title,
        notes: "",
        date: item.date,
        startTime: "",
        endTime: "",
        dealId: item.dealId ?? row?.dealId ?? "",
        orderId: row && !row.id.startsWith("deal:") ? row.id : "",
        kind: item.kind,
        bookingId: item.bookingIds[0],
        purchaseOrderIds: item.purchaseOrderIds,
      })
    }
  }

  function downloadIcs() {
    const ics = operationsCalendarIcs(visible)
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "zk-operations-calendar.ics"
    link.click()
    URL.revokeObjectURL(url)
  }

  function saveDraft() {
    if (!draft) return
    const bookingKind = draft.kind
    if (bookingKind === "guest_deadline" || bookingKind === "collection") {
      run(() =>
        saveOperationsCalendarBookingDate({
          kind: bookingKind,
          date: draft.date,
          orderId: draft.orderId || null,
          dealId: draft.dealId || null,
          purchaseOrderIds: draft.purchaseOrderIds,
        }),
      )
      return
    }
    run(() =>
      saveOperationsCalendarEntry({
        id: draft.id,
        title: draft.title,
        notes: draft.notes,
        date: draft.date,
        startTime: draft.startTime,
        endTime: draft.endTime,
        dealId: draft.dealId || null,
        orderId: draft.orderId || null,
      }),
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[16px] font-semibold">Operations calendar</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Race dates, guest deadlines and collections from bookings, plus internal tasks you add.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setDraft(emptyDraft(selected))}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Add to calendar
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {OPERATIONS_CALENDAR_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[10px] font-semibold ${
              filter === value ? "border-primary bg-red-50 text-primary" : "text-slate-600"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${filterDotClass(value)}`} />
            {operationsCalendarFilterLabel(value)}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={eventKey}
            onChange={(event) => setEventKey(event.target.value)}
            className="h-9 min-w-[160px] rounded-md border bg-white px-3 text-[11px]"
          >
            <option value="all">All events</option>
            {eventOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={downloadIcs}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[11px] font-semibold"
          >
            <Download className="h-3.5 w-3.5" />
            Export calendar
          </button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-lg border bg-white p-3 sm:p-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  view === "week"
                    ? selectDate(addCalendarDays(weekStart, -7))
                    : setCursor((current) => addMonths(current.year, current.month, -1))
                }
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  view === "week"
                    ? selectDate(addCalendarDays(weekStart, 7))
                    : setCursor((current) => addMonths(current.year, current.month, 1))
                }
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button type="button" onClick={goToday} className="h-8 rounded-md border px-3 text-[11px] font-semibold">
                Today
              </button>
            </div>
            <h3 className="text-center text-[15px] font-semibold">
              {view === "week"
                ? `${formatCalendarShortDay(weekStart)} – ${formatCalendarShortDay(addCalendarDays(weekStart, 6))}`
                : monthLabel}
            </h3>
            <div className="inline-flex justify-start rounded-md border p-0.5 sm:justify-end">
              {(["month", "week", "list"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setView(value)}
                  className={`h-8 rounded px-3 text-[10px] font-semibold capitalize ${
                    view === value ? "bg-primary text-white" : "text-slate-600"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          {view === "list" ? (
            <CalendarList dates={monthListDates} byDate={byDate} selected={selected} todayIso={todayIso} onSelect={selectDate} />
          ) : view === "week" ? (
            <div className="mt-3 grid grid-cols-7 border-t">
              {weekDays.map((date) => (
                <DayCell
                  key={date}
                  date={date}
                  dayLabel={parseIso(date).day}
                  weekday={WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7] ?? ""}
                  items={byDate.get(date) ?? []}
                  selected={selected === date}
                  today={date === todayIso}
                  tall
                  onSelect={selectDate}
                />
              ))}
            </div>
          ) : (
            <div>
              <div className="mt-3 grid grid-cols-7 text-center text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="py-2">
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 border-t">
                {monthCells.map((cell) => (
                  <DayCell
                    key={cell.date}
                    date={cell.date}
                    dayLabel={cell.day}
                    items={byDate.get(cell.date) ?? []}
                    selected={cell.date === selected}
                    today={cell.date === todayIso}
                    muted={!cell.inMonth}
                    onSelect={selectDate}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[13px] font-semibold">{formatCalendarDayHeading(selected)}</h3>
              <div className="flex items-center gap-2">
                <p className="text-[10px] text-slate-400">
                  {selectedItems.length} item{selectedItems.length === 1 ? "" : "s"}
                </p>
                {canManage ? (
                  <button type="button" onClick={() => setDraft(emptyDraft(selected))} className="text-[10px] font-semibold text-primary">
                    Add
                  </button>
                ) : null}
              </div>
            </div>
            <ul className="mt-3 space-y-2">
              {selectedItems.map((item) => (
                <CalendarItemCard
                  key={item.id}
                  item={item}
                  todayIso={todayIso}
                  rows={rows}
                  canManage={canManage}
                  onOpen={openBooking}
                  onEdit={() => startEdit(item)}
                />
              ))}
              {selectedItems.length === 0 ? <li className="text-[11px] text-slate-400">Nothing on this day.</li> : null}
            </ul>
          </div>
          <div className="rounded-lg border bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[12px] font-semibold">Next 7 days</h3>
              <p className="text-[10px] text-slate-400">
                {upcoming.length} item{upcoming.length === 1 ? "" : "s"}
              </p>
            </div>
            <ul className="mt-3 space-y-2">
              {upcoming.map((item) => (
                <li key={`up:${item.id}`}>
                  <button type="button" onClick={() => selectDate(item.date)} className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left hover:bg-slate-50">
                    <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded ${kindChipClass(item.kind)}`}>
                      <KindIcon kind={item.kind} className="h-3 w-3" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold">{item.title}</p>
                      <p className="text-[10px] text-slate-400">
                        {formatCalendarShortDay(item.date)}
                        {item.subtitle ? ` · ${item.subtitle}` : ""}
                      </p>
                    </span>
                  </button>
                </li>
              ))}
              {upcoming.length === 0 ? <li className="text-[11px] text-slate-400">Nothing coming up in the next week.</li> : null}
            </ul>
            <button
              type="button"
              onClick={() => setView("list")}
              className="mt-3 w-full rounded-md border px-3 py-2 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              View all events
            </button>
          </div>
        </div>
      </div>

      {draft ? (
        <CalendarEditor
          draft={draft}
          rows={rows}
          pending={pending}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={saveDraft}
          onDelete={
            draft.id
              ? () =>
                  run(() => deleteOperationsCalendarEntry(draft.id!))
              : undefined
          }
        />
      ) : null}
    </div>
  )
}

function DayCell({
  date,
  dayLabel,
  weekday,
  items,
  selected,
  today,
  muted,
  tall,
  onSelect,
}: {
  date: string | null
  dayLabel: number | null
  weekday?: string
  items: OperationsCalendarFeedItem[]
  selected: boolean
  today: boolean
  muted?: boolean
  tall?: boolean
  onSelect: (date: string) => void
}) {
  const shown = tall ? items.slice(0, 5) : items.slice(0, 2)
  const extra = items.length - shown.length
  return (
    <button
      type="button"
      disabled={!date}
      onClick={() => date && onSelect(date)}
      className={`min-h-[108px] border-b border-r p-1.5 text-left ${tall ? "min-h-[168px]" : ""} ${
        selected ? "bg-red-50" : date ? "bg-white hover:bg-slate-50" : "bg-slate-50"
      } ${muted ? "bg-slate-50/80" : ""}`}
    >
      {weekday ? <p className="text-[8px] font-semibold uppercase tracking-wide text-slate-400">{weekday}</p> : null}
      {dayLabel ? (
        <p className={`text-[11px] font-semibold ${today ? "text-primary" : muted ? "text-slate-300" : ""}`}>
          {dayLabel}
          {today ? <span className="ml-1 text-[8px] uppercase tracking-wide">Today</span> : null}
        </p>
      ) : null}
      <div className="mt-1 space-y-0.5">
        {shown.map((item) => (
          <p key={item.id} className={`rounded px-1 py-0.5 ${kindChipClass(item.kind)}`}>
            <span className="block truncate text-[9px] font-semibold">{item.title}</span>
            {item.subtitle ? <span className="block truncate text-[8px] font-normal opacity-80">{item.subtitle}</span> : null}
          </p>
        ))}
        {extra > 0 ? <p className="px-1 text-[8px] font-semibold text-slate-400">+{extra} more</p> : null}
      </div>
    </button>
  )
}

function CalendarList({
  dates,
  byDate,
  selected,
  todayIso,
  onSelect,
}: {
  dates: string[]
  byDate: Map<string, OperationsCalendarFeedItem[]>
  selected: string
  todayIso: string
  onSelect: (date: string) => void
}) {
  if (dates.length === 0) {
    return <p className="px-2 py-10 text-center text-[11px] text-slate-400">Nothing in this month for the current filters.</p>
  }
  return (
    <ul className="mt-3 divide-y">
      {dates.map((date) => (
        <li key={date} className={`px-1 py-3 ${date === selected ? "bg-red-50/60" : ""}`}>
          <button type="button" onClick={() => onSelect(date)} className="mb-2 text-left text-[11px] font-semibold">
            {formatCalendarDayHeading(date)}
            {date === todayIso ? <span className="ml-2 text-[9px] uppercase tracking-wide text-primary">Today</span> : null}
          </button>
          <div className="space-y-1">
            {(byDate.get(date) ?? []).map((item) => (
              <p key={item.id} className={`rounded-md px-2 py-1 text-[11px] font-semibold ${kindChipClass(item.kind)}`}>
                {item.title}
                {item.subtitle ? <span className="ml-2 font-normal opacity-80">{item.subtitle}</span> : null}
              </p>
            ))}
          </div>
        </li>
      ))}
    </ul>
  )
}

function CalendarItemCard({
  item,
  todayIso,
  rows,
  canManage,
  onOpen,
  onEdit,
}: {
  item: OperationsCalendarFeedItem
  todayIso: string
  rows: OperationsBookingRow[]
  canManage: boolean
  onOpen: (bookingId: string) => void
  onEdit: () => void
}) {
  const overdue = item.date < todayIso && (item.kind === "guest_deadline" || item.kind === "collection" || item.kind === "task")
  return (
    <li className="rounded-md border px-3 py-2">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ${kindChipClass(item.kind)}`}>
          <KindIcon kind={item.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-semibold">{item.title}</p>
            {item.date === todayIso ? <span className="text-[8px] font-semibold uppercase tracking-wide text-primary">Today</span> : null}
            {overdue ? <span className="text-[8px] font-semibold uppercase tracking-wide text-red-600">Overdue</span> : null}
          </div>
          <p className="mt-0.5 text-[10px] text-slate-500">{operationsCalendarKindLabel(item.kind)}</p>
          {item.subtitle && item.kind !== "collection" ? <p className="mt-0.5 text-[10px] text-slate-500">{item.subtitle}</p> : null}
          {item.timeLabel ? (
            <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-slate-500">
              <CalendarDays className="h-3 w-3" />
              {item.timeLabel}
            </p>
          ) : null}
          {item.kind === "collection" && item.subtitle ? (
            <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-slate-500">
              <MapPin className="h-3 w-3" />
              {item.subtitle}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {item.bookingIds[0] && item.kind !== "race" ? (
              <button type="button" onClick={() => onOpen(item.bookingIds[0]!)} className="text-[10px] font-semibold text-primary">
                Open booking
              </button>
            ) : null}
            {item.kind === "race"
              ? item.bookingIds.slice(0, 6).map((bookingId) => {
                  const row = rows.find((booking) => booking.id === bookingId)
                  return (
                    <button key={bookingId} type="button" onClick={() => onOpen(bookingId)} className="text-[10px] font-semibold text-primary">
                      {row?.accountName ?? "Open booking"}
                    </button>
                  )
                })
              : null}
            {canManage && item.editable ? (
              <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600">
                <Pencil className="h-3 w-3" />
                Amend
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  )
}

function CalendarEditor({
  draft,
  rows,
  pending,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Draft
  rows: OperationsBookingRow[]
  pending: boolean
  onChange: (draft: Draft) => void
  onClose: () => void
  onSave: () => void
  onDelete?: () => void
}) {
  const bookingDate = draft.kind === "guest_deadline" || draft.kind === "collection"
  const title = bookingDate ? `Amend ${draft.kind === "guest_deadline" ? "guest deadline" : "collection date"}` : draft.id ? "Edit calendar item" : "Add to calendar"
  return (
    <AdminModalScrim onClose={onClose} panelClassName="max-w-lg">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 p-4">
        {bookingDate ? (
          <p className="text-[11px] text-slate-500">
            This date lives on the booking{draft.kind === "guest_deadline" ? " purchase order" : ""}. Changing it here updates the same field Operations already uses.
          </p>
        ) : (
          <label className="block text-[11px] font-semibold">
            Title
            <input
              value={draft.title}
              onChange={(event) => onChange({ ...draft, title: event.target.value })}
              className="mt-1 h-9 w-full rounded-md border px-3 font-normal"
              placeholder="e.g. Send seating plan"
            />
          </label>
        )}
        <label className="block text-[11px] font-semibold">
          Date
          <input
            type="date"
            value={draft.date}
            onChange={(event) => onChange({ ...draft, date: event.target.value })}
            className="mt-1 h-9 w-full rounded-md border px-3 font-normal"
          />
        </label>
        {bookingDate ? null : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[11px] font-semibold">
                Starts
                <input
                  type="time"
                  value={draft.startTime}
                  onChange={(event) => onChange({ ...draft, startTime: event.target.value })}
                  className="mt-1 h-9 w-full rounded-md border px-3 font-normal"
                />
              </label>
              <label className="block text-[11px] font-semibold">
                Ends
                <input
                  type="time"
                  value={draft.endTime}
                  onChange={(event) => onChange({ ...draft, endTime: event.target.value })}
                  className="mt-1 h-9 w-full rounded-md border px-3 font-normal"
                />
              </label>
            </div>
            <label className="block text-[11px] font-semibold">
              Notes
              <textarea
                value={draft.notes}
                onChange={(event) => onChange({ ...draft, notes: event.target.value })}
                rows={3}
                className="mt-1 w-full rounded-md border p-2 font-normal"
              />
            </label>
            <label className="block text-[11px] font-semibold">
              Linked booking
              <select
                value={draft.dealId || draft.orderId}
                onChange={(event) => {
                  const row = rows.find((booking) => booking.dealId === event.target.value || booking.id === event.target.value)
                  onChange({
                    ...draft,
                    dealId: row?.dealId ?? "",
                    orderId: row && !row.id.startsWith("deal:") ? row.id : "",
                  })
                }}
                className="mt-1 h-9 w-full rounded-md border bg-white px-2 font-normal"
              >
                <option value="">None</option>
                {rows.map((row) => (
                  <option key={row.id} value={row.dealId || row.id}>
                    {row.dealReference || row.reference} · {row.accountName}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
        {onDelete ? (
          <button type="button" disabled={pending} onClick={onDelete} className="text-[11px] font-semibold text-red-600">
            Remove
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-md border px-3 text-[11px] font-semibold">
            Cancel
          </button>
          <button type="button" disabled={pending} onClick={onSave} className="h-9 rounded-md bg-primary px-4 text-[11px] font-semibold text-white">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </AdminModalScrim>
  )
}
