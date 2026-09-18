"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { OperationsDashboardCalendarItem } from "@/lib/admin/operations-dashboard-metrics"
import { cn } from "@/lib/utils"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

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

function chipClass(kind: OperationsDashboardCalendarItem["kind"]): string {
  if (kind === "race") return "text-emerald-700"
  if (kind === "guest_deadline") return "text-sky-700"
  if (kind === "collection") return "text-amber-700"
  if (kind === "task") return "text-emerald-800"
  return "text-red-600"
}

function dotClass(kind: OperationsDashboardCalendarItem["kind"]): string {
  if (kind === "race") return "bg-emerald-500"
  if (kind === "guest_deadline") return "bg-sky-500"
  if (kind === "collection") return "bg-amber-500"
  if (kind === "task") return "bg-emerald-600"
  return "bg-[#e10600]"
}

export function OperationsDashboardCalendar({
  items,
  todayIso,
}: {
  items: OperationsDashboardCalendarItem[]
  todayIso: string
}) {
  const initial = parseIso(todayIso)
  const [cursor, setCursor] = useState({ year: initial.year, month: initial.month })

  const byDate = useMemo(() => {
    const map = new Map<string, OperationsDashboardCalendarItem[]>()
    for (const item of items) {
      const list = map.get(item.date) ?? []
      list.push(item)
      map.set(item.date, list)
    }
    return map
  }, [items])

  const first = new Date(Date.UTC(cursor.year, cursor.month, 1))
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

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor((current) => addMonths(current.year, current.month, -1))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#eceff3] text-[#5c6168] hover:bg-slate-50"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setCursor((current) => addMonths(current.year, current.month, 1))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#eceff3] text-[#5c6168] hover:bg-slate-50"
            aria-label="Next month"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <h3 className="ml-1 text-[13px] font-semibold text-[#1b1c1f]">{monthLabel}</h3>
        </div>
        <button
          type="button"
          onClick={() => setCursor({ year: initial.year, month: initial.month })}
          className="h-7 rounded-md border border-[#eceff3] px-2.5 text-[11px] font-medium text-[#3d4148] hover:bg-slate-50"
        >
          Today
        </button>
      </div>
      <div className="mt-3 grid grid-cols-7 text-center text-[9px] font-medium uppercase tracking-wide text-[#9aa0a6]">
        {WEEKDAYS.map((day) => (
          <div key={day} className="py-1.5">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 border-t border-[#f0f2f4]">
        {monthCells.map((cell) => {
          const dayItems = cell.inMonth ? (byDate.get(cell.date) ?? []).slice(0, 3) : []
          const extra = cell.inMonth ? (byDate.get(cell.date)?.length ?? 0) - dayItems.length : 0
          const isToday = cell.date === todayIso
          return (
            <div
              key={cell.date}
              className={cn(
                "min-h-[72px] border-b border-r border-[#f0f2f4] p-1",
                !cell.inMonth && "bg-[#fafbfc]",
              )}
            >
              <p
                className={cn(
                  "mb-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-[11px] font-semibold",
                  isToday ? "bg-primary text-white" : cell.inMonth ? "text-[#2c3036]" : "text-[#c5c9ce]",
                )}
              >
                {cell.day}
              </p>
              <div className="space-y-0.5">
                {dayItems.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={cn("flex items-center gap-1 truncate text-[8px] font-medium leading-tight hover:underline", chipClass(item.kind))}
                    title={item.label}
                  >
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass(item.kind))} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                ))}
                {extra > 0 ? (
                  <Link
                    href="/admin/operations?tab=calendar"
                    className="block truncate px-0.5 text-[8px] font-medium text-[#9aa0a6] hover:underline"
                  >
                    +{extra} more
                  </Link>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
