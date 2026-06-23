import { NextResponse } from "next/server"
import { assertInvoicePdfAccess, InvoicePdfAccessError } from "@/lib/invoices/pdf-access"
import { xeroFetchInvoicePdf } from "@/lib/integrations/xero/client"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  const { orderId } = await context.params
  if (!UUID_RE.test(orderId)) {
    return NextResponse.json({ error: "Invalid order id." }, { status: 400 })
  }

  try {
    const access = await assertInvoicePdfAccess(orderId)
    const pdf = await xeroFetchInvoicePdf(access.xeroInvoiceId)
    const label = access.xeroInvoiceNumber?.trim() || access.orderReference
    const filename = `invoice-${label.replace(/[^\w.-]+/g, "-")}.pdf`

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (e) {
    if (e instanceof InvoicePdfAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    const msg = e instanceof Error ? e.message : "Failed to download invoice PDF."
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
