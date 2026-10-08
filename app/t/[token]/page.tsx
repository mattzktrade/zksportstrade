import { FileX2 } from "lucide-react"
import { getPublicTicketView } from "@/lib/tickets/public"
import { TicketView } from "./ticket-view"

export const dynamic = "force-dynamic"

export default async function PublicTicketPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  let view = null
  try {
    view = await getPublicTicketView(token)
  } catch {
    view = null
  }

  if (!view) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#010101] px-5 text-white">
        <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111] p-8 text-center">
          <FileX2 className="mx-auto h-11 w-11 text-white/40" />
          <h1 className="mt-4 text-xl font-bold">Ticket unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-white/70">
            This link is invalid or the ticket was replaced. Contact ZK operations for a new pass.
          </p>
        </section>
      </main>
    )
  }

  return <TicketView ticket={view} />
}
