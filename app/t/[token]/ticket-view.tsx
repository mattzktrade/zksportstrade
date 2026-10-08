"use client"

import { useState } from "react"
import Image from "next/image"
import { Outfit } from "next/font/google"
import { CalendarDays, Download, Shield } from "lucide-react"
import { LOGO_WHITE } from "@/lib/branding"
import { displayTicketShortCode } from "@/lib/tickets/pass"
import { validDayChipLabels } from "@/lib/tickets/model"
import type { PublicTicketView } from "@/lib/tickets/public"

const outfit = Outfit({ subsets: ["latin"], weight: ["400", "500", "600", "700"] })

function AppleMark() {
  return (
    <svg width="14" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.37 12.64c.03-3.18 2.6-4.7 2.72-4.78-1.49-2.17-3.8-2.47-4.61-2.5-1.95-.2-3.82 1.15-4.81 1.15-.99 0-2.52-1.13-4.15-1.1-2.13.03-4.1 1.24-5.2 3.15-2.22 3.85-.57 9.54 1.59 12.67 1.06 1.53 2.32 3.25 3.97 3.19 1.61-.07 2.22-1.03 4.16-1.03 1.94 0 2.49 1.03 4.17 1 1.73-.03 2.82-1.56 3.87-3.1 1.22-1.77 1.72-3.49 1.75-3.58-.04-.02-3.26-1.25-3.46-4.97zM13.7 3.88c.88-1.07 1.47-2.56 1.31-4.04-1.27.05-2.8.85-3.71 1.91-.81.94-1.53 2.45-1.34 3.89 1.42.11 2.87-.72 3.74-1.76z" />
    </svg>
  )
}

function GoogleWalletMark() {
  return (
    <svg width="18" height="14" viewBox="0 0 24 18" aria-hidden>
      <rect x="1" y="3" width="22" height="13" rx="3" fill="#1A73E8" />
      <rect x="1" y="3" width="22" height="4.2" rx="2" fill="#34A853" />
      <circle cx="17.2" cy="11.4" r="2.15" fill="#FBBC05" />
      <circle cx="17.2" cy="11.4" r="0.85" fill="#EA4335" />
    </svg>
  )
}

function FormulaOneMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/images/tickets/f1-mark.png"
      alt=""
      className="h-[18px] w-auto shrink-0 sm:h-[20px]"
    />
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-white/10 py-[15px]">
      <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/40">{label}</p>
      <p className="mt-1.5 text-[17px] font-semibold leading-snug tracking-[-0.015em] text-white">{value}</p>
    </div>
  )
}

