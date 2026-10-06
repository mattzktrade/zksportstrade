"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"

const FILTERS = [
  { id: "all", label: "All" },
  { id: "needs_review", label: "Needs review" },
  { id: "ai_active", label: "Assistant" },
  { id: "human_takeover", label: "Taken over" },
  { id: "closed", label: "Closed" },
] as const

export function AssistantInboxClient({
  status,
  rows,
}: {
  status: string
  rows: Array<{ id: string; channel: string; status: string; identity: string; name: string; updatedAt: string }>
}) {
  const router = useRouter()
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap gap-1 border-b border-border p-2">
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => router.push(filter.id === "all" ? "/admin/assistant" : `/admin/assistant?status=${filter.id}`)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-medium",
              status === filter.id ? "bg-red-50 text-primary" : "text-muted-foreground hover:bg-slate-50",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <div className="divide-y divide-[#f0f1f3]">
        {rows.map((row) => (
          <Link
            key={row.id}
            href={`/admin/assistant/${row.id}`}
            className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-50"
          >
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-[#1b1c1f]">{row.name}</span>
              <span className="mt-0.5 block text-[11px] text-[#80848d]">
                {row.channel} · {row.status.replaceAll("_", " ")} · {row.identity}
              </span>
            </span>
            <span className="shrink-0 text-[11px] text-[#9aa0a6]">
              {new Date(row.updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          </Link>
        ))}
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12px] text-[#9aa0a6]">
            No conversations yet. Inbound WhatsApp and sales@ email land here once the webhooks are connected.
          </p>
        ) : null}
      </div>
    </div>
  )
}
