"use client"

import Image from "next/image"
import { useRef, useState } from "react"
import { CheckCircle2, Download, Eraser, LockKeyhole } from "lucide-react"
import type { PublicBookingForm } from "@/lib/booking-forms/public"
import { BOOKING_SIGNATURE_CONSENT } from "@/lib/booking-forms/template"
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad"
import { BRAND_RED, LOGO_MAIN } from "@/lib/branding"

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

function isoDate(value: string): string {
  return value.slice(0, 10)
}

export function SigningClient({
  token,
  form,
}: {
  token: string
  form: PublicBookingForm
}) {
  const padRef = useRef<SignaturePadHandle | null>(null)
  const [hasInk, setHasInk] = useState(false)
  const [signerName, setSignerName] = useState(form.snapshot.billTo.contactName)
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [declined, setDeclined] = useState(false)
  const [signed, setSigned] = useState(
    ["awaiting_zk_signature", "zk_signed", "completed"].includes(form.status),
  )
  const snapshot = form.snapshot
  const includeVat = snapshot.taxAmountIncluded > 0

  async function submit() {
    if (!signerName.trim()) {
      setError("Enter your full name.")
      return
    }
    const signatureDataUrl = padRef.current?.toDataURL() ?? ""
    if (!hasInk || !padRef.current?.hasInk() || !signatureDataUrl.startsWith("data:image/png")) {
      setError("Draw your signature in the box.")
      return
    }
    if (!consent) {
      setError("Please confirm the electronic signature consent.")
      return
    }
    setSubmitting(true)
    setError("")
    try {
      const response = await fetch("/api/booking-forms/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          signerName: signerName.trim(),
          signerEmail: snapshot.billTo.contactEmail,
          signatureDataUrl,
          consent: true,
        }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(payload.error || "Could not record your signature.")
      setSigned(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not record your signature.")
    } finally {
      setSubmitting(false)
    }
  }

  async function decline() {
    const reason = window.prompt("Optionally tell ZK why you are declining this booking form:") ?? ""
    if (!window.confirm("Decline this booking form and release the reserved stock?")) return
    setSubmitting(true)
    setError("")
    try {
      const response = await fetch("/api/booking-forms/decline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, reason }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(payload.error || "Could not decline this booking form.")
      setDeclined(true)
    } catch (declineError) {
      setError(declineError instanceof Error ? declineError.message : "Could not decline this booking form.")
    } finally {
      setSubmitting(false)
    }
  }

  const expiry = new Date(form.expiresAt).toLocaleString("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  })

  return (
    <main className="min-h-screen bg-[#f3f3f3] px-4 py-8 text-[#010101] sm:px-6 lg:py-12">
      <div className="mx-auto max-w-4xl">
        <section className="rounded-xl border border-[#e5e5e5] bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-8 px-8 py-8 sm:px-10">
            <div>
              <Image
                src={LOGO_MAIN.src}
                alt="ZK Sports & Entertainment"
                width={LOGO_MAIN.width}
                height={LOGO_MAIN.height}
                className="h-10 w-auto"
                sizes="200px"
                priority
              />
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[#6b6b6b]">
                <LockKeyhole className="h-3.5 w-3.5" />
                Encrypted secure link · expires {expiry} UTC
              </div>
            </div>
            <div className="text-right text-xs leading-6 text-[#010101]">
              {snapshot.seller.addressLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
              <div>TRN {snapshot.seller.trn}</div>
            </div>
          </div>

          <div className="grid gap-8 px-8 pb-4 sm:px-10 md:grid-cols-2">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: BRAND_RED }}>
                Quote N° {snapshot.documentRef}
              </h1>
              <p className="mt-3 text-sm">Date : {isoDate(snapshot.createdAt)}</p>
            </div>
            <div className="md:text-right">
              <div className="text-sm font-bold" style={{ color: BRAND_RED }}>
                BILL TO:
              </div>
              <div className="mt-2 space-y-0.5 text-sm leading-6">
                <div className="font-semibold">{snapshot.billTo.accountName}</div>
                <div>{snapshot.billTo.contactName}</div>
                <div>{snapshot.billTo.contactEmail}</div>
                {snapshot.billTo.addressLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </div>
          </div>

          <div className="px-8 py-8 sm:px-10">
            <h2 className="text-center text-base font-bold underline decoration-1 underline-offset-8">
              {snapshot.deal.title}
            </h2>
            {includeVat ? (
              <p className="mt-4 text-center text-xs text-[#6b6b6b]">Prices include 5% VAT</p>
            ) : null}

            <div className="mt-8 overflow-hidden rounded-md border border-[#e5e5e5]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-[#f0f0f0] text-[#6b6b6b]">
                    <th className="border-r border-[#e5e5e5] px-4 py-3 text-left font-semibold">Product</th>
                    <th className="border-r border-[#e5e5e5] px-4 py-3 text-right font-semibold">Price</th>
                    <th className="border-r border-[#e5e5e5] px-4 py-3 text-right font-semibold">Quantity</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.lines.map((line) => (
                    <tr key={`${line.packageId}-${line.description}`} className="border-t border-[#e5e5e5]">
                      <td className="border-r border-[#e5e5e5] px-4 py-4 font-medium leading-6">{line.description}</td>
                      <td className="border-r border-[#e5e5e5] px-4 py-4 text-right tabular-nums">
                        {money(line.unitPrice, line.currency)}
                      </td>
                      <td className="border-r border-[#e5e5e5] px-4 py-4 text-right tabular-nums">{line.quantity}</td>
                      <td className="px-4 py-4 text-right font-semibold tabular-nums">
                        {money(line.lineTotal, line.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-8 ml-auto w-full max-w-xs space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span>Section total</span>
                <span className="tabular-nums">{money(snapshot.subtotal, snapshot.currency)}</span>
              </div>
              {includeVat ? (
                <div className="flex justify-between text-[#6b6b6b]">
                  <span>{snapshot.taxDescription ?? "VAT included (5%)"}</span>
                  <span className="tabular-nums">
                    {money(snapshot.taxAmountIncluded, snapshot.currency)}
                  </span>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-[#e5e5e5] pt-3 text-base font-bold">
                <span>Total</span>
                <span className="tabular-nums">{money(snapshot.total, snapshot.currency)}</span>
              </div>
            </div>

            <div className="mt-12 grid gap-10 md:grid-cols-[1fr_280px] md:items-end">
              <p className="text-xs font-bold uppercase leading-6 tracking-wide">
                {snapshot.acknowledgement}
              </p>
              <div>
                {declined ? (
                  <div className="rounded-md border border-[#e5e5e5] bg-[#f7f7f7] p-4 text-center text-sm">
                    Booking form declined. ZK has been notified.
                  </div>
                ) : signed ? (
                  <div className="rounded-md border border-[#e5e5e5] bg-[#f7f7f7] p-4 text-center">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-[#010101]" />
                    <p className="mt-2 text-sm font-bold">Your signature is complete</p>
                    <p className="mt-1 text-xs leading-5 text-[#6b6b6b]">
                      ZK has been notified. An approved admin must countersign before the
                      agreement is complete.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs font-semibold text-[#6b6b6b]">Client signature</label>
                      <button
                        type="button"
                        onClick={() => padRef.current?.clear()}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6b6b6b] hover:text-[#010101]"
                      >
                        <Eraser className="h-3.5 w-3.5" /> Clear
                      </button>
                    </div>
                    <SignaturePad
                      padRef={padRef}
                      disabled={signed}
                      onHasInkChange={setHasInk}
                      className="mt-3 h-28 w-full border-b border-[#010101] bg-white"
                    />
                    <p className="mt-2 text-xs text-[#6b6b6b]">Date : {isoDate(new Date().toISOString())}</p>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-[#e5e5e5] px-8 py-8 sm:px-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Agreement documents</h2>
              <a
                href={`/api/booking-forms/${encodeURIComponent(token)}/document`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-[#d4d4d4] px-3 py-2 text-sm font-semibold hover:bg-[#f7f7f7]"
              >
                <Download className="h-4 w-4" />
                View PDF
              </a>
            </div>
            <details className="mt-4 rounded-lg border border-[#e5e5e5]">
              <summary className="cursor-pointer px-4 py-3 font-semibold">
                Ticketing &amp; Hospitality Terms and Conditions
              </summary>
              <div className="max-h-[520px] overflow-y-auto border-t border-[#e5e5e5] px-4 py-5 text-sm leading-6 text-[#333]">
                {snapshot.terms.map((section) => (
                  <section key={section.heading} className="mb-5">
                    <h3 className="font-bold">{section.heading}</h3>
                    {section.paragraphs.map((paragraph) => (
                      <p key={paragraph} className="mt-2">{paragraph}</p>
                    ))}
                  </section>
                ))}
              </div>
            </details>
          </div>

          {!declined && !signed ? (
            <div className="border-t border-[#e5e5e5] px-8 py-8 sm:px-10">
              <label className="block text-sm font-semibold" htmlFor="signer-name">
                Full legal name
              </label>
              <input
                id="signer-name"
                value={signerName}
                onChange={(event) => setSignerName(event.target.value)}
                maxLength={160}
                className="mt-2 h-11 w-full rounded-md border border-[#d4d4d4] px-3 outline-none focus:border-[#F90202] focus:ring-2 focus:ring-[#F90202]/15"
              />
              <label className="mt-5 flex items-start gap-3 text-sm leading-6 text-[#333]">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-[#F90202]"
                />
                <span>{BOOKING_SIGNATURE_CONSENT}</span>
              </label>
              {error ? <p className="mt-4 text-sm font-semibold text-[#F90202]">{error}</p> : null}
              <button
                type="button"
                disabled={submitting}
                onClick={submit}
                className="mt-6 h-12 w-full rounded-md bg-[#010101] px-5 font-bold text-white hover:bg-[#222] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Recording secure signature…" : "Agree and sign booking form"}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={decline}
                className="mt-3 h-11 w-full rounded-md border border-[#d4d4d4] px-5 font-semibold text-[#6b6b6b] hover:bg-[#f7f7f7] disabled:opacity-60"
              >
                Decline booking form
              </button>
            </div>
          ) : null}
        </section>
        <p className="mt-5 text-center text-xs leading-5 text-[#6b6b6b]">
          Do not forward this private signing link. Signature evidence includes the document
          snapshot, timestamp, IP address, and browser details.
        </p>
      </div>
    </main>
  )
}
