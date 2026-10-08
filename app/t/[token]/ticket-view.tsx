"use client"

import Image from "next/image"
import { LOGO_WHITE } from "@/lib/branding"
import type { PublicTicketView } from "@/lib/tickets/public"

export function TicketView({ ticket }: { ticket: PublicTicketView }) {
  return (
    <main className="min-h-screen bg-[#010101] px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-md">
        <div className="flex justify-center">
          <Image src={LOGO_WHITE.src} alt="ZK Sports" width={160} height={42} className="h-8 w-auto" />
        </div>
        <p className="mt-3 text-center text-[11px] font-semibold tracking-[0.2em] text-[#F90202]">
          {ticket.voided ? "VOID" : "GUEST TICKET"}
        </p>

        <section className="mt-6 overflow-hidden rounded-3xl bg-white text-[#010101] shadow-2xl">
          <div className="h-1.5 bg-[#F90202]" />
          <div className="px-6 pb-7 pt-6">
            <h1 className="text-2xl font-bold leading-tight">{ticket.guestName}</h1>
            <p className="mt-1 text-sm text-[#5f636b]">{ticket.packageName}</p>
            <p className="mt-3 text-sm font-semibold">{ticket.eventLabel}</p>
            {ticket.venue ? <p className="text-sm text-[#5f636b]">{ticket.venue}</p> : null}
            <p className="mt-2 text-sm font-semibold text-[#F90202]">{ticket.daysLabel}</p>

            <div className="mt-6 flex flex-col items-center">
              {ticket.voided ? (
                <div className="flex h-52 w-52 items-center justify-center rounded-2xl border-4 border-[#F90202] text-3xl font-black text-[#F90202]">
                  VOID
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ticket.qrDataUrl}
                  alt="Ticket QR code"
                  className="h-52 w-52 rounded-xl border border-[#eceef1] bg-white p-2"
                />
              )}
              <p className="mt-3 font-mono text-lg font-bold tracking-wide">{ticket.shortCode}</p>
            </div>

            <p className="mt-5 text-center text-xs leading-5 text-[#5f636b]">
              This ticket is named and unique. Do not share the QR. If the code will not scan, show this screen and your
              photo ID at the welcome point.
            </p>

            {!ticket.voided ? (
              <div className="mt-5 grid gap-2">
                <a
                  href={`/api/tickets/${encodeURIComponent(ticket.token)}/pdf`}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-[#010101] text-sm font-semibold text-white"
                >
                  Save PDF / photos backup
                </a>
                {ticket.wallet.apple === "ready" ? (
                  <a
                    href={`/api/tickets/${encodeURIComponent(ticket.token)}/wallet/apple`}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-[#010101] text-sm font-semibold"
                  >
                    Add to Apple Wallet
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-[#eceef1] text-sm font-semibold text-[#92969e]"
                  >
                    Add to Apple Wallet
                  </button>
                )}
                {ticket.wallet.google === "ready" ? (
                  <a
                    href={`/api/tickets/${encodeURIComponent(ticket.token)}/wallet/google`}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-[#010101] text-sm font-semibold"
                  >
                    Add to Google Wallet
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-[#eceef1] text-sm font-semibold text-[#92969e]"
                  >
                    Add to Google Wallet
                  </button>
                )}
                <p className="text-center text-[11px] text-[#92969e]">
                  Wallet buttons activate once Apple and Google issuer certificates are connected. Do not share this
                  ticket.
                </p>
              </div>
            ) : (
              <p className="mt-5 text-center text-sm font-semibold text-[#F90202]">
                This pass was replaced. Use the new link from operations.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
