import { Resend } from "resend"
import { getInvoiceFinanceCc, getResendApiKey, getResendFromAddress } from "@/lib/email/config"
import { xeroFetchInvoicePdf } from "@/lib/integrations/xero/client"

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export async function sendNativeInvoicePaymentReminder(input: {
  recipientEmail: string
  recipientName: string
  orderReference: string
  xeroInvoiceId: string
  xeroInvoiceNumber: string | null
  amount: number
  currency: string
  dueDate: string
  daysOverdue: number
  reminderNumber: number
}): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const apiKey = getResendApiKey()
  const from = getResendFromAddress()
  if (!apiKey || !from) {
    return { ok: false, skipped: "RESEND_API_KEY or email sender is not configured" }
  }
  let pdf: ArrayBuffer
  try {
    pdf = await xeroFetchInvoicePdf(input.xeroInvoiceId)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not download the Xero invoice PDF.",
    }
  }
  const invoiceLabel = input.xeroInvoiceNumber || input.orderReference
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: input.currency,
  }).format(input.amount)
  const cc = getInvoiceFinanceCc(input.recipientEmail)
  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to: [input.recipientEmail],
    ...(cc.length > 0 ? { cc } : {}),
    subject: `Payment reminder: invoice ${invoiceLabel} is overdue`,
    html: [
      `<p>Hi ${escapeHtml(input.recipientName)},</p>`,
      `<p>This is reminder ${input.reminderNumber} that invoice <strong>${escapeHtml(invoiceLabel)}</strong> for <strong>${escapeHtml(amount)}</strong> is now ${input.daysOverdue} day${input.daysOverdue === 1 ? "" : "s"} overdue.</p>`,
      `<p>The payment due date was ${escapeHtml(input.dueDate)}. Please arrange payment by wire transfer using the details shown on the attached invoice.</p>`,
      input.daysOverdue >= 28
        ? "<p><strong>This booking is now eligible for cancellation and stock release. Please contact ZK immediately if payment is already in progress.</strong></p>"
        : "<p>If payment has already been made, please reply with the remittance advice so our finance team can reconcile it.</p>",
      "<p>Thank you,<br/>ZK Sports &amp; Entertainment</p>",
    ].join(""),
    attachments: [
      {
        filename: `Invoice-${invoiceLabel.replace(/[^\w.-]+/g, "-")}.pdf`,
        content: Buffer.from(pdf),
      },
    ],
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

