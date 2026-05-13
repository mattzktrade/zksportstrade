import { getMyInvoices } from "@/lib/invoices/queries"
import { InvoicesPageClient } from "./invoices-page-client"

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>
}) {
  const sp = await searchParams
  const invoices = await getMyInvoices()
  return <InvoicesPageClient initialInvoices={invoices} highlightOrderId={sp.orderId} />
}
