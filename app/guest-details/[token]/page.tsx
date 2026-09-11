import { FileX2, TimerOff } from "lucide-react"
import { getPublicGuestDetailsForm } from "@/lib/guest-details/public"
import { GuestDetailsForm } from "./guest-details-form"

export const dynamic = "force-dynamic"

export default async function GuestDetailsPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const { form, unavailableReason } = await getPublicGuestDetailsForm(token)

  if (!form) {
    const expired = unavailableReason === "expired"
    const Icon = expired ? TimerOff : FileX2
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f4f5f7] px-5 text-slate-900">
        <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <Icon className="mx-auto h-11 w-11 text-slate-400" />
          <h1 className="mt-4 text-xl font-bold">
            {expired ? "This guest details form has expired" : "Guest details form unavailable"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {expired
              ? "This link is no longer valid. Contact your ZK operations contact for a new guest details form."
              : "This secure link is invalid or the booking is no longer available. Contact your ZK representative for help."}
          </p>
        </section>
      </main>
    )
  }

  return <GuestDetailsForm initial={form} />
}
