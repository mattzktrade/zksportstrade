"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { CircleDollarSign, Download, RefreshCcw, Send, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { dealConfirmedOffPlatform, type DealListRow } from "@/lib/crm/deal-types"
import {
  cancelNativeDealOrder,
  reconcileNativeDealInvoice,
  resendNativeDealInvoice,
  retryNativeDealInvoice,
} from "./deal-finance-actions"

function date(value: string | null): string {
  if (!value) return "—"
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function DealFinancePanel({
  deal,
  canManageFinance,
}: {
  deal: DealListRow
  canManageFinance: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

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

  function cancelOrder() {
    if (!deal.order_id) return
    const reason = window.prompt(
      "Cancellation reason. The Xero invoice will be voided and committed stock restored:",
    )
    if (!reason?.trim()) return
    if (!window.confirm("Cancel this order and restore all stock?")) return
    run(() =>
      cancelNativeDealOrder({
        dealId: deal.id,
        orderId: deal.order_id!,
        reason,
      }),
    )
  }

  const eligibleAt = deal.cancellation_eligible_at
  const cancellationReady =
    eligibleAt != null && eligibleAt.slice(0, 10) <= new Date().toISOString().slice(0, 10)
  const canCreateOrder = ["signed", "awaiting_invoice"].includes(deal.stage)
  const activeInvoice = deal.invoice_status && deal.invoice_status !== "cancelled"

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center gap-2">
        <CircleDollarSign className="h-4 w-4 text-blue-600" />
        <h3 className="text-[9px] font-semibold">Order &amp; Xero invoice</h3>
      </div>

      {!deal.order_id ? (
        <div className="mt-3">
          <p className="text-[8px] text-slate-500">
            {dealConfirmedOffPlatform(deal)
              ? "No portal order or Xero invoice is needed. This sale was billed on the previous platform."
              : "The order is created only after both booking-form signatures."}
          </p>
          {canCreateOrder && canManageFinance ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => retryNativeDealInvoice(deal.id))}
              className="mt-2 h-9 w-full rounded-md bg-blue-600 text-[9px] font-semibold text-white disabled:opacity-50"
            >
              Create order &amp; queue invoice
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <dl className="grid grid-cols-[90px_1fr] gap-y-1.5 rounded-md bg-slate-50 p-3 text-[8px]">
            <dt className="text-slate-400">Order</dt>
            <dd className="font-semibold">{deal.order_reference || deal.order_id}</dd>
            <dt className="text-slate-400">Invoice</dt>
            <dd>
              {deal.xero_invoice_number ||
                (deal.xero_invoice_id ? "Created in Xero" : deal.ledger_invoice_number || "Not created")}
              {deal.ledger_invoice_number &&
              deal.ledger_invoice_number !== deal.xero_invoice_number &&
              deal.xero_invoice_number
                ? ` · Ledger ${deal.ledger_invoice_number}`
                : null}
            </dd>
            <dt className="text-slate-400">Status</dt>
            <dd className="font-semibold">{deal.invoice_status?.replaceAll("_", " ") || "Awaiting invoice"}</dd>
            <dt className="text-slate-400">Xero sync</dt>
            <dd>{deal.xero_sync_status || "pending"}</dd>
            <dt className="text-slate-400">Due date</dt>
            <dd>{date(deal.invoice_due_date)}</dd>
          </dl>

          {deal.xero_sync_error || deal.invoice_email_error || deal.payment_reminder_error ? (
            <div className="flex items-start gap-2 rounded-md bg-red-50 p-2 text-[8px] text-red-700">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {deal.xero_sync_error || deal.invoice_email_error || deal.payment_reminder_error}
              </span>
            </div>
          ) : null}
          {cancellationReady && deal.invoice_status === "awaiting_payment" ? (
            <div className="rounded-md bg-amber-50 p-2 text-[8px] font-semibold text-amber-900">
              Payment is 28+ days overdue. This order is eligible for reviewed cancellation.
            </div>
          ) : null}

          {canManageFinance ? (
            <div className="grid grid-cols-2 gap-2">
              {!deal.xero_invoice_id || deal.xero_sync_status === "failed" ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => retryNativeDealInvoice(deal.id))}
                  className="h-9 rounded-md border text-[9px] font-semibold disabled:opacity-50"
                >
                  <span className="inline-flex items-center gap-1">
                    <RefreshCcw className="h-3.5 w-3.5" /> Retry Xero
                  </span>
                </button>
              ) : null}
              {deal.xero_invoice_id ? (
                <>
                  <a
                    href={`/api/invoices/${encodeURIComponent(deal.order_id)}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-9 items-center justify-center gap-1 rounded-md border text-[9px] font-semibold"
                  >
                    <Download className="h-3.5 w-3.5" /> PDF
                  </a>
                  <button
                    type="button"
                    disabled={pending || !activeInvoice}
                    onClick={() => run(() => resendNativeDealInvoice(deal.order_id!))}
                    className="h-9 rounded-md border text-[9px] font-semibold disabled:opacity-50"
                  >
                    <span className="inline-flex items-center gap-1">
                      <Send className="h-3.5 w-3.5" /> Resend
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    title="Refresh this invoice from Xero. If the client has paid in Xero, this marks it paid here. Automatic reminders also do this before sending."
                    onClick={() => run(() => reconcileNativeDealInvoice(deal.order_id!))}
                    className="h-9 rounded-md border text-[9px] font-semibold disabled:opacity-50"
                  >
                    Reconcile
                  </button>
                </>
              ) : null}
              {deal.invoice_status && !["paid", "delivered", "cancelled"].includes(deal.invoice_status) ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={cancelOrder}
                  className="h-9 rounded-md border border-red-200 text-[9px] font-semibold text-red-600 disabled:opacity-50"
                >
                  Cancel order
                </button>
              ) : null}
              {deal.xero_invoice_id ? (
                <p className="col-span-2 text-[8px] leading-4 text-slate-500">
                  Reconcile pulls the latest Xero status. Use it if payment landed in Xero and this deal has not caught up yet. The reminder job also reconciles automatically.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-[8px] text-slate-500">Finance or admin permission is required for invoice actions.</p>
          )}
        </div>
      )}
    </div>
  )
}

