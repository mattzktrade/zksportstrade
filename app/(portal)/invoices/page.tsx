import { redirect } from "next/navigation"

/** Invoices page retired — payment status lives on My Bookings. */
export default function InvoicesPage() {
  redirect("/bookings")
}
