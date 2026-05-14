"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { updateInvoiceStatus } from "@/app/(admin)/actions"
import {
  INVOICE_WORKFLOW_STATUSES,
  invoiceWorkflowStatusLabels,
  isInvoiceWorkflowStatus,
  normalizeInvoiceStatus,
  type InvoiceWorkflowStatus,
} from "@/lib/invoices/status"

export function AdminInvoiceStatusSelect({
  invoiceId,
  initialStatus,
  className,
}: {
  invoiceId: string | null
  initialStatus: string | null
  className?: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [localStatus, setLocalStatus] = useState<InvoiceWorkflowStatus>(() =>
    normalizeInvoiceStatus(initialStatus ?? "awaiting_invoice"),
  )

  if (!invoiceId) {
    return <span className="text-muted-foreground">—</span>
  }

  return (
    <select
      aria-label="Invoice status"
      className={cn(
        "max-w-[220px] rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground",
        pending && "opacity-60 pointer-events-none",
        className,
      )}
      value={localStatus}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value
        if (!isInvoiceWorkflowStatus(next)) return
        const prev = localStatus
        setLocalStatus(next)
        start(async () => {
          const res = await updateInvoiceStatus(invoiceId, next)
          if (!res.ok) {
            setLocalStatus(prev)
            window.alert(res.message)
            return
          }
          router.refresh()
        })
      }}
    >
      {INVOICE_WORKFLOW_STATUSES.map((s) => (
        <option key={s} value={s}>
          {invoiceWorkflowStatusLabels[s]}
        </option>
      ))}
    </select>
  )
}
