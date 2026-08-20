import { FileX2, TimerOff } from "lucide-react"
import { getPublicBookingForm } from "@/lib/booking-forms/public"
import { SigningClient } from "./signing-client"

export const dynamic = "force-dynamic"

export default async function BookingFormSigningPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const { form, unavailableReason } = await getPublicBookingForm(token)

  if (!form) {
    const expired = unavailableReason === "expired"
    const Icon = expired ? TimerOff : FileX2
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f3f5f7] px-5 text-slate-900">
        <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <Icon className="mx-auto h-11 w-11 text-slate-400" />
          <h1 className="mt-4 text-xl font-bold">
            {expired ? "This booking form has expired" : "Booking form unavailable"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {expired
              ? "The seven-day signing period has ended and the stock hold has been released. Contact your ZK representative for a new form."
              : "This secure link is invalid, has been replaced, or the booking form is no longer available. Contact your ZK representative for help."}
          </p>
        </section>
      </main>
    )
  }

  return <SigningClient token={token} form={form} />
}

