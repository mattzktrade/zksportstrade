import type { SupabaseClient } from "@supabase/supabase-js"
import {
  DEFAULT_PAYMENT_DUE_DAYS,
  addUtcDays,
  defaultPaymentSchedule,
  paymentScheduleFromUnknown,
  resolvePaymentSchedule,
  todayUtcDate,
  type ResolvedPaymentInstallment,
} from "@/lib/booking-forms/payment-schedule"
import { allOrderInvoicesPaid, pickCurrentInvoice, sortInvoicesByInstallment } from "@/lib/invoices/status"

export type OrderInvoiceRow = {
  id: string
  order_id: string
  reference: string
  amount: number
  currency: string
  status: string
  due_date: string | null
  issued_at: string | null
  xero_invoice_id: string | null
  xero_invoice_number: string | null
  xero_sync_status: string | null
  xero_sync_error: string | null
  invoice_emailed_at: string | null
  invoice_email_error: string | null
  installment_index: number | null
  installment_count: number | null
  installment_percent: number | null
  installment_label: string | null
  created_at?: string | null
}

const INVOICE_SELECT = "*"

export function invoiceDueLeadDays(): number {
  const dueDays = Number(process.env.XERO_INVOICE_DUE_DAYS ?? DEFAULT_PAYMENT_DUE_DAYS)
  return Number.isFinite(dueDays) ? dueDays : DEFAULT_PAYMENT_DUE_DAYS
}

export function isInvoiceIssuable(
  invoice: Pick<OrderInvoiceRow, "status" | "xero_invoice_id" | "installment_index" | "due_date">,
  today = todayUtcDate(),
  leadDays = invoiceDueLeadDays(),
): boolean {
  if (invoice.status === "cancelled" || invoice.status === "paid" || invoice.status === "delivered") {
    return false
  }
  if (invoice.xero_invoice_id) return false
  if ((invoice.installment_index ?? 1) <= 1) return true
  if (!invoice.due_date) return true
  return invoice.due_date <= addUtcDays(today, leadDays)
}

export async function loadOrderInvoices(
  admin: SupabaseClient,
  orderId: string,
): Promise<OrderInvoiceRow[]> {
  const { data, error } = await admin
    .from("invoices")
    .select(INVOICE_SELECT)
    .eq("order_id", orderId)
  if (error) throw new Error(error.message)
  return sortInvoicesByInstallment((data ?? []) as OrderInvoiceRow[])
}

export function pickOrderInvoice(
  invoices: OrderInvoiceRow[],
  invoiceId?: string | null,
): OrderInvoiceRow | null {
  if (invoiceId) return invoices.find((row) => row.id === invoiceId) ?? null
  return pickCurrentInvoice(invoices)
}

export function installmentInvoiceReference(orderReference: string, index: number): string {
  return index <= 1 ? orderReference : `${orderReference}-${index}`
}

export function scaleLineAmountsToTotal<T extends { quantity: number; unit_price: number; line_total?: number }>(
  lines: T[],
  targetAmount: number,
): T[] {
  if (!lines.length) return lines
  const sourceTotal = lines.reduce((sum, line) => {
    const lineTotal =
      line.line_total != null
        ? Number(line.line_total)
        : Number(line.quantity) * Number(line.unit_price)
    return sum + lineTotal
  }, 0)
  if (sourceTotal <= 0 || Math.abs(sourceTotal - targetAmount) < 0.005) return lines

  const ratio = targetAmount / sourceTotal
  const scaled = lines.map((line) => {
    const quantity = Number(line.quantity)
    const nextUnit = Math.round((Number(line.unit_price) * ratio + Number.EPSILON) * 100) / 100
    return {
      ...line,
      unit_price: nextUnit,
      line_total: Math.round((quantity * nextUnit + Number.EPSILON) * 100) / 100,
    }
  })
  const allocated = scaled.slice(0, -1).reduce((sum, line) => sum + Number(line.line_total), 0)
  const last = scaled[scaled.length - 1]
  if (last) {
    const lastTotal = Math.round((targetAmount - allocated + Number.EPSILON) * 100) / 100
    const quantity = Number(last.quantity) || 1
    last.line_total = lastTotal
    last.unit_price = Math.round((lastTotal / quantity + Number.EPSILON) * 100) / 100
  }
  return scaled
}

