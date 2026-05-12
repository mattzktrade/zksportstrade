"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { packages } from "@/lib/data"

export function CalendarPreview() {
  const [currentMonth, setCurrentMonth] = useState(new Date(2026, 4, 1)) // May 2026

  const monthName = currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()

  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay()

  const eventDays = packages
    .filter((pkg) => {
      const pkgDate = new Date(pkg.date)
      return pkgDate.getMonth() === currentMonth.getMonth() && pkgDate.getFullYear() === currentMonth.getFullYear()
    })
    .map((pkg) => new Date(pkg.date).getDate())

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))
  }

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))
  }

  return (
    <div className="bg-card rounded-2xl border border-border p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h3 className="text-base sm:text-lg font-semibold text-foreground">Race Calendar</h3>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button onClick={prevMonth} className="p-1 sm:p-1.5 rounded-lg hover:bg-muted transition-colors">
            <ChevronLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </button>
          <span className="text-xs sm:text-sm font-medium w-24 sm:w-32 text-center">{monthName}</span>
          <button onClick={nextMonth} className="p-1 sm:p-1.5 rounded-lg hover:bg-muted transition-colors">
            <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
          <div key={day} className="text-center text-[10px] sm:text-xs font-medium text-muted-foreground py-1.5 sm:py-2">
            {day}
          </div>
        ))}

        {Array.from({ length: firstDayOfMonth }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const hasEvent = eventDays.includes(day)

          return (
            <div
              key={day}
              className={`
                relative text-center py-1.5 sm:py-2 text-xs sm:text-sm rounded-lg cursor-pointer transition-colors
                ${hasEvent ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-muted"}
              `}
            >
              {day}
              {hasEvent && (
                <div className="absolute bottom-0.5 sm:bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white" />
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-border">
        <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-muted-foreground">
          <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded bg-primary" />
          <span>Race Weekend</span>
        </div>
      </div>
    </div>
  )
}