export function TicketView({ ticket }: { ticket: PublicTicketView }) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const showPhoto = ticket.hasHeadshot && !photoFailed && !ticket.voided
  const days = validDayChipLabels(ticket.days)
  const code = displayTicketShortCode(ticket.shortCode)

  return (
    <main className={`${outfit.className} ticket-page relative min-h-dvh overflow-x-hidden bg-[#03070b] text-white`}>
      <style>{`
        .ticket-shell {
          position: relative;
          overflow: hidden;
          border-radius: 22px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: linear-gradient(155deg, rgba(16, 18, 22, 0.58), rgba(8, 10, 14, 0.5));
          box-shadow: 0 28px 70px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06);
          backdrop-filter: blur(18px) saturate(1.15);
          -webkit-backdrop-filter: blur(18px) saturate(1.15);
        }
        .ticket-shell::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          border: 2.5px solid #F90202;
          border-bottom-color: transparent;
          -webkit-mask-image: linear-gradient(#000 0 16px, transparent 22px);
          mask-image: linear-gradient(#000 0 16px, transparent 22px);
        }
      `}</style>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/tickets/ticket-bg-mobile.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-top md:hidden"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/tickets/ticket-bg-desktop.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 hidden h-full w-full object-cover object-center md:block"
      />

      <div className="relative mx-auto flex w-full max-w-[440px] flex-col px-4 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-[max(1.15rem,env(safe-area-inset-top))] sm:px-5 md:max-w-[460px] md:justify-center md:py-12">
        <header className="flex flex-col items-center pt-1 md:pt-0">
          <Image
            src={LOGO_WHITE.src}
            alt="ZK Sports & Entertainment"
            width={220}
            height={56}
            className="h-[30px] w-auto sm:h-[34px] md:h-[44px]"
            priority
          />
          <p className="mt-3.5 text-[10px] font-semibold uppercase tracking-[0.4em] text-[#F90202] sm:text-[11px]">
            {ticket.voided ? "Void" : "Guest ticket"}
          </p>
        </header>

        <section className="ticket-shell mt-4 sm:mt-5">
          <div className="pointer-events-none absolute right-[-6%] top-[36%] h-44 w-32 rounded-full bg-[#F90202]/[0.18] blur-[48px]" />

          <div className="relative px-5 pb-6 pt-6 sm:px-6 sm:pb-7 sm:pt-[26px]">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div className="min-w-0 pr-2">
                <h1 className="text-[28px] font-bold leading-[1.08] tracking-[-0.03em] text-white sm:text-[32px]">
                  {ticket.guestName.trim() || "Guest"}
                </h1>
                <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.24em] text-white/40">Guest</p>
              </div>
              <div className="flex shrink-0 items-center gap-2.5 pt-1">
                <FormulaOneMark />
                {showPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/tickets/${encodeURIComponent(ticket.token)}/photo`}
                    alt=""
                    onError={() => setPhotoFailed(true)}
                    className="h-10 w-10 rounded-lg object-cover ring-1 ring-[#F90202]/80"
                  />
                ) : null}
              </div>
            </div>

            <Field label="Package" value={ticket.packageName} />
            <Field label="Event" value={ticket.eventLabel} />

            <p className="mt-4 text-[10px] font-medium uppercase tracking-[0.22em] text-white/40">Attending days</p>
            <div
              className="mt-2.5 grid gap-2"
              style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(days.length, 1), 3)}, minmax(0, 1fr))` }}
            >
              {days.map((day) => (
                <span
                  key={day}
                  className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full border border-[#F90202] bg-[#F90202]/[0.07] px-2 py-[7px] text-[12px] font-medium text-white sm:text-[13px]"
                >
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-white" aria-hidden />
                  {day}
                </span>
              ))}
            </div>

            <div className="mt-[18px] flex flex-col items-center">
              {ticket.voided ? (
                <div className="flex h-[196px] w-[196px] items-center justify-center rounded-[14px] bg-white text-3xl font-black text-[#F90202]">
                  VOID
                </div>
              ) : (
                <div className="rounded-[14px] bg-white p-2.5 shadow-[0_10px_24px_rgba(0,0,0,0.28)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ticket.qrDataUrl} alt="Ticket QR code" className="h-[186px] w-[186px] sm:h-[196px] sm:w-[196px]" />
                </div>
              )}
              <p className="mt-3.5 text-[20px] font-bold tracking-[0.14em] text-white">{code}</p>
              <div className="mt-3.5 h-px w-full bg-white/10" />
              <p className="mt-3.5 flex max-w-[20rem] items-start gap-2 text-[11px] leading-[1.55] text-white/50">
                <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/55" aria-hidden />
                <span>
                  This ticket is named and unique. Do not share the QR. If the code will not scan, show this screen and
                  your photo ID at the welcome point.
                </span>
              </p>
            </div>

            {!ticket.voided ? (
              <div className="mt-5 grid gap-2">
                <a
                  href={`/api/tickets/${encodeURIComponent(ticket.token)}/pdf`}
                  className="inline-flex h-[46px] items-center justify-center gap-2 rounded-xl bg-[#F90202] text-[13px] font-semibold text-white transition hover:brightness-110"
                >
                  <Download className="h-4 w-4" aria-hidden />
                  Save PDF / photos backup
                </a>
                {ticket.wallet.apple === "ready" ? (
                  <a
                    href={`/api/tickets/${encodeURIComponent(ticket.token)}/wallet/apple`}
                    className="inline-flex h-[46px] items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] text-[13px] font-semibold"
                  >
                    <AppleMark />
                    Add to Apple Wallet
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-[46px] items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] text-[13px] font-semibold text-white/70"
                  >
                    <AppleMark />
                    Add to Apple Wallet
                  </button>
                )}
                {ticket.wallet.google === "ready" ? (
                  <a
                    href={`/api/tickets/${encodeURIComponent(ticket.token)}/wallet/google`}
                    className="inline-flex h-[46px] items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] text-[13px] font-semibold"
                  >
                    <GoogleWalletMark />
                    Add to Google Wallet
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-[46px] items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] text-[13px] font-semibold text-white/70"
                  >
                    <GoogleWalletMark />
                    Add to Google Wallet
                  </button>
                )}
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