function snapshotFromUnknown(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export async function applyBookingFormPaymentScheduleToOrder(
  admin: SupabaseClient,
  orderId: string,
): Promise<OrderInvoiceRow[]> {
  const invoices = await loadOrderInvoices(admin, orderId)
  if (!invoices.length) return invoices
  if (invoices.some((row) => row.xero_invoice_id)) return invoices

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, reference, total_amount, currency, booking_form_id, channel")
    .eq("id", orderId)
    .maybeSingle()
  if (orderError) throw new Error(orderError.message)
  if (!order?.booking_form_id || order.channel !== "native_deal") return invoices

  const { data: form, error: formError } = await admin
    .from("booking_forms")
    .select("snapshot_data, completed_at")
    .eq("id", order.booking_form_id)
    .maybeSingle()
  if (formError) throw new Error(formError.message)

  const snapshot = snapshotFromUnknown(form?.snapshot_data)
  const schedule = paymentScheduleFromUnknown(snapshot?.paymentSchedule) ?? defaultPaymentSchedule()
  const signingDate = String(form?.completed_at || todayUtcDate()).slice(0, 10)
  const total = Number(snapshot?.total ?? order.total_amount)
  const currency = String(snapshot?.currency ?? order.currency ?? "USD")
  const resolved = resolvePaymentSchedule(schedule, total, signingDate)
  if (resolved.length <= 1) {
    const only = resolved[0]
    const { error } = await admin
      .from("invoices")
      .update({
        due_date: only?.dueDate ?? addUtcDays(signingDate, DEFAULT_PAYMENT_DUE_DAYS),
      })
      .eq("id", invoices[0].id)
    if (error) throw new Error(error.message)
    return loadOrderInvoices(admin, orderId)
  }

  const existingByIndex = new Map(invoices.map((row) => [Number(row.installment_index ?? 1), row]))

  for (const installment of resolved) {
    const existing =
      existingByIndex.get(installment.index) ??
      (installment.index === 1 && invoices.length === 1 ? invoices[0] : null)
    if (existing) {
      await updateExistingInvoiceForInstallment(admin, existing, installment, order.reference)
      existingByIndex.set(installment.index, existing)
    } else {
      await insertInstallmentInvoice(admin, {
        orderId,
        orderReference: order.reference,
        currency,
        installment,
      })
    }
  }
  return loadOrderInvoices(admin, orderId)
}

async function updateExistingInvoiceForInstallment(
  admin: SupabaseClient,
  existing: OrderInvoiceRow,
  installment: ResolvedPaymentInstallment,
  orderReference: string,
) {
  const { error } = await admin
    .from("invoices")
    .update({
      reference: installmentInvoiceReference(orderReference, installment.index),
      amount: installment.amount,
      due_date: installment.dueDate,
      installment_index: installment.index,
      installment_count: installment.count,
      installment_percent: installment.percent,
      installment_label: installment.label || null,
    })
    .eq("id", existing.id)
  if (error) throw new Error(error.message)
}

async function insertInstallmentInvoice(
  admin: SupabaseClient,
  input: {
    orderId: string
    orderReference: string
    currency: string
    installment: ResolvedPaymentInstallment
  },
) {
  const { error } = await admin.from("invoices").insert({
    order_id: input.orderId,
    reference: installmentInvoiceReference(input.orderReference, input.installment.index),
    amount: input.installment.amount,
    currency: input.currency,
    status: "awaiting_invoice",
    issued_at: null,
    due_date: input.installment.dueDate,
    installment_index: input.installment.index,
    installment_count: input.installment.count,
    installment_percent: input.installment.percent,
    installment_label: input.installment.label || null,
  })
  if (error) throw new Error(error.message)
}

export function earliestOpenInvoiceDueDate(invoices: OrderInvoiceRow[]): string | null {
  const open = sortInvoicesByInstallment(invoices).filter(
    (row) => row.status !== "cancelled" && row.status !== "paid" && row.status !== "delivered",
  )
  return open.find((row) => row.due_date)?.due_date ?? null
}

export { allOrderInvoicesPaid }
