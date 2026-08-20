"use client"

import { useRef, useState } from "react"
import { CheckCircle2, Download, Eraser, LockKeyhole } from "lucide-react"
import type { PublicBookingForm } from "@/lib/booking-forms/public"
import { BOOKING_SIGNATURE_CONSENT } from "@/lib/booking-forms/template"
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad"

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value)
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

  async function submit() {
    if (!signerName.trim()) {
      setError("Enter your full name.")
      return
    }
    if (!hasInk || !padRef.current) {
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
          signerEmail: form.snapshot.billTo.contactEmail,
          signatureDataUrl: padRef.current.toDataURL(),
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
    <main className="min-h-screen bg-[#f3f5f7] px-4 py-8 text-slate-900 sm:px-6 lg:py-12">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-[#0e1726] px-6 py-5 text-white shadow-sm">
          <div>
            <div className="text-xl font-black tracking-tight">ZK SPORTS</div>
            <div className="mt-1 text-sm text-slate-300">Secure booking-form signature</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <LockKeyhole className="h-4 w-4 text-emerald-400" />
            Encrypted secure link
          </div>
        </header>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-6 sm:px-8">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
              Booking form
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{form.snapshot.deal.title}</h1>
            <div className="mt-2 text-sm text-slate-500">
              Reference {form.snapshot.documentRef} · expires {expiry} UTC
            </div>
          </div>

          <div className="grid gap-8 px-6 py-7 sm:px-8 md:grid-cols-[1fr_280px]">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Bill to</h2>
              <div className="mt-2 text-base font-semibold">{form.snapshot.billTo.accountName}</div>
              <div className="text-sm text-slate-600">{form.snapshot.billTo.contactName}</div>
              <div className="text-sm text-slate-600">{form.snapshot.billTo.contactEmail}</div>
              {form.snapshot.billTo.addressLines.map((line) => (
                <div key={line} className="text-sm text-slate-600">{line}</div>
              ))}
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Total</div>
              <div className="mt-1 text-2xl font-black text-slate-950">
                {money(form.snapshot.total, form.snapshot.currency)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {form.snapshot.taxDescription ??
                  (form.snapshot.taxRate > 0 ? "5% UAE VAT included" : "0% VAT")}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 px-6 py-7 sm:px-8">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Products</h2>
            <div className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200">
              {form.snapshot.lines.map((line) => (
                <div key={`${line.packageId}-${line.description}`} className="flex items-start justify-between gap-5 p-4">
                  <div>
                    <div className="font-semibold">{line.description}</div>
                    <div className="mt-1 text-sm text-slate-500">
                      {line.quantity} × {money(line.unitPrice, line.currency)}
                      {(line.taxRate ?? form.snapshot.taxRate) > 0
                        ? " · 5% UAE VAT included"
                        : " · 0% VAT"}
                    </div>
                  </div>
                  <div className="shrink-0 font-bold">{money(line.lineTotal, line.currency)}</div>
                </div>
              ))}
            </div>
            <p className="mt-5 rounded-lg bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-950">
              {form.snapshot.acknowledgement}
            </p>
          </div>

          <div className="border-t border-slate-200 px-6 py-7 sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Agreement documents</h2>
              <a
                href={`/api/booking-forms/${encodeURIComponent(token)}/document`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50"
              >
                <Download className="h-4 w-4" />
                View PDF
              </a>
            </div>
            <details className="mt-4 rounded-lg border border-slate-200">
              <summary className="cursor-pointer px-4 py-3 font-semibold">
                Ticketing &amp; Hospitality Terms and Conditions
              </summary>
              <div className="max-h-[520px] overflow-y-auto border-t border-slate-200 px-4 py-5 text-sm leading-6 text-slate-700">
                {form.snapshot.terms.map((section) => (
                  <section key={section.heading} className="mb-5">
                    <h3 className="font-bold text-slate-950">{section.heading}</h3>
                    {section.paragraphs.map((paragraph) => (
                      <p key={paragraph} className="mt-2">{paragraph}</p>
                    ))}
                  </section>
                ))}
              </div>
            </details>
          </div>

          <div className="border-t border-slate-200 px-6 py-7 sm:px-8">
            {declined ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
                <h2 className="text-lg font-bold">Booking form declined</h2>
                <p className="mt-2 text-sm text-slate-600">
                  ZK has been notified and the reserved stock has been released.
                </p>
              </div>
            ) : signed ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
                <h2 className="mt-3 text-lg font-bold text-emerald-950">Your signature is complete</h2>
                <p className="mt-2 text-sm leading-6 text-emerald-800">
                  ZK has been notified. An approved admin must countersign before the agreement is
                  complete; both parties will then receive the final PDF.
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-bold">Client signature</h2>
                <p className="mt-1 text-sm text-slate-600">
                  The client signs first. ZK will countersign after review.
                </p>
                <label className="mt-5 block text-sm font-semibold" htmlFor="signer-name">
                  Full legal name
                </label>
                <input
                  id="signer-name"
                  value={signerName}
                  onChange={(event) => setSignerName(event.target.value)}
                  maxLength={160}
                  className="mt-2 h-11 w-full rounded-md border border-slate-300 px-3 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                />
                <div className="mt-5 flex items-center justify-between gap-3">
                  <label className="text-sm font-semibold">Draw signature</label>
                  <button
                    type="button"
                    onClick={() => padRef.current?.clear()}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-950"
                  >
                    <Eraser className="h-4 w-4" /> Clear
                  </button>
                </div>
                <SignaturePad
                  padRef={padRef}
                  disabled={signed}
                  onHasInkChange={setHasInk}
                  className="mt-2 h-44 w-full rounded-lg border-2 border-dashed border-slate-300 bg-white"
                />
                <label className="mt-5 flex items-start gap-3 text-sm leading-6 text-slate-700">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    className="mt-1 h-4 w-4 accent-emerald-600"
                  />
                  <span>{BOOKING_SIGNATURE_CONSENT}</span>
                </label>
                {error ? <p className="mt-4 text-sm font-semibold text-red-700">{error}</p> : null}
                <button
                  type="button"
                  disabled={submitting}
                  onClick={submit}
                  className="mt-6 h-12 w-full rounded-md bg-emerald-600 px-5 font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Recording secure signature…" : "Agree and sign booking form"}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={decline}
                  className="mt-3 h-11 w-full rounded-md border border-slate-300 px-5 font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  Decline booking form
                </button>
              </>
            )}
          </div>
        </section>
        <p className="mt-5 text-center text-xs leading-5 text-slate-500">
          Do not forward this private signing link. Signature evidence includes the document
          snapshot, timestamp, IP address, and browser details.
        </p>
      </div>
    </main>
  )
}

