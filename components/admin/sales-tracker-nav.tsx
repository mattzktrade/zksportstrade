"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"

export function SalesTrackerNav({ tab }: { tab: "revenue" | "demand" }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-[#eceef1]">
      <Link
        href="/admin/sales-tracker"
        className={cn(
          "border-b-2 px-3 pb-2.5 text-[10px] font-semibold",
          tab === "revenue" ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-700",
        )}
      >
        Revenue
      </Link>
      <Link
        href="/admin/sales-tracker?view=demand"
        className={cn(
          "border-b-2 px-3 pb-2.5 text-[10px] font-semibold",
          tab === "demand" ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-700",
        )}
      >
        Demand
      </Link>
    </div>
  )
}
